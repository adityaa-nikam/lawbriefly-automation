import type { Env } from "../index";
import { executeNewsIngestion, type IngestionOutcome } from "./news-ingestion";
import { selectHotTopic, type SelectHotTopicOutcome } from "./topic-selection";
import { generateContentForSelection, type ContentGenerationOutcome } from "./content-generation";
import { renderCarouselArtifacts, type RenderedCarouselArtifact } from "./carousel-rendering";
import { persistRenderedCarousel, type PersistCarouselResult } from "./carousel-persistence";
import { notifyEditorForStoredPost, type NotifyEditorResult } from "./editorial-approval";

export interface PipelineOptions {
	days?: string | number;
	limit?: string | number;
	dryRun?: boolean;
}

export type PipelineStage =
	| "concurrency_lock"
	| "news_ingestion"
	| "topic_selection"
	| "content_generation"
	| "carousel_rendering"
	| "carousel_persistence"
	| "editorial_notification";

export interface PipelineSuccessResult {
	success: true;
	status: "completed";
	post_id: string;
	post_status: string;
	is_duplicate: boolean;
	topic: {
		candidate_id?: string;
		topic_title?: string;
		legal_domain?: string;
		jurisdiction?: string;
	};
	carousel_slide_count: number;
	telegram_notification: {
		success: boolean;
		approval_request_id?: string;
		telegram_chat_id?: string;
		control_message_id?: number;
		media_message_ids?: number[];
		expires_at?: string;
		is_already_sent?: boolean;
	};
}

export interface PipelineNoTopicResult {
	success: true;
	status: "no_strong_topic";
	stage: "topic_selection";
	message: string;
	selection_kind?: string;
	alternative_candidates?: any[];
}

export interface PipelineFailureResult {
	success: false;
	status: number;
	stage: PipelineStage;
	error: string;
	details?: string;
	post_id?: string;
}

export type PipelineOutcome =
	| PipelineSuccessResult
	| PipelineNoTopicResult
	| PipelineFailureResult;

// In-memory concurrency lock with auto-expiry
let activePipelineLock: { startedAt: number; runId: string } | null = null;
const PIPELINE_LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15-minute safety boundary

export function acquirePipelineLock(runId = crypto.randomUUID()): boolean {
	const now = Date.now();
	if (activePipelineLock && now - activePipelineLock.startedAt < PIPELINE_LOCK_TIMEOUT_MS) {
		return false;
	}
	activePipelineLock = { startedAt: now, runId };
	return true;
}

export function releasePipelineLock(): void {
	activePipelineLock = null;
}

export function isPipelineLocked(): boolean {
	if (!activePipelineLock) return false;
	return Date.now() - activePipelineLock.startedAt < PIPELINE_LOCK_TIMEOUT_MS;
}

/**
 * Orchestrates the full LawBriefly AI content pipeline end-to-end:
 * 1. executeNewsIngestion()
 * 2. selectHotTopic()
 * 3. generateContentForSelection()
 * 4. renderCarouselArtifacts()
 * 5. persistRenderedCarousel()
 * 6. notifyEditorForStoredPost()
 */
export async function executePipeline(
	env: Env,
	options?: PipelineOptions
): Promise<PipelineOutcome> {
	if (!acquirePipelineLock()) {
		return {
			success: false,
			status: 409,
			stage: "concurrency_lock",
			error: "A pipeline run is currently in progress. Concurrent execution is prohibited.",
		};
	}

	try {
		const days = options?.days !== undefined ? String(options.days) : "1";
		const limit = options?.limit !== undefined ? String(options.limit) : "10";

		// Stage 1: News Ingestion
		console.log(`[Pipeline] Stage 1: Ingesting news (days=${days}, limit=${limit})...`);
		const ingestionOutcome = await executeNewsIngestion(env, days, limit);
		if (!ingestionOutcome.success) {
			return {
				success: false,
				status: ingestionOutcome.status || 500,
				stage: "news_ingestion",
				error: ingestionOutcome.error,
				details: ingestionOutcome.details,
			};
		}

		// Stage 2: Hot Topic Selection
		console.log("[Pipeline] Stage 2: Selecting hot legal topic...");
		const topicOutcome = await selectHotTopic(env, { days: Number(days) });
		if (!topicOutcome.success) {
			return {
				success: false,
				status: topicOutcome.status || 500,
				stage: "topic_selection",
				error: topicOutcome.error,
				details: topicOutcome.details,
			};
		}

		if (
			topicOutcome.data.selection_status === "no_strong_topic" ||
			!topicOutcome.data.selected_topic
		) {
			console.log("[Pipeline] Stage 2: No strong legal topic met editorial threshold.");
			return {
				success: true,
				status: "no_strong_topic",
				stage: "topic_selection",
				message: "No strong legal topic met editorial threshold for publication.",
				selection_kind: topicOutcome.data.selection_kind,
				alternative_candidates: topicOutcome.data.alternative_candidates,
			};
		}

		// Stage 3: Content Generation (extracts articles via Jina internally)
		console.log(`[Pipeline] Stage 3: Generating content package for "${topicOutcome.data.selected_topic.topic_title}"...`);
		const contentOutcome = await generateContentForSelection(env, topicOutcome.data);
		if (!contentOutcome.success) {
			return {
				success: false,
				status: contentOutcome.status || 500,
				stage: "content_generation",
				error: contentOutcome.error,
				details: contentOutcome.details,
			};
		}

		const contentPackage = contentOutcome.data;
		if (contentPackage.generation_status === "insufficient_evidence") {
			return {
				success: false,
				status: 422,
				stage: "content_generation",
				error: "Cannot persist carousel: content generated with 'insufficient_evidence' status.",
				details: contentPackage.evidence?.limitations?.join("; "),
			};
		}

		if (contentPackage.generation_status !== "ready_for_review") {
			return {
				success: false,
				status: 400,
				stage: "content_generation",
				error: `Invalid generation_status: '${contentPackage.generation_status}'. Must be 'ready_for_review'.`,
			};
		}

		// Stage 4: Carousel Rendering (Dual-format PNG & JPEG via Browser Run)
		console.log("[Pipeline] Stage 4: Rendering carousel slides...");
		let renderedArtifact: RenderedCarouselArtifact;
		try {
			renderedArtifact = await renderCarouselArtifacts(contentPackage, env);
		} catch (err: any) {
			console.error("[Pipeline] Stage 4 rendering error:", err);
			return {
				success: false,
				status: 500,
				stage: "carousel_rendering",
				error: err.message || "Failed to render carousel artifacts",
			};
		}

		// Stage 5: Carousel Persistence (Storage & PostgreSQL)
		console.log("[Pipeline] Stage 5: Persisting carousel artifacts to Supabase...");
		let persistResult: PersistCarouselResult;
		try {
			persistResult = await persistRenderedCarousel(env, contentPackage, renderedArtifact);
		} catch (err: any) {
			console.error("[Pipeline] Stage 5 persistence error:", err);
			const isConflict = err.message?.includes("in progress");
			return {
				success: false,
				status: isConflict ? 409 : 500,
				stage: "carousel_persistence",
				error: err.message || "Failed to persist carousel to database and storage",
			};
		}

		if (!persistResult.success || !persistResult.post_id) {
			return {
				success: false,
				status: 500,
				stage: "carousel_persistence",
				error: "Carousel persistence returned unsuccessful outcome without a post ID",
			};
		}

		// Stage 6: Editorial Notification (Telegram album and inline review buttons)
		console.log(`[Pipeline] Stage 6: Sending Telegram editorial notification for post ${persistResult.post_id}...`);
		let notificationResult: NotifyEditorResult;
		try {
			notificationResult = await notifyEditorForStoredPost(env, {
				postId: persistResult.post_id,
				dryRun: Boolean(options?.dryRun),
			});
		} catch (err: any) {
			console.error(`[Pipeline] Stage 6 notification error for post ${persistResult.post_id}:`, err);
			return {
				success: false,
				status: 500,
				stage: "editorial_notification",
				post_id: persistResult.post_id,
				error: err.message || "Failed to deliver Telegram editorial notification",
			};
		}

		console.log(`[Pipeline] Pipeline completed successfully for post ${persistResult.post_id}!`);
		return {
			success: true,
			status: "completed",
			post_id: persistResult.post_id,
			post_status: persistResult.post_status,
			is_duplicate: persistResult.is_duplicate,
			topic: {
				candidate_id: contentPackage.topic?.candidate_id,
				topic_title: contentPackage.topic?.topic_title,
				legal_domain: contentPackage.topic?.legal_domain,
				jurisdiction: contentPackage.topic?.jurisdiction,
			},
			carousel_slide_count: persistResult.carousel_slide_count || contentPackage.slides.length,
			telegram_notification: {
				success: notificationResult.success,
				approval_request_id: notificationResult.approval_request_id,
				telegram_chat_id: notificationResult.telegram_chat_id,
				control_message_id: notificationResult.control_message_id,
				media_message_ids: notificationResult.media_message_ids,
				expires_at: notificationResult.expires_at,
				is_already_sent: notificationResult.is_already_sent,
			},
		};
	} finally {
		releasePipelineLock();
	}
}

/**
 * Development-only HTTP handler for POST /api/ai/run-pipeline.
 */
export async function handleRunPipeline(request: Request, env: Env): Promise<Response> {
	if (env.APP_ENV !== "development" && (env as any).ENVIRONMENT !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (request.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method Not Allowed", status: 405 }), {
			status: 405,
			headers: { "Content-Type": "application/json" },
		});
	}

	let options: PipelineOptions = {};
	try {
		const text = await request.text();
		if (text && text.trim().length > 0) {
			const body = JSON.parse(text);
			if (typeof body === "object" && body !== null) {
				options = body;
			}
		}
	} catch {
		return new Response(JSON.stringify({ error: "Bad Request", message: "Malformed JSON payload" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	const outcome = await executePipeline(env, options);
	const httpStatus = outcome.success ? 200 : outcome.status;

	return new Response(JSON.stringify(outcome), {
		status: httpStatus,
		headers: { "Content-Type": "application/json" },
	});
}
