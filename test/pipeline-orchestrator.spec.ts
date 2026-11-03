import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker, { type Env } from "../src/index";
import * as pipelineModule from "../src/services/pipeline-orchestrator";
import * as newsIngestionModule from "../src/services/news-ingestion";
import * as topicSelectionModule from "../src/services/topic-selection";
import * as contentGenerationModule from "../src/services/content-generation";
import * as carouselRenderingModule from "../src/services/carousel-rendering";
import * as carouselPersistenceModule from "../src/services/carousel-persistence";
import * as editorialApprovalModule from "../src/services/editorial-approval";

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
});

