import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker, { type Env } from "../src/index";
import * as observabilityModule from "../src/services/observability";
import * as pipelineModule from "../src/services/pipeline-orchestrator";
import * as distributedLockModule from "../src/services/distributed-lock";
import * as editorialApprovalModule from "../src/services/editorial-approval";
import * as carouselPersistenceModule from "../src/services/carousel-persistence";
import * as newsIngestionModule from "../src/services/news-ingestion";
import * as topicSelectionModule from "../src/services/topic-selection";
import * as contentGenerationModule from "../src/services/content-generation";
import * as carouselRenderingModule from "../src/services/carousel-rendering";
import * as telegramBotModule from "../src/services/telegram-bot";
import * as supabaseModule from "../src/services/supabase";
import { validateProductionReadiness } from "../scripts/validate-production-readiness";
import wranglerConfigRaw from "../wrangler.jsonc?raw";

const mockFullProdEnv: Env = {
	APP_ENV: "production",
	LAWBRIEFLY_API_URL: "https://lawbriefly.test/api/news",
	LAWBRIEFLY_API_KEY: "prod_lb_key_secret_12345",
	SUPABASE_URL: "https://kacfrcnzxstclzrceugg.supabase.co",
	SUPABASE_SECRET_KEY: "prod_sb_secret_token_67890",
	GROQ_API_KEY: "gsk_prod_groq_api_key_xyz",
	GROQ_MODEL: "openai/gpt-oss-120b",
	OPENROUTER_API_KEY: "sk-or-prod-openrouter-key",
	MERCURY_MODEL: "inception/mercury-decide:free",
	JINA_API_KEY: "jina_prod_key_abc",
	TELEGRAM_BOT_TOKEN: "9225365645:AAEc_mock_bot_token_secret",
	TELEGRAM_CHAT_ID: "-1001234567890",
	TELEGRAM_ALLOWED_USER_IDS: "1405876915,987654321",
	TELEGRAM_WEBHOOK_SECRET: "adad023fb8a54241342306718779c35c0460d65cf6e88278cc58ff66c4640c3a",
	INSTAGRAM_AUTH_MODE: "instagram_login",
	INSTAGRAM_ACCESS_TOKEN: "IGAAQs_prod_mock_instagram_access_token_xyz",
	INSTAGRAM_ACCOUNT_ID: "17841422733573452",
	INSTAGRAM_USER_ID: "17841422733573452",
	INSTAGRAM_GRAPH_VERSION: "v26.0",
	INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "false",
	AUTONOMOUS_PIPELINE_ENABLED: "false",
	OPS_ALERTS_ENABLED: "false",
	ADMIN_API_KEY: "super_secret_operator_admin_token_999",
};

const mockCtx: ExecutionContext = {
	waitUntil: vi.fn(),
	passThroughOnException: vi.fn(),
} as any;

describe("Task 21: LawBriefly Production Hardening & Deployment Readiness", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// 1. Production configuration validator detects missing variables
	it("1. Validator detects missing variables and reports NOT_READY", () => {
		const emptySummary = validateProductionReadiness({});
		expect(emptySummary.overallStatus).toBe("NOT_READY");
		expect(emptySummary.missingCount).toBeGreaterThan(0);
		expect(emptySummary.blockers.some((b) => b.includes("SUPABASE_URL"))).toBe(true);
		expect(emptySummary.blockers.some((b) => b.includes("TELEGRAM_BOT_TOKEN"))).toBe(true);
	});

	// 2. Validator never exposes secrets
	it("2. Validator never exposes raw secret values in output or logs", () => {
		const rawSecrets = {
			APP_ENV: "production",
			ADMIN_API_KEY: "sensitive_admin_key_alpha",
			SUPABASE_URL: "https://my-prod.supabase.co",
			SUPABASE_SECRET_KEY: "sensitive_supabase_secret_bravo",
			TELEGRAM_BOT_TOKEN: "sensitive_telegram_token_charlie",
			TELEGRAM_CHAT_ID: "-100111",
			TELEGRAM_ALLOWED_USER_IDS: "123",
			TELEGRAM_WEBHOOK_SECRET: "sensitive_wh_secret_delta",
			INSTAGRAM_ACCOUNT_ID: "12345",
			INSTAGRAM_ACCESS_TOKEN: "sensitive_ig_token_echo",
		};

		const summary = validateProductionReadiness(rawSecrets, { targetEnv: "production" });
		const serialized = JSON.stringify(summary);

		expect(serialized).not.toContain("sensitive_admin_key_alpha");
		expect(serialized).not.toContain("sensitive_supabase_secret_bravo");
		expect(serialized).not.toContain("sensitive_telegram_token_charlie");
		expect(serialized).not.toContain("sensitive_wh_secret_delta");
		expect(serialized).not.toContain("sensitive_ig_token_echo");

		// Secrets must be explicitly marked redacted in details
		const secretItems = summary.items.filter((i) => i.isSecret);
		expect(secretItems.length).toBeGreaterThan(0);
		secretItems.forEach((item) => {
			if (item.status === "CONFIGURED") {
				expect(item.details).toContain("redacted");
			}
		});
	});

	// 3. Development-only routes are inaccessible in production
	it("3. Development-only routes return 404 in production environment", async () => {
		const devOnlyRoutes = [
			{ path: "/api/news/sync", method: "POST" },
			{ path: "/api/news/batches", method: "GET" },
			{ path: "/api/ai/analyze-batches", method: "POST" },
			{ path: "/api/ai/select-hot-topic", method: "POST" },
			{ path: "/api/ai/extract-article", method: "POST" },
			{ path: "/api/ai/extract-topic-articles", method: "POST" },
			{ path: "/api/ai/generate-content", method: "POST" },
			{ path: "/api/ai/render-carousel", method: "POST" },
			{ path: "/api/ai/store-carousel", method: "POST" },
			{ path: "/api/ai/notify-editor", method: "POST" },
			{ path: "/api/ai/publish-instagram", method: "POST" },
			{ path: "/api/ai/recover-stranded-publications", method: "POST" },
			{ path: "/api/ai/run-pipeline", method: "POST" },
			{ path: "/api/health/supabase", method: "GET" },
			{ path: "/api/health/operations", method: "GET" },
		];

		for (const route of devOnlyRoutes) {
			const req = new Request(`https://test.lawbriefly.internal${route.path}`, {
				method: route.method,
				headers: { "Content-Type": "application/json" },
				body: route.method === "POST" ? JSON.stringify({}) : undefined,
			});
			const res = await worker.fetch(req, mockFullProdEnv, mockCtx);
			expect(res.status).toBe(404);
		}
	});

	// 4. Feature flags remain disabled by default
	it("4. Feature flags remain disabled by default and cron skips execution", async () => {
		const envWithDisabledFlags: Env = {
			...mockFullProdEnv,
			AUTONOMOUS_PIPELINE_ENABLED: "false",
			OPS_ALERTS_ENABLED: "false",
			INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "false",
		};

		const controller: ScheduledController = {
			cron: "0 2 * * *",
			scheduledTime: Date.now(),
			noRetry: vi.fn(),
		};

		const outcome = await pipelineModule.handleScheduledPipelineRun(controller, envWithDisabledFlags);
		expect(outcome).toHaveProperty("skipped", true);
		expect((outcome as any).reason).toBe("kill_switch_disabled");
	});

	// 5. Distributed lock fails closed
	it("5. Distributed lock fails closed (503) if Supabase RPC is unavailable in production", async () => {
		const envNoDb: Env = {
			...mockFullProdEnv,
			SUPABASE_SECRET_KEY: "", // missing config forces fail-closed
		};

		const outcome = await pipelineModule.executePipeline(envNoDb, {
			triggerType: "manual",
			runId: "prod-lock-test-1",
		});

		expect(outcome.success).toBe(false);
		expect(outcome.status).toBe(503);
		expect(outcome.stage).toBe("concurrency_lock");
	});

	// 6. Distributed lock configuration is validated
	it("6. Distributed lock configuration parameters are strictly bounded", () => {
		expect(distributedLockModule.DEFAULT_LEASE_DURATION_SECONDS).toBe(180);
		expect(distributedLockModule.DEFAULT_PIPELINE_LOCK_NAME).toBe("global_content_pipeline");
	});

	// 7. Critical writes cannot proceed after detected lease loss
	it("7. Orchestrator aborts before Stage 5 persistence if heartbeat renewal fails", async () => {
		vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
			success: true,
			result: { fetched_count: 5, valid_count: 5, invalid_count: 0, duplicate_count: 0, database_affected_count: 5 },
		} as any);

		vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
			success: true,
			data: {
				selection_status: "selected",
				selected_topic: {
					candidate_id: "cand-1",
					topic_title: "Test Topic",
					legal_domain: "law",
					jurisdiction: "india",
				},
			},
		} as any);

		vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
			success: true,
			data: {
				generation_status: "ready_for_review",
				topic: {
					candidate_id: "cand-1",
					topic_title: "Test Topic",
				},
				slides: [{ slide_number: 1, role: "hook", headline: "Headline", body: "Body" }],
			},
		} as any);

		vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockResolvedValue({
			manifest: { total_slides: 1, dimensions: "1080x1350", slides: [] },
			slides: [{ slide_number: 1, png_buffer: new Uint8Array([1, 2, 3]), mime_type: "image/png" }],
			zipBuffer: new Uint8Array([4, 5, 6]),
		} as any);

		vi.spyOn(distributedLockModule, "acquireDistributedPipelineLock").mockResolvedValue({
			success: true,
			lockName: "global_content_pipeline",
			ownerRunId: "run-stage-abort-test",
			ownerToken: "token-stage-abort-test",
			fencingToken: 42,
			leaseExpiresAt: new Date(Date.now() + 180000).toISOString(),
			reason: "acquired",
		});

		// Stage renewals succeed for stages 2, 3, 4, then FAILS before stage 5 persistence
		let renewCallCount = 0;
		vi.spyOn(distributedLockModule, "renewDistributedPipelineLock").mockImplementation(async () => {
			renewCallCount++;
			if (renewCallCount >= 4) {
				// 4th renewal is before Stage 5 (carousel_persistence)
				return {
					renewed: false,
					lockName: "global_content_pipeline",
					fencingToken: 42,
					reason: "fencing_token_mismatch",
				};
			}
			return {
				renewed: true,
				lockName: "global_content_pipeline",
				fencingToken: 42,
				leaseExpiresAt: new Date(Date.now() + 180000).toISOString(),
				reason: "renewed",
			};
		});

		const persistSpy = vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel");

		const outcome = await pipelineModule.executePipeline(mockFullProdEnv, {
			triggerType: "manual",
			runId: "run-stage-abort-test",
		});

		expect(outcome.success).toBe(false);
		expect(outcome.status).toBe(409);
		expect(outcome.error).toContain("carousel_persistence");
		expect(persistSpy).not.toHaveBeenCalled();
	});

	// 8. Quarantine queue metrics configuration is valid
	it("8. Quarantine queue metrics binding is registered in wrangler.jsonc and calls metrics()", async () => {
		expect(wranglerConfigRaw).toContain('"INSTAGRAM_QUARANTINE_QUEUE"');
		expect(wranglerConfigRaw).toContain('"instagram-publishing-quarantine"');

		const mockQuarantineQueue = {
			metrics: vi.fn().mockResolvedValue({
				backlogCount: 2,
				backlogBytes: 1024,
				oldestMessageTimestamp: new Date(Date.now() - 3600000), // 1 hour ago
			}),
		};

		const testEnv: Env = {
			...mockFullProdEnv,
			INSTAGRAM_QUARANTINE_QUEUE: mockQuarantineQueue as any,
		};

		const result = await observabilityModule.checkQuarantineBacklog(testEnv);
		expect(result.monitored).toBe(true);
		expect(result.backlogCount).toBe(2);
		expect(result.backlogBytes).toBe(1024);
		expect(result.ageSeconds).toBeGreaterThanOrEqual(3500);
	});

	// 9. Missing metrics are not treated as zero
	it("9. Missing quarantine metrics are not fabricated as zero", async () => {
		const brokenQuarantineQueue = {
			metrics: vi.fn().mockRejectedValue(new Error("Cloudflare metrics API unavailable")),
		};

		const testEnv: Env = {
			...mockFullProdEnv,
			INSTAGRAM_QUARANTINE_QUEUE: brokenQuarantineQueue as any,
		};

		const result = await observabilityModule.checkQuarantineBacklog(testEnv);
		expect(result.monitored).toBe(false);
		expect(result.backlogCount).toBeNull();
		expect(result.backlogBytes).toBeNull();
		expect(result.ageSeconds).toBeNull();
		expect(result.thresholdExceeded).toBe(false);
	});

	// 10. Backlog alert cooldown works
	it("10. Quarantine backlog alert respects 15-minute cooldown", async () => {
		const mockQuarantineQueue = {
			metrics: vi.fn().mockResolvedValue({
				backlogCount: 5,
				backlogBytes: 4096,
				oldestMessageTimestamp: new Date(Date.now() - 7200000), // 2 hours ago
			}),
		};

		const testEnv: Env = {
			...mockFullProdEnv,
			OPS_ALERTS_ENABLED: "true",
			INSTAGRAM_QUARANTINE_QUEUE: mockQuarantineQueue as any,
		};

		// Mock Telegram sendMessage and Supabase reservation RPC
		vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ ok: true } as any);

		const mockRpc = vi
			.fn()
			.mockResolvedValueOnce({ data: [{ reserved: true, reason: "reserved" }], error: null })
			.mockResolvedValueOnce({ data: null, error: null }) // confirm_operational_alert_sent
			.mockResolvedValueOnce({ data: [{ reserved: false, reason: "cooldown_active" }], error: null });

		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({ rpc: mockRpc } as any);

		const firstCheck = await observabilityModule.checkQuarantineBacklog(testEnv);
		expect(firstCheck.alertSent).toBe(true);

		const secondCheck = await observabilityModule.checkQuarantineBacklog(testEnv);
		expect(secondCheck.alertSent).toBe(false);
		expect(secondCheck.alertSuppressed).toBe(true);
	});

	// 11. Existing alert deduplication is preserved
	it("11. Operational alerting deduplicates repeated failures with 15-minute cooldown", async () => {
		const testEnv: Env = {
			...mockFullProdEnv,
			OPS_ALERTS_ENABLED: "true",
		};

		const mockSupabase = {
			rpc: vi.fn().mockResolvedValue({
				data: [{ reserved: false, reason: "cooldown_active", cooldown_remaining_seconds: 850 }],
				error: null,
			}),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

		const result = await observabilityModule.sendOperationalAlert(testEnv, {
			triggerType: "scheduled",
			stage: "news_ingestion",
			errorCategory: "NETWORK_TIMEOUT",
			errorMessage: "Test network timeout error",
		});

		expect(result.sent).toBe(false);
		expect(result.reason).toBe("cooldown_active");
	});

	// 12. Replay tooling requires authorization
	it("12. Replay endpoint returns 401 Unauthorized without valid ADMIN_API_KEY", async () => {
		const req = new Request("https://test.local/api/admin/quarantine/re-enqueue-dlq", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ dlq_message_id: "msg-123" }),
		});

		const res = await worker.fetch(req, mockFullProdEnv, mockCtx);
		expect(res.status).toBe(401);
	});

	// 13. Replay tooling rejects malformed payloads
	it("13. Replay endpoint rejects malformed payload with 400 Bad Request", async () => {
		const req = new Request("https://test.local/api/admin/quarantine/re-enqueue-dlq", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Admin-Key": mockFullProdEnv.ADMIN_API_KEY!,
			},
			body: JSON.stringify({}), // Missing target identifier
		});

		const res = await worker.fetch(req, mockFullProdEnv, mockCtx);
		expect(res.status).toBe(400);
	});

	// 14. Replay operation is idempotent
	it("14. Replay endpoint returns 409 Conflict if record has already been replayed", async () => {
		const mockSupabase = {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: {
								id: "dlq-event-uuid-1",
								dlq_message_id: "msg-replayed-1",
								post_id: "post-uuid-1",
								job_id: "publish:post-uuid-1",
								processing_status: "replayed", // Already replayed
							},
							error: null,
						}),
					}),
				}),
			}),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

		const req = new Request("https://test.local/api/admin/quarantine/re-enqueue-dlq", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Admin-Key": mockFullProdEnv.ADMIN_API_KEY!,
			},
			body: JSON.stringify({ dlq_message_id: "msg-replayed-1" }),
		});

		const res = await worker.fetch(req, mockFullProdEnv, mockCtx);
		expect(res.status).toBe(409);
		const data = await res.json<any>();
		expect(data.is_duplicate).toBe(true);
	});

	// 15. Replay tooling cannot call Instagram publishing directly
	it("15. Replay endpoint enqueues to Queue and never invokes Instagram publishing directly", async () => {
		const queueSendSpy = vi.fn().mockResolvedValue({ metadata: { metrics: {} } });
		const testEnv: Env = {
			...mockFullProdEnv,
			INSTAGRAM_PUBLISHING_QUEUE: { send: queueSendSpy } as any,
		};

		const updateSpy = vi.fn().mockReturnValue({
			eq: vi.fn().mockResolvedValue({ data: null, error: null }),
		});

		const mockSupabase = {
			from: vi.fn((table: string) => {
				if (table === "dead_letter_events") {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: {
										id: "dlq-event-uuid-2",
										dlq_message_id: "msg-quarantined-2",
										post_id: "post-uuid-2",
										job_id: "publish:post-uuid-2",
										processing_status: "quarantined",
									},
									error: null,
								}),
							}),
						}),
						update: updateSpy,
					};
				}
				return {};
			}),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

		const req = new Request("https://test.local/api/admin/quarantine/re-enqueue-dlq", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Admin-Key": testEnv.ADMIN_API_KEY!,
			},
			body: JSON.stringify({ dlq_message_id: "msg-quarantined-2" }),
		});

		const res = await worker.fetch(req, testEnv, mockCtx);
		expect(res.status).toBe(200);
		expect(queueSendSpy).toHaveBeenCalledTimes(1);
		expect(queueSendSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				job_id: "publish:post-uuid-2",
				post_id: "post-uuid-2",
				replayed_from_dlq: true,
			})
		);
		expect(updateSpy).toHaveBeenCalledWith({ processing_status: "replayed" });
	});

	// 16. Telegram callback authentication remains strict
	it("16. Telegram webhook rejects invalid or missing secret token header with 401", async () => {
		const req = new Request("https://test.local/api/webhooks/telegram", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Telegram-Bot-Api-Secret-Token": "wrong_secret_token",
			},
			body: JSON.stringify({ update_id: 12345 }),
		});

		const res = await worker.fetch(req, mockFullProdEnv, mockCtx);
		expect(res.status).toBe(401);
	});

	// 17. Unauthorized users cannot approve posts
	it("17. Telegram webhook rejects approval callbacks from unauthorized user IDs", async () => {
		const unauthorizedUpdate = {
			update_id: 99999,
			callback_query: {
				id: "cb-unauth-1",
				from: { id: 999999999, first_name: "Intruder" }, // Not in TELEGRAM_ALLOWED_USER_IDS
				data: "a:0123456789abcdef0123456789abcdef",
				message: { message_id: 888, chat: { id: -1001234567890 } },
			},
		};

		const req = new Request("https://test.local/api/webhooks/telegram", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Telegram-Bot-Api-Secret-Token": mockFullProdEnv.TELEGRAM_WEBHOOK_SECRET!,
			},
			body: JSON.stringify(unauthorizedUpdate),
		});

		const res = await worker.fetch(req, mockFullProdEnv, mockCtx);
		expect(res.status).toBe(200);
		const data = await res.json<any>();
		expect(data.success).toBe(false);
		expect(data.error_code).toBe("UNAUTHORIZED_USER");
	});

	// 18. Publishing approval remains mandatory
	it("18. Publishing approval remains mandatory when INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL is false", () => {
		const isAllowed = editorialApprovalModule.isAutoPublishAllowed(
			mockFullProdEnv,
			"post-uuid-arbitrary-1"
		);
		expect(isAllowed).toBe(false);
	});

	// 19. Instagram duplicate-prevention tests remain intact
	it("19. Deterministic publishing job IDs prevent duplicate publishing jobs", () => {
		const id1 = editorialApprovalModule.deterministicPublishingJobId(
			"post-123",
			"approval-req-456"
		);
		const id2 = editorialApprovalModule.deterministicPublishingJobId(
			"post-123",
			"approval-req-456"
		);
		expect(id1).toBe(id2);
		expect(id1).toBe("publish:post-123:approval-req-456");
	});

	// 20. Existing DLQ and outbox recovery behavior remains intact
	it("20. Scheduled sweep runs stranded outbox recovery and quarantine backlog checks", async () => {
		const recoverSpy = vi.spyOn(editorialApprovalModule, "recoverStrandedApprovedPosts").mockResolvedValue({
			recovered_count: 0,
			enqueued_count: 0,
			failed_count: 0,
			post_ids: [],
		});

		const backlogSpy = vi.spyOn(observabilityModule, "checkQuarantineBacklog").mockResolvedValue({
			monitored: true,
			backlogCount: 0,
			backlogBytes: 0,
			oldestMessageTimestamp: null,
			ageSeconds: null,
			thresholdExceeded: false,
		});

		const controller: ScheduledController = {
			cron: "*/15 * * * *",
			scheduledTime: Date.now(),
			noRetry: vi.fn(),
		};

		const envWithAutoPublish = {
			...mockFullProdEnv,
			INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "true",
		};

		await worker.scheduled(controller, envWithAutoPublish, mockCtx);
		expect(recoverSpy).toHaveBeenCalledTimes(1);
		expect(backlogSpy).toHaveBeenCalledTimes(1);
	});
});
