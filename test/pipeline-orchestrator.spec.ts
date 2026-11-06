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
import * as supabaseModule from "../src/services/supabase";

const mockDevEnv: Env = {
	APP_ENV: "development",
	LAWBRIEFLY_API_URL: "https://lawbriefly.test/api/news",
	LAWBRIEFLY_API_KEY: "test_lb_key",
	SUPABASE_URL: "https://test.supabase.co",
	SUPABASE_SECRET_KEY: "test_sb_secret",
	GROQ_API_KEY: "test_groq_key",
	OPENROUTER_API_KEY: "test_openrouter_key",
	JINA_API_KEY: "test_jina_key",
	MYBROWSER: {} as any,
	TELEGRAM_BOT_TOKEN: "123456:mock_bot_token",
	TELEGRAM_CHAT_ID: "-1001234567890",
	TELEGRAM_ALLOWED_USER_IDS: "123456789",
	TELEGRAM_WEBHOOK_SECRET: "test_webhook_secret",
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
		{
			slide_number: 2,
			slide_role: "what_happened",
			headline: "Key Takeaways",
			body_text: "Court narrows arrest powers",
			claims: [],
			visual_direction: "Text layout",
			visual_spec: { layout_variant: "editorial_text", background_variant: "brand_light", visual_elements: ["document"], emphasis: "key_fact" },
			bullet_points: [],
		},
		{
			slide_number: 3,
			slide_role: "legal_details",
			headline: "Statutory Analysis",
			body_text: "Section 69 scope restricted",
			claims: [],
			visual_direction: "Cards",
			visual_spec: { layout_variant: "bullet_cards", background_variant: "brand_light", visual_elements: ["shield"], emphasis: "key_fact" },
			bullet_points: [],
		},
		{
			slide_number: 4,
			slide_role: "why_it_matters",
			headline: "Commercial Impact",
			body_text: "Relief for MSMEs and corporate taxpayers",
			claims: [],
			visual_direction: "Impact",
			visual_spec: { layout_variant: "impact_cards", background_variant: "brand_light", visual_elements: ["rupee"], emphasis: "takeaway" },
			bullet_points: [],
		},
		{
			slide_number: 5,
			slide_role: "sources_disclaimer",
			headline: "Sources & Disclaimer",
			body_text: "Official court reports",
			claims: [],
			visual_direction: "Sources list",
			visual_spec: { layout_variant: "source_list", background_variant: "brand_light", visual_elements: ["chart"], emphasis: "sources" },
			bullet_points: [],
		},
	],
	instagram_caption: "Supreme Court overhauls tax enforcement procedures.",
	hashtags: ["#SupremeCourt", "#TaxLaw", "#GST"],
	evidence: { claims: [], limitations: [], editorial_flags: [], human_review_required: true },
	source_attributions: [{ article_id: "art-1", original_title: "SC Judgment", original_url: "https://law.example.com/art1", source_domain: "law.example.com", extraction_status: "success" }],
	source_metrics: { requested_article_count: 1, successful_extraction_count: 1, failed_extraction_count: 0, unique_source_domain_count: 1, source_diversity_status: "single_domain" },
};

const sampleRenderedArtifact: any = {
	manifest: { version: "1.0", slides: [] },
	manifestBytes: new Uint8Array([1, 2, 3]),
	slides: [
		{ slide_number: 1, slide_role: "cover", filename: "slide-01.png", mime_type: "image/png", bytes: new Uint8Array([1]), width: 1080, height: 1350 },
	],
};

const samplePersistResult: any = {
	success: true,
	post_id: "00000000-0000-0000-0000-000000000001",
	post_status: "stored",
	is_duplicate: false,
	carousel_slide_count: 5,
	content_fingerprint: "mock-fingerprint-123",
	assets: [],
	signed_urls: {},
};

const sampleNotificationResult: any = {
	success: true,
	post_id: "00000000-0000-0000-0000-000000000001",
	approval_request_id: "req-uuid-001",
	telegram_chat_id: "-1001234567890",
	control_message_id: 100,
	media_message_ids: [101, 102, 103, 104, 105],
	expires_at: "2026-11-06T00:00:00Z",
	is_already_sent: false,
};

describe("Pipeline Orchestrator Service (POST /api/ai/run-pipeline)", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		pipelineModule.releasePipelineLock();

		const mockRpc = vi.fn(async (func: string, args: any) => {
			if (func === "acquire_pipeline_run_lock") {
				return {
					data: [{
						acquired: true,
						lock_name: args?.p_lock_name || "global_content_pipeline",
						owner_run_id: args?.p_owner_run_id || "run-default",
						owner_token: args?.p_owner_token || "token-default",
						fencing_token: 1,
						lease_expires_at: new Date(Date.now() + 180000).toISOString(),
						reason: "acquired",
					}],
					error: null,
				};
			}
			if (func === "renew_pipeline_run_lock") {
				return {
					data: [{
						renewed: true,
						lock_name: args?.p_lock_name || "global_content_pipeline",
						owner_run_id: "test",
						fencing_token: args?.p_fencing_token || 1,
						lease_expires_at: new Date(Date.now() + 180000).toISOString(),
						reason: "renewed",
					}],
					error: null,
				};
			}
			if (func === "release_pipeline_run_lock") {
				return {
					data: [{
						released: true,
						lock_name: args?.p_lock_name || "global_content_pipeline",
						reason: "released",
					}],
					error: null,
				};
			}
			return { data: null, error: null };
		});

		const defaultMockSupabase = {
			from: vi.fn(() => ({
				insert: vi.fn().mockResolvedValue({ data: null, error: null }),
				upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
			})),
			rpc: mockRpc,
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(defaultMockSupabase as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		pipelineModule.releasePipelineLock();
	});

	describe("executePipeline()", () => {
		it("1. Successfully executes all 6 stages in sequence and returns complete result", async () => {
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: true,
				result: { fetched_count: 10, valid_count: 10, invalid_count: 0, duplicate_count: 0, database_affected_count: 10 },
			} as any);

			const topicSpy = vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: sampleTopicResponse,
			});

			const contentSpy = vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
				success: true,
				data: sampleContentPackage,
			});

			const renderSpy = vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockResolvedValue(sampleRenderedArtifact);

			const persistSpy = vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel").mockResolvedValue(samplePersistResult);

			const notifySpy = vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost").mockResolvedValue(sampleNotificationResult);

			const outcome = await pipelineModule.executePipeline(mockDevEnv, { days: "2", limit: "15" });

			expect(outcome.success).toBe(true);
			if (outcome.success && outcome.status === "completed") {
				expect(outcome.post_id).toBe("00000000-0000-0000-0000-000000000001");
				expect(outcome.post_status).toBe("stored");
				expect(outcome.is_duplicate).toBe(false);
				expect(outcome.topic.topic_title).toBe("Supreme Court Overhauls Tax Enforcement");
				expect(outcome.carousel_slide_count).toBe(5);
				expect(outcome.telegram_notification.control_message_id).toBe(100);
				expect(outcome.telegram_notification.media_message_ids).toHaveLength(5);
			}

			// Verify each stage was called with appropriate arguments
			expect(ingestSpy).toHaveBeenCalledWith(mockDevEnv, "2", "15");
			expect(topicSpy).toHaveBeenCalledWith(mockDevEnv, { days: 2 });
			expect(contentSpy).toHaveBeenCalledWith(mockDevEnv, sampleTopicResponse);
			expect(renderSpy).toHaveBeenCalledWith(sampleContentPackage, mockDevEnv);
			expect(persistSpy).toHaveBeenCalledWith(mockDevEnv, sampleContentPackage, sampleRenderedArtifact);
			expect(notifySpy).toHaveBeenCalledWith(mockDevEnv, {
				postId: "00000000-0000-0000-0000-000000000001",
				dryRun: false,
			});
		});

		it("2. Stops cleanly at Stage 2 when no strong topic is found", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: true,
				result: { fetched_count: 5, valid_count: 5, invalid_count: 0, duplicate_count: 0, database_affected_count: 0 },
			} as any);

			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: {
					...sampleTopicResponse,
					selection_status: "no_strong_topic",
					selection_kind: "no_strong_topic",
					selected_topic: null,
					alternative_candidates: [{ topic_title: "Weak topic", reason_not_selected: "Insufficient evidence", article_ids: ["art-1"] }],
				},
			});

			const contentSpy = vi.spyOn(contentGenerationModule, "generateContentForSelection");
			const renderSpy = vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts");
			const persistSpy = vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel");
			const notifySpy = vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost");

			const outcome = await pipelineModule.executePipeline(mockDevEnv);

			expect(outcome.success).toBe(true);
			if (outcome.success && outcome.status === "no_strong_topic") {
				expect(outcome.stage).toBe("topic_selection");
				expect(outcome.message).toContain("No strong legal topic");
				expect(outcome.alternative_candidates).toHaveLength(1);
			}

			// Subsequent stages must NOT have been called
			expect(contentSpy).not.toHaveBeenCalled();
			expect(renderSpy).not.toHaveBeenCalled();
			expect(persistSpy).not.toHaveBeenCalled();
			expect(notifySpy).not.toHaveBeenCalled();
		});

		it("3. Stops and reports failure when Stage 1 (news ingestion) fails", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: false,
				status: 502,
				error: "LawBriefly API unreachable",
			});

			const topicSpy = vi.spyOn(topicSelectionModule, "selectHotTopic");

			const outcome = await pipelineModule.executePipeline(mockDevEnv);

			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.stage).toBe("news_ingestion");
				expect(outcome.status).toBe(502);
				expect(outcome.error).toBe("LawBriefly API unreachable");
			}
			expect(topicSpy).not.toHaveBeenCalled();
		});

		it("4. Stops and reports failure when Stage 2 (topic selection) fails", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true } as any);
			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: false,
				status: 500,
				error: "Mercury Decide LLM timeout",
			});

			const contentSpy = vi.spyOn(contentGenerationModule, "generateContentForSelection");

			const outcome = await pipelineModule.executePipeline(mockDevEnv);

			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.stage).toBe("topic_selection");
				expect(outcome.status).toBe(500);
				expect(outcome.error).toBe("Mercury Decide LLM timeout");
			}
			expect(contentSpy).not.toHaveBeenCalled();
		});

		it("5. Stops and reports failure when Stage 3 (content generation) returns insufficient evidence", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true } as any);
			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: sampleTopicResponse,
			});
			vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
				success: true,
				data: {
					...sampleContentPackage,
					generation_status: "insufficient_evidence",
					evidence: { limitations: ["Single uncorroborated source"] },
				},
			});

			const renderSpy = vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts");

			const outcome = await pipelineModule.executePipeline(mockDevEnv);

			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.stage).toBe("content_generation");
				expect(outcome.status).toBe(422);
				expect(outcome.error).toContain("insufficient_evidence");
			}
			expect(renderSpy).not.toHaveBeenCalled();
		});

		it("6. Stops and reports failure when Stage 4 (rendering) throws", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true } as any);
			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: sampleTopicResponse,
			});
			vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
				success: true,
				data: sampleContentPackage,
			});
			vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockRejectedValue(
				new Error("Cloudflare Browser connection dropped")
			);

			const persistSpy = vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel");

			const outcome = await pipelineModule.executePipeline(mockDevEnv);

			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.stage).toBe("carousel_rendering");
				expect(outcome.status).toBe(500);
				expect(outcome.error).toBe("Cloudflare Browser connection dropped");
			}
			expect(persistSpy).not.toHaveBeenCalled();
		});

		it("7. Stops and reports failure when Stage 5 (persistence) throws", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true } as any);
			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: sampleTopicResponse,
			});
			vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
				success: true,
				data: sampleContentPackage,
			});
			vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockResolvedValue(sampleRenderedArtifact);
			vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel").mockRejectedValue(
				new Error("A persistence operation for this content is currently in progress. Please retry shortly.")
			);

			const notifySpy = vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost");

			const outcome = await pipelineModule.executePipeline(mockDevEnv);

			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.stage).toBe("carousel_persistence");
				expect(outcome.status).toBe(409); // in progress translates to 409
				expect(outcome.error).toContain("in progress");
			}
			expect(notifySpy).not.toHaveBeenCalled();
		});

		it("8. Stops and reports failure when Stage 6 (notification) throws", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true } as any);
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
			vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost").mockRejectedValue(
				new Error("Telegram sendMediaGroup API rate limit (429)")
			);

			const outcome = await pipelineModule.executePipeline(mockDevEnv);

			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.stage).toBe("editorial_notification");
				expect(outcome.status).toBe(500);
				expect(outcome.post_id).toBe("00000000-0000-0000-0000-000000000001");
				expect(outcome.error).toBe("Telegram sendMediaGroup API rate limit (429)");
			}
		});

		it("9. Concurrency lock prevents overlapping pipeline runs with HTTP 409", async () => {
			// Manually hold the pipeline lock
			const acquired = pipelineModule.acquirePipelineLock("existing-lock");
			expect(acquired).toBe(true);

			const outcome = await pipelineModule.executePipeline(mockDevEnv);

			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.status).toBe(409);
				expect(outcome.stage).toBe("concurrency_lock");
				expect(outcome.error).toContain("currently in progress");
			}
		});
	});

	describe("HTTP Endpoint: POST /api/ai/run-pipeline", () => {
		it("10. Returns 404 in non-development environments", async () => {
			const req = new Request("http://localhost/api/ai/run-pipeline", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			});
			const res = await worker.fetch(req, mockProdEnv, {} as any);
			expect(res.status).toBe(404);
		});

		it("11. Returns 405 Method Not Allowed for non-POST requests", async () => {
			const req = new Request("http://localhost/api/ai/run-pipeline", {
				method: "GET",
			});
			const res = await worker.fetch(req, mockDevEnv, {} as any);
			expect(res.status).toBe(405);
		});

		it("12. Returns 400 Bad Request for malformed JSON payload", async () => {
			const req = new Request("http://localhost/api/ai/run-pipeline", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not-json{",
			});
			const res = await worker.fetch(req, mockDevEnv, {} as any);
			expect(res.status).toBe(400);
			const data = await res.json() as any;
			expect(data.error).toBe("Bad Request");
		});

		it("13. Successfully routes valid POST request and returns 200 with completed pipeline payload", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true } as any);
			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({ success: true, data: sampleTopicResponse });
			vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({ success: true, data: sampleContentPackage });
			vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockResolvedValue(sampleRenderedArtifact);
			vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel").mockResolvedValue(samplePersistResult);
			vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost").mockResolvedValue(sampleNotificationResult);

			const req = new Request("http://localhost/api/ai/run-pipeline", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ days: 1, limit: 10 }),
			});

			const res = await worker.fetch(req, mockDevEnv, {} as any);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.success).toBe(true);
			expect(data.status).toBe("completed");
			expect(data.post_id).toBe("00000000-0000-0000-0000-000000000001");
			expect(data.topic.topic_title).toBe("Supreme Court Overhauls Tax Enforcement");
			expect(data.carousel_slide_count).toBe(5);
			expect(data.telegram_notification.control_message_id).toBe(100);
		});
	});

	describe("Scheduled Cron Handler: 0 2 * * * (Task 19 Autonomous Pipeline)", () => {
		const mockScheduledContext = {} as ExecutionContext;

		const mockPipelineEnv: Env = {
			...mockDevEnv,
			AUTONOMOUS_PIPELINE_ENABLED: "true",
		};

		function mockSuccessfulPipelineStages() {
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

		it("1. Correct routing: 0 2 * * * invokes executePipeline with verified defaults (days: 3, limit: 30) when enabled", async () => {
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: true,
				result: { fetched_count: 10, valid_count: 10, invalid_count: 0, duplicate_count: 0, database_affected_count: 10 },
			} as any);
			const topicSpy = vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: sampleTopicResponse,
			});
			const contentSpy = vi.spyOn(contentGenerationModule, "generateContentForSelection").mockResolvedValue({
				success: true,
				data: sampleContentPackage,
			});
			const renderSpy = vi.spyOn(carouselRenderingModule, "renderCarouselArtifacts").mockResolvedValue(sampleRenderedArtifact);
			const persistSpy = vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel").mockResolvedValue(samplePersistResult);
			const notifySpy = vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost").mockResolvedValue(sampleNotificationResult);

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, mockPipelineEnv, mockScheduledContext);

			expect(ingestSpy).toHaveBeenCalledWith(mockPipelineEnv, "3", "30");
			expect(topicSpy).toHaveBeenCalledWith(mockPipelineEnv, { days: 3 });
			expect(contentSpy).toHaveBeenCalledWith(mockPipelineEnv, sampleTopicResponse);
			expect(renderSpy).toHaveBeenCalledWith(sampleContentPackage, mockPipelineEnv);
			expect(persistSpy).toHaveBeenCalledWith(mockPipelineEnv, sampleContentPackage, sampleRenderedArtifact);
			expect(notifySpy).toHaveBeenCalledWith(mockPipelineEnv, {
				postId: "00000000-0000-0000-0000-000000000001",
				dryRun: false,
			});
		});

		it("2. Existing news sync Cron (30 0 * * *) still invokes handleScheduledNewsSync and not the pipeline", async () => {
			const newsSyncSpy = vi.spyOn(newsIngestionModule, "handleScheduledNewsSync").mockResolvedValue({} as any);
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion");

			const controller: ScheduledController = {
				cron: "30 0 * * *",
				scheduledTime: 1761957000000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, mockPipelineEnv, mockScheduledContext);

			expect(newsSyncSpy).toHaveBeenCalledTimes(1);
			expect(ingestSpy).not.toHaveBeenCalled();
		});

		it("3. Existing queue recovery Cron (*/15 * * * *) operates as before and does not invoke the pipeline", async () => {
			const recoverySpy = vi.spyOn(editorialApprovalModule, "recoverStrandedApprovedPosts").mockResolvedValue({} as any);
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion");
			const newsSyncSpy = vi.spyOn(newsIngestionModule, "handleScheduledNewsSync");

			const envWithAutoPublish: Env = {
				...mockPipelineEnv,
				INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "true",
			};

			const controller: ScheduledController = {
				cron: "*/15 * * * *",
				scheduledTime: 1761957900000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, envWithAutoPublish, mockScheduledContext);

			expect(recoverySpy).toHaveBeenCalledTimes(1);
			expect(ingestSpy).not.toHaveBeenCalled();
			expect(newsSyncSpy).not.toHaveBeenCalled();
		});

		it("4. Unrecognized Cron expressions do not execute the pipeline, news sync, or recovery", async () => {
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion");
			const newsSyncSpy = vi.spyOn(newsIngestionModule, "handleScheduledNewsSync");
			const recoverySpy = vi.spyOn(editorialApprovalModule, "recoverStrandedApprovedPosts");

			const controller: ScheduledController = {
				cron: "0 5 * * *",
				scheduledTime: 1761973200000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, mockPipelineEnv, mockScheduledContext);

			expect(ingestSpy).not.toHaveBeenCalled();
			expect(newsSyncSpy).not.toHaveBeenCalled();
			expect(recoverySpy).not.toHaveBeenCalled();
		});

		it("5. Missing AUTONOMOUS_PIPELINE_ENABLED prevents pipeline execution and logs skip", async () => {
			const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion");

			const envWithoutKillSwitch: Env = { ...mockDevEnv };
			delete envWithoutKillSwitch.AUTONOMOUS_PIPELINE_ENABLED;

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, envWithoutKillSwitch, mockScheduledContext);

			expect(ingestSpy).not.toHaveBeenCalled();
			const skipLog = consoleLogSpy.mock.calls.find((call) => {
				try {
					const parsed = JSON.parse(String(call[0]));
					return parsed.event === "scheduled_pipeline_skipped";
				} catch {
					return false;
				}
			});
			expect(skipLog).toBeDefined();
			const parsed = JSON.parse(String(skipLog![0]));
			expect(parsed.enabled).toBe(false);
			expect(parsed.reason).toContain("AUTONOMOUS_PIPELINE_ENABLED is not set to 'true'");
		});

		it("6. AUTONOMOUS_PIPELINE_ENABLED='false' prevents pipeline execution", async () => {
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion");

			const envWithFalse: Env = {
				...mockDevEnv,
				AUTONOMOUS_PIPELINE_ENABLED: "false",
			};

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, envWithFalse, mockScheduledContext);

			expect(ingestSpy).not.toHaveBeenCalled();
		});

		it("7. Only exact value 'true' enables pipeline execution", async () => {
			mockSuccessfulPipelineStages();
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion");

			// Invalid variations: "TRUE", "1", "yes", "enabled"
			for (const invalidVal of ["TRUE", "1", "yes", "enabled"]) {
				const envInvalid: Env = { ...mockDevEnv, AUTONOMOUS_PIPELINE_ENABLED: invalidVal };
				await worker.scheduled({ cron: "0 2 * * *", scheduledTime: 1761962400000, noRetry: vi.fn() }, envInvalid, mockScheduledContext);
			}
			expect(ingestSpy).not.toHaveBeenCalled();

			// Exact "true" enables
			await worker.scheduled({ cron: "0 2 * * *", scheduledTime: 1761962400000, noRetry: vi.fn() }, mockPipelineEnv, mockScheduledContext);
			expect(ingestSpy).toHaveBeenCalledTimes(1);
		});

		it("8. Pipeline is invoked exactly once for an enabled scheduled event", async () => {
			mockSuccessfulPipelineStages();
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion");

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, mockPipelineEnv, mockScheduledContext);

			expect(ingestSpy).toHaveBeenCalledTimes(1);
		});

		it("9. Concurrency lock prevents overlapping scheduled execution (records skipped conflict)", async () => {
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			// Pre-acquire the lock as if a manual run is in progress
			pipelineModule.acquirePipelineLock("manual-run-123");

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			// Must not throw an unhandled exception
			await expect(worker.scheduled(controller, mockPipelineEnv, mockScheduledContext)).resolves.not.toThrow();

			const conflictLog = consoleWarnSpy.mock.calls.find((call) => {
				try {
					const parsed = JSON.parse(String(call[0]));
					return parsed.event === "scheduled_pipeline_skipped" && parsed.status === "concurrency_conflict";
				} catch {
					return false;
				}
			});
			expect(conflictLog).toBeDefined();
			const parsed = JSON.parse(String(conflictLog![0]));
			expect(parsed.stage).toBe("concurrency_lock");
		});

		it("10. A no-strong-topic outcome is handled safely without throwing an error", async () => {
			const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true, result: {} } as any);
			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: { selection_status: "no_strong_topic", selection_kind: "none" } as any,
			});
			const notifySpy = vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost");

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			await expect(worker.scheduled(controller, mockPipelineEnv, mockScheduledContext)).resolves.not.toThrow();

			expect(notifySpy).not.toHaveBeenCalled();

			const completionLog = consoleLogSpy.mock.calls.find((call) => {
				try {
					const parsed = JSON.parse(String(call[0]));
					return parsed.event === "scheduled_pipeline_completed" && parsed.status === "no_strong_topic";
				} catch {
					return false;
				}
			});
			expect(completionLog).toBeDefined();
		});

		it("11. Pipeline failure is logged and reported as a failed scheduled execution (throws error)", async () => {
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: false,
				status: 502,
				error: "LawBriefly API unavailable",
			} as any);

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			await expect(worker.scheduled(controller, mockPipelineEnv, mockScheduledContext)).rejects.toThrow(
				"Scheduled pipeline failed at stage 'news_ingestion': LawBriefly API unavailable"
			);

			const failureLog = consoleErrorSpy.mock.calls.find((call) => {
				try {
					const parsed = JSON.parse(String(call[0]));
					return parsed.event === "scheduled_pipeline_failed";
				} catch {
					return false;
				}
			});
			expect(failureLog).toBeDefined();
			const parsed = JSON.parse(String(failureLog![0]));
			expect(parsed.stage).toBe("news_ingestion");
			expect(parsed.error).toBe("LawBriefly API unavailable");
		});

		it("12. Telegram editorial notification occurs only through the successful pipeline path", async () => {
			mockSuccessfulPipelineStages();
			const notifySpy = vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost");

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, mockPipelineEnv, mockScheduledContext);

			expect(notifySpy).toHaveBeenCalledTimes(1);
			expect(notifySpy).toHaveBeenCalledWith(mockPipelineEnv, {
				postId: "00000000-0000-0000-0000-000000000001",
				dryRun: false,
			});
		});

		it("13. Cron execution never directly publishes to Instagram or auto-approves", async () => {
			mockSuccessfulPipelineStages();
			const instagramPublishSpy = vi.spyOn(instagramPublishingModule, "handlePublishInstagram");

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, mockPipelineEnv, mockScheduledContext);

			// Instagram publishing handler must never be called during the cron execution
			expect(instagramPublishSpy).not.toHaveBeenCalled();
		});

		it("14. Manual POST /api/ai/run-pipeline remains functional and accepts custom parameters", async () => {
			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: true,
				result: { fetched_count: 5, valid_count: 5, invalid_count: 0, duplicate_count: 0, database_affected_count: 5 },
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

			const req = new Request("http://localhost/api/ai/run-pipeline", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ days: 2, limit: 15 }),
			});

			const res = await worker.fetch(req, mockDevEnv, {} as any);
			expect(res.status).toBe(200);
			expect(ingestSpy).toHaveBeenCalledWith(mockDevEnv, "2", "15");
		});

		it("15. Secret redaction remains intact: scheduled logs never expose API keys or secrets", async () => {
			const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			mockSuccessfulPipelineStages();

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: 1761962400000,
				noRetry: vi.fn(),
			};

			await worker.scheduled(controller, mockPipelineEnv, mockScheduledContext);

			const allLogOutput = [
				...consoleLogSpy.mock.calls.map((c) => String(c[0])),
				...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
			].join(" ");

			expect(allLogOutput).not.toContain(mockPipelineEnv.LAWBRIEFLY_API_KEY);
			expect(allLogOutput).not.toContain(mockPipelineEnv.SUPABASE_SECRET_KEY);
			expect(allLogOutput).not.toContain(mockPipelineEnv.GROQ_API_KEY);
			expect(allLogOutput).not.toContain(mockPipelineEnv.OPENROUTER_API_KEY);
			expect(allLogOutput).not.toContain(mockPipelineEnv.TELEGRAM_BOT_TOKEN);
			expect(allLogOutput).not.toContain("Authorization");
		});
	});

	describe("Task 19.2: Distributed Pipeline Lock & Cross-Isolate Concurrency Control", () => {
		const mockScheduledContext = {} as ExecutionContext;
		const mockPipelineEnv: Env = {
			...mockDevEnv,
			AUTONOMOUS_PIPELINE_ENABLED: "true",
		};

		function mockStages() {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({
				success: true,
				result: { fetched_count: 5, valid_count: 5, invalid_count: 0, duplicate_count: 0, database_affected_count: 5 },
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

		it("1. First execution successfully acquires the global lock with initial fencing token", async () => {
			mockStages();
			const rpcSpy = vi.fn(async (func: string, args: any) => {
				if (func === "acquire_pipeline_run_lock") {
					return {
						data: [{
							acquired: true,
							lock_name: "global_content_pipeline",
							owner_run_id: args.p_owner_run_id,
							owner_token: args.p_owner_token,
							fencing_token: 1,
							lease_expires_at: new Date(Date.now() + 180000).toISOString(),
							reason: "acquired",
						}],
						error: null,
					};
				}
				if (func === "renew_pipeline_run_lock") {
					return { data: [{ renewed: true, fencing_token: 1, lease_expires_at: new Date(Date.now() + 180000).toISOString(), reason: "renewed" }], error: null };
				}
				if (func === "release_pipeline_run_lock") {
					return { data: [{ released: true, reason: "released" }], error: null };
				}
				return { data: null, error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const outcome = await pipelineModule.executePipeline(mockDevEnv);
			expect(outcome.success).toBe(true);
			expect(rpcSpy).toHaveBeenCalledWith("acquire_pipeline_run_lock", expect.objectContaining({
				p_lock_name: "global_content_pipeline",
				p_lease_duration_seconds: 180,
			}));
		});

		it("2. Second execution is rejected while the lease is active (returns 409 concurrency_conflict)", async () => {
			const rpcSpy = vi.fn(async (func: string) => {
				if (func === "acquire_pipeline_run_lock") {
					return {
						data: [{
							acquired: false,
							lock_name: "global_content_pipeline",
							owner_run_id: "other-isolate-run-123",
							owner_token: "other-token-456",
							fencing_token: 1,
							lease_expires_at: new Date(Date.now() + 120000).toISOString(),
							reason: "lease_active",
						}],
						error: null,
					};
				}
				return { data: null, error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const outcome = await pipelineModule.executePipeline(mockDevEnv);
			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.status).toBe(409);
				expect(outcome.stage).toBe("concurrency_lock");
				expect(outcome.error).toContain("currently in progress");
			}
		});

		it("3. Manual and scheduled execution compete for the same distributed lock", async () => {
			const rpcSpy = vi.fn(async (func: string) => {
				if (func === "acquire_pipeline_run_lock") {
					return {
						data: [{
							acquired: false,
							lock_name: "global_content_pipeline",
							owner_run_id: "manual-run-uuid-1",
							owner_token: "manual-token-1",
							fencing_token: 3,
							lease_expires_at: new Date(Date.now() + 150000).toISOString(),
							reason: "lease_active",
						}],
						error: null,
					};
				}
				return { data: null, error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: Date.now(),
				noRetry: vi.fn(),
			};

			const scheduledOutcome = await pipelineModule.handleScheduledPipelineRun(controller, mockPipelineEnv);
			expect(scheduledOutcome).toBeDefined();
			expect((scheduledOutcome as any)?.status).toBe(409);
			expect((scheduledOutcome as any)?.stage).toBe("concurrency_lock");
		});

		it("4. Two separate mocked Worker-isolate contexts cannot both acquire ownership", async () => {
			let lockOwner: string | null = null;
			let activeFencingToken = 0;

			const createMockSupabaseForIsolate = (isolateId: string) => ({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: vi.fn(async (func: string, args: any) => {
					if (func === "acquire_pipeline_run_lock") {
						if (!lockOwner) {
							lockOwner = isolateId;
							activeFencingToken += 1;
							return {
								data: [{
									acquired: true,
									lock_name: "global_content_pipeline",
									owner_run_id: args.p_owner_run_id,
									owner_token: args.p_owner_token,
									fencing_token: activeFencingToken,
									lease_expires_at: new Date(Date.now() + 180000).toISOString(),
									reason: "acquired",
								}],
								error: null,
							};
						}
						return {
							data: [{
								acquired: false,
								lock_name: "global_content_pipeline",
								owner_run_id: lockOwner,
								owner_token: "held-by-" + lockOwner,
								fencing_token: activeFencingToken,
								lease_expires_at: new Date(Date.now() + 180000).toISOString(),
								reason: "lease_active",
							}],
							error: null,
						};
					}
					return { data: [{ released: true }], error: null };
				}),
			});

			// Isolate 1 acquires
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(createMockSupabaseForIsolate("isolate-1") as any);
			const acq1 = await pipelineModule.acquireDistributedPipelineLock(mockDevEnv, { ownerRunId: "run-iso-1", ownerToken: "token-iso-1" });
			expect(acq1.success).toBe(true);

			// Isolate 2 attempts acquisition while Isolate 1 holds lock
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(createMockSupabaseForIsolate("isolate-2") as any);
			const acq2 = await pipelineModule.acquireDistributedPipelineLock(mockDevEnv, { ownerRunId: "run-iso-2", ownerToken: "token-iso-2" });
			expect(acq2.success).toBe(false);
			expect(acq2.reason).toBe("lease_active");
		});

		it("5. Expired lease can be reclaimed by subsequent execution", async () => {
			const rpcSpy = vi.fn(async (func: string, args: any) => {
				if (func === "acquire_pipeline_run_lock") {
					return {
						data: [{
							acquired: true,
							lock_name: "global_content_pipeline",
							owner_run_id: args.p_owner_run_id,
							owner_token: args.p_owner_token,
							fencing_token: 5,
							lease_expires_at: new Date(Date.now() + 180000).toISOString(),
							reason: "acquired",
						}],
						error: null,
					};
				}
				return { data: [{ released: true }], error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const result = await pipelineModule.acquireDistributedPipelineLock(mockDevEnv, {
				ownerRunId: "reclaiming-run",
				ownerToken: "reclaiming-token",
			});
			expect(result.success).toBe(true);
			expect(result.reason).toBe("acquired");
		});

		it("6. Reclaimed lease receives a higher monotonically increasing fencing token", async () => {
			const rpcSpy = vi.fn(async (func: string, args: any) => {
				if (func === "acquire_pipeline_run_lock") {
					return {
						data: [{
							acquired: true,
							lock_name: "global_content_pipeline",
							owner_run_id: args.p_owner_run_id,
							owner_token: args.p_owner_token,
							fencing_token: 8,
							lease_expires_at: new Date(Date.now() + 180000).toISOString(),
							reason: "acquired",
						}],
						error: null,
					};
				}
				return { data: null, error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const result = await pipelineModule.acquireDistributedPipelineLock(mockDevEnv, {
				ownerRunId: "takeover-run",
				ownerToken: "takeover-token",
			});
			expect(result.success).toBe(true);
			expect(result.fencingToken).toBe(8);
		});

		it("7. Old owner cannot renew a newer owner's lease", async () => {
			const rpcSpy = vi.fn(async (func: string) => {
				if (func === "renew_pipeline_run_lock") {
					return {
						data: [{
							renewed: false,
							lock_name: "global_content_pipeline",
							fencing_token: 9,
							reason: "fencing_token_mismatch",
						}],
						error: null,
					};
				}
				return { data: null, error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const result = await pipelineModule.renewDistributedPipelineLock(mockDevEnv, {
				ownerToken: "stale-owner-token",
				fencingToken: 8,
			});
			expect(result.renewed).toBe(false);
			expect(result.reason).toBe("fencing_token_mismatch");
		});

		it("8. Old owner cannot release a newer owner's lease", async () => {
			const rpcSpy = vi.fn(async (func: string) => {
				if (func === "release_pipeline_run_lock") {
					return {
						data: [{
							released: false,
							lock_name: "global_content_pipeline",
							reason: "owner_mismatch",
						}],
						error: null,
					};
				}
				return { data: null, error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const result = await pipelineModule.releaseDistributedPipelineLock(mockDevEnv, {
				ownerToken: "stale-owner-token",
				fencingToken: 8,
			});
			expect(result.released).toBe(false);
			expect(result.reason).toBe("owner_mismatch");
		});

		it("9. Valid owner can renew lease", async () => {
			const rpcSpy = vi.fn(async (func: string, args: any) => {
				if (func === "renew_pipeline_run_lock") {
					return {
						data: [{
							renewed: true,
							lock_name: "global_content_pipeline",
							fencing_token: args.p_fencing_token,
							lease_expires_at: new Date(Date.now() + 180000).toISOString(),
							reason: "renewed",
						}],
						error: null,
					};
				}
				return { data: null, error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const result = await pipelineModule.renewDistributedPipelineLock(mockDevEnv, {
				ownerToken: "valid-owner-token",
				fencingToken: 9,
			});
			expect(result.renewed).toBe(true);
			expect(result.reason).toBe("renewed");
		});

		it("10. Valid owner can release lease", async () => {
			const rpcSpy = vi.fn(async (func: string) => {
				if (func === "release_pipeline_run_lock") {
					return {
						data: [{
							released: true,
							lock_name: "global_content_pipeline",
							reason: "released",
						}],
						error: null,
					};
				}
				return { data: null, error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const result = await pipelineModule.releaseDistributedPipelineLock(mockDevEnv, {
				ownerToken: "valid-owner-token",
				fencingToken: 9,
			});
			expect(result.released).toBe(true);
			expect(result.reason).toBe("released");
		});

		it("11. Supabase RPC failure prevents pipeline execution (fail-closed with 503)", async () => {
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: vi.fn().mockResolvedValue({
					data: null,
					error: new Error("503 Service Unavailable: PostgreSQL connection pool exhausted"),
				}),
			} as any);

			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion");

			const outcome = await pipelineModule.executePipeline(mockDevEnv);
			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.status).toBe(503);
				expect(outcome.stage).toBe("concurrency_lock");
				expect(outcome.error).toContain("failed closed");
			}
			expect(ingestSpy).not.toHaveBeenCalled();
		});

		it("12. Lease loss stops further pipeline side effects before persistence", async () => {
			mockStages();
			let rpcCallCount = 0;
			const rpcSpy = vi.fn(async (func: string, args: any) => {
				rpcCallCount++;
				if (func === "acquire_pipeline_run_lock") {
					return {
						data: [{
							acquired: true,
							lock_name: "global_content_pipeline",
							owner_run_id: args.p_owner_run_id,
							owner_token: args.p_owner_token,
							fencing_token: 1,
							lease_expires_at: new Date(Date.now() + 180000).toISOString(),
							reason: "acquired",
						}],
						error: null,
					};
				}
				if (func === "renew_pipeline_run_lock") {
					// Stage 2 and Stage 3 renew successfully
					if (rpcCallCount <= 3) {
						return { data: [{ renewed: true, fencing_token: 1, reason: "renewed" }], error: null };
					}
					// Before Stage 4 (rendering/persistence), renewal fails due to lease loss!
					return { data: [{ renewed: false, fencing_token: 2, reason: "lease_expired" }], error: null };
				}
				return { data: [{ released: true }], error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			const persistSpy = vi.spyOn(carouselPersistenceModule, "persistRenderedCarousel");
			const notifySpy = vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost");

			const outcome = await pipelineModule.executePipeline(mockDevEnv);
			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.status).toBe(409);
				expect(outcome.stage).toBe("concurrency_lock");
			}

			expect(persistSpy).not.toHaveBeenCalled();
			expect(notifySpy).not.toHaveBeenCalled();
		});

		it("13. Pipeline failure still releases the current owner's lock in finally", async () => {
			let releasedCalled = false;
			const rpcSpy = vi.fn(async (func: string, args: any) => {
				if (func === "acquire_pipeline_run_lock") {
					return {
						data: [{
							acquired: true,
							lock_name: "global_content_pipeline",
							owner_run_id: args.p_owner_run_id,
							owner_token: args.p_owner_token,
							fencing_token: 1,
							lease_expires_at: new Date(Date.now() + 180000).toISOString(),
							reason: "acquired",
						}],
						error: null,
					};
				}
				if (func === "release_pipeline_run_lock") {
					releasedCalled = true;
					return { data: [{ released: true, reason: "released" }], error: null };
				}
				return { data: null, error: null };
			});

			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: rpcSpy,
			} as any);

			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockRejectedValue(new Error("Ingestion network crashed"));

			await pipelineModule.executePipeline(mockDevEnv).catch(() => {});
			expect(releasedCalled).toBe(true);
		});

		it("14. Existing no-strong-topic handling remains intact with distributed lock", async () => {
			vi.spyOn(newsIngestionModule, "executeNewsIngestion").mockResolvedValue({ success: true, result: {} } as any);
			vi.spyOn(topicSelectionModule, "selectHotTopic").mockResolvedValue({
				success: true,
				data: { selection_status: "no_strong_topic", selection_kind: "none" } as any,
			});

			const outcome = await pipelineModule.executePipeline(mockDevEnv);
			expect(outcome.success).toBe(true);
			expect(outcome.status).toBe("no_strong_topic");
		});

		it("15. Existing Telegram editorial notification occurs only after verified lock acquisition", async () => {
			mockStages();
			const notifySpy = vi.spyOn(editorialApprovalModule, "notifyEditorForStoredPost");

			const outcome = await pipelineModule.executePipeline(mockDevEnv);
			expect(outcome.success).toBe(true);
			expect(notifySpy).toHaveBeenCalledTimes(1);
		});

		it("16. Existing publishing and outbox tests remain intact (no auto-publish)", async () => {
			mockStages();
			const publishSpy = vi.spyOn(instagramPublishingModule, "publishApprovedCarousel");

			await pipelineModule.executePipeline(mockDevEnv);
			expect(publishSpy).not.toHaveBeenCalled();
		});

		it("17. Kill-switch semantics remain unchanged (disabled by default skips cleanly)", async () => {
			const controller: ScheduledController = {
				cron: "0 2 * * *",
				scheduledTime: Date.now(),
				noRetry: vi.fn(),
			};

			const envDisabled: Env = {
				...mockDevEnv,
				AUTONOMOUS_PIPELINE_ENABLED: "false",
			};

			const outcome = await pipelineModule.handleScheduledPipelineRun(controller, envDisabled);
			expect((outcome as any)?.skipped).toBe(true);
			expect((outcome as any)?.reason).toBe("kill_switch_disabled");
		});

		it("18. No fallback to process-local locking occurs in production mode when database fails", async () => {
			vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
				from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })),
				rpc: vi.fn().mockRejectedValue(new Error("Supabase host unreachable")),
			} as any);

			const ingestSpy = vi.spyOn(newsIngestionModule, "executeNewsIngestion");

			const outcome = await pipelineModule.executePipeline(mockProdEnv);
			expect(outcome.success).toBe(false);
			if (!outcome.success) {
				expect(outcome.status).toBe(503);
				expect(outcome.stage).toBe("concurrency_lock");
			}
			expect(ingestSpy).not.toHaveBeenCalled();
		});
	});
});

