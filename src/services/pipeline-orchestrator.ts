import type { Env } from "../index";
import { executeNewsIngestion, type IngestionOutcome } from "./news-ingestion";
import { selectHotTopic, type SelectHotTopicOutcome } from "./topic-selection";
import { generateContentForSelection, type ContentGenerationOutcome } from "./content-generation";
import { renderCarouselArtifacts, type RenderedCarouselArtifact } from "./carousel-rendering";
import { persistRenderedCarousel, type PersistCarouselResult } from "./carousel-persistence";
import { notifyEditorForStoredPost, type NotifyEditorResult } from "./editorial-approval";
import {
	logOperationalEvent,
	recordPipelineRunMetric,
	recordPipelineSuccessMetric,
	recordPipelineFailureMetric,
	persistPipelineRunMetric,
	persistStageEventMetric,
	sendOperationalAlert,
} from "./observability";
import {
	acquireDistributedPipelineLock,
	renewDistributedPipelineLock,
	releaseDistributedPipelineLock,
	DEFAULT_PIPELINE_LOCK_NAME,
	DEFAULT_LEASE_DURATION_SECONDS,
	type AcquireLockResult,
	type RenewLockResult,
	type ReleaseLockResult,
} from "./distributed-lock";

export {
	acquireDistributedPipelineLock,
	renewDistributedPipelineLock,
	releaseDistributedPipelineLock,
	DEFAULT_PIPELINE_LOCK_NAME,
	DEFAULT_LEASE_DURATION_SECONDS,
};

export interface PipelineOptions {
	days?: string | number;
	limit?: string | number;
	dryRun?: boolean;
	runId?: string;
	triggerType?: "scheduled" | "manual";
	cronExpression?: string;
}

export type PipelineStage =
	| "concurrency_lock"
	| "news_ingestion"
	| "topic_selection"
	| "content_generation"
	| "carousel_rendering"
	| "carousel_persistence"
	| "editorial_notification"
	| "instagram_publication";

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

export interface ActiveStageInfo {
	stage: PipelineStage;
	status: "waiting" | "running" | "completed" | "failed" | "skipped";
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	metadata?: Record<string, any>;
	error?: string;
}

export interface ActiveRunInfo {
	runId: string;
	triggerType: string;
	currentStage: PipelineStage;
	overallStatus: "running" | "completed" | "failed" | "concurrency_conflict" | "no_strong_topic";
	startedAt: string;
	completedAt?: string;
	elapsedMs: number;
	stages: Record<string, ActiveStageInfo>;
	topicTitle?: string;
	postId?: string;
	approvalRequestId?: string;
	telegramNotificationSent?: boolean;
	error?: string;
}

let currentLiveRun: ActiveRunInfo | null = null;
let lastFinishedRun: ActiveRunInfo | null = null;
const recentRunsHistory: ActiveRunInfo[] = [];

export function recordRunToHistory(run: ActiveRunInfo): void {
	const cloned = { ...run, stages: { ...run.stages } };
	recentRunsHistory.unshift(cloned);
	if (recentRunsHistory.length > 20) {
		recentRunsHistory.pop();
	}
	lastFinishedRun = cloned;
}

export function getRecentRunsList(): ActiveRunInfo[] {
	return recentRunsHistory.map((r) => ({ ...r, stages: { ...r.stages } }));
}

export function clearRecentRunsHistoryForTesting(): void {
	recentRunsHistory.length = 0;
	lastFinishedRun = null;
	currentLiveRun = null;
}

export function getActiveRunProgress(): ActiveRunInfo | null {
	if (!currentLiveRun) return null;
	return {
		...currentLiveRun,
		elapsedMs: Date.now() - new Date(currentLiveRun.startedAt).getTime(),
		stages: { ...currentLiveRun.stages },
	};
}

export function getLastRunProgress(): ActiveRunInfo | null {
	return lastFinishedRun ? { ...lastFinishedRun, stages: { ...lastFinishedRun.stages } } : null;
}

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
	const runId = options?.runId || crypto.randomUUID();
	const ownerToken = `${runId}:${crypto.randomUUID()}`;
	const triggerType = options?.triggerType || "manual";
	const cronExpression = options?.cronExpression;
	const pipelineStartTime = Date.now();
	const environment = env.APP_ENV || "development";

	logOperationalEvent({
		event: "pipeline_run_started",
		timestamp: new Date().toISOString(),
		run_id: runId,
		trigger_type: triggerType,
		cron_expression: cronExpression,
		environment,
		metadata: {
			days: options?.days,
			limit: options?.limit,
		},
	});

	// 1. Fast-path in-memory check (isolate-local caching optimization)
	if (!acquirePipelineLock(runId)) {
		const durationMs = Date.now() - pipelineStartTime;
		logOperationalEvent({
			event: "pipeline_run_skipped",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			cron_expression: cronExpression,
			status: "concurrency_conflict",
			stage: "concurrency_lock",
			duration_ms: durationMs,
			environment,
		});
		recordPipelineRunMetric({
			runId,
			triggerType,
			cronExpression,
			status: "concurrency_conflict",
			durationMs,
			stage: "concurrency_lock",
		});
		return {
			success: false,
			status: 409,
			stage: "concurrency_lock",
			error: "A pipeline run is currently in progress. Concurrent execution is prohibited.",
		};
	}

	// 2. Authoritative distributed lock acquisition via Supabase PostgreSQL
	const lockAcquisition = await acquireDistributedPipelineLock(env, {
		lockName: DEFAULT_PIPELINE_LOCK_NAME,
		ownerRunId: runId,
		ownerToken,
		leaseDurationSeconds: DEFAULT_LEASE_DURATION_SECONDS,
	});

	if (!lockAcquisition.success) {
		releasePipelineLock();
		const durationMs = Date.now() - pipelineStartTime;

		if (lockAcquisition.reason === "lock_unavailable") {
			// Fail-closed: Never execute uncoordinated pipeline when lock authority is down
			logOperationalEvent(
				{
					event: "pipeline_run_failed",
					timestamp: new Date().toISOString(),
					run_id: runId,
					trigger_type: triggerType,
					cron_expression: cronExpression,
					stage: "concurrency_lock",
					status: "failed",
					duration_ms: durationMs,
					error_code: "503",
					error_message: `Distributed lock unavailable: ${lockAcquisition.error || "Lock service error"}`,
					environment,
				},
				"error"
			);
			recordPipelineFailureMetric({
				runId,
				triggerType,
				cronExpression,
				stage: "concurrency_lock",
				errorCode: "503",
				errorMessage: `Distributed lock unavailable: ${lockAcquisition.error || "Lock service error"}`,
				durationMs,
			});
			return {
				success: false,
				status: 503,
				stage: "concurrency_lock",
				error: `Distributed lock service is unavailable. Execution failed closed: ${lockAcquisition.error || "Lock service error"}`,
			};
		}

		// Concurrency conflict: Active lease held by another worker isolate
		logOperationalEvent({
			event: "pipeline_run_skipped",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			cron_expression: cronExpression,
			status: "concurrency_conflict",
			stage: "concurrency_lock",
			duration_ms: durationMs,
			environment,
			metadata: {
				active_owner: lockAcquisition.ownerRunId,
				fencing_token: lockAcquisition.fencingToken,
				lease_expires_at: lockAcquisition.leaseExpiresAt,
			},
		});
		recordPipelineRunMetric({
			runId,
			triggerType,
			cronExpression,
			status: "concurrency_conflict",
			durationMs,
			stage: "concurrency_lock",
		});
		return {
			success: false,
			status: 409,
			stage: "concurrency_lock",
			error: "A pipeline run is currently in progress. Concurrent execution is prohibited.",
		};
	}

	let currentFencingToken = lockAcquisition.fencingToken;

	const allInitialStages: PipelineStage[] = [
		"news_ingestion",
		"topic_selection",
		"content_generation",
		"carousel_rendering",
		"carousel_persistence",
		"editorial_notification",
		"instagram_publication",
	];
	const initialStageMap: Record<string, ActiveStageInfo> = {
		concurrency_lock: {
			stage: "concurrency_lock",
			status: "completed",
			startedAt: new Date(pipelineStartTime).toISOString(),
			completedAt: new Date().toISOString(),
			durationMs: Date.now() - pipelineStartTime,
		},
	};
	for (const s of allInitialStages) {
		initialStageMap[s] = { stage: s, status: "waiting" };
	}

	currentLiveRun = {
		runId,
		triggerType,
		currentStage: "news_ingestion",
		overallStatus: "running",
		startedAt: new Date(pipelineStartTime).toISOString(),
		elapsedMs: 0,
		stages: initialStageMap,
	};

	const renewLockOrAbort = async (stage: PipelineStage): Promise<boolean> => {
		const renewResult = await renewDistributedPipelineLock(env, {
			lockName: DEFAULT_PIPELINE_LOCK_NAME,
			ownerToken,
			fencingToken: currentFencingToken,
			leaseDurationSeconds: DEFAULT_LEASE_DURATION_SECONDS,
		});

		if (!renewResult.renewed) {
			console.error(`[Pipeline] Lock lease lost at stage '${stage}': reason=${renewResult.reason}, error=${renewResult.error || "none"}`);
			await handleStageFailure(
				"concurrency_lock",
				409,
				`Pipeline lock lease lost or superseded at stage '${stage}': ${renewResult.reason}`,
				renewResult.error
			);
			return false;
		}

		currentFencingToken = renewResult.fencingToken;
		return true;
	};

	let currentStageStartTime = Date.now();

	const handleStageFailure = async (
		stage: PipelineStage,
		status: number,
		error: string,
		details?: string,
		postId?: string
	): Promise<PipelineFailureResult> => {
		const stageDuration = Date.now() - currentStageStartTime;
		const totalDuration = Date.now() - pipelineStartTime;

		logOperationalEvent(
			{
				event: "pipeline_stage_failed",
				timestamp: new Date().toISOString(),
				run_id: runId,
				trigger_type: triggerType,
				stage,
				status: "failed",
				duration_ms: stageDuration,
				error_code: String(status),
				error_message: error,
				details,
				post_id: postId,
				environment,
			},
			"error"
		);

		logOperationalEvent(
			{
				event: "pipeline_run_failed",
				timestamp: new Date().toISOString(),
				run_id: runId,
				trigger_type: triggerType,
				stage,
				status: "failed",
				duration_ms: totalDuration,
				error_message: error,
				post_id: postId,
				environment,
			},
			"error"
		);

		recordPipelineFailureMetric({
			runId,
			triggerType,
			cronExpression,
			stage,
			errorCode: String(status),
			errorMessage: error,
			durationMs: totalDuration,
		});

		await persistPipelineRunMetric(env, {
			run_id: runId,
			trigger_type: triggerType,
			cron_expression: cronExpression,
			status: "failed",
			started_at: new Date(pipelineStartTime).toISOString(),
			completed_at: new Date().toISOString(),
			duration_ms: totalDuration,
			failed_stage: stage,
			error_code: String(status),
			error_message: error,
			post_id: postId,
		}).catch(() => {});

		await sendOperationalAlert(env, {
			runId,
			triggerType,
			stage,
			errorCategory: `${stage.toUpperCase()}_FAILURE`,
			errorMessage: error,
			durationMs: totalDuration,
		}).catch(() => {});

		if (currentLiveRun) {
			currentLiveRun.overallStatus = "failed";
			currentLiveRun.error = error;
			currentLiveRun.stages[stage] = {
				...currentLiveRun.stages[stage],
				status: "failed",
				completedAt: new Date().toISOString(),
				durationMs: stageDuration,
				error,
			};
			lastFinishedRun = {
				...currentLiveRun,
				completedAt: new Date().toISOString(),
				elapsedMs: totalDuration,
			};
			recordRunToHistory(lastFinishedRun);
		}

		return {
			success: false,
			status,
			stage,
			error,
			details,
			post_id: postId,
		};
	};

	const handleStageSuccess = async (
		stage: PipelineStage,
		metadata?: Record<string, any>
	): Promise<void> => {
		const stageDuration = Date.now() - currentStageStartTime;
		if (currentLiveRun) {
			currentLiveRun.stages[stage] = {
				...currentLiveRun.stages[stage],
				status: "completed",
				completedAt: new Date().toISOString(),
				durationMs: stageDuration,
				metadata,
			};
		}
		logOperationalEvent({
			event: "pipeline_stage_completed",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			stage,
			status: "success",
			duration_ms: stageDuration,
			environment,
			metadata,
		});
		await persistStageEventMetric(env, {
			run_id: runId,
			stage,
			status: "completed",
			started_at: new Date(currentStageStartTime).toISOString(),
			completed_at: new Date().toISOString(),
			duration_ms: stageDuration,
			metadata,
		}).catch(() => {});
	};

	try {
		const days = options?.days !== undefined ? String(options.days) : "1";
		const limit = options?.limit !== undefined ? String(options.limit) : "10";

		// Stage 1: News Ingestion
		currentStageStartTime = Date.now();
		if (currentLiveRun) {
			currentLiveRun.currentStage = "news_ingestion";
			currentLiveRun.stages["news_ingestion"] = {
				stage: "news_ingestion",
				status: "running",
				startedAt: new Date(currentStageStartTime).toISOString(),
			};
		}
		logOperationalEvent({
			event: "pipeline_stage_started",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			stage: "news_ingestion",
			environment,
		});
		console.log(`[Pipeline] Stage 1: Ingesting news (days=${days}, limit=${limit})...`);
		const ingestionOutcome = await executeNewsIngestion(env, days, limit);
		if (!ingestionOutcome.success) {
			return await handleStageFailure(
				"news_ingestion",
				ingestionOutcome.status || 500,
				ingestionOutcome.error,
				ingestionOutcome.details
			);
		}
		await handleStageSuccess("news_ingestion", {
			fetched: ingestionOutcome.result?.fetched_count,
			valid: ingestionOutcome.result?.valid_count,
		});

		// Stage 2: Hot Topic Selection
		if (!(await renewLockOrAbort("topic_selection"))) {
			return {
				success: false,
				status: 409,
				stage: "concurrency_lock",
				error: "Pipeline lock lease lost or superseded before stage 'topic_selection'",
			};
		}
		currentStageStartTime = Date.now();
		if (currentLiveRun) {
			currentLiveRun.currentStage = "topic_selection";
			currentLiveRun.stages["topic_selection"] = {
				stage: "topic_selection",
				status: "running",
				startedAt: new Date(currentStageStartTime).toISOString(),
			};
		}
		logOperationalEvent({
			event: "pipeline_stage_started",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			stage: "topic_selection",
			environment,
		});
		console.log("[Pipeline] Stage 2: Selecting hot legal topic...");
		const topicOutcome = await selectHotTopic(env, { days: Number(days) });
		if (!topicOutcome.success) {
			return await handleStageFailure(
				"topic_selection",
				topicOutcome.status || 500,
				topicOutcome.error,
				topicOutcome.details
			);
		}

		if (
			topicOutcome.data.selection_status === "no_strong_topic" ||
			!topicOutcome.data.selected_topic
		) {
			console.log("[Pipeline] Stage 2: No strong legal topic met editorial threshold.");
			const s2Duration = Date.now() - currentStageStartTime;
			const totalDuration = Date.now() - pipelineStartTime;
			if (currentLiveRun) {
				currentLiveRun.overallStatus = "no_strong_topic";
				currentLiveRun.stages["topic_selection"] = {
					stage: "topic_selection",
					status: "completed",
					completedAt: new Date().toISOString(),
					durationMs: s2Duration,
					metadata: { selection_status: "no_strong_topic" },
				};
				const remainingStages: PipelineStage[] = [
					"content_generation",
					"carousel_rendering",
					"carousel_persistence",
					"editorial_notification",
					"instagram_publication",
				];
				for (const s of remainingStages) {
					currentLiveRun.stages[s] = { stage: s, status: "skipped" };
				}
				lastFinishedRun = {
					...currentLiveRun,
					completedAt: new Date().toISOString(),
					elapsedMs: totalDuration,
				};
				recordRunToHistory(lastFinishedRun);
			}
			logOperationalEvent({
				event: "pipeline_stage_completed",
				timestamp: new Date().toISOString(),
				run_id: runId,
				trigger_type: triggerType,
				stage: "topic_selection",
				status: "no_strong_topic",
				duration_ms: s2Duration,
				environment,
			});
			logOperationalEvent({
				event: "pipeline_run_completed",
				timestamp: new Date().toISOString(),
				run_id: runId,
				trigger_type: triggerType,
				status: "no_strong_topic",
				duration_ms: totalDuration,
				environment,
			});
			recordPipelineSuccessMetric({
				runId,
				triggerType,
				cronExpression,
				status: "no_strong_topic",
				durationMs: totalDuration,
			});
			await persistPipelineRunMetric(env, {
				run_id: runId,
				trigger_type: triggerType,
				cron_expression: cronExpression,
				status: "no_strong_topic",
				started_at: new Date(pipelineStartTime).toISOString(),
				completed_at: new Date().toISOString(),
				duration_ms: totalDuration,
			}).catch(() => {});
			return {
				success: true,
				status: "no_strong_topic",
				stage: "topic_selection",
				message: "No strong legal topic met editorial threshold for publication.",
				selection_kind: topicOutcome.data.selection_kind,
				alternative_candidates: topicOutcome.data.alternative_candidates,
			};
		}
		if (currentLiveRun && topicOutcome.data.selected_topic) {
			currentLiveRun.topicTitle = topicOutcome.data.selected_topic.topic_title;
		}
		await handleStageSuccess("topic_selection", {
			topic_title: topicOutcome.data.selected_topic.topic_title,
			confidence: topicOutcome.data.selected_topic.confidence,
		});

		// Stage 3: Content Generation (extracts articles via Jina internally)
		if (!(await renewLockOrAbort("content_generation"))) {
			return {
				success: false,
				status: 409,
				stage: "concurrency_lock",
				error: "Pipeline lock lease lost or superseded before stage 'content_generation'",
			};
		}
		currentStageStartTime = Date.now();
		if (currentLiveRun) {
			currentLiveRun.currentStage = "content_generation";
			currentLiveRun.stages["content_generation"] = {
				stage: "content_generation",
				status: "running",
				startedAt: new Date(currentStageStartTime).toISOString(),
			};
		}
		logOperationalEvent({
			event: "pipeline_stage_started",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			stage: "content_generation",
			environment,
		});
		console.log(`[Pipeline] Stage 3: Generating content package for "${topicOutcome.data.selected_topic.topic_title}"...`);
		const contentOutcome = await generateContentForSelection(env, topicOutcome.data);
		if (!contentOutcome.success) {
			return await handleStageFailure(
				"content_generation",
				contentOutcome.status || 500,
				contentOutcome.error,
				contentOutcome.details
			);
		}

		const contentPackage = contentOutcome.data;
		if (contentPackage.generation_status === "insufficient_evidence") {
			return await handleStageFailure(
				"content_generation",
				422,
				"Cannot persist carousel: content generated with 'insufficient_evidence' status.",
				contentPackage.evidence?.limitations?.join("; ")
			);
		}

		if (contentPackage.generation_status !== "ready_for_review") {
			return await handleStageFailure(
				"content_generation",
				400,
				`Invalid generation_status: '${contentPackage.generation_status}'. Must be 'ready_for_review'.`
			);
		}
		await handleStageSuccess("content_generation", {
			slide_count: contentPackage.slides?.length,
		});

		// Stage 4: Carousel Rendering (Dual-format PNG & JPEG via Browser Run)
		if (!(await renewLockOrAbort("carousel_rendering"))) {
			return {
				success: false,
				status: 409,
				stage: "concurrency_lock",
				error: "Pipeline lock lease lost or superseded before stage 'carousel_rendering'",
			};
		}
		currentStageStartTime = Date.now();
		if (currentLiveRun) {
			currentLiveRun.currentStage = "carousel_rendering";
			currentLiveRun.stages["carousel_rendering"] = {
				stage: "carousel_rendering",
				status: "running",
				startedAt: new Date(currentStageStartTime).toISOString(),
			};
		}
		logOperationalEvent({
			event: "pipeline_stage_started",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			stage: "carousel_rendering",
			environment,
		});
		console.log("[Pipeline] Stage 4: Rendering carousel slides...");
		let renderedArtifact: RenderedCarouselArtifact;
		try {
			renderedArtifact = await renderCarouselArtifacts(contentPackage, env);
		} catch (err: any) {
			console.error("[Pipeline] Stage 4 rendering error:", err);
			return await handleStageFailure(
				"carousel_rendering",
				500,
				err.message || "Failed to render carousel artifacts"
			);
		}
		await handleStageSuccess("carousel_rendering", {
			rendered_slides: renderedArtifact.slides?.length,
		});

		// Stage 5: Carousel Persistence (Storage & PostgreSQL)
		if (!(await renewLockOrAbort("carousel_persistence"))) {
			return {
				success: false,
				status: 409,
				stage: "concurrency_lock",
				error: "Pipeline lock lease lost or superseded before stage 'carousel_persistence'",
			};
		}
		currentStageStartTime = Date.now();
		if (currentLiveRun) {
			currentLiveRun.currentStage = "carousel_persistence";
			currentLiveRun.stages["carousel_persistence"] = {
				stage: "carousel_persistence",
				status: "running",
				startedAt: new Date(currentStageStartTime).toISOString(),
			};
		}
		logOperationalEvent({
			event: "pipeline_stage_started",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			stage: "carousel_persistence",
			environment,
		});
		console.log("[Pipeline] Stage 5: Persisting carousel artifacts to Supabase...");
		let persistResult: PersistCarouselResult;
		try {
			persistResult = await persistRenderedCarousel(env, contentPackage, renderedArtifact);
		} catch (err: any) {
			console.error("[Pipeline] Stage 5 persistence error:", err);
			const isConflict = err.message?.includes("in progress");
			return await handleStageFailure(
				"carousel_persistence",
				isConflict ? 409 : 500,
				err.message || "Failed to persist carousel to database and storage"
			);
		}

		if (!persistResult.success || !persistResult.post_id) {
			return await handleStageFailure(
				"carousel_persistence",
				500,
				"Carousel persistence returned unsuccessful outcome without a post ID"
			);
		}
		if (currentLiveRun) {
			currentLiveRun.postId = persistResult.post_id;
		}
		await handleStageSuccess("carousel_persistence", {
			post_id: persistResult.post_id,
		});

		// Stage 6: Editorial Notification (Telegram album and inline review buttons)
		if (!(await renewLockOrAbort("editorial_notification"))) {
			return {
				success: false,
				status: 409,
				stage: "concurrency_lock",
				error: "Pipeline lock lease lost or superseded before stage 'editorial_notification'",
			};
		}
		currentStageStartTime = Date.now();
		if (currentLiveRun) {
			currentLiveRun.currentStage = "editorial_notification";
			currentLiveRun.stages["editorial_notification"] = {
				stage: "editorial_notification",
				status: "running",
				startedAt: new Date(currentStageStartTime).toISOString(),
			};
		}
		logOperationalEvent({
			event: "pipeline_stage_started",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			stage: "editorial_notification",
			environment,
		});
		console.log(`[Pipeline] Stage 6: Sending Telegram editorial notification for post ${persistResult.post_id}...`);
		let notificationResult: NotifyEditorResult;
		try {
			notificationResult = await notifyEditorForStoredPost(env, {
				postId: persistResult.post_id,
				dryRun: Boolean(options?.dryRun),
			});
		} catch (err: any) {
			console.error(`[Pipeline] Stage 6 notification error for post ${persistResult.post_id}:`, err);
			return await handleStageFailure(
				"editorial_notification",
				500,
				err.message || "Failed to deliver Telegram editorial notification",
				undefined,
				persistResult.post_id
			);
		}
		if (currentLiveRun) {
			currentLiveRun.approvalRequestId = notificationResult.approval_request_id;
			currentLiveRun.telegramNotificationSent = notificationResult.success;
			currentLiveRun.stages["instagram_publication"] = {
				stage: "instagram_publication",
				status: "waiting",
				metadata: {
					note: "Awaiting human review in Telegram before Instagram publication",
					approval_request_id: notificationResult.approval_request_id,
				},
			};
		}
		await handleStageSuccess("editorial_notification", {
			approval_request_id: notificationResult.approval_request_id,
		});

		// Pipeline Complete
		const totalDuration = Date.now() - pipelineStartTime;
		if (currentLiveRun) {
			currentLiveRun.overallStatus = "completed";
			lastFinishedRun = {
				...currentLiveRun,
				completedAt: new Date().toISOString(),
				elapsedMs: totalDuration,
			};
			recordRunToHistory(lastFinishedRun);
		}
		console.log(`[Pipeline] Pipeline completed successfully for post ${persistResult.post_id}!`);
		logOperationalEvent({
			event: "pipeline_run_completed",
			timestamp: new Date().toISOString(),
			run_id: runId,
			trigger_type: triggerType,
			status: "success",
			duration_ms: totalDuration,
			post_id: persistResult.post_id,
			environment,
		});
		recordPipelineSuccessMetric({
			runId,
			triggerType,
			cronExpression,
			status: "completed",
			durationMs: totalDuration,
			postId: persistResult.post_id,
		});
		await persistPipelineRunMetric(env, {
			run_id: runId,
			trigger_type: triggerType,
			cron_expression: cronExpression,
			status: "completed",
			started_at: new Date(pipelineStartTime).toISOString(),
			completed_at: new Date().toISOString(),
			duration_ms: totalDuration,
			post_id: persistResult.post_id,
		}).catch(() => {});

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
		currentLiveRun = null;
		try {
			await releaseDistributedPipelineLock(env, {
				lockName: DEFAULT_PIPELINE_LOCK_NAME,
				ownerToken,
				fencingToken: currentFencingToken,
			});
		} catch (err) {
			console.error("[Pipeline] Error releasing distributed lock:", err);
		} finally {
			releasePipelineLock();
		}
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

export const SCHEDULED_PIPELINE_OPTIONS: PipelineOptions = {
	days: 3,
	limit: 30,
};

/**
 * Autonomous Scheduled Execution Handler for 0 2 * * * (02:00 UTC / 07:30 AM IST).
 * Orchestrates the full daily content generation pipeline when enabled via AUTONOMOUS_PIPELINE_ENABLED="true".
 * Safeguards:
 * - Kill switch: skips cleanly if AUTONOMOUS_PIPELINE_ENABLED !== "true"
 * - Concurrency lock: skips cleanly if another pipeline run is in progress (409)
 * - Safe no-topic outcome: logs cleanly without throwing
 * - Failure handling: logs failure and rethrows for Cloudflare Workers cron error tracking
 * - Privacy: never leaks API keys, tokens, or unredacted secrets
 */
export async function handleScheduledPipelineRun(
	controller: ScheduledController,
	env: Env,
	customOptions?: PipelineOptions
): Promise<PipelineOutcome | { skipped: true; reason: string }> {
	const cronExpression = controller.cron || "0 2 * * *";
	const scheduledTime = controller.scheduledTime || Date.now();
	const startTime = Date.now();
	const runId = crypto.randomUUID();

	if (env.AUTONOMOUS_PIPELINE_ENABLED !== "true") {
		console.log(
			JSON.stringify({
				event: "scheduled_pipeline_skipped",
				cron_expression: cronExpression,
				scheduled_time: scheduledTime,
				enabled: false,
				reason: "AUTONOMOUS_PIPELINE_ENABLED is not set to 'true'",
			})
		);
		return { skipped: true, reason: "kill_switch_disabled" };
	}

	const effectiveOptions: PipelineOptions = {
		...(customOptions || SCHEDULED_PIPELINE_OPTIONS),
		runId,
		triggerType: "scheduled",
		cronExpression,
	};

	console.log(
		JSON.stringify({
			event: "scheduled_pipeline_started",
			run_id: runId,
			cron_expression: cronExpression,
			scheduled_time: scheduledTime,
			enabled: true,
			parameters: {
				days: effectiveOptions.days,
				limit: effectiveOptions.limit,
			},
		})
	);

	let outcome: PipelineOutcome;
	try {
		outcome = await executePipeline(env, effectiveOptions);
	} catch (err: any) {
		const elapsed = Date.now() - startTime;
		const errorMsg = err instanceof Error ? err.message : String(err);
		console.error(
			JSON.stringify({
				event: "scheduled_pipeline_failed",
				run_id: runId,
				cron_expression: cronExpression,
				scheduled_time: scheduledTime,
				status: "failed",
				error: errorMsg,
				duration_ms: elapsed,
			})
		);
		throw err;
	}

	const durationMs = Date.now() - startTime;

	if (outcome.success) {
		if (outcome.status === "no_strong_topic") {
			console.log(
				JSON.stringify({
					event: "scheduled_pipeline_completed",
					run_id: runId,
					cron_expression: cronExpression,
					scheduled_time: scheduledTime,
					status: "no_strong_topic",
					stage: "topic_selection",
					message: outcome.message,
					duration_ms: durationMs,
				})
			);
		} else {
			console.log(
				JSON.stringify({
					event: "scheduled_pipeline_completed",
					run_id: runId,
					cron_expression: cronExpression,
					scheduled_time: scheduledTime,
					status: "completed",
					post_id: outcome.post_id,
					post_status: outcome.post_status,
					topic_title: outcome.topic?.topic_title,
					carousel_slide_count: outcome.carousel_slide_count,
					telegram_approval_request_id: outcome.telegram_notification?.approval_request_id,
					duration_ms: durationMs,
				})
			);
		}
		return outcome;
	}

	// Concurrency conflict is treated as a safe skip
	if (outcome.status === 409 || outcome.stage === "concurrency_lock") {
		console.warn(
			JSON.stringify({
				event: "scheduled_pipeline_skipped",
				run_id: runId,
				cron_expression: cronExpression,
				scheduled_time: scheduledTime,
				status: "concurrency_conflict",
				stage: "concurrency_lock",
				message: outcome.error,
				duration_ms: durationMs,
			})
		);
		return outcome;
	}

	// Execution failure
	console.error(
		JSON.stringify({
			event: "scheduled_pipeline_failed",
			run_id: runId,
			cron_expression: cronExpression,
			scheduled_time: scheduledTime,
			status: "failed",
			stage: outcome.stage,
			error: outcome.error,
			details: outcome.details,
			post_id: outcome.post_id,
			duration_ms: durationMs,
		})
	);
	throw new Error(`Scheduled pipeline failed at stage '${outcome.stage}': ${outcome.error}`);
}
