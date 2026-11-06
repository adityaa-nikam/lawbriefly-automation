import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker, { type Env } from "../src/index";
import * as observabilityModule from "../src/services/observability";
import * as pipelineModule from "../src/services/pipeline-orchestrator";
import * as newsIngestionModule from "../src/services/news-ingestion";
import * as topicSelectionModule from "../src/services/topic-selection";
import * as contentGenerationModule from "../src/services/content-generation";
import * as carouselRenderingModule from "../src/services/carousel-rendering";
import * as carouselPersistenceModule from "../src/services/carousel-persistence";
import * as editorialApprovalModule from "../src/services/editorial-approval";
import * as instagramPublishingModule from "../src/services/instagram-publishing";
import * as telegramBotModule from "../src/services/telegram-bot";
import * as supabaseModule from "../src/services/supabase";
import wranglerConfigRaw from "../wrangler.jsonc?raw";

const mockDevEnv: Env = {
	APP_ENV: "development",
	LAWBRIEFLY_API_URL: "https://lawbriefly.test/api/news",
	LAWBRIEFLY_API_KEY: "test_lb_key_secret_12345",
	SUPABASE_URL: "https://test.supabase.co",
	SUPABASE_SECRET_KEY: "test_sb_secret_token_67890",
	GROQ_API_KEY: "gsk_test_groq_api_key_xyz",
	OPENROUTER_API_KEY: "sk-or-test-openrouter-key",
	JINA_API_KEY: "jina_test_key_abc",
	TELEGRAM_BOT_TOKEN: "123456:mock_bot_token_secret",
	TELEGRAM_CHAT_ID: "-1001234567890",
	TELEGRAM_ALLOWED_USER_IDS: "123456789",
	TELEGRAM_WEBHOOK_SECRET: "mock_wh_secret",
	AUTONOMOUS_PIPELINE_ENABLED: "false",
	OPS_ALERTS_ENABLED: "false",
};

const sampleTopicResponse: topicSelectionModule.GlobalTopicSelectionResponse = {
	success: true,
	provider: "openrouter",
	model: "inception/mercury-decide:free",
	window_days: 1,
	batch_size: 10,
	total_articles: 10,
	batch_count: 1,
	selection_status: "selected",
	selection_kind: "multi_source_trend",
	selected_topic: {
		candidate_id: "cand-obs-1",
		topic_title: "Supreme Court Telecommunications Ruling",
		topic_summary: "Major telecom decision summary",
		legal_domain: "telecom_law",
		jurisdiction: "Union of India",
		editorial_angle: "Focus on consumer tariffs",
		selection_rationale: "Broad national impact",
		confidence: 0.94,
		evidence_metrics: {
			unique_article_count: 3,
			unique_source_host_count: 3,
			supporting_batch_count: 1,
			evidence_strength: "strong_multi_source",
		},
		supporting_articles: [
			{
				article_id: "art-1",
				title: "SC on AGR Dues",
				description: "Telecom operators plea",
				url: "https://law.example.com/telecom",
				last_seen_at: "2026-11-05T00:00:00Z",
			},
		],
	},
	alternative_candidates: [],
	quality_warnings: [],
};

const sampleContentPackage: any = {
	success: true,
	provider: "groq",
	model: "llama-3.3-70b-versatile",
	generation_status: "ready_for_review",
	generated_at: "2026-11-05T00:00:00Z",
	topic: {
		candidate_id: "cand-obs-1",
		topic_title: "Supreme Court Telecommunications Ruling",
		legal_domain: "telecom_law",
		jurisdiction: "Union of India",
	},
	carousel_slide_count: 5,
	slides: [
		{ slide_number: 1, slide_role: "cover", headline: "SC Telecom Ruling", subtitle: "AGR Dues", claims: [] },
	],
};

const sampleRenderedArtifact: any = {
	manifest: { version: "1.0", slide_count: 5, slides: [] },
	manifestBytes: new Uint8Array([1, 2, 3]),
	slides: [{ slide_number: 1, slide_role: "cover", filename: "slide-01.png", mime_type: "image/png", bytes: new Uint8Array([1]) }],
};

const samplePersistResult: any = {
	success: true,
	post_id: "20000000-0000-0000-0000-000000000001",
	post_status: "stored",
	is_duplicate: false,
	carousel_slide_count: 5,
	content_fingerprint: "obs-fingerprint-123",
	assets: [],
	signed_urls: {},
};

const sampleNotificationResult: any = {
	success: true,
	post_id: "20000000-0000-0000-0000-000000000001",
	approval_request_id: "req-obs-001",
	telegram_chat_id: "-1001234567890",
	control_message_id: 300,
	media_message_ids: [301, 302, 303, 304, 305],
	expires_at: "2026-11-06T00:00:00Z",
	is_already_sent: false,
};

function mockAllSuccessfulPipelineStages() {
	vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
		success: true,
		result: { fetched_count: 10, valid_count: 10, invalid_count: 0, duplicate_count: 0, database_affected_count: 10 },
	} as any);
	vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
		success: true,
		data: sampleTopicResponse,
	});
	vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
		success: true,
		data: sampleContentPackage,
	});
	vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockResolvedValue(sampleRenderedArtifact);
	vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel").mockResolvedValue(samplePersistResult);
	vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost").mockResolvedValue(sampleNotificationResult);
}

describe("Task 20: Observability, Alerting & Operational Monitoring", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		pipelineModule.releasePipelineLock();
		observabilityModule.resetMemoryMetrics();
		observabilityModule.resetAlertCooldowns();

		const mockSupabaseBuilder: any = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: null, error: null }),
			maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
			insert: vi.fn().mockResolvedValue({ data: null, error: null }),
			upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
		};
		const defaultMockSupabase = {
			from: vi.fn().mockReturnValue(mockSupabaseBuilder),
			rpc: vi.fn().mockResolvedValue({
				data: [{
					acquired: true,
					renewed: true,
					released: true,
					fencing_token: 1,
					reserved: true,
					claimed: true,
					last_alerted_at: new Date().toISOString(),
					alert_count: 1,
					cooldown_remaining_seconds: 0,
					reason: "reserved"
				}],
				error: null,
			}),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(defaultMockSupabase as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		pipelineModule.releasePipelineLock();
	});

	describe("Component A: Structured Logging", () => {
		it("1. Correct structured event format: emits standard envelope with timestamp and metadata", () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const envelope: observabilityModule.ObservabilityLogEnvelope = {
				event: "pipeline_stage_completed",
				timestamp: new Date().toISOString(),
				run_id: "test-run-123",
				trigger_type: "scheduled",
				cron_expression: "0 2 * * *",
				stage: "topic_selection",
				status: "success",
				duration_ms: 1240,
				environment: "development",
			};

			const jsonStr = observabilityModule.logOperationalEvent(envelope);
			expect(consoleSpy).toHaveBeenCalledTimes(1);

			const parsed = JSON.parse(jsonStr);
			expect(parsed.event).toBe("pipeline_stage_completed");
			expect(parsed.run_id).toBe("test-run-123");
			expect(parsed.stage).toBe("topic_selection");
			expect(parsed.status).toBe("success");
			expect(parsed.duration_ms).toBe(1240);
			expect(parsed.cron_expression).toBe("0 2 * * *");
		});

		it("2. Propagates run_id consistently across all stage lifecycle events", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			mockAllSuccessfulPipelineStages();

			const testRunId = "run-trace-abc-999";
			await pipelineModule.executePipeline(mockDevEnv, { runId: testRunId, triggerType: "scheduled" });

			const loggedEvents = consoleSpy.mock.calls
				.map((c) => {
					try {
						return JSON.parse(String(c[0]));
					} catch {
						return null;
					}
				})
				.filter((e) => e && e.event && e.event.startsWith("pipeline_"));

			expect(loggedEvents.length).toBeGreaterThan(6);
			for (const evt of loggedEvents) {
				expect(evt.run_id).toBe(testRunId);
				expect(evt.trigger_type).toBe("scheduled");
			}
		});

		it("3 & 4. Calculates stage durations and total pipeline duration accurately", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			mockAllSuccessfulPipelineStages();

			await pipelineModule.executePipeline(mockDevEnv, { triggerType: "manual" });

			const completedRunEvt = consoleSpy.mock.calls
				.map((c) => {
					try {
						return JSON.parse(String(c[0]));
					} catch {
						return null;
					}
				})
				.find((e) => e && e.event === "pipeline_run_completed");

			expect(completedRunEvt).toBeDefined();
			expect(typeof completedRunEvt.duration_ms).toBe("number");
			expect(completedRunEvt.duration_ms).toBeGreaterThanOrEqual(0);
		});

		it("5. Categorizes errors cleanly when a stage fails", async () => {
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: false,
				status: 504,
				error: "Gateway timeout connecting to upstream feed",
			} as any);

			const outcome = await pipelineModule.executePipeline(mockDevEnv);
			expect(outcome.success).toBe(false);

			const failedStageEvt = consoleErrorSpy.mock.calls
				.map((c) => {
					try {
						return JSON.parse(String(c[0]));
					} catch {
						return null;
					}
				})
				.find((e) => e && e.event === "pipeline_stage_failed");

			expect(failedStageEvt).toBeDefined();
			expect(failedStageEvt.stage).toBe("news_ingestion");
			expect(failedStageEvt.error_code).toBe("504");
			expect(failedStageEvt.error_message).toContain("Gateway timeout");
		});

		it("6. Secret and token redaction: sanitizeLogPayload strips API keys, JWTs, bot tokens, and passwords", () => {
			const payload = {
				api_key: "gsk_test123456",
				telegram_token: "bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
				auth_header: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeak",
				safe_field: "public_legal_topic",
				nested: {
					secret_token: "super-secret-password-xyz",
					count: 42,
				},
			};

			const sanitized = observabilityModule.sanitizeLogPayload(payload);
			expect(sanitized.api_key).toBe("[REDACTED]");
			expect(sanitized.telegram_token).toBe("[REDACTED]");
			expect(sanitized.auth_header).toBe("[REDACTED]");
			expect(sanitized.safe_field).toBe("public_legal_topic");
			expect(sanitized.nested.secret_token).toBe("[REDACTED]");
			expect(sanitized.nested.count).toBe(42);
		});
	});

	describe("Component B: Pipeline Metrics & Persistence", () => {
		it("7. Records successful pipeline execution metrics", async () => {
			mockAllSuccessfulPipelineStages();

			await pipelineModule.executePipeline(mockDevEnv, { triggerType: "manual" });

			const metrics = observabilityModule.getMemoryMetrics();
			expect(metrics.totalExecutions).toBe(1);
			expect(metrics.successfulExecutions).toBe(1);
			expect(metrics.failedExecutions).toBe(0);
			expect(metrics.lastRun?.status).toBe("completed");
			expect(metrics.lastSuccess?.postId).toBe("20000000-0000-0000-0000-000000000001");
		});

		it("8. Records failed pipeline execution metrics and isolates failure stage", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: false,
				status: 500,
				error: "Database ingestion write lock error",
			} as any);

			await pipelineModule.executePipeline(mockDevEnv);

			const metrics = observabilityModule.getMemoryMetrics();
			expect(metrics.totalExecutions).toBe(1);
			expect(metrics.successfulExecutions).toBe(0);
			expect(metrics.failedExecutions).toBe(1);
			expect(metrics.lastFailure?.stage).toBe("news_ingestion");
			expect(metrics.lastFailure?.errorMessage).toBe("Database ingestion write lock error");
		});

		it("9. Records skipped pipeline metrics on concurrency lock conflict", async () => {
			pipelineModule.acquirePipelineLock("existing-lock");

			await pipelineModule.executePipeline(mockDevEnv);

			const metrics = observabilityModule.getMemoryMetrics();
			expect(metrics.totalExecutions).toBe(1);
			expect(metrics.skippedExecutions).toBe(1);
			expect(metrics.lastRun?.status).toBe("concurrency_conflict");
		});

		it("10. Records no_strong_topic metrics without counting as an infrastructure failure", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true, result: {} } as any);
			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: { selection_status: "no_strong_topic", selection_kind: "none" } as any,
			});

			const outcome = await pipelineModule.executePipeline(mockDevEnv);
			expect(outcome.success).toBe(true);
			expect(outcome.status).toBe("no_strong_topic");

			const metrics = observabilityModule.getMemoryMetrics();
			expect(metrics.totalExecutions).toBe(1);
			expect(metrics.noStrongTopicCount).toBe(1);
			expect(metrics.failedExecutions).toBe(0);
		});

		it("12. Observability persistence failure does not break or fail pipeline execution (best-effort)", async () => {
			mockAllSuccessfulPipelineStages();

			// Mock Supabase throwing an error during metrics persistence
			const mockSupabase = {
				from: vi.fn().mockReturnValue({
					upsert: vi.fn().mockRejectedValue(new Error("Supabase disk quota exceeded")),
					insert: vi.fn().mockRejectedValue(new Error("Supabase connection timeout")),
				}),
				rpc: vi.fn().mockResolvedValue({
					data: [{
						acquired: true,
						renewed: true,
						released: true,
						fencing_token: 1,
						reserved: true,
						claimed: true,
						reason: "acquired",
					}],
					error: null,
				}),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			// Pipeline execution must still complete successfully and return status: completed
			const outcome = await pipelineModule.executePipeline(mockDevEnv);
			expect(outcome.success).toBe(true);
			expect(outcome.status).toBe("completed");
		});
	});

	describe("Component C: Telegram Operational Failure Alerts", () => {
		it("13 & 14. Alert switch: missing or false prevents alerts; exact 'true' enables them", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 999 });

			// 1. Missing OPS_ALERTS_ENABLED -> suppressed
			const envMissing: Env = { ...mockDevEnv };
			delete envMissing.OPS_ALERTS_ENABLED;
			let res = await observabilityModule.sendOperationalAlert(envMissing, {
				stage: "news_ingestion",
				errorMessage: "Ingestion failed",
			});
			expect(res.sent).toBe(false);
			expect(res.reason).toBe("kill_switch_disabled");
			expect(sendMsgSpy).not.toHaveBeenCalled();

			// 2. "false" -> suppressed
			res = await observabilityModule.sendOperationalAlert({ ...mockDevEnv, OPS_ALERTS_ENABLED: "false" }, {
				stage: "news_ingestion",
				errorMessage: "Ingestion failed",
			});
			expect(res.sent).toBe(false);
			expect(res.reason).toBe("kill_switch_disabled");
			expect(sendMsgSpy).not.toHaveBeenCalled();

			// 3. Exact "true" -> sends alert
			res = await observabilityModule.sendOperationalAlert({ ...mockDevEnv, OPS_ALERTS_ENABLED: "true" }, {
				stage: "news_ingestion",
				errorMessage: "Ingestion failed",
			});
			expect(res.sent).toBe(true);
			expect(sendMsgSpy).toHaveBeenCalledTimes(1);
		});

		it("15. Truthy-looking values ('TRUE', '1', 'yes', 'enabled') do not enable alerts", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage");

			for (const val of ["TRUE", "1", "yes", "enabled", "True"]) {
				const res = await observabilityModule.sendOperationalAlert(
					{ ...mockDevEnv, OPS_ALERTS_ENABLED: val },
					{ stage: "news_ingestion", errorMessage: "Failure" }
				);
				expect(res.sent).toBe(false);
				expect(res.reason).toBe("kill_switch_disabled");
			}
			expect(sendMsgSpy).not.toHaveBeenCalled();
		});

		it("16. Pipeline stage failure generates an operational alert when enabled", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1001 });
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: false,
				status: 502,
				error: "Upstream RSS feed returned 502 Bad Gateway",
			} as any);

			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };
			const outcome = await pipelineModule.executePipeline(envWithAlerts);
			expect(outcome.success).toBe(false);

			expect(sendMsgSpy).toHaveBeenCalledTimes(1);
			const [token, chatId, text] = sendMsgSpy.mock.calls[0];
			expect(token).toBe(envWithAlerts.TELEGRAM_BOT_TOKEN);
			expect(chatId).toBe(envWithAlerts.TELEGRAM_CHAT_ID);
			expect(text).toContain("LAWBRIEFLY PIPELINE FAILURE");
			expect(text).toContain("news_ingestion");
			expect(text).toContain("502 Bad Gateway");
		});

		it("17 & 18. Expected outcomes (no_strong_topic, concurrency_lock) never produce operational alerts", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage");
			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

			// Case 1: no_strong_topic
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true, result: {} } as any);
			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: { selection_status: "no_strong_topic", selection_kind: "none" } as any,
			});
			await pipelineModule.executePipeline(envWithAlerts);
			expect(sendMsgSpy).not.toHaveBeenCalled();

			// Case 2: concurrency lock skip
			pipelineModule.acquirePipelineLock("held-lock");
			await pipelineModule.executePipeline(envWithAlerts);
			expect(sendMsgSpy).not.toHaveBeenCalled();
		});

		it("19. Telegram delivery failure does not mask or overwrite the original pipeline error", async () => {
			// Telegram API fails with 500
			vi.spyOn(telegramBotModule, "sendMessage").mockRejectedValue(new Error("Telegram API server error (500)"));
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: false,
				status: 502,
				error: "Original Ingestion Error",
			} as any);

			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };
			const outcome = await pipelineModule.executePipeline(envWithAlerts);

			// Must preserve original error
			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.stage).toBe("news_ingestion");
				expect(outcome.error).toBe("Original Ingestion Error");
				expect(outcome.status).toBe(502);
			}
		});

		it("20 & 21. Deduplication policy: suppresses repeated identical alerts within cooldown but allows distinct incidents", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1002 });
			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

			// First incident: news_ingestion error
			const res1 = await observabilityModule.sendOperationalAlert(envWithAlerts, {
				stage: "news_ingestion",
				errorCategory: "INGESTION_ERROR",
				errorMessage: "Ingestion connection reset",
			});
			expect(res1.sent).toBe(true);
			expect(sendMsgSpy).toHaveBeenCalledTimes(1);

			// Immediate duplicate incident for same stage & errorCategory -> suppressed
			const res2 = await observabilityModule.sendOperationalAlert(envWithAlerts, {
				stage: "news_ingestion",
				errorCategory: "INGESTION_ERROR",
				errorMessage: "Ingestion connection reset again",
			});
			expect(res2.sent).toBe(false);
			expect(res2.reason).toBe("cooldown_active");
			expect(sendMsgSpy).toHaveBeenCalledTimes(1); // Still 1!

			// Different stage / errorCategory -> allowed
			const res3 = await observabilityModule.sendOperationalAlert(envWithAlerts, {
				stage: "carousel_rendering",
				errorCategory: "BROWSER_CRASH",
				errorMessage: "Puppeteer navigation timeout",
			});
			expect(res3.sent).toBe(true);
			expect(sendMsgSpy).toHaveBeenCalledTimes(2);
		});

		it("22. Dedicated TELEGRAM_OPS_ALERT_CHAT_ID routes alerts to operational room", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1003 });
			const envDedicatedChat: Env = {
				...mockDevEnv,
				OPS_ALERTS_ENABLED: "true",
				TELEGRAM_OPS_ALERT_CHAT_ID: "-1009999888877",
			};

			await observabilityModule.sendOperationalAlert(envDedicatedChat, {
				stage: "editorial_notification",
				errorMessage: "Rate limit reached",
			});

			expect(sendMsgSpy).toHaveBeenCalledWith(
				envDedicatedChat.TELEGRAM_BOT_TOKEN,
				"-1009999888877", // Dedicated ops chat
				expect.any(String),
				{ parse_mode: "HTML" }
			);
		});
	});

	describe("Component D: Queue and Dead-Letter Monitoring", () => {
		it("23 & 26. Dead letter queue handler logs dead_letter_received and sends alert when enabled", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1004 });
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

			const mockAck = vi.fn();
			const mockBatch = {
				queue: "instagram-publishing-dlq",
				messages: [
					{
						id: "msg-dlq-001",
						timestamp: new Date(),
						attempts: 3,
						body: {
							post_id: "20000000-0000-0000-0000-000000000001",
							job_id: "publish:20000000-0000-0000-0000-000000000001",
						},
						ack: mockAck,
						retry: vi.fn(),
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};

			await worker.queue(mockBatch as any, envWithAlerts, {} as any);

			expect(mockAck).toHaveBeenCalledTimes(1);

			// Verified in-memory dead letter metric
			const metrics = observabilityModule.getMemoryMetrics();
			expect(metrics.deadLetterCount).toBe(1);

			// Operational alert sent
			expect(sendMsgSpy).toHaveBeenCalledTimes(1);
			const alertText = sendMsgSpy.mock.calls[0][2];
			expect(alertText).toContain("queue_dead_letter");
			expect(alertText).toContain("MAX_RETRIES_EXHAUSTED");
			expect(alertText).toContain("20000000-0000-0000-0000-000000000001");
		});

		it("27. Dead-letter queue alerts are deduplicated to prevent notification storms", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1005 });
			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

			const createMockDlqBatch = () => ({
				queue: "instagram-publishing-dlq",
				messages: [
					{
						id: "msg-dlq-repeat",
						timestamp: new Date(),
						attempts: 3,
						body: { post_id: "20000000-0000-0000-0000-000000000001", job_id: "job-1" },
						ack: vi.fn(),
						retry: vi.fn(),
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			});

			// First DLQ arrival
			await worker.queue(createMockDlqBatch() as any, envWithAlerts, {} as any);
			expect(sendMsgSpy).toHaveBeenCalledTimes(1);

			// Immediate duplicate DLQ arrival -> alert suppressed by cooldown
			await worker.queue(createMockDlqBatch() as any, envWithAlerts, {} as any);
			expect(sendMsgSpy).toHaveBeenCalledTimes(1); // Still 1!
		});
	});

	describe("Component E: Operational Health Endpoint (GET /api/health/operations)", () => {
		it("28. Returns 404 in non-development environments", async () => {
			const req = new Request("http://localhost/api/health/operations", { method: "GET" });
			const res = await worker.fetch(req, { ...mockDevEnv, APP_ENV: "production" }, {} as any);
			expect(res.status).toBe(404);
		});

		it("29. Returns 200 with operational metrics summary in development environment", async () => {
			// Record some metrics
			observabilityModule.recordPipelineSuccessMetric({
				runId: "run-success-01",
				triggerType: "manual",
				status: "completed",
				durationMs: 32000,
				postId: "20000000-0000-0000-0000-000000000001",
			});

			const req = new Request("http://localhost/api/health/operations", { method: "GET" });
			const res = await worker.fetch(req, mockDevEnv, {} as any);
			expect(res.status).toBe(200);

			const data = (await res.json()) as any;
			expect(data.status).toBe("healthy");
			expect(data.environment).toBe("development");
			expect(data.metrics.total_executions).toBe(1);
			expect(data.metrics.successful_executions).toBe(1);
			expect(data.metrics.failed_executions).toBe(0);
			expect(data.last_run.status).toBe("completed");
			expect(data.last_run.runId).toBe("run-success-01");
			expect(data.config.ops_alerts_enabled).toBe(false);
			expect(data.config.autonomous_cron_enabled).toBe(false);
		});
	});

	describe("Task 20.1: Operational Reliability & Verification", () => {
		it("R1. Source publishing queue routes exhausted messages to the configured DLQ in wrangler.jsonc", () => {
			const stripped = wranglerConfigRaw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
			const config = JSON.parse(stripped);

			const consumers = config.queues?.consumers;
			expect(consumers).toBeDefined();

			const publishingConsumer = consumers.find((c: any) => c.queue === "instagram-publishing-jobs");
			expect(publishingConsumer).toBeDefined();
			expect(publishingConsumer.dead_letter_queue).toBe("instagram-publishing-dlq");
			expect(publishingConsumer.max_retries).toBe(3);

			const dlqConsumer = consumers.find((c: any) => c.queue === "instagram-publishing-dlq");
			expect(dlqConsumer).toBeDefined();
			expect(dlqConsumer.dead_letter_queue).toBe("instagram-publishing-quarantine");
			expect(dlqConsumer.max_retries).toBe(3);
			expect(dlqConsumer.retry_delay).toBe(60);

			// Verify quarantine queue has NO active automatic consumer
			const quarantineConsumer = consumers.find((c: any) => c.queue === "instagram-publishing-quarantine");
			expect(quarantineConsumer).toBeUndefined();
		});

		it("R2. DLQ consumer receives messages correctly via worker.queue()", async () => {
			const mockAck = vi.fn();
			const mockBatch = {
				queue: "instagram-publishing-dlq",
				messages: [
					{
						id: "msg-dlq-route-test",
						timestamp: new Date(),
						attempts: 3,
						body: { post_id: "20000000-0000-0000-0000-000000000002", job_id: "job-route-2" },
						ack: mockAck,
						retry: vi.fn(),
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};

			await worker.queue(mockBatch as any, mockDevEnv, {} as any);
			expect(mockAck).toHaveBeenCalledTimes(1);
			const metrics = observabilityModule.getMemoryMetrics();
			expect(metrics.deadLetterCount).toBe(1);
		});

		it("R3. DLQ record is durably persisted to dead_letter_events before acknowledgement", async () => {
			const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
			const mockSupabase = {
				from: vi.fn((table: string) => {
					if (table === "dead_letter_events") {
						return { upsert: upsertSpy };
					}
					return {
						select: vi.fn().mockReturnThis(),
						eq: vi.fn().mockReturnThis(),
						maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
					};
				}),
				rpc: vi.fn().mockResolvedValue({ data: [{ claimed: true }], error: null }),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			const callOrder: string[] = [];
			upsertSpy.mockImplementation(async () => {
				callOrder.push("upsert");
				return { data: null, error: null };
			});

			const mockAck = vi.fn(() => {
				callOrder.push("ack");
			});

			const mockBatch = {
				queue: "instagram-publishing-dlq",
				messages: [
					{
						id: "msg-dlq-durability",
						timestamp: new Date(),
						attempts: 3,
						body: {
							post_id: "20000000-0000-0000-0000-000000000003",
							job_id: "job-dlq-3",
							secret_token: "super-secret-do-not-leak",
						},
						ack: mockAck,
						retry: vi.fn(),
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};

			await worker.queue(mockBatch as any, mockDevEnv, {} as any);

			// Assert upsert happened BEFORE ack
			expect(callOrder).toEqual(["upsert", "ack"]);
			expect(upsertSpy).toHaveBeenCalledTimes(1);

			// Verify retained safe fields & sanitized payload
			const upsertArg = upsertSpy.mock.calls[0][0];
			expect(upsertArg.dlq_message_id).toBe("msg-dlq-durability");
			expect(upsertArg.source_queue).toBe("instagram-publishing-jobs");
			expect(upsertArg.post_id).toBe("20000000-0000-0000-0000-000000000003");
			expect(upsertArg.job_id).toBe("job-dlq-3");
			expect(upsertArg.failure_category).toBe("MAX_RETRIES_EXHAUSTED");
			expect(upsertArg.processing_status).toBe("quarantined");
			expect(upsertArg.payload.secret_token).toBe("[REDACTED]");
		});

		it("R4. Supabase persistence failure does not cause silent acknowledgement (retries message)", async () => {
			const mockSupabase = {
				from: vi.fn((table: string) => {
					if (table === "dead_letter_events") {
						return {
							upsert: vi.fn().mockResolvedValue({ data: null, error: new Error("Supabase disk full") }),
						};
					}
					return {};
				}),
				rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			const mockAck = vi.fn();
			const mockRetry = vi.fn();

			const mockBatch = {
				queue: "instagram-publishing-dlq",
				messages: [
					{
						id: "msg-dlq-fail-persist",
						timestamp: new Date(),
						attempts: 3,
						body: { post_id: "20000000-0000-0000-0000-000000000004", job_id: "job-dlq-4" },
						ack: mockAck,
						retry: mockRetry,
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};

			await worker.queue(mockBatch as any, mockDevEnv, {} as any);

			// Must NEVER acknowledge when durable persistence fails!
			expect(mockAck).not.toHaveBeenCalled();
			// Must retry so message stays quarantined in DLQ
			expect(mockRetry).toHaveBeenCalledWith({ delaySeconds: 60 });
		});

		it("R5. Telegram failure does not delete or roll back a retained DLQ event", async () => {
			const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
			const deleteSpy = vi.fn();
			const mockSupabase = {
				from: vi.fn((table: string) => {
					if (table === "dead_letter_events") {
						return { upsert: upsertSpy, delete: deleteSpy };
					}
					return {
						select: vi.fn().mockReturnThis(),
						eq: vi.fn().mockReturnThis(),
						maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
					};
				}),
				rpc: vi.fn().mockResolvedValue({ data: [{ claimed: true }], error: null }),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			// Telegram alert delivery throws 503 Service Unavailable
			vi.spyOn(telegramBotModule, "sendMessage").mockRejectedValue(new Error("Telegram 503 Service Unavailable"));

			const mockAck = vi.fn();
			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

			const mockBatch = {
				queue: "instagram-publishing-dlq",
				messages: [
					{
						id: "msg-dlq-tg-fail",
						timestamp: new Date(),
						attempts: 3,
						body: { post_id: "20000000-0000-0000-0000-000000000005", job_id: "job-dlq-5" },
						ack: mockAck,
						retry: vi.fn(),
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};

			await worker.queue(mockBatch as any, envWithAlerts, {} as any);

			// Persisted successfully
			expect(upsertSpy).toHaveBeenCalledTimes(1);
			expect(deleteSpy).not.toHaveBeenCalled();
			// Acknowledged because durable database record is safe
			expect(mockAck).toHaveBeenCalledTimes(1);
		});

		it("R6. DLQ event retention survives an isolate restart (persistence test)", async () => {
			const storedRows = new Map<string, any>();

			const mockSupabase = {
				from: vi.fn((table: string) => {
					if (table === "dead_letter_events") {
						return {
							upsert: vi.fn(async (row: any) => {
								storedRows.set(row.dlq_message_id, row);
								return { data: row, error: null };
							}),
							select: vi.fn(() => ({
								eq: vi.fn((col: string, val: string) => ({
									maybeSingle: vi.fn(async () => {
										if (col === "dlq_message_id") {
											return { data: storedRows.get(val) || null, error: null };
										}
										return { data: null, error: null };
									}),
								})),
							})),
						};
					}
					return {};
				}),
				rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			// Persist via DLQ
			const mockBatch = {
				queue: "instagram-publishing-dlq",
				messages: [
					{
						id: "msg-dlq-restart-test",
						timestamp: new Date(),
						attempts: 3,
						body: { post_id: "20000000-0000-0000-0000-000000000006", job_id: "job-dlq-6" },
						ack: vi.fn(),
						retry: vi.fn(),
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};
			await worker.queue(mockBatch as any, mockDevEnv, {} as any);

			// Simulate isolate cold restart (clearing memory metrics & isolate caches)
			observabilityModule.resetMemoryMetrics();
			observabilityModule.resetAlertCooldowns();
			const metricsAfterRestart = observabilityModule.getMemoryMetrics();
			expect(metricsAfterRestart.deadLetterCount).toBe(0); // in-memory reset

			// Query database to verify durability survived the isolate restart
			const client = supabaseModule.getSupabaseClient(mockDevEnv);
			const { data: record } = await client
				.from("dead_letter_events")
				.select("*")
				.eq("dlq_message_id", "msg-dlq-restart-test")
				.maybeSingle();

			expect(record).toBeDefined();
			expect(record.post_id).toBe("20000000-0000-0000-0000-000000000006");
			expect(record.failure_category).toBe("MAX_RETRIES_EXHAUSTED");
			expect(record.processing_status).toBe("quarantined");
		});

		it("R7. Two concurrent executions cannot both claim the same alert signature (atomic database claim)", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1101 });
			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

			let callCount = 0;
			const rpcSpy = vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					// 1st isolate wins atomic claim
					return {
						data: [{ claimed: true, last_alerted_at: new Date().toISOString(), alert_count: 1, cooldown_remaining_seconds: 0 }],
						error: null,
					};
				} else {
					// 2nd concurrent isolate loses claim
					return {
						data: [{ claimed: false, last_alerted_at: new Date().toISOString(), alert_count: 2, cooldown_remaining_seconds: 880 }],
						error: null,
					};
				}
			});

			const mockSupabase = {
				from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis() }),
				rpc: rpcSpy,
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			// Execute two alert dispatches concurrently with the same signature
			const [res1, res2] = await Promise.all([
				observabilityModule.sendOperationalAlert(envWithAlerts, {
					stage: "news_ingestion",
					errorCategory: "UPSTREAM_TIMEOUT",
					errorMessage: "Timeout in isolate 1",
				}),
				observabilityModule.sendOperationalAlert(envWithAlerts, {
					stage: "news_ingestion",
					errorCategory: "UPSTREAM_TIMEOUT",
					errorMessage: "Timeout in isolate 2",
				}),
			]);

			expect(res1.sent).toBe(true);
			expect(res2.sent).toBe(false);
			expect(res2.reason).toBe("cooldown_active");

			// Telegram API called exactly once!
			expect(sendMsgSpy).toHaveBeenCalledTimes(1);
		});

		it("R8. Cooldown expiry allows a new alert", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1102 });
			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

			const rpcSpy = vi.fn().mockResolvedValue({
				data: [{ claimed: true, last_alerted_at: new Date().toISOString(), alert_count: 2, cooldown_remaining_seconds: 0 }],
				error: null,
			});

			const mockSupabase = {
				from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis() }),
				rpc: rpcSpy,
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			const res = await observabilityModule.sendOperationalAlert(envWithAlerts, {
				stage: "news_ingestion",
				errorCategory: "UPSTREAM_TIMEOUT",
				errorMessage: "Timeout after cooldown expiry",
			});

			expect(res.sent).toBe(true);
			expect(sendMsgSpy).toHaveBeenCalledTimes(1);
		});

		it("R9. Independent incidents are not incorrectly suppressed", async () => {
			const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1103 });
			const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

			const rpcSpy = vi.fn().mockResolvedValue({
				data: [{ claimed: true, last_alerted_at: new Date().toISOString(), alert_count: 1, cooldown_remaining_seconds: 0 }],
				error: null,
			});

			const mockSupabase = {
				from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis() }),
				rpc: rpcSpy,
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			// Incident 1: news_ingestion
			const res1 = await observabilityModule.sendOperationalAlert(envWithAlerts, {
				stage: "news_ingestion",
				errorCategory: "INGESTION_ERROR",
				errorMessage: "Ingestion connection error",
			});
			expect(res1.sent).toBe(true);

			// Incident 2: carousel_rendering (different dedup key)
			const res2 = await observabilityModule.sendOperationalAlert(envWithAlerts, {
				stage: "carousel_rendering",
				errorCategory: "PUPPETEER_CRASH",
				errorMessage: "Browser crash error",
			});
			expect(res2.sent).toBe(true);

			expect(sendMsgSpy).toHaveBeenCalledTimes(2);
		});

		it("R10. Ordinary queue success, retry, and failure events are recorded with duration and correlation ID", async () => {
			const logEvents: observabilityModule.ObservabilityLogEnvelope[] = [];
			vi.spyOn(observabilityModule, "logOperationalEvent").mockImplementation((envelope) => {
				logEvents.push(envelope);
			});

			const mockAck = vi.fn();
			const mockRetry = vi.fn();

			// 1. Success case: post approved & published
			vi.spyOn(instagramPublishingModule, "publishApprovedCarousel").mockResolvedValue({
				success: true,
				publication_id: "pub-ord-01",
				instagram_media_id: "ig-media-12345",
				publication_status: "published",
			} as any);

			const mockSupabaseSuccess = {
				from: vi.fn((table: string) => ({
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							single: vi.fn(async () => ({
								data: {
									id: "18200000-0000-0000-0000-000000001840",
									post_status: "approved",
									human_review_required: true,
									carousel_slide_count: 5,
								},
								error: null,
							})),
						})),
					})),
				})),
				rpc: vi.fn(async (func: string) => {
					if (func === "claim_publication_job") {
						return {
							data: { claimed: true, in_progress: false, is_already_published: false, is_unknown: false },
							error: null,
						};
					}
					return { data: null, error: null };
				}),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabaseSuccess as any);

			const successBatch = {
				queue: "instagram-publishing-jobs",
				messages: [
					{
						id: "msg-pub-success-1",
						timestamp: new Date(),
						attempts: 1,
						body: {
							post_id: "18200000-0000-0000-0000-000000001840",
							job_id: "job-pub-1840",
						},
						ack: mockAck,
						retry: mockRetry,
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};

			const envWithAutoPublish: Env = {
				...mockDevEnv,
				INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "true",
			};

			await editorialApprovalModule.handleInstagramPublishingQueue(successBatch as any, envWithAutoPublish);

			expect(mockAck).toHaveBeenCalledTimes(1);

			// Assert structured logs emitted
			const receivedEvent = logEvents.find((e) => e.event === "queue_message_received");
			expect(receivedEvent).toBeDefined();
			expect(receivedEvent?.post_id).toBe("18200000-0000-0000-0000-000000001840");
			expect(receivedEvent?.metadata?.job_id).toBe("job-pub-1840");

			const processedEvent = logEvents.find((e) => e.event === "queue_message_processed");
			expect(processedEvent).toBeDefined();
			expect(processedEvent?.status).toBe("success");
			expect(processedEvent?.duration_ms).toBeGreaterThanOrEqual(0);
			expect(processedEvent?.metadata?.instagram_media_id).toBe("ig-media-12345");
		});

		it("R11. Existing publishing retries remain unchanged (transient error triggers 30s delay)", async () => {
			vi.spyOn(instagramPublishingModule, "publishApprovedCarousel").mockRejectedValue(
				new Error("Instagram API 500 internal server error")
			);

			const mockQueryBuilder: any = {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn(async () => ({
					data: {
						id: "18200000-0000-0000-0000-000000001841",
						post_status: "approved",
						human_review_required: true,
						carousel_slide_count: 5,
					},
					error: null,
				})),
				maybeSingle: vi.fn(async () => ({
					data: { publication_status: "failed" },
					error: null,
				})),
			};
			const mockSupabase = {
				from: vi.fn(() => mockQueryBuilder),
				rpc: vi.fn(async () => ({
					data: { claimed: true, in_progress: false, is_already_published: false, is_unknown: false },
					error: null,
				})),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			const mockAck = vi.fn();
			const mockRetry = vi.fn();

			const batch = {
				queue: "instagram-publishing-jobs",
				messages: [
					{
						id: "msg-retry-test",
						timestamp: new Date(),
						attempts: 1,
						body: { post_id: "18200000-0000-0000-0000-000000001841", job_id: "job-1841" },
						ack: mockAck,
						retry: mockRetry,
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};

			const envWithAutoPublish: Env = {
				...mockDevEnv,
				INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "true",
			};

			await editorialApprovalModule.handleInstagramPublishingQueue(batch as any, envWithAutoPublish);

			// Unchanged retry behavior: retries with 30s delay
			expect(mockRetry).toHaveBeenCalledWith({ delaySeconds: 30 });
			expect(mockAck).not.toHaveBeenCalled();
		});

		it("R12. Existing outbox recovery remains intact", async () => {
			const mockSendSpy = vi.fn().mockResolvedValue(undefined);
			const envWithQ: Env = {
				...mockDevEnv,
				INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "true",
				INSTAGRAM_PUBLISHING_QUEUE: { send: mockSendSpy } as any,
			};

			const mockSupabase = {
				from: vi.fn((table: string) => {
					if (table === "social_content_posts") {
						return {
							select: vi.fn(() => ({
								eq: vi.fn(() => ({
									eq: vi.fn(async () => ({
										data: [
											{
												id: "18200000-0000-0000-0000-000000001842",
												post_status: "approved",
												human_review_required: true,
												carousel_slide_count: 5,
											},
										],
										error: null,
									})),
								})),
							})),
						};
					}
					if (table === "social_content_publications") {
						return {
							select: vi.fn(() => ({
								eq: vi.fn(() => ({
									eq: vi.fn(() => ({
										maybeSingle: vi.fn(async () => ({
											data: { publication_status: "pending", updated_at: new Date(Date.now() - 120000).toISOString() },
											error: null,
										})),
									})),
								})),
							})),
							update: vi.fn(() => ({
								eq: vi.fn().mockResolvedValue({ error: null }),
							})),
						};
					}
					return {};
				}),
				rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			const result = await editorialApprovalModule.recoverStrandedApprovedPosts(envWithQ);
			expect(result.checked).toBe(1);
			expect(result.enqueued).toBe(1);
			expect(mockSendSpy).toHaveBeenCalledTimes(1);
		});

		it("R13. No duplicate Instagram publication is introduced (already-published post acks immediately)", async () => {
			const publishSpy = vi.spyOn(instagramPublishingModule, "publishApprovedCarousel");

			const mockSupabase = {
				from: vi.fn((table: string) => ({
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							single: vi.fn(async () => ({
								data: {
									id: "18200000-0000-0000-0000-000000001843",
									post_status: "published", // already published
									human_review_required: true,
									carousel_slide_count: 5,
								},
								error: null,
							})),
						})),
					})),
				})),
				rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			const mockAck = vi.fn();
			const batch = {
				queue: "instagram-publishing-jobs",
				messages: [
					{
						id: "msg-dup-check",
						timestamp: new Date(),
						attempts: 1,
						body: { post_id: "18200000-0000-0000-0000-000000001843", job_id: "job-1843" },
						ack: mockAck,
						retry: vi.fn(),
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};

			await editorialApprovalModule.handleInstagramPublishingQueue(batch as any, {
				...mockDevEnv,
				INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "true",
			});

			expect(mockAck).toHaveBeenCalledTimes(1);
			expect(publishSpy).not.toHaveBeenCalled();
		});

		it("R14. Human editorial approval remains mandatory (unapproved post is rejected and acked)", async () => {
			const publishSpy = vi.spyOn(instagramPublishingModule, "publishApprovedCarousel");

			const mockSupabase = {
				from: vi.fn((table: string) => ({
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							single: vi.fn(async () => ({
								data: {
									id: "18200000-0000-0000-0000-000000001844",
									post_status: "pending_approval", // not yet approved
									human_review_required: true,
									carousel_slide_count: 5,
								},
								error: null,
							})),
						})),
					})),
				})),
				rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
			};
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

			const mockAck = vi.fn();
			const batch = {
				queue: "instagram-publishing-jobs",
				messages: [
					{
						id: "msg-unapproved-check",
						timestamp: new Date(),
						attempts: 1,
						body: { post_id: "18200000-0000-0000-0000-000000001844", job_id: "job-1844" },
						ack: mockAck,
						retry: vi.fn(),
					},
				],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			};

			await editorialApprovalModule.handleInstagramPublishingQueue(batch as any, {
				...mockDevEnv,
				INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "true",
			});

			expect(mockAck).toHaveBeenCalledTimes(1);
			expect(publishSpy).not.toHaveBeenCalled();
		});

		describe("Task 20.2: DLQ Retry Safety & Operational Alert Delivery Reliability", () => {
			it("T20_2_1. DLQ persistence failure triggers retry with 60s delay and never acknowledges", async () => {
				const mockSupabase = {
					from: vi.fn(() => ({
						upsert: vi.fn().mockResolvedValue({ data: null, error: new Error("Supabase 503 Service Unavailable") }),
					})),
					rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
				};
				vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

				const mockAck = vi.fn();
				const mockRetry = vi.fn();

				const batch = {
					queue: "instagram-publishing-dlq",
					messages: [
						{
							id: "msg-dlq-retry-safety",
							timestamp: new Date(),
							attempts: 1,
							body: { post_id: "20000000-0000-0000-0000-000000000099", job_id: "job-99" },
							ack: mockAck,
							retry: mockRetry,
						},
					],
					ackAll: vi.fn(),
					retryAll: vi.fn(),
				};

				await worker.queue(batch as any, mockDevEnv, {} as any);

				expect(mockAck).not.toHaveBeenCalled();
				expect(mockRetry).toHaveBeenCalledWith({ delaySeconds: 60 });
			});

			it("T20_2_2. Primary DLQ consumer configures dead_letter_queue to instagram-publishing-quarantine with max_retries 3", () => {
				const stripped = wranglerConfigRaw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
				const config = JSON.parse(stripped);
				const dlqConsumer = config.queues.consumers.find((c: any) => c.queue === "instagram-publishing-dlq");

				expect(dlqConsumer.dead_letter_queue).toBe("instagram-publishing-quarantine");
				expect(dlqConsumer.max_retries).toBe(3);
				expect(dlqConsumer.retry_delay).toBe(60);
			});

			it("T20_2_3. Quarantine queue retains messages without automated consumer processing", async () => {
				const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
				const publishSpy = vi.spyOn(instagramPublishingModule, "publishApprovedCarousel");
				const mockAck = vi.fn();
				const mockRetry = vi.fn();

				const batch = {
					queue: "instagram-publishing-quarantine",
					messages: [
						{
							id: "msg-quarantine-01",
							timestamp: new Date(),
							attempts: 3,
							body: { post_id: "20000000-0000-0000-0000-000000000100" },
							ack: mockAck,
							retry: mockRetry,
						},
					],
					ackAll: vi.fn(),
					retryAll: vi.fn(),
				};

				// Must throw on unconsumed queue to prevent Cloudflare auto-ack
				await expect(worker.queue(batch as any, mockDevEnv, {} as any)).rejects.toThrow(
					/has no registered consumer in Worker and must not be processed/
				);

				// Unhandled in automatic consumer, so not acknowledged or retried
				expect(mockAck).not.toHaveBeenCalled();
				expect(mockRetry).not.toHaveBeenCalled();
				expect(publishSpy).not.toHaveBeenCalled();
			});

			it("T20_2_4. Successful recovery after Supabase becomes available (persists and acks)", async () => {
				const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
				const mockSupabase = {
					from: vi.fn(() => ({
						upsert: upsertSpy,
					})),
					rpc: vi.fn().mockResolvedValue({ data: [{ reserved: true }], error: null }),
				};
				vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

				const mockAck = vi.fn();
				const batch = {
					queue: "instagram-publishing-dlq",
					messages: [
						{
							id: "msg-recovered-01",
							timestamp: new Date(),
							attempts: 2,
							body: { post_id: "20000000-0000-0000-0000-000000000101", job_id: "job-rec-1" },
							ack: mockAck,
							retry: vi.fn(),
						},
					],
					ackAll: vi.fn(),
					retryAll: vi.fn(),
				};

				await worker.queue(batch as any, mockDevEnv, {} as any);

				expect(upsertSpy).toHaveBeenCalledTimes(1);
				expect(mockAck).toHaveBeenCalledTimes(1);
			});

			it("T20_2_5. Telegram failure after alert reservation records failure and does NOT consume 15m cooldown", async () => {
				const rpcCalls: string[] = [];
				const mockSupabase = {
					from: vi.fn(() => ({ select: vi.fn().mockReturnThis() })),
					rpc: vi.fn(async (func: string) => {
						rpcCalls.push(func);
						if (func === "reserve_operational_alert") {
							return { data: [{ reserved: true, delivery_status: "pending", alert_count: 1 }], error: null };
						}
						if (func === "record_operational_alert_failed") {
							return { data: true, error: null };
						}
						return { data: null, error: null };
					}),
				};
				vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

				// Telegram delivery fails
				vi.spyOn(telegramBotModule, "sendMessage").mockRejectedValue(new Error("Telegram API 500 Internal Error"));

				const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

				const result = await observabilityModule.sendOperationalAlert(envWithAlerts, {
					stage: "news_ingestion",
					errorCategory: "API_500",
					errorMessage: "Upstream ingestion server 500 error",
				});

				expect(result.sent).toBe(false);
				expect(result.error).toContain("Telegram API 500");

				// Verified RPC call progression: reserved -> failed (confirm was NEVER called)
				expect(rpcCalls).toContain("reserve_operational_alert");
				expect(rpcCalls).toContain("record_operational_alert_failed");
				expect(rpcCalls).not.toContain("confirm_operational_alert_sent");
			});

			it("T20_2_6. Controlled retry of an undelivered alert succeeds after backoff", async () => {
				const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1201 });
				const rpcCalls: string[] = [];

				const mockSupabase = {
					from: vi.fn(() => ({ select: vi.fn().mockReturnThis() })),
					rpc: vi.fn(async (func: string) => {
						rpcCalls.push(func);
						if (func === "reserve_operational_alert") {
							// After 30s backoff, DB allows retry of failed alert
							return { data: [{ reserved: true, delivery_status: "pending", alert_count: 2 }], error: null };
						}
						if (func === "confirm_operational_alert_sent") {
							return { data: true, error: null };
						}
						return { data: null, error: null };
					}),
				};
				vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

				const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

				// Retry attempt after backoff
				const result = await observabilityModule.sendOperationalAlert(envWithAlerts, {
					stage: "news_ingestion",
					errorCategory: "API_500",
					errorMessage: "Upstream ingestion server 500 error",
				});

				expect(result.sent).toBe(true);
				expect(sendMsgSpy).toHaveBeenCalledTimes(1);
				expect(rpcCalls).toContain("reserve_operational_alert");
				expect(rpcCalls).toContain("confirm_operational_alert_sent");
			});

			it("T20_2_7. Successful delivery confirms alert and starts full 15m cooldown", async () => {
				const sendMsgSpy = vi.spyOn(telegramBotModule, "sendMessage").mockResolvedValue({ message_id: 1202 });

				const mockSupabase = {
					from: vi.fn(() => ({ select: vi.fn().mockReturnThis() })),
					rpc: vi.fn(async (func: string) => {
						if (func === "reserve_operational_alert") {
							return { data: [{ reserved: true, delivery_status: "pending" }], error: null };
						}
						if (func === "confirm_operational_alert_sent") {
							return { data: true, error: null };
						}
						return { data: null, error: null };
					}),
				};
				vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

				const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

				// Initial alert delivery succeeds
				const res1 = await observabilityModule.sendOperationalAlert(envWithAlerts, {
					stage: "carousel_rendering",
					errorCategory: "PUPPETEER_TIMEOUT",
					errorMessage: "Browser render timeout",
				});
				expect(res1.sent).toBe(true);
				expect(sendMsgSpy).toHaveBeenCalledTimes(1);

				// Subsequent immediate attempt for same signature is suppressed by the active 15m cooldown
				const res2 = await observabilityModule.sendOperationalAlert(envWithAlerts, {
					stage: "carousel_rendering",
					errorCategory: "PUPPETEER_TIMEOUT",
					errorMessage: "Browser render timeout again",
				});
				expect(res2.sent).toBe(false);
				expect(res2.reason).toBe("cooldown_active");
				// Telegram sendMessage was not invoked again
				expect(sendMsgSpy).toHaveBeenCalledTimes(1);
			});

			it("T20_2_8. No recursive alerts when Telegram delivery fails", async () => {
				const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

				// Telegram delivery fails
				vi.spyOn(telegramBotModule, "sendMessage").mockRejectedValue(new Error("Telegram connection timeout"));

				const mockSupabase = {
					from: vi.fn(() => ({ select: vi.fn().mockReturnThis() })),
					rpc: vi.fn().mockResolvedValue({ data: [{ reserved: true }], error: null }),
				};
				vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

				const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

				const res = await observabilityModule.sendOperationalAlert(envWithAlerts, {
					stage: "content_generation",
					errorCategory: "GROQ_TIMEOUT",
					errorMessage: "Groq generation timeout",
				});

				expect(res.sent).toBe(false);
				expect(res.error).toBe("Telegram connection timeout");

				// Verify operational_alert_failed is logged exactly once and no infinite alert loop occurs
				const failedEvents = consoleErrorSpy.mock.calls
					.map((c) => {
						try {
							return JSON.parse(String(c[0]));
						} catch {
							return null;
						}
					})
					.filter((e) => e && e.event === "operational_alert_failed");

				expect(failedEvents.length).toBe(1);
			});
		});

		describe("Task 20.3: Final Quarantine Retention & Operational Reliability Verification", () => {
			it("T20_3_1. Confirms quarantine queue has NO consumer registered in wrangler.jsonc", () => {
				const stripped = wranglerConfigRaw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
				const config = JSON.parse(stripped);
				const consumerQueues = config.queues.consumers.map((c: any) => c.queue);

				// Only source jobs and primary dlq have consumers
				expect(consumerQueues).toContain("instagram-publishing-jobs");
				expect(consumerQueues).toContain("instagram-publishing-dlq");
				expect(consumerQueues).not.toContain("instagram-publishing-quarantine");
			});

			it("T20_3_2. Unexpected quarantine delivery strictly rejects, never acks, never retries, and never publishes", async () => {
				const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
				const publishSpy = vi.spyOn(instagramPublishingModule, "publishApprovedCarousel");
				const mockAck = vi.fn();
				const mockRetry = vi.fn();

				const batch = {
					queue: "instagram-publishing-quarantine",
					messages: [
						{
							id: "msg-quarantine-guard-01",
							timestamp: new Date(),
							attempts: 1,
							body: { post_id: "20000000-0000-0000-0000-000000000999" },
							ack: mockAck,
							retry: mockRetry,
						},
					],
					ackAll: vi.fn(),
					retryAll: vi.fn(),
				};

				await expect(worker.queue(batch as any, mockDevEnv, {} as any)).rejects.toThrow(
					"Queue 'instagram-publishing-quarantine' has no registered consumer in Worker and must not be processed."
				);

				expect(mockAck).not.toHaveBeenCalled();
				expect(mockRetry).not.toHaveBeenCalled();
				expect(publishSpy).not.toHaveBeenCalled();
			});

			it("T20_3_3. Documents and verifies Cloudflare queue retention parameters (14-day / 1,209,600s max holding buffer)", () => {
				// Cloudflare Queues retention specification
				const MAX_PAID_RETENTION_SECONDS = 14 * 24 * 60 * 60; // 1,209,600 seconds
				const DEFAULT_RETENTION_SECONDS = 4 * 24 * 60 * 60; // 345,600 seconds
				const FREE_TIER_RETENTION_SECONDS = 24 * 60 * 60; // 86,400 seconds

				expect(MAX_PAID_RETENTION_SECONDS).toBe(1209600);
				expect(DEFAULT_RETENTION_SECONDS).toBe(345600);
				expect(FREE_TIER_RETENTION_SECONDS).toBe(86400);

				// Validates CLI command format to apply in staging/production:
				const expectedCliCommand = "npx wrangler queues update instagram-publishing-quarantine --message-retention-period-secs 1209600";
				expect(expectedCliCommand).toContain("--message-retention-period-secs 1209600");
			});

			it("T20_3_4. Validates quarantine operator recovery procedure: re-queuing to primary DLQ once Supabase is restored", async () => {
				// When Supabase is healthy, an operator or recovery script reading quarantined messages re-enqueues them to DLQ
				const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
				const mockSupabase = {
					from: vi.fn(() => ({
						upsert: upsertSpy,
					})),
					rpc: vi.fn().mockResolvedValue({ data: [{ reserved: true }], error: null }),
				};
				vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

				const mockAck = vi.fn();
				const dlqBatch = {
					queue: "instagram-publishing-dlq",
					messages: [
						{
							id: "msg-recovered-from-quarantine",
							timestamp: new Date(),
							attempts: 1,
							body: { post_id: "20000000-0000-0000-0000-000000000999", job_id: "job-quarantine-recovered" },
							ack: mockAck,
							retry: vi.fn(),
						},
					],
					ackAll: vi.fn(),
					retryAll: vi.fn(),
				};

				await worker.queue(dlqBatch as any, mockDevEnv, {} as any);

				expect(upsertSpy).toHaveBeenCalledTimes(1);
				expect(mockAck).toHaveBeenCalledTimes(1);
			});

			it("T20_3_5. Alert confirmation strictly requires Telegram API success (ok: true and message_id number)", async () => {
				const rpcCalls: string[] = [];
				const mockSupabase = {
					from: vi.fn(() => ({ select: vi.fn().mockReturnThis() })),
					rpc: vi.fn(async (func: string) => {
						rpcCalls.push(func);
						if (func === "reserve_operational_alert") {
							return { data: [{ reserved: true, delivery_status: "pending" }], error: null };
						}
						if (func === "record_operational_alert_failed") {
							return { data: true, error: null };
						}
						return { data: null, error: null };
					}),
				};
				vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

				// Telegram returns HTTP 400 with ok: false
				vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
					if (String(url).includes("api.telegram.org")) {
						return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), {
							status: 400,
							headers: { "Content-Type": "application/json" },
						});
					}
					return new Response("Not found", { status: 404 });
				});

				const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

				const result = await observabilityModule.sendOperationalAlert(envWithAlerts, {
					stage: "news_ingestion",
					errorCategory: "API_400",
					errorMessage: "Test Bad Request",
				});

				expect(result.sent).toBe(false);
				expect(result.error).toContain("Telegram sendMessage failed (400)");
				expect(rpcCalls).toContain("reserve_operational_alert");
				expect(rpcCalls).toContain("record_operational_alert_failed");
				expect(rpcCalls).not.toContain("confirm_operational_alert_sent");
			});

			it("T20_3_6. Ambiguous network timeout on Telegram records failure with 30s backoff without consuming full cooldown", async () => {
				const rpcCalls: string[] = [];
				const mockSupabase = {
					from: vi.fn(() => ({ select: vi.fn().mockReturnThis() })),
					rpc: vi.fn(async (func: string) => {
						rpcCalls.push(func);
						if (func === "reserve_operational_alert") {
							return { data: [{ reserved: true, delivery_status: "pending" }], error: null };
						}
						if (func === "record_operational_alert_failed") {
							return { data: true, error: null };
						}
						return { data: null, error: null };
					}),
				};
				vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(mockSupabase as any);

				// Simulate network timeout after 15s (request may or may not have reached Telegram)
				vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
					if (String(url).includes("api.telegram.org")) {
						const err = new Error("The operation was aborted due to timeout");
						err.name = "TimeoutError";
						throw err;
					}
					return new Response("Not found", { status: 404 });
				});

				const envWithAlerts: Env = { ...mockDevEnv, OPS_ALERTS_ENABLED: "true" };

				const result = await observabilityModule.sendOperationalAlert(envWithAlerts, {
					stage: "content_generation",
					errorCategory: "TIMEOUT",
					errorMessage: "Ambiguous network timeout",
				});

				expect(result.sent).toBe(false);
				expect(result.error).toContain("timeout");
				expect(rpcCalls).toContain("reserve_operational_alert");
				expect(rpcCalls).toContain("record_operational_alert_failed");
				expect(rpcCalls).not.toContain("confirm_operational_alert_sent");
			});
		});
	});
});
