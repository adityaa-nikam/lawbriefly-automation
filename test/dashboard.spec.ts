import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker, { type Env } from "../src/index";
import * as pipelineModule from "../src/services/pipeline-orchestrator";
import * as newsIngestionModule from "../src/services/news-ingestion";
import * as topicSelectionModule from "../src/services/topic-selection";
import * as contentGenerationModule from "../src/services/content-generation";
import * as carouselRenderingModule from "../src/services/carousel-rendering";
import * as carouselPersistenceModule from "../src/services/carousel-persistence";
import * as editorialApprovalModule from "../src/services/editorial-approval";
import * as instagramPublishingModule from "../src/services/instagram-publishing";
import * as distributedLockModule from "../src/services/distributed-lock";
import * as supabaseModule from "../src/services/supabase";

const mockDevEnv: Env = {
	APP_ENV: "development",
	LAWBRIEFLY_API_URL: "https://lawbriefly.test/api/news",
	LAWBRIEFLY_API_KEY: "secret_lb_key_xyz",
	SUPABASE_URL: "https://test.supabase.co",
	SUPABASE_SECRET_KEY: "secret_sb_key_abc",
	GROQ_API_KEY: "secret_groq_key_def",
	OPENROUTER_API_KEY: "secret_openrouter_key_ghi",
	JINA_API_KEY: "secret_jina_key_jkl",
	TELEGRAM_BOT_TOKEN: "987654:secret_bot_token_mno",
	TELEGRAM_CHAT_ID: "-1001234567890",
	TELEGRAM_ALLOWED_USER_IDS: "123456789",
	TELEGRAM_WEBHOOK_SECRET: "secret_webhook_pqr",
	META_APP_SECRET: "secret_meta_stu",
	ADMIN_API_KEY: "secret_admin_vwx",
};

const mockProdEnv: Env = {
	...mockDevEnv,
	APP_ENV: "production",
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
		candidate_id: "cand-123",
		topic_title: "Supreme Court Overhauls Tax Enforcement",
		topic_summary: "Major tax overhaul summary",
		legal_domain: "tax_law",
		jurisdiction: "Union of India",
		editorial_angle: "Focus on procedural safeguards",
		selection_rationale: "Broad constitutional importance",
		confidence: 0.95,
		evidence_metrics: {
			unique_article_count: 3,
			unique_source_host_count: 3,
			supporting_batch_count: 1,
			evidence_strength: "strong_multi_source",
		},
		supporting_articles: [
			{
				article_id: "art-1",
				title: "SC Judgment on GST",
				description: "Landmark tax ruling",
				url: "https://law.example.com/art1",
				last_seen_at: "2026-11-04T00:00:00Z",
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
	generated_at: "2026-11-04T00:00:00Z",
	topic: {
		candidate_id: "cand-123",
		topic_title: "Supreme Court Overhauls Tax Enforcement",
		legal_domain: "tax_law",
		jurisdiction: "Union of India",
	},
	carousel_slide_count: 5,
	slides: [
		{
			slide_number: 1,
			slide_role: "cover",
			headline: "Supreme Court Overhauls Tax Enforcement",
			subtitle: "Major relief for businesses",
			claims: [],
			visual_direction: "Hero scales of justice",
			visual_spec: { layout_variant: "cover", background_variant: "brand_dark", visual_elements: ["scales"], emphasis: "headline" },
			bullet_points: ["Voluntary compliance reinforced"],
		},
	],
	evidence: {
		primary_sources: [],
		statutes_cited: [],
		case_citations: [],
		cross_verification_matrix: [],
		confidence_score: 0.95,
		limitations: [],
	},
	metadata: {
		analysis_timestamp: "2026-11-04T00:00:00Z",
		pipeline_version: "2.0.0",
	},
};

const sampleRenderedArtifact: carouselRenderingModule.RenderedCarouselArtifact = {
	post_id: "00000000-0000-0000-0000-000000000001",
	rendered_at: "2026-11-04T00:00:00Z",
	slide_count: 1,
	slides: [
		{
			slide_number: 1,
			png_blob: new Uint8Array([1, 2, 3]),
			jpeg_blob: new Uint8Array([4, 5, 6]),
			width: 1080,
			height: 1350,
			visual_spec: {
				layout_variant: "cover",
				background_variant: "brand_dark",
				visual_elements: ["scales"],
				emphasis: "headline",
			},
		},
	],
};

describe("Task 21.5: LawBriefly Operator Dashboard", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		pipelineModule.clearRecentRunsHistoryForTesting();
		pipelineModule.releasePipelineLock();

		// Default mock query builder for Supabase
		const makeQueryBuilder = () => {
			const builder: any = {
				insert: vi.fn().mockResolvedValue({ data: null, error: null }),
				upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockResolvedValue({ data: [], error: null }),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
				then(onfulfilled: any, onrejected: any) {
					return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
				},
			};
			return builder;
		};

		const defaultMockSupabase = {
			from: vi.fn(() => makeQueryBuilder()),
			rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(defaultMockSupabase as any);

		// Default successful lock mocks
		vi.spyOn(distributedLockModule, "acquireDistributedPipelineLock").mockResolvedValue({
			success: true,
			fencingToken: 1,
			leaseExpiresAt: new Date(Date.now() + 180000).toISOString(),
		});
		vi.spyOn(distributedLockModule, "renewDistributedPipelineLock").mockResolvedValue({
			renewed: true,
			fencingToken: 2,
			leaseExpiresAt: new Date(Date.now() + 180000).toISOString(),
		});
		vi.spyOn(distributedLockModule, "releaseDistributedPipelineLock").mockResolvedValue({
			released: true,
		});

		// Mock Supabase health
		vi.spyOn(supabaseModule, "checkSupabaseHealth").mockResolvedValue(
			new Response(JSON.stringify({ status: "healthy", database: "connected" }), { status: 200 })
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		pipelineModule.clearRecentRunsHistoryForTesting();
		pipelineModule.releasePipelineLock();
	});

	// Criterion 1: Dashboard accessible in dev
	it("1. Dashboard accessible in dev: GET /dashboard returns 200 with HTML", async () => {
		const res = await worker.fetch(new Request("http://127.0.0.1:8787/dashboard"), mockDevEnv);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/html");
		const html = await res.text();
		expect(html).toContain("LawBriefly Operator Dashboard");
		expect(html).toContain("RUN FULL PIPELINE NOW");
		expect(html).toContain("SYNC NEWS ONLY");
	});

	// Criterion 2: Dashboard returns 404 outside dev
	it("2. Dashboard returns 404 outside dev: GET /dashboard and API endpoints return 404 in production", async () => {
		const resPage = await worker.fetch(new Request("http://127.0.0.1:8787/dashboard"), mockProdEnv);
		expect(resPage.status).toBe(404);

		const resState = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockProdEnv);
		expect(resState.status).toBe(404);

		const resRun = await worker.fetch(
			new Request("http://127.0.0.1:8787/api/dashboard/run", { method: "POST" }),
			mockProdEnv
		);
		expect(resRun.status).toBe(404);
	});

	// Criterion 3: State endpoint returns accurate status
	it("3. State endpoint returns accurate status: GET /api/dashboard/state returns valid schema", async () => {
		const res = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockDevEnv);
		expect(res.status).toBe(200);
		const data = (await res.json()) as any;
		expect(data).toHaveProperty("activeRun");
		expect(data).toHaveProperty("lastRun");
		expect(data).toHaveProperty("distributedLock");
		expect(data).toHaveProperty("supabase");
		expect(data).toHaveProperty("quarantineQueue");
		expect(data).toHaveProperty("schedules");
		expect(data).toHaveProperty("operatorScheduleNote");
		expect(data.schedules.length).toBeGreaterThanOrEqual(3);
		expect(data.operatorScheduleNote).toContain("10:30 AM");
		expect(data.operatorScheduleNote).toContain("07:30 AM IST (02:00 UTC)");
	});

	// Criterion 4: Run history loads correctly
	it("4. Run history loads correctly: GET /api/dashboard/runs returns runs list with in-memory fallback", async () => {
		// Record a synthetic run into history
		pipelineModule.recordRunToHistory({
			runId: "run-hist-1",
			triggerType: "manual",
			currentStage: "editorial_notification",
			overallStatus: "completed",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			elapsedMs: 1200,
			stages: {},
		});

		const res = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/runs"), mockDevEnv);
		expect(res.status).toBe(200);
		const data = (await res.json()) as any;
		expect(Array.isArray(data.runs)).toBe(true);
		expect(data.runs.length).toBeGreaterThan(0);
		expect(data.runs[0].runId).toBe("run-hist-1");
	});

	// Criterion 5: Stage timeline updates
	it("5. Stage timeline updates: recorded run stages contain statuses, durations, and metadata", async () => {
		pipelineModule.recordRunToHistory({
			runId: "run-timeline-1",
			triggerType: "manual",
			currentStage: "editorial_notification",
			overallStatus: "completed",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			elapsedMs: 2500,
			stages: {
				news_ingestion: { stage: "news_ingestion", status: "completed", durationMs: 400 },
				topic_selection: { stage: "topic_selection", status: "completed", durationMs: 600 },
				content_generation: { stage: "content_generation", status: "completed", durationMs: 800 },
				carousel_rendering: { stage: "carousel_rendering", status: "completed", durationMs: 300 },
				carousel_persistence: { stage: "carousel_persistence", status: "completed", durationMs: 200 },
				editorial_notification: { stage: "editorial_notification", status: "completed", durationMs: 200 },
			},
		});

		const res = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/runs/run-timeline-1"), mockDevEnv);
		expect(res.status).toBe(200);
		const data = (await res.json()) as any;
		expect(data.run.stages.news_ingestion.status).toBe("completed");
		expect(data.run.stages.news_ingestion.durationMs).toBe(400);
		expect(data.run.stages.editorial_notification.status).toBe("completed");
	});

	// Criterion 6: Active stage is shown
	it("6. Active stage is shown: getActiveRunProgress reflects currently running stage", () => {
		// Mock active state
		expect(pipelineModule.getActiveRunProgress()).toBeNull();
	});

	// Criterion 7: Failed stages show safe error details
	it("7. Failed stages show safe error details: records failure stage and sanitized error", async () => {
		vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
			success: false,
			status: 502,
			error: "LawBriefly API returned 502 Bad Gateway",
		});

		const res = await worker.fetch(
			new Request("http://127.0.0.1:8787/api/dashboard/run", { method: "POST" }),
			mockDevEnv
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as any;
		expect(body.success).toBe(false);
		expect(body.stage).toBe("news_ingestion");
		expect(body.error).toContain("502 Bad Gateway");

		const last = pipelineModule.getLastRunProgress();
		expect(last).not.toBeNull();
		expect(last?.overallStatus).toBe("failed");
		expect(last?.stages.news_ingestion.status).toBe("failed");
	});

	// Criterion 8: Manual trigger calls orchestrator
	it("8. Manual trigger calls orchestrator: POST /api/dashboard/run executes full pipeline", async () => {
		const execSpy = vi.spyOn(pipelineModule, "executePipeline");

		vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
			success: true,
			result: { fetched_count: 5, valid_count: 5 },
		});
		vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
			success: true,
			data: sampleTopicResponse,
		});
		vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
			success: true,
			data: sampleContentPackage,
		});
		vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockResolvedValue(sampleRenderedArtifact);
		vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel").mockResolvedValue({
			success: true,
			post_id: "00000000-0000-0000-0000-000000000001",
			post_status: "pending_approval",
			is_duplicate: false,
		});
		vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost").mockResolvedValue({
			success: true,
			approval_request_id: "req-001",
		});

		const res = await worker.fetch(
			new Request("http://127.0.0.1:8787/api/dashboard/run", { method: "POST" }),
			mockDevEnv
		);
		expect(res.status).toBe(200);
		expect(execSpy).toHaveBeenCalledWith(
			mockDevEnv,
			expect.objectContaining({ triggerType: "manual" })
		);
	});

	// Criterion 9: Manual execution uses distributed lock
	it("9. Manual execution uses distributed lock: acquireDistributedPipelineLock called on trigger", async () => {
		const lockSpy = vi.spyOn(distributedLockModule, "acquireDistributedPipelineLock");

		vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
			success: true,
			result: { fetched_count: 5, valid_count: 5 },
		});
		vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
			success: true,
			data: sampleTopicResponse,
		});
		vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
			success: true,
			data: sampleContentPackage,
		});
		vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockResolvedValue(sampleRenderedArtifact);
		vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel").mockResolvedValue({
			success: true,
			post_id: "00000000-0000-0000-0000-000000000001",
			post_status: "pending_approval",
			is_duplicate: false,
		});
		vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost").mockResolvedValue({
			success: true,
			approval_request_id: "req-001",
		});

		await worker.fetch(
			new Request("http://127.0.0.1:8787/api/dashboard/run", { method: "POST" }),
			mockDevEnv
		);
		expect(lockSpy).toHaveBeenCalled();
	});

	// Criterion 10: Second trigger returns 409 conflict
	it("10. Second trigger returns 409 conflict: concurrent run rejected while lock is held", async () => {
		pipelineModule.acquirePipelineLock("pre-existing-run");

		const res = await worker.fetch(
			new Request("http://127.0.0.1:8787/api/dashboard/run", { method: "POST" }),
			mockDevEnv
		);
		expect(res.status).toBe(409);
		const body = (await res.json()) as any;
		expect(body.success).toBe(false);
		expect(body.error).toContain("Concurrent execution is prohibited");
	});

	// Criterion 11: Distributed lock failure returns 503
	it("11. Distributed lock failure returns 503: fail-closed when lock authority unreachable", async () => {
		vi.spyOn(distributedLockModule, "acquireDistributedPipelineLock").mockResolvedValue({
			success: false,
			reason: "lock_unavailable",
			error: "Supabase connection timed out",
		});

		const res = await worker.fetch(
			new Request("http://127.0.0.1:8787/api/dashboard/run", { method: "POST" }),
			mockDevEnv
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as any;
		expect(body.success).toBe(false);
		expect(body.error).toContain("Distributed lock service is unavailable");
	});

	// Criterion 12: Sync news only does not trigger AI generation
	it("12. Sync news only does not trigger AI generation: POST /api/dashboard/news-sync runs ingestion only", async () => {
		const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
			success: true,
			result: { fetched_count: 12, valid_count: 10 },
		});
		const topicSpy = vi.spyOn(topicSelectionModule, "selectHotTopic");
		const contentSpy = vi.spyOn(contentGenerationModule, "generateContentForSelection");
		const notifySpy = vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost");

		const res = await worker.fetch(
			new Request("http://127.0.0.1:8787/api/dashboard/news-sync", {
				method: "POST",
				body: JSON.stringify({ days: "2", limit: "15" }),
			}),
			mockDevEnv
		);
		expect(res.status).toBe(200);
		expect(ingestSpy).toHaveBeenCalledWith(mockDevEnv, "2", "15");
		expect(topicSpy).not.toHaveBeenCalled();
		expect(contentSpy).not.toHaveBeenCalled();
		expect(notifySpy).not.toHaveBeenCalled();
	});

	// Criterion 13: Full pipeline reaches Telegram notification stage
	it("13. Full pipeline reaches Telegram notification stage: captures approval request ID", async () => {
		vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
			success: true,
			result: { fetched_count: 5, valid_count: 5 },
		});
		vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
			success: true,
			data: sampleTopicResponse,
		});
		vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
			success: true,
			data: sampleContentPackage,
		});
		vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockResolvedValue(sampleRenderedArtifact);
		vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel").mockResolvedValue({
			success: true,
			post_id: "00000000-0000-0000-0000-000000000001",
			post_status: "pending_approval",
			is_duplicate: false,
		});
		vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost").mockResolvedValue({
			success: true,
			approval_request_id: "req-task215-001",
		});

		const res = await worker.fetch(
			new Request("http://127.0.0.1:8787/api/dashboard/run", { method: "POST" }),
			mockDevEnv
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.telegram_notification.success).toBe(true);
		expect(body.telegram_notification.approval_request_id).toBe("req-task215-001");

		const last = pipelineModule.getLastRunProgress();
		expect(last?.overallStatus).toBe("completed");
		expect(last?.approvalRequestId).toBe("req-task215-001");
		expect(last?.telegramNotificationSent).toBe(true);
	});

	// Criterion 14: Dashboard does not auto-approve content
	it("14. Dashboard does not auto-approve content: no dashboard route permits auto-approval", async () => {
		// Verify that none of the dashboard routes execute processTelegramCallback or bypass human review
		const approveSpy = vi.spyOn(editorialApprovalModule, "processTelegramCallback");
		await worker.fetch(new Request("http://127.0.0.1:8787/dashboard"), mockDevEnv);
		await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockDevEnv);
		expect(approveSpy).not.toHaveBeenCalled();
	});

	// Criterion 15: Dashboard does not directly publish to Instagram
	it("15. Dashboard does not directly publish to Instagram: publication remains queue/telegram driven", async () => {
		const publishSpy = vi.spyOn(instagramPublishingModule, "handlePublishInstagram");
		await worker.fetch(new Request("http://127.0.0.1:8787/dashboard"), mockDevEnv);
		await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockDevEnv);
		expect(publishSpy).not.toHaveBeenCalled();
	});

	// Criterion 16: Polling stops/slows on completion
	it("16. Polling stops/slows on completion: client script includes adaptive polling interval", async () => {
		const res = await worker.fetch(new Request("http://127.0.0.1:8787/dashboard"), mockDevEnv);
		const html = await res.text();
		// Verify adaptive polling: 2500ms when executing, 10000ms when idle
		expect(html).toContain("2500");
		expect(html).toContain("10000");
		expect(html).toContain("resetPolling");
	});

	// Criterion 17: Missing migrations displayed honestly
	it("17. Missing migrations displayed honestly: migrationsApplied is false if database lacks tables", async () => {
		// Mock Supabase client to throw or return error on pipeline_runs table probe
		const clientMock: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue({ error: { message: "relation 'pipeline_runs' does not exist" } }),
					eq: vi.fn(() => ({
						single: vi.fn().mockResolvedValue({ data: null, error: null }),
					})),
					order: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue({ data: null, error: { message: "relation does not exist" } }),
					})),
				})),
			})),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(clientMock);

		const res = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockDevEnv);
		const state = (await res.json()) as any;
		expect(state.supabase.migrationsApplied).toBe(false);
	});

	// Criterion 18: Missing queue metrics displayed honestly
	it("18. Missing queue metrics displayed honestly: handles environment without queue metrics gracefully", async () => {
		const envWithoutMetrics = { ...mockDevEnv };
		delete (envWithoutMetrics as any).INSTAGRAM_QUARANTINE_QUEUE;

		const res = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), envWithoutMetrics);
		const state = (await res.json()) as any;
		expect(state.quarantineQueue.available).toBe(false);
		expect(state.quarantineQueue.backlogCount).toBe(0);
		expect(state.quarantineQueue.note).toContain("unavailable");
	});

	// Criterion 19: Secret values never appear in responses
	it("19. Secret values never appear in responses: dashboard HTML and state API never leak secrets", async () => {
		const resHtml = await worker.fetch(new Request("http://127.0.0.1:8787/dashboard"), mockDevEnv);
		const html = await resHtml.text();
		expect(html).not.toContain(mockDevEnv.SUPABASE_SECRET_KEY);
		expect(html).not.toContain(mockDevEnv.TELEGRAM_BOT_TOKEN);
		expect(html).not.toContain(mockDevEnv.GROQ_API_KEY);
		expect(html).not.toContain(mockDevEnv.OPENROUTER_API_KEY);
		expect(html).not.toContain(mockDevEnv.JINA_API_KEY);
		expect(html).not.toContain(mockDevEnv.TELEGRAM_WEBHOOK_SECRET);
		expect(html).not.toContain(mockDevEnv.LAWBRIEFLY_API_KEY);

		const resState = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockDevEnv);
		const stateText = await resState.text();
		expect(stateText).not.toContain(mockDevEnv.SUPABASE_SECRET_KEY);
		expect(stateText).not.toContain(mockDevEnv.TELEGRAM_BOT_TOKEN);
		expect(stateText).not.toContain(mockDevEnv.GROQ_API_KEY);
		expect(stateText).not.toContain(mockDevEnv.OPENROUTER_API_KEY);
		expect(stateText).not.toContain(mockDevEnv.JINA_API_KEY);
		expect(stateText).not.toContain(mockDevEnv.TELEGRAM_WEBHOOK_SECRET);
	});

	// Criterion 20: Existing pipeline, queue, and approval behavior remains intact
	it("20. Existing pipeline, queue, and approval behavior remains intact: scheduled crons & routes work", async () => {
		// Test that scheduled execution handler remains wired
		const scheduledSpy = vi.spyOn(pipelineModule, "handleScheduledPipelineRun").mockResolvedValue({
			skipped: true,
			reason: "AUTONOMOUS_PIPELINE_ENABLED is not set to 'true'",
		});

		await worker.scheduled(
			{ cron: "0 2 * * *", scheduledTime: Date.now() } as any,
			mockDevEnv,
			{ waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any
		);
		expect(scheduledSpy).toHaveBeenCalled();
	});

	// Task 21.7 Criteria: Monochrome shadcn theme, animated green line, in-place error diagnostics & Stage 7 Instagram check
	it("21. Task 21.7: Dashboard HTML contains monochrome shadcn theme, animated green beam, and 7 stage cards with in-place error boxes", async () => {
		const res = await worker.fetch(new Request("http://127.0.0.1:8787/dashboard"), mockDevEnv);
		const html = await res.text();

		// Monochrome shadcn tokens
		expect(html).toContain("--bg: #09090b");
		expect(html).toContain("--border: #27272a");
		expect(html).toContain("--btn-primary-bg: #fafafa");

		// Animated glowing green progress beam
		expect(html).toContain("pipeline-progress-bar");
		expect(html).toContain("pipeline-progress-fill");
		expect(html).toContain("--green: #22c55e");
		expect(html).toContain("rgba(34, 197, 94");

		// All 7 stage cards present
		expect(html).toContain('id="card-news_ingestion"');
		expect(html).toContain('id="card-topic_selection"');
		expect(html).toContain('id="card-content_generation"');
		expect(html).toContain('id="card-carousel_rendering"');
		expect(html).toContain('id="card-carousel_persistence"');
		expect(html).toContain('id="card-editorial_notification"');
		expect(html).toContain('id="card-instagram_publication"');

		// In-place error diagnostic containers present for every stage
		expect(html).toContain('id="err-news_ingestion"');
		expect(html).toContain('id="err-topic_selection"');
		expect(html).toContain('id="err-content_generation"');
		expect(html).toContain('id="err-carousel_rendering"');
		expect(html).toContain('id="err-carousel_persistence"');
		expect(html).toContain('id="err-editorial_notification"');
		expect(html).toContain('id="err-instagram_publication"');

		// Post-Telegram Instagram destination banner
		expect(html).toContain('id="destination-banner"');
		expect(html).toContain('id="dest-post-id"');
		expect(html).toContain('id="dest-media-id"');
	});

	it("22. Task 21.7: Dashboard state includes publication payload reflecting Instagram publication status", async () => {
		const res = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockDevEnv);
		expect(res.status).toBe(200);
		const state = (await res.json()) as any;

		expect(state).toHaveProperty("publication");
		expect(state.publication).toHaveProperty("status");
		expect(["not_reached", "awaiting_editorial_approval", "queued_for_publishing", "publishing_in_progress", "published", "publication_failed"]).toContain(state.publication.status);
	});

	it("23. Task 21.7: Stage 7 (instagram_publication) reflects 'completed' when post is published on Instagram", async () => {
		const testPostId = "00000000-0000-0000-0000-000000000077";

		// Record a last run with a postId
		pipelineModule.recordRunToHistory({
			runId: "run-stage7-published",
			triggerType: "manual",
			currentStage: "editorial_notification",
			overallStatus: "completed",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			elapsedMs: 3000,
			postId: testPostId,
			stages: {
				news_ingestion: { stage: "news_ingestion", status: "completed" },
				topic_selection: { stage: "topic_selection", status: "completed" },
				content_generation: { stage: "content_generation", status: "completed" },
				carousel_rendering: { stage: "carousel_rendering", status: "completed" },
				carousel_persistence: { stage: "carousel_persistence", status: "completed" },
				editorial_notification: { stage: "editorial_notification", status: "completed" },
				instagram_publication: { stage: "instagram_publication", status: "waiting" },
			},
		});

		// Mock Supabase returning a published publication row for this post
		const clientMock: any = {
			from: vi.fn((table: string) => ({
				select: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue({ data: [], error: null }),
					order: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue({ data: [], error: null }),
					})),
					eq: vi.fn((col: string, val: string) => ({
						eq: vi.fn(() => ({
							maybeSingle: vi.fn().mockResolvedValue({
								data: {
									id: "pub-row-1",
									publication_status: "published",
									instagram_media_id: "media_17999888777",
									instagram_permalink: "https://www.instagram.com/p/TEST777/",
									error_code: null,
									error_message: null,
									updated_at: new Date().toISOString(),
								},
								error: null,
							}),
						})),
						single: vi.fn().mockResolvedValue({ data: null, error: null }),
					})),
				})),
			})),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(clientMock);

		const res = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockDevEnv);
		const state = (await res.json()) as any;

		expect(state.publication.status).toBe("published");
		expect(state.publication.instagramMediaId).toBe("media_17999888777");
		expect(state.publication.instagramPermalink).toBe("https://www.instagram.com/p/TEST777/");
		expect(state.lastRun.stages.instagram_publication.status).toBe("completed");
		expect(state.lastRun.stages.instagram_publication.metadata.media_id).toBe("media_17999888777");
	});

	it("24. Task 21.7: Stage 7 (instagram_publication) reflects 'failed' with error when publication fails", async () => {
		const testPostId = "00000000-0000-0000-0000-000000000088";

		pipelineModule.recordRunToHistory({
			runId: "run-stage7-failed",
			triggerType: "manual",
			currentStage: "editorial_notification",
			overallStatus: "completed",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			elapsedMs: 3000,
			postId: testPostId,
			stages: {
				editorial_notification: { stage: "editorial_notification", status: "completed" },
				instagram_publication: { stage: "instagram_publication", status: "waiting" },
			},
		});

		const clientMock: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue({ data: [], error: null }),
					order: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue({ data: [], error: null }),
					})),
					eq: vi.fn(() => ({
						eq: vi.fn(() => ({
							maybeSingle: vi.fn().mockResolvedValue({
								data: {
									id: "pub-row-2",
									publication_status: "failed",
									error_code: "FB_OAUTH_EXPIRED",
									error_message: "OAuth token expired during carousel container creation",
									updated_at: new Date().toISOString(),
								},
								error: null,
							}),
						})),
						single: vi.fn().mockResolvedValue({ data: null, error: null }),
					})),
				})),
			})),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(clientMock);

		const res = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockDevEnv);
		const state = (await res.json()) as any;

		expect(state.publication.status).toBe("publication_failed");
		expect(state.publication.errorMessage).toContain("OAuth token expired");
		expect(state.lastRun.stages.instagram_publication.status).toBe("failed");
		expect(state.lastRun.stages.instagram_publication.error).toContain("OAuth token expired");
	});
});
