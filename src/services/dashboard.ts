import type { Env } from "../index";
import {
	getActiveRunProgress,
	getLastRunProgress,
	getRecentRunsList,
	executePipeline,
	isPipelineLocked,
	type ActiveRunInfo,
	DEFAULT_PIPELINE_LOCK_NAME,
} from "./pipeline-orchestrator";
import { executeNewsIngestion } from "./news-ingestion";
import { getSupabaseClient, checkSupabaseHealth } from "./supabase";
import { resolveGroqModel, DEFAULT_GROQ_MODEL } from "./groq";
import { publishApprovedCarousel } from "./instagram-publishing";
import { editMessageReplyMarkup, normalizeBotToken } from "./telegram-bot";

export interface DashboardSchedule {
	name: string;
	cron: string;
	utcTime: string;
	istTime: string;
	purpose: string;
}

export interface DashboardPublicationInfo {
	postId?: string;
	status:
		| "awaiting_editorial_approval"
		| "queued_for_publishing"
		| "publishing_in_progress"
		| "published"
		| "publication_failed"
		| "not_reached";
	instagramMediaId?: string;
	instagramPermalink?: string;
	publishedAt?: string;
	errorMessage?: string;
}

export interface DashboardState {
	activeRun: ActiveRunInfo | null;
	lastRun: ActiveRunInfo | null;
	publication: DashboardPublicationInfo;
	distributedLock: {
		locked: boolean;
		available: boolean;
		ownerRunId?: string;
		leaseExpiresAt?: string;
		error?: string;
	};
	groq: {
		status: "ready" | "blocked";
		model: string;
		available: boolean;
		error?: string;
	};
	supabase: {
		status: "connected" | "degraded";
		error?: string;
		migrationsApplied: boolean;
	};
	quarantineQueue: {
		available: boolean;
		backlogCount: number;
		oldestMessageAgeSeconds?: number;
		note?: string;
	};
	schedules: DashboardSchedule[];
	operatorScheduleNote: string;
	recentRuns: any[];
	timestamp: string;
}

export const REGISTERED_SCHEDULES: DashboardSchedule[] = [
	{
		name: "News Sync",
		cron: "30 0 * * *",
		utcTime: "00:30 UTC",
		istTime: "06:00 AM IST",
		purpose: "Scheduled ingestion of legal news articles into Supabase",
	},
	{
		name: "Autonomous Content Pipeline",
		cron: "0 2 * * *",
		utcTime: "02:00 UTC",
		istTime: "07:30 AM IST",
		purpose: "Autonomous daily end-to-end content generation & Telegram editorial notification",
	},
	{
		name: "Publishing Recovery & Quarantine Monitor",
		cron: "*/15 * * * *",
		utcTime: "Every 15 min",
		istTime: "Every 15 min",
		purpose: "Stranded publishing sweep and secondary quarantine backlog monitoring",
	},
];

export const OPERATOR_SCHEDULE_DISCREPANCY_NOTE =
	"Operator Schedule Notice: The operator mentioned 10:30 AM, but wrangler.jsonc registers 07:30 AM IST (02:00 UTC). Existing registered triggers are preserved without silent changes.";

export const DASHBOARD_STAGE_KEYS = [
	"news_ingestion",
	"topic_selection",
	"content_generation",
	"carousel_rendering",
	"carousel_persistence",
	"editorial_notification",
	"instagram_publication",
] as const;

export async function getDashboardState(env: Env): Promise<DashboardState> {
	const activeRun = getActiveRunProgress();
	const lastRun = getLastRunProgress();

	// 1. Supabase connectivity & migrations status
	let supabaseStatus: "connected" | "degraded" = "degraded";
	let supabaseError: string | undefined;
	let migrationsApplied = false;

	try {
		const client = getSupabaseClient(env);
		const healthRes = await checkSupabaseHealth(env);
		if (healthRes.status === 200) {
			supabaseStatus = "connected";
		} else {
			const body = (await healthRes.json().catch(() => ({}))) as any;
			supabaseError = body.error || "Supabase health check returned non-200";
		}

		// Probe if Task 20/21 migrations are applied in database
		const { error: probeError } = await client
			.from("pipeline_runs")
			.select("run_id")
			.limit(1);

		if (!probeError) {
			migrationsApplied = true;
		}
	} catch (err: any) {
		supabaseStatus = "degraded";
		supabaseError = err.message || "Failed to connect to Supabase";
	}

	// 2. Distributed lock status
	let lockState: {
		locked: boolean;
		available: boolean;
		ownerRunId?: string;
		leaseExpiresAt?: string;
		error?: string;
	} = {
		locked: isPipelineLocked(),
		available: true,
	};

	try {
		const client = getSupabaseClient(env);
		const { data: lockRow, error: lockErr } = await client
			.from("pipeline_run_locks")
			.select("lock_name, owner_run_id, lease_expires_at, fencing_token")
			.eq("lock_name", DEFAULT_PIPELINE_LOCK_NAME)
			.maybeSingle();

		if (lockErr) {
			lockState = {
				locked: false,
				available: false,
				error: "Distributed lock table 'pipeline_run_locks' not found in database. Migrations pending.",
			};
		} else if (lockRow && new Date(lockRow.lease_expires_at).getTime() > Date.now()) {
			lockState = {
				locked: true,
				available: true,
				ownerRunId: lockRow.owner_run_id,
				leaseExpiresAt: lockRow.lease_expires_at,
			};
		} else {
			lockState = {
				locked: false,
				available: true,
			};
		}
	} catch (err: any) {
		lockState = {
			locked: false,
			available: false,
			error: err?.message || "Failed to query distributed lock",
		};
	}

	// 2b. Groq model readiness
	let groqStatus: {
		status: "ready" | "blocked";
		model: string;
		available: boolean;
		error?: string;
	} = {
		status: "ready",
		model: DEFAULT_GROQ_MODEL,
		available: true,
	};

	if (!env.GROQ_API_KEY || !env.GROQ_API_KEY.trim()) {
		groqStatus = {
			status: "blocked",
			model: "none",
			available: false,
			error: "Missing GROQ_API_KEY configuration",
		};
	} else {
		const modelRes = resolveGroqModel(env);
		if (!modelRes.success) {
			groqStatus = {
				status: "blocked",
				model: env.GROQ_MODEL || "unknown",
				available: false,
				error: modelRes.error,
			};
		} else {
			groqStatus = {
				status: "ready",
				model: modelRes.model,
				available: true,
			};
		}
	}

	// 3. Quarantine Queue status & metrics
	let quarantineQueue: {
		available: boolean;
		backlogCount: number;
		oldestMessageAgeSeconds?: number;
		note?: string;
	} = {
		available: false,
		backlogCount: 0,
		note: "Quarantine queue metrics unavailable in local development environment",
	};

	if (
		env.INSTAGRAM_QUARANTINE_QUEUE &&
		typeof (env.INSTAGRAM_QUARANTINE_QUEUE as any).metrics === "function"
	) {
		try {
			const qm = await (env.INSTAGRAM_QUARANTINE_QUEUE as any).metrics();
			quarantineQueue = {
				available: true,
				backlogCount: qm.messages || 0,
				oldestMessageAgeSeconds: qm.oldestMessageTimestamp
					? Math.max(0, Math.floor((Date.now() - qm.oldestMessageTimestamp) / 1000))
					: 0,
			};
		} catch (err: any) {
			quarantineQueue.note = `Metrics query failed: ${err.message || "unknown"}`;
		}
	}

	// 4. Recent runs history (Supabase with fallback to in-memory buffer)
	let recentRuns: any[] = [];
	try {
		const client = getSupabaseClient(env);
		const { data, error } = await client
			.from("pipeline_runs")
			.select(
				"run_id, trigger_type, cron_expression, status, started_at, completed_at, duration_ms, failed_stage, error_code, error_message, post_id"
			)
			.order("started_at", { ascending: false })
			.limit(10);

		if (!error && Array.isArray(data) && data.length > 0) {
			recentRuns = data;
		} else {
			recentRuns = getRecentRunsList();
		}
	} catch {
		recentRuns = getRecentRunsList();
	}

	// Hydrate lastRun from recentRuns if in-memory isolate reloaded
	let effectiveLastRun = lastRun;
	if (!effectiveLastRun && !activeRun && recentRuns && recentRuns.length > 0) {
		const latestDbRun = recentRuns[0];
		const runId = latestDbRun.run_id || latestDbRun.runId;
		if (runId) {
			try {
				const client = getSupabaseClient(env);
				const { data: stageEvents } = await client
					.from("pipeline_stage_events")
					.select("*")
					.eq("run_id", runId)
					.order("created_at", { ascending: true });

				const stages: Record<string, any> = {};
				if (Array.isArray(stageEvents)) {
					for (const ev of stageEvents) {
						if (ev.stage) {
							stages[ev.stage] = {
								stage: ev.stage,
								status: ev.status === "success" ? "completed" : ev.status,
								startedAt: ev.created_at,
								completedAt: ev.created_at,
								durationMs: ev.duration_ms,
								error: ev.error_message,
								metadata: ev.metadata,
							};
						}
					}
				}

				if (Object.keys(stages).length === 0 && latestDbRun.status === "completed") {
					for (const s of [
						"concurrency_lock",
						"news_ingestion",
						"topic_selection",
						"content_generation",
						"carousel_rendering",
						"carousel_persistence",
						"editorial_notification",
					]) {
						stages[s] = { stage: s, status: "completed" };
					}
				}

				effectiveLastRun = {
					runId: runId,
					triggerType: latestDbRun.trigger_type || "manual",
					overallStatus: latestDbRun.status || "completed",
					startedAt: latestDbRun.started_at,
					completedAt: latestDbRun.completed_at,
					elapsedMs: latestDbRun.duration_ms || 0,
					currentStage: latestDbRun.failed_stage || "instagram_publication",
					postId: latestDbRun.post_id || latestDbRun.postId,
					stages,
				};
			} catch {
				// fallback
			}
		}
	}

	// 5. Post-Telegram Instagram Publishing Status Check (Final Pipeline Stage)
	const publicationInfo: DashboardPublicationInfo = {
		status: "not_reached",
	};

	// Strict Run Isolation: If an active run is in progress, ONLY check publication for activeRun's postId.
	// Never fall back to previous runs or database history while a new run is executing!
	const candidatePostId = activeRun
		? activeRun.postId
		: effectiveLastRun?.postId ||
		  (recentRuns && recentRuns.length > 0 ? (recentRuns[0].post_id || recentRuns[0].postId) : undefined);

	if (candidatePostId) {
		publicationInfo.postId = candidatePostId;
		try {
			const client = getSupabaseClient(env);
			const { data: pubRow } = await client
				.from("social_content_publications")
				.select(
					"id, publication_status, instagram_media_id, instagram_permalink, error_code, error_message, updated_at"
				)
				.eq("post_id", candidatePostId)
				.eq("platform", "instagram")
				.maybeSingle();

			if (pubRow) {
				if (pubRow.publication_status === "published") {
					publicationInfo.status = "published";
					publicationInfo.instagramMediaId = pubRow.instagram_media_id;
					publicationInfo.instagramPermalink = pubRow.instagram_permalink;
					publicationInfo.publishedAt = pubRow.updated_at;
				} else if (pubRow.publication_status === "failed") {
					publicationInfo.status = "publication_failed";
					publicationInfo.errorMessage =
						pubRow.error_message || pubRow.error_code || "Publication failed on Instagram";
				} else if (
					pubRow.publication_status === "processing" ||
					pubRow.publication_status === "in_progress"
				) {
					publicationInfo.status = "publishing_in_progress";
				} else if (pubRow.publication_status === "pending") {
					publicationInfo.status = "queued_for_publishing";
				}
			} else {
				publicationInfo.status = "awaiting_editorial_approval";
			}
		} catch {
			publicationInfo.status = "awaiting_editorial_approval";
		}
	}

	// Synchronize Stage 7 in targetRun (activeRun or effectiveLastRun)
	const targetRun = activeRun || effectiveLastRun;
	if (targetRun) {
		const targetPostId = targetRun.postId;
		if (targetPostId && publicationInfo.postId === targetPostId) {
			if (publicationInfo.status === "published") {
				targetRun.stages["instagram_publication"] = {
					stage: "instagram_publication",
					status: "completed",
					metadata: {
						media_id: publicationInfo.instagramMediaId,
						permalink: publicationInfo.instagramPermalink,
						published_at: publicationInfo.publishedAt,
					},
				};
			} else if (publicationInfo.status === "publication_failed") {
				targetRun.stages["instagram_publication"] = {
					stage: "instagram_publication",
					status: "failed",
					error: publicationInfo.errorMessage,
				};
			} else if (
				publicationInfo.status === "queued_for_publishing" ||
				publicationInfo.status === "publishing_in_progress"
			) {
				targetRun.stages["instagram_publication"] = {
					stage: "instagram_publication",
					status: "running",
					metadata: { status: publicationInfo.status },
				};
			} else if (publicationInfo.status === "awaiting_editorial_approval") {
				targetRun.stages["instagram_publication"] = {
					stage: "instagram_publication",
					status: "waiting",
					metadata: { note: "Awaiting human editorial approval in Telegram" },
				};
			}
		} else {
			// If targetRun has not produced a postId or published yet, Stage 7 is strictly WAITING
			targetRun.stages["instagram_publication"] = {
				stage: "instagram_publication",
				status: "waiting",
			};
		}
	}

	return {
		activeRun,
		lastRun: effectiveLastRun,
		publication: publicationInfo,
		distributedLock: lockState,
		groq: groqStatus,
		supabase: {
			status: supabaseStatus,
			error: supabaseError,
			migrationsApplied,
		},
		quarantineQueue,
		schedules: REGISTERED_SCHEDULES,
		operatorScheduleNote: OPERATOR_SCHEDULE_DISCREPANCY_NOTE,
		recentRuns,
		timestamp: new Date().toISOString(),
	};
}

export function renderDashboardHtml(): string {
	return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>LawBriefly Operator Dashboard</title>
	<style>
		:root {
			--bg: #09090b;
			--surface: #09090b;
			--card: #09090b;
			--border: #27272a;
			--border-muted: #18181b;
			--text-primary: #fafafa;
			--text-secondary: #a1a1aa;
			--text-muted: #71717a;
			--btn-primary-bg: #fafafa;
			--btn-primary-text: #09090b;
			--btn-primary-hover: #e4e4e7;
			--btn-secondary-bg: #18181b;
			--btn-secondary-text: #fafafa;
			--btn-secondary-border: #27272a;
			--btn-secondary-hover: #27272a;
			--green: #22c55e;
			--green-dim: rgba(34, 197, 94, 0.15);
			--green-border: rgba(34, 197, 94, 0.4);
			--red: #ef4444;
			--red-dim: rgba(239, 68, 68, 0.15);
			--red-border: rgba(239, 68, 68, 0.5);
			--amber: #f59e0b;
			--amber-dim: rgba(245, 158, 11, 0.15);
			--radius: 6px;
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			background-color: var(--bg);
			color: var(--text-primary);
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
			line-height: 1.45;
			padding: 24px;
			min-height: 100vh;
		}
		.container {
			max-width: 1280px;
			margin: 0 auto;
		}

		/* Header - shadcn inspired */
		header {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			padding-bottom: 20px;
			margin-bottom: 24px;
			border-bottom: 1px solid var(--border);
			gap: 16px;
		}
		.brand-group {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.brand-icon {
			width: 32px;
			height: 32px;
			background: #fafafa;
			color: #09090b;
			border-radius: var(--radius);
			display: flex;
			align-items: center;
			justify-content: center;
			font-weight: 800;
			font-size: 14px;
		}
		.brand-title {
			font-size: 18px;
			font-weight: 700;
			letter-spacing: -0.02em;
			color: #fafafa;
		}
		.brand-subtitle {
			font-size: 12px;
			color: var(--text-muted);
		}
		.header-meta {
			display: flex;
			align-items: center;
			gap: 10px;
			font-size: 12px;
		}
		.badge {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 3px 8px;
			border-radius: 9999px;
			font-size: 11px;
			font-weight: 600;
			border: 1px solid var(--border);
			background: var(--surface);
			color: var(--text-secondary);
		}
		.badge-dev {
			border-color: #3f3f46;
			color: #fafafa;
			background: #18181b;
		}
		.badge-pulse {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background-color: var(--green);
			box-shadow: 0 0 6px var(--green);
		}
		.badge-pulse.running {
			background-color: var(--green);
			box-shadow: 0 0 8px var(--green);
			animation: pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
		}
		@keyframes pulse-ring {
			0%, 100% { transform: scale(1); opacity: 1; }
			50% { transform: scale(1.4); opacity: 0.5; }
		}

		/* Actions - shadcn button style */
		.action-bar {
			display: flex;
			flex-wrap: wrap;
			gap: 10px;
			margin-bottom: 24px;
			align-items: center;
		}
		.btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 6px;
			padding: 8px 14px;
			border-radius: var(--radius);
			font-size: 13px;
			font-weight: 500;
			cursor: pointer;
			transition: all 0.15s ease-in-out;
			border: 1px solid transparent;
		}
		.btn:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		.btn-primary {
			background-color: var(--btn-primary-bg);
			color: var(--btn-primary-text);
		}
		.btn-primary:hover:not(:disabled) {
			background-color: var(--btn-primary-hover);
		}
		.btn-secondary {
			background-color: var(--btn-secondary-bg);
			color: var(--btn-secondary-text);
			border-color: var(--btn-secondary-border);
		}
		.btn-secondary:hover:not(:disabled) {
			background-color: var(--btn-secondary-hover);
			border-color: #3f3f46;
		}

		/* shadcn Cards */
		.card {
			background-color: var(--card);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 20px;
			margin-bottom: 24px;
		}
		.card-header {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			margin-bottom: 16px;
		}
		.card-title {
			font-size: 15px;
			font-weight: 600;
			letter-spacing: -0.01em;
			color: #fafafa;
		}

		/* Animated Green Progress Line Connector */
		.pipeline-track-container {
			position: relative;
			margin: 20px 0 10px 0;
		}
		.pipeline-progress-bar {
			position: absolute;
			top: 24px;
			left: 30px;
			right: 30px;
			height: 2px;
			background: var(--border);
			z-index: 1;
		}
		.pipeline-progress-fill {
			height: 100%;
			background: var(--green);
			box-shadow: 0 0 10px rgba(34, 197, 94, 0.8), 0 0 20px rgba(34, 197, 94, 0.4);
			transition: width 0.4s ease-in-out;
			width: 0%;
			position: relative;
		}
		.pipeline-progress-fill.active::after {
			content: "";
			position: absolute;
			right: -4px;
			top: -3px;
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--green);
			box-shadow: 0 0 10px var(--green);
			animation: beam-pulse 1s infinite alternate;
		}
		@keyframes beam-pulse {
			0% { transform: scale(1); opacity: 0.8; }
			100% { transform: scale(1.6); opacity: 1; }
		}

		/* 7 Stages Grid */
		.stages-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
			gap: 12px;
			position: relative;
			z-index: 2;
		}
		.stage-card {
			background-color: #09090b;
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 14px;
			display: flex;
			flex-direction: column;
			gap: 8px;
			transition: border-color 0.2s, box-shadow 0.2s;
			position: relative;
		}
		.stage-card.running {
			border-color: var(--green);
			box-shadow: 0 0 14px rgba(34, 197, 94, 0.2);
		}
		.stage-card.completed {
			border-color: var(--green-border);
		}
		.stage-card.failed {
			border-color: var(--red);
			background-color: #110505;
		}
		.stage-card.skipped {
			opacity: 0.45;
		}
		.stage-num-badge {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 22px;
			height: 22px;
			border-radius: 50%;
			font-size: 11px;
			font-weight: 700;
			background: #18181b;
			border: 1px solid var(--border);
			color: var(--text-muted);
			margin-bottom: 2px;
		}
		.stage-card.completed .stage-num-badge {
			background: var(--green);
			border-color: var(--green);
			color: #09090b;
		}
		.stage-card.running .stage-num-badge {
			background: #09090b;
			border-color: var(--green);
			color: var(--green);
			box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
		}
		.stage-card.failed .stage-num-badge {
			background: var(--red);
			border-color: var(--red);
			color: #fafafa;
		}
		.stage-name {
			font-size: 12px;
			font-weight: 600;
			color: var(--text-primary);
		}
		.stage-status-pill {
			display: inline-block;
			font-size: 10px;
			font-weight: 600;
			padding: 2px 6px;
			border-radius: 4px;
			text-transform: uppercase;
			width: fit-content;
			letter-spacing: 0.03em;
		}
		.status-waiting { background: #18181b; border: 1px solid var(--border); color: var(--text-muted); }
		.status-running { background: var(--green-dim); border: 1px solid var(--green); color: var(--green); }
		.status-completed { background: #18181b; border: 1px solid var(--green-border); color: var(--green); }
		.status-failed { background: var(--red-dim); border: 1px solid var(--red); color: var(--red); }
		.status-skipped { background: #18181b; color: var(--text-muted); border: 1px solid var(--border); }
		.stage-meta {
			font-size: 11px;
			color: var(--text-muted);
			font-family: monospace;
		}

		/* In-Place Stage Error Diagnostics */
		.stage-error-box {
			display: none;
			margin-top: 6px;
			padding: 8px;
			background: var(--red-dim);
			border: 1px solid var(--red);
			border-radius: 4px;
			font-size: 11px;
			color: #fca5a5;
		}
		.stage-error-box.visible {
			display: block;
		}
		.stage-error-title {
			font-weight: 700;
			margin-bottom: 2px;
			display: flex;
			align-items: center;
			gap: 4px;
		}
		.stage-error-msg {
			word-break: break-word;
			line-height: 1.35;
			color: #fecaca;
		}
		.stage-error-action {
			margin-top: 4px;
			font-size: 10px;
			color: #fafafa;
			opacity: 0.85;
			border-top: 1px dashed rgba(239, 68, 68, 0.4);
			padding-top: 3px;
		}

		/* Instagram Final Destination Banner */
		.destination-banner {
			display: none;
			background: #121215;
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 16px;
			margin-bottom: 24px;
		}
		.destination-banner.visible {
			display: block;
		}
		.destination-banner.published {
			border-color: var(--green);
			box-shadow: 0 0 15px rgba(34, 197, 94, 0.1);
		}
		.dest-header {
			font-size: 14px;
			font-weight: 600;
			display: flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 6px;
		}
		.dest-header.published { color: var(--green); }
		.dest-header.awaiting { color: var(--text-primary); }

		/* Monochrome Info Grid */
		.grid-4 {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
			gap: 12px;
			margin-bottom: 24px;
		}
		.info-item {
			background: var(--card);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 14px;
		}
		.info-label {
			font-size: 11px;
			font-weight: 600;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			margin-bottom: 4px;
		}
		.info-value {
			font-size: 13px;
			font-weight: 600;
			color: #fafafa;
			word-break: break-all;
		}

		/* History Table */
		.table-wrapper {
			overflow-x: auto;
		}
		.history-table {
			width: 100%;
			border-collapse: collapse;
			font-size: 12px;
			text-align: left;
		}
		.history-table th {
			background-color: #121215;
			padding: 10px 12px;
			color: var(--text-muted);
			font-weight: 600;
			border-bottom: 1px solid var(--border);
		}
		.history-table td {
			padding: 10px 12px;
			border-bottom: 1px solid var(--border);
			color: var(--text-primary);
		}
		.history-table tr:hover {
			background-color: #18181b;
		}

		/* Modal Dialog - shadcn style */
		.modal-backdrop {
			display: none;
			position: fixed;
			top: 0; left: 0; right: 0; bottom: 0;
			background-color: rgba(0, 0, 0, 0.85);
			backdrop-filter: blur(4px);
			z-index: 999;
			align-items: center;
			justify-content: center;
			padding: 16px;
		}
		.modal-backdrop.open {
			display: flex;
		}
		.modal-box {
			background-color: #09090b;
			border: 1px solid var(--border);
			border-radius: var(--radius);
			max-width: 500px;
			width: 100%;
			padding: 24px;
			box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
		}
		.modal-title {
			font-size: 16px;
			font-weight: 600;
			color: #fafafa;
			margin-bottom: 8px;
		}
		.modal-desc {
			font-size: 13px;
			color: var(--text-secondary);
			line-height: 1.5;
			margin-bottom: 18px;
		}
		.modal-actions {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}
		.alert-callout {
			background: #18181b;
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 10px 12px;
			font-size: 12px;
			color: var(--text-secondary);
			margin-top: 12px;
		}
	</style>
</head>
<body>
	<div class="container">
		<header>
			<div class="brand-group">
				<div class="brand-icon">LB</div>
				<div>
					<div class="brand-title">LawBriefly Operator Dashboard</div>
					<div class="brand-subtitle">End-to-End Pipeline State &amp; Automated Publishing Monitor</div>
				</div>
			</div>
			<div class="header-meta">
				<span class="badge badge-dev">DEVELOPMENT MODE</span>
				<span class="badge">
					<span id="live-pulse" class="badge-pulse"></span>
					<span id="live-status-text">Connected</span>
				</span>
				<span id="server-time" class="badge" style="font-family: monospace;">--:--:-- UTC</span>
			</div>
		</header>

		<!-- Primary Action Controls -->
		<div class="action-bar">
			<button id="btn-run-pipeline" class="btn btn-primary" onclick="openPipelineModal()">
				<span>⚡</span> RUN FULL PIPELINE NOW
			</button>
			<button id="btn-news-sync" class="btn btn-secondary" onclick="openNewsSyncModal()">
				<span>📰</span> SYNC NEWS ONLY
			</button>
			<button id="btn-refresh" class="btn btn-secondary" onclick="fetchState(true)">
				<span>🔄</span> Refresh State
			</button>
			<button id="btn-reset-view" class="btn btn-secondary" onclick="resetPipelineView()">
				<span>✨</span> Clear Slate / Start Fresh
			</button>
			<span id="action-feedback" style="font-size: 12px; color: var(--text-muted); margin-left: 6px;"></span>
		</div>

		<!-- Final Destination: Instagram Publication & Telegram Card -->
		<div id="destination-banner" class="destination-banner">
			<div id="dest-header" class="dest-header">
				<span id="dest-icon">📬</span>
				<span id="dest-title">Post-Telegram Status Check</span>
			</div>
			<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
				<span id="dest-body">Awaiting human review in Telegram before Instagram publication.</span>
				<div style="margin-top: 6px; font-family: monospace; font-size: 11px;">
					Post ID: <span id="dest-post-id" style="color: #fafafa;">--</span>
					&bull; Media ID: <span id="dest-media-id" style="color: var(--green);">--</span>
					<span id="dest-link-container" style="margin-left: 8px;"></span>
				</div>
			</div>
		</div>

		<!-- Live Pipeline Stepper with Green Connecting Beam -->
		<div class="card">
			<div class="card-header">
				<div>
					<h2 class="card-title" id="run-status-heading">Pipeline Status: IDLE</h2>
					<p id="run-meta-sub" style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">No active run in progress.</p>
				</div>
				<div id="run-overall-badge" class="stage-status-pill status-waiting">IDLE</div>
			</div>

			<!-- Dynamic Green Progress Track -->
			<div class="pipeline-track-container">
				<div class="pipeline-progress-bar">
					<div id="pipeline-progress-fill" class="pipeline-progress-fill"></div>
				</div>

				<!-- 7 Stage Blocks -->
				<div class="stages-grid">
					<!-- Stage 1 -->
					<div class="stage-card" id="card-news_ingestion">
						<div class="stage-num-badge" id="num-news_ingestion">1</div>
						<div class="stage-name">News Ingestion</div>
						<span class="stage-status-pill status-waiting" id="badge-news_ingestion">Waiting</span>
						<span class="stage-meta" id="dur-news_ingestion">--</span>
						<div class="stage-error-box" id="err-news_ingestion">
							<div class="stage-error-title">⚠️ Stage 1 Failed</div>
							<div class="stage-error-msg" id="errmsg-news_ingestion"></div>
							<div class="stage-error-action">Action: Verify LawBriefly API availability &amp; credentials.</div>
						</div>
					</div>

					<!-- Stage 2 -->
					<div class="stage-card" id="card-topic_selection">
						<div class="stage-num-badge" id="num-topic_selection">2</div>
						<div class="stage-name">Topic Selection</div>
						<span class="stage-status-pill status-waiting" id="badge-topic_selection">Waiting</span>
						<span class="stage-meta" id="dur-topic_selection">--</span>
						<div class="stage-error-box" id="err-topic_selection">
							<div class="stage-error-title">⚠️ Stage 2 Failed</div>
							<div class="stage-error-msg" id="errmsg-topic_selection"></div>
							<div class="stage-error-action">Action: Check OpenRouter / Mercury API quotas or thresholds.</div>
						</div>
					</div>

					<!-- Stage 3 -->
					<div class="stage-card" id="card-content_generation">
						<div class="stage-num-badge" id="num-content_generation">3</div>
						<div class="stage-name">Content Generation</div>
						<span class="stage-status-pill status-waiting" id="badge-content_generation">Waiting</span>
						<span class="stage-meta" id="dur-content_generation">--</span>
						<div class="stage-error-box" id="err-content_generation">
							<div class="stage-error-title">⚠️ Stage 3 Failed</div>
							<div class="stage-error-msg" id="errmsg-content_generation"></div>
							<div class="stage-error-action">Action: Inspect Groq API rate limits or Jina article extraction.</div>
						</div>
					</div>

					<!-- Stage 4 -->
					<div class="stage-card" id="card-carousel_rendering">
						<div class="stage-num-badge" id="num-carousel_rendering">4</div>
						<div class="stage-name">Visual Rendering</div>
						<span class="stage-status-pill status-waiting" id="badge-carousel_rendering">Waiting</span>
						<span class="stage-meta" id="dur-carousel_rendering">--</span>
						<div class="stage-error-box" id="err-carousel_rendering">
							<div class="stage-error-title">⚠️ Stage 4 Failed</div>
							<div class="stage-error-msg" id="errmsg-carousel_rendering"></div>
							<div class="stage-error-action">Action: Check Cloudflare Browser Rendering binding (MYBROWSER).</div>
						</div>
					</div>

					<!-- Stage 5 -->
					<div class="stage-card" id="card-carousel_persistence">
						<div class="stage-num-badge" id="num-carousel_persistence">5</div>
						<div class="stage-name">Storage &amp; DB</div>
						<span class="stage-status-pill status-waiting" id="badge-carousel_persistence">Waiting</span>
						<span class="stage-meta" id="dur-carousel_persistence">--</span>
						<div class="stage-error-box" id="err-carousel_persistence">
							<div class="stage-error-title">⚠️ Stage 5 Failed</div>
							<div class="stage-error-msg" id="errmsg-carousel_persistence"></div>
							<div class="stage-error-action">Action: Verify Supabase Storage bucket &amp; service_role RLS permissions.</div>
						</div>
					</div>

					<!-- Stage 6 -->
					<div class="stage-card" id="card-editorial_notification">
						<div class="stage-num-badge" id="num-editorial_notification">6</div>
						<div class="stage-name">Telegram Review</div>
						<span class="stage-status-pill status-waiting" id="badge-editorial_notification">Waiting</span>
						<span class="stage-meta" id="dur-editorial_notification">--</span>
						<div class="stage-error-box" id="err-editorial_notification">
							<div class="stage-error-title">⚠️ Stage 6 Failed</div>
							<div class="stage-error-msg" id="errmsg-editorial_notification"></div>
							<div class="stage-error-action">Action: Inspect TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.</div>
						</div>
					</div>

					<!-- Stage 7 (Final Destination) -->
					<div class="stage-card" id="card-instagram_publication">
						<div class="stage-num-badge" id="num-instagram_publication">7</div>
						<div class="stage-name">Instagram Published</div>
						<span class="stage-status-pill status-waiting" id="badge-instagram_publication">Waiting</span>
						<span class="stage-meta" id="dur-instagram_publication">--</span>
						<div class="stage-error-box" id="err-instagram_publication">
							<div class="stage-error-title">⚠️ Stage 7 Failed</div>
							<div class="stage-error-msg" id="errmsg-instagram_publication"></div>
							<div class="stage-error-action">Action: Check Meta access token or DLQ recovery script.</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Operational Health & Infrastructure -->
		<div class="grid-4">
			<div class="info-item">
				<div class="info-label">Supabase Database</div>
				<div class="info-value" id="health-supabase">Checking...</div>
				<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;" id="health-migrations">Migrations: Checking...</div>
			</div>
			<div class="info-item">
				<div class="info-label">Distributed Lock</div>
				<div class="info-value" id="health-lock">Unlocked / Idle</div>
				<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;" id="health-lock-detail">180s Lease &bull; Fencing Active</div>
			</div>
			<div class="info-item">
				<div class="info-label">Quarantine Queue</div>
				<div class="info-value" id="health-quarantine">0 messages</div>
				<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;" id="health-quarantine-note">Secondary DLQ protection</div>
			</div>
			<div class="info-item">
				<div class="info-label">Groq AI Engine</div>
				<div class="info-value" id="health-groq">Checking...</div>
				<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;" id="health-groq-detail">Structured Outputs: Checking...</div>
			</div>
			<div class="info-item">
				<div class="info-label">Daily Autonomous Cron</div>
				<div class="info-value" style="color: #fafafa;">07:30 AM IST (02:00 UTC)</div>
				<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Registered: <code>0 2 * * *</code></div>
			</div>
		</div>

		<!-- Registered Schedules Inspection -->
		<div class="card">
			<div class="card-header">
				<h2 class="card-title">Registered Cloudflare Worker Schedules</h2>
				<span class="badge">wrangler.jsonc</span>
			</div>
			<div class="table-wrapper">
				<table class="history-table">
					<thead>
						<tr>
							<th>Schedule Name</th>
							<th>Cron Expression</th>
							<th>UTC Time</th>
							<th>IST Time</th>
							<th>Purpose</th>
						</tr>
					</thead>
					<tbody id="schedules-table-body">
						<tr>
							<td>News Sync</td>
							<td><code>30 0 * * *</code></td>
							<td>00:30 UTC</td>
							<td>06:00 AM IST</td>
							<td>Scheduled news ingestion into Supabase</td>
						</tr>
						<tr>
							<td>Autonomous Content Pipeline</td>
							<td><code>0 2 * * *</code></td>
							<td>02:00 UTC</td>
							<td>07:30 AM IST</td>
							<td>Daily content generation &amp; Telegram editorial notification</td>
						</tr>
						<tr>
							<td>Publishing Recovery &amp; Quarantine</td>
							<td><code>*/15 * * * *</code></td>
							<td>Every 15 min</td>
							<td>Every 15 min</td>
							<td>Stranded post sweep &amp; secondary DLQ quarantine monitoring</td>
						</tr>
					</tbody>
				</table>
			</div>
			<div class="alert-callout" id="schedule-discrepancy-note">
				<strong>Notice:</strong> The operator mentioned 10:30 AM, but wrangler.jsonc registers 07:30 AM IST (02:00 UTC). Existing registered triggers are preserved without silent alterations.
			</div>
		</div>

		<!-- Recent Pipeline Runs -->
		<div class="card">
			<div class="card-header">
				<h2 class="card-title">Recent Pipeline Runs</h2>
				<span style="font-size: 12px; color: var(--text-muted);">Historical executions</span>
			</div>
			<div class="table-wrapper">
				<table class="history-table">
					<thead>
						<tr>
							<th>Started At (IST)</th>
							<th>Run ID</th>
							<th>Trigger</th>
							<th>Status</th>
							<th>Duration</th>
							<th>Topic / Details</th>
						</tr>
					</thead>
					<tbody id="recent-runs-tbody">
						<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading recent runs...</td></tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- Modal: Run Full Pipeline -->
	<div id="modal-pipeline" class="modal-backdrop">
		<div class="modal-box">
			<h3 class="modal-title">Execute Full Autonomous Content Pipeline?</h3>
			<p class="modal-desc">
				This executes the complete end-to-end pipeline:
				<br><br>
				1. Ingest news articles from LawBriefly API<br>
				2. Select hot legal topic via Groq &amp; Mercury<br>
				3. Extract articles via Jina Reader &amp; generate slides<br>
				4. Render dual PNG/JPEG carousel slides via browser worker<br>
				5. Persist slides to Supabase Storage &amp; Database<br>
				6. Dispatch editorial notification to Telegram for review<br>
				7. Monitor Instagram publication status
			</p>
			<div class="alert-callout" style="margin-bottom: 18px;">
				⚠️ <strong>Concurreny Notice:</strong> Competes for the distributed lock. Publishing remains strictly gated behind your human approval in Telegram.
			</div>
			<div class="modal-actions">
				<button class="btn btn-secondary" onclick="closePipelineModal()">Cancel</button>
				<button id="modal-confirm-btn" class="btn btn-primary" onclick="confirmRunPipeline()">Confirm &amp; Execute</button>
			</div>
		</div>
	</div>

	<!-- Modal: Sync News Only -->
	<div id="modal-news" class="modal-backdrop">
		<div class="modal-box">
			<h3 class="modal-title">Sync Legal News Only?</h3>
			<p class="modal-desc">
				Fetches latest legal news articles from LawBriefly RSS/API and persists them to Supabase.
				<br><br>
				<strong>Guaranteed:</strong> It does NOT trigger topic selection, carousel generation, or Telegram notifications.
			</p>
			<div class="modal-actions">
				<button class="btn btn-secondary" onclick="closeNewsSyncModal()">Cancel</button>
				<button class="btn btn-primary" onclick="confirmNewsSync()">Confirm &amp; Ingest</button>
			</div>
		</div>
	</div>

	<script>
		let pollInterval = null;
		let isExecutingRun = false;
		const STAGE_KEYS = [
			"news_ingestion",
			"topic_selection",
			"content_generation",
			"carousel_rendering",
			"carousel_persistence",
			"editorial_notification",
			"instagram_publication"
		];

		async function fetchState(manual = false) {
			const pulse = document.getElementById("live-pulse");
			const statusText = document.getElementById("live-status-text");
			if (manual) {
				document.getElementById("action-feedback").textContent = "Refreshing state...";
			}

			try {
				const res = await fetch("/api/dashboard/state");
				if (!res.ok) throw new Error("HTTP " + res.status);
				const data = await res.json();
				renderState(data);
				statusText.textContent = isExecutingRun ? "Running..." : "Connected";
				if (manual) {
					document.getElementById("action-feedback").textContent = "Updated.";
					setTimeout(() => { document.getElementById("action-feedback").textContent = ""; }, 2000);
				}
			} catch (err) {
				console.error("Failed to fetch state:", err);
				statusText.textContent = "Reconnecting...";
				pulse.style.backgroundColor = "var(--red)";
			}
		}

		function renderState(data) {
			if (data.timestamp) {
				const d = new Date(data.timestamp);
				document.getElementById("server-time").textContent = d.toISOString().substring(11, 19) + " UTC";
			}

			// Render Supabase Health
			const supaEl = document.getElementById("health-supabase");
			if (data.supabase.status === "connected") {
				supaEl.textContent = "Connected (Healthy)";
				supaEl.style.color = "var(--green)";
			} else {
				supaEl.textContent = "Degraded / Offline";
				supaEl.style.color = "var(--red)";
			}

			const migEl = document.getElementById("health-migrations");
			if (data.supabase.migrationsApplied) {
				migEl.textContent = "Migrations: Applied in Remote DB";
				migEl.style.color = "var(--green)";
			} else {
				migEl.textContent = "Migrations: Local Pending (Unapplied Remotely)";
				migEl.style.color = "var(--amber)";
			}

			// Render Distributed Lock
			const lockEl = document.getElementById("health-lock");
			const lockDetail = document.getElementById("health-lock-detail");
			if (data.distributedLock.available === false) {
				lockEl.textContent = "Unavailable (Blocked)";
				lockEl.style.color = "var(--red)";
				lockDetail.textContent = data.distributedLock.error || "Missing remote lock table/RPC";
			} else if (data.distributedLock.locked) {
				lockEl.textContent = "Locked (Active Lease)";
				lockEl.style.color = "var(--amber)";
				lockDetail.textContent = "Owner: " + (data.distributedLock.ownerRunId || "Active");
			} else {
				lockEl.textContent = "Unlocked / Idle";
				lockEl.style.color = "var(--green)";
				lockDetail.textContent = "Ready for execution &bull; 180s Lease";
			}

			// Render Groq AI Engine Status
			const groqEl = document.getElementById("health-groq");
			const groqDetail = document.getElementById("health-groq-detail");
			if (groqEl && groqDetail && data.groq) {
				if (data.groq.status === "ready") {
					groqEl.textContent = "Ready (" + data.groq.model + ")";
					groqEl.style.color = "var(--green)";
					groqDetail.textContent = "Structured Outputs Active";
				} else {
					groqEl.textContent = "Blocked (" + data.groq.model + ")";
					groqEl.style.color = "var(--red)";
					groqDetail.textContent = data.groq.error || "Configuration blocker";
				}
			}

			// Render Quarantine Backlog
			const quarEl = document.getElementById("health-quarantine");
			const quarNote = document.getElementById("health-quarantine-note");
			quarEl.textContent = data.quarantineQueue.backlogCount + " messages";
			if (data.quarantineQueue.available) {
				quarNote.textContent = "Cloudflare Queue Metrics Active";
			} else {
				quarNote.textContent = data.quarantineQueue.note || "Local simulation mode";
			}

			const active = data.activeRun;
			const last = data.lastRun;
			const runToDisplay = active || last;

			const runBtn = document.getElementById("btn-run-pipeline");
			const heading = document.getElementById("run-status-heading");
			const sub = document.getElementById("run-meta-sub");
			const overallBadge = document.getElementById("run-overall-badge");
			const pulse = document.getElementById("live-pulse");

			if (active) {
				isExecutingRun = true;
				runBtn.disabled = true;
				runBtn.innerHTML = "<span>⏳</span> Pipeline Running...";
				pulse.classList.add("running");

				heading.textContent = "Pipeline Execution in Progress";
				sub.textContent = "Run ID: " + active.runId + " &bull; Trigger: " + active.triggerType + " &bull; Elapsed: " + Math.round((active.elapsedMs || 0) / 1000) + "s";
				overallBadge.textContent = "RUNNING";
				overallBadge.className = "stage-status-pill status-running";
			} else {
				isExecutingRun = false;
				if (data.distributedLock && data.distributedLock.available === false) {
					runBtn.disabled = true;
					runBtn.title = "Full pipeline blocked: Distributed lock tables/RPC not found in database. Apply migrations to enable.";
					runBtn.innerHTML = "<span>⚠️</span> LOCK UNAVAILABLE (APPLY MIGRATIONS)";
				} else {
					runBtn.disabled = data.distributedLock.locked;
					runBtn.title = "";
					runBtn.innerHTML = "<span>⚡</span> RUN FULL PIPELINE NOW";
				}
				pulse.classList.remove("running");

				if (last) {
					heading.textContent = "Last Run: " + (last.overallStatus === "completed" ? "Completed" : last.overallStatus.toUpperCase());
					sub.textContent = "Run ID: " + last.runId + " &bull; Trigger: " + last.triggerType + " &bull; Duration: " + Math.round((last.elapsedMs || 0) / 1000) + "s";
					overallBadge.textContent = last.overallStatus.toUpperCase();
					overallBadge.className = "stage-status-pill status-" + (last.overallStatus === "completed" ? "completed" : last.overallStatus === "failed" ? "failed" : "waiting");
				} else {
					heading.textContent = "Pipeline Status: IDLE";
					sub.textContent = "No runs recorded yet in current session.";
					overallBadge.textContent = "IDLE";
					overallBadge.className = "stage-status-pill status-waiting";
				}
			}

			// Update 7 Stage Cards & Animated Green Beam
			let highestCompletedIndex = -1;
			let activeStageIndex = -1;

			if (runToDisplay && runToDisplay.stages) {
				for (let i = 0; i < STAGE_KEYS.length; i++) {
					const s = STAGE_KEYS[i];
					const info = runToDisplay.stages[s] || { status: "waiting" };
					const card = document.getElementById("card-" + s);
					const badge = document.getElementById("badge-" + s);
					const dur = document.getElementById("dur-" + s);
					const errBox = document.getElementById("err-" + s);
					const errMsg = document.getElementById("errmsg-" + s);

					card.className = "stage-card " + info.status;
					badge.className = "stage-status-pill status-" + info.status;
					badge.textContent = info.status.toUpperCase();

					if (info.status === "completed") {
						highestCompletedIndex = i;
					} else if (info.status === "running") {
						activeStageIndex = i;
					}

					if (info.durationMs !== undefined) {
						dur.textContent = info.durationMs + " ms";
					} else if (info.status === "running") {
						dur.textContent = "In progress...";
					} else {
						dur.textContent = "--";
					}

					// In-place Stage Error Diagnostics
					if (info.status === "failed" && (info.error || runToDisplay.error)) {
						errBox.classList.add("visible");
						errMsg.textContent = info.error || runToDisplay.error || "Unknown error";
					} else if (!active && s === "content_generation" && data.groq && data.groq.status === "blocked") {
						errBox.classList.add("visible");
						errMsg.textContent = "Service Blocker: Groq model " + data.groq.model + " is not ready (" + data.groq.error + ").";
					} else {
						errBox.classList.remove("visible");
					}
				}
			} else {
				for (const s of STAGE_KEYS) {
					const card = document.getElementById("card-" + s);
					const badge = document.getElementById("badge-" + s);
					const dur = document.getElementById("dur-" + s);
					const errBox = document.getElementById("err-" + s);
					card.className = "stage-card";
					badge.className = "stage-status-pill status-waiting";
					badge.textContent = "WAITING";
					dur.textContent = "--";
					if (errBox) {
						if (s === "content_generation" && data.groq && data.groq.status === "blocked") {
							errBox.classList.add("visible");
							const em = document.getElementById("errmsg-" + s);
							if (em) em.textContent = "Service Blocker: Groq model " + data.groq.model + " is not ready (" + data.groq.error + ").";
						} else {
							errBox.classList.remove("visible");
						}
					}
				}
			}

			// Update Animated Green Progress Fill Line
			const progressFill = document.getElementById("pipeline-progress-fill");
			const totalStages = STAGE_KEYS.length;
			let fillPercent = 0;
			if (activeStageIndex >= 0) {
				fillPercent = Math.min(100, ((activeStageIndex + 0.5) / totalStages) * 100);
				progressFill.classList.add("active");
			} else if (highestCompletedIndex >= 0) {
				fillPercent = Math.min(100, ((highestCompletedIndex + 1) / totalStages) * 100);
				progressFill.classList.remove("active");
			} else {
				fillPercent = 0;
				progressFill.classList.remove("active");
			}
			progressFill.style.width = fillPercent + "%";

			// Update Destination Banner (Post-Telegram Instagram Publication Status)
			const destBanner = document.getElementById("destination-banner");
			const destHeader = document.getElementById("dest-header");
			const destIcon = document.getElementById("dest-icon");
			const destTitle = document.getElementById("dest-title");
			const destBody = document.getElementById("dest-body");
			const destPostId = document.getElementById("dest-post-id");
			const destMediaId = document.getElementById("dest-media-id");
			const destLinkContainer = document.getElementById("dest-link-container");

			const pub = data.publication;
			const shouldShowBanner = pub && pub.status !== "not_reached" && runToDisplay && (!active || (active.postId && pub.postId === active.postId));
			if (shouldShowBanner) {
				destBanner.classList.add("visible");
				destPostId.textContent = pub.postId || runToDisplay.postId || "--";
				destMediaId.textContent = pub.instagramMediaId || "Pending Publication";

				if (pub.status === "published") {
					destBanner.className = "destination-banner visible published";
					destHeader.className = "dest-header published";
					destIcon.textContent = "✓";
					destTitle.textContent = "Published on Instagram!";
					destBody.textContent = "Carousel post has been successfully published to Instagram Graph API.";
					if (pub.instagramPermalink) {
						destLinkContainer.innerHTML = '<a href="' + pub.instagramPermalink + '" target="_blank" rel="noopener noreferrer" style="color: var(--green); text-decoration: underline; font-weight: 600;">View on Instagram &rarr;</a>';
					}
				} else if (pub.status === "publication_failed") {
					destBanner.className = "destination-banner visible";
					destHeader.className = "dest-header";
					destIcon.textContent = "⚠️";
					destTitle.textContent = "Instagram Publication Failed";
					destBody.textContent = "Error: " + (pub.errorMessage || "Publishing queue rejected container creation.");
					destLinkContainer.innerHTML = '<span style="color: var(--red);">Check DLQ and quarantine recovery tooling</span>';
				} else if (pub.status === "queued_for_publishing" || pub.status === "publishing_in_progress") {
					destBanner.className = "destination-banner visible";
					destHeader.className = "dest-header";
					destIcon.textContent = "⏳";
					destTitle.textContent = "Publishing in Progress";
					destBody.textContent = "Approved by editor in Telegram. Publishing job is being processed by Cloudflare Queues.";
					destLinkContainer.innerHTML = "";
				} else {
					destBanner.className = "destination-banner visible";
					destHeader.className = "dest-header awaiting";
					destIcon.textContent = "📬";
					destTitle.textContent = "Awaiting Editorial Approval in Telegram";
					destBody.textContent = "Slide album delivered to Telegram chat. Review in Telegram or approve directly below to publish.";
					destLinkContainer.innerHTML = '<button id="btn-approve-publish" class="btn btn-primary" onclick="approveAndPublish()" style="background-color: var(--green); color: #000; font-weight: 700; font-size: 13px; margin-top: 10px; padding: 10px 18px; border: none; cursor: pointer; border-radius: 6px;">🚀 APPROVE &amp; PUBLISH TO INSTAGRAM NOW</button>';
				}
			} else {
				destBanner.classList.remove("visible");
			}

			// Render Recent Runs Table
			renderRecentRuns(data.recentRuns);

			// Adaptive Polling
			resetPolling(isExecutingRun ? 2500 : 10000);
		}

		function renderRecentRuns(runs) {
			const tbody = document.getElementById("recent-runs-tbody");
			if (!runs || runs.length === 0) {
				tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 16px;">No runs recorded yet.</td></tr>';
				return;
			}

			let html = "";
			for (const r of runs) {
				const runId = r.run_id || r.runId || "--";
				const trigger = r.trigger_type || r.triggerType || "manual";
				const status = r.status || r.overallStatus || "unknown";
				const duration = r.duration_ms !== undefined ? (r.duration_ms + " ms") : (r.elapsedMs !== undefined ? (r.elapsedMs + " ms") : "--");
				const started = r.started_at || r.startedAt ? new Date(r.started_at || r.startedAt).toLocaleTimeString() : "--";
				const topic = r.topicTitle || (r.post_id ? ("Post " + r.post_id.substring(0, 8) + "...") : "Legal Topic");

				const statusClass = status === "completed" ? "status-completed" : status === "failed" ? "status-failed" : "status-waiting";
				html += '<tr>' +
					'<td>' + started + '</td>' +
					'<td style="font-family: monospace; font-size: 11px;">' + runId.substring(0, 8) + '...</td>' +
					'<td>' + trigger + '</td>' +
					'<td><span class="stage-status-pill ' + statusClass + '">' + status.toUpperCase() + '</span></td>' +
					'<td>' + duration + '</td>' +
					'<td>' + topic + '</td>' +
				'</tr>';
			}
			tbody.innerHTML = html;
		}

		function resetPolling(intervalMs) {
			if (pollInterval) clearInterval(pollInterval);
			pollInterval = setInterval(fetchState, intervalMs);
		}

		// Modals
		function openPipelineModal() {
			document.getElementById("modal-pipeline").classList.add("open");
		}
		function closePipelineModal() {
			document.getElementById("modal-pipeline").classList.remove("open");
		}
		function openNewsSyncModal() {
			document.getElementById("modal-news").classList.add("open");
		}
		function closeNewsSyncModal() {
			document.getElementById("modal-news").classList.remove("open");
		}

		function resetPipelineView(isSilent) {
			for (const s of STAGE_KEYS) {
				const card = document.getElementById("card-" + s);
				const badge = document.getElementById("badge-" + s);
				const dur = document.getElementById("dur-" + s);
				const errBox = document.getElementById("err-" + s);
				if (card) card.className = "stage-card";
				if (badge) {
					badge.className = "stage-status-pill status-waiting";
					badge.textContent = "WAITING";
				}
				if (dur) dur.textContent = "--";
				if (errBox) errBox.classList.remove("visible");
			}

			const progressFill = document.getElementById("pipeline-progress-fill");
			if (progressFill) {
				progressFill.style.width = "0%";
				progressFill.classList.remove("active");
			}

			const destBanner = document.getElementById("destination-banner");
			if (destBanner) destBanner.classList.remove("visible");

			const heading = document.getElementById("run-status-heading");
			const sub = document.getElementById("run-meta-sub");
			const overallBadge = document.getElementById("run-overall-badge");
			const pulse = document.getElementById("live-pulse");

			if (heading) heading.textContent = "Ready for New Pipeline Run";
			if (sub) sub.textContent = "Click 'RUN FULL PIPELINE NOW' to initiate a fresh autonomous cycle.";
			if (overallBadge) {
				overallBadge.textContent = "READY";
				overallBadge.className = "stage-status-pill status-waiting";
			}
			if (pulse) pulse.classList.remove("running");

			const feedback = document.getElementById("action-feedback");
			if (feedback && !isSilent) {
				feedback.textContent = "Slate cleared. Ready for fresh pipeline run.";
				feedback.style.color = "var(--text-muted)";
				setTimeout(() => { feedback.textContent = ""; }, 4000);
			}
		}

		async function confirmRunPipeline() {
			closePipelineModal();
			resetPipelineView(true);
			const runBtn = document.getElementById("btn-run-pipeline");
			const feedback = document.getElementById("action-feedback");
			runBtn.disabled = true;
			runBtn.innerHTML = "<span>⏳</span> Starting Pipeline...";
			feedback.textContent = "Triggering pipeline run...";
			isExecutingRun = true;
			resetPolling(2000);

			try {
				const res = await fetch("/api/dashboard/run", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ triggerType: "manual" }),
				});
				const data = await res.json();
				if (!res.ok) {
					feedback.textContent = "Run returned " + res.status + ": " + (data.error || "Execution failed");
					feedback.style.color = "var(--red)";
				} else {
					feedback.textContent = "Pipeline completed successfully!";
					feedback.style.color = "var(--green)";
				}
				setTimeout(() => { feedback.textContent = ""; }, 5000);
			} catch (err) {
				console.error("Trigger error:", err);
				feedback.textContent = "Failed to trigger run: " + err.message;
				feedback.style.color = "var(--red)";
			} finally {
				fetchState();
			}
		}

		async function confirmNewsSync() {
			closeNewsSyncModal();
			const syncBtn = document.getElementById("btn-news-sync");
			const feedback = document.getElementById("action-feedback");
			syncBtn.disabled = true;
			syncBtn.innerHTML = "<span>⏳</span> Ingesting News...";
			feedback.textContent = "Ingesting news articles...";

			try {
				const res = await fetch("/api/dashboard/news-sync", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ days: "3", limit: "20" }),
				});
				const data = await res.json();
				if (!res.ok) {
					feedback.textContent = "News sync failed: " + (data.error || "Unknown error");
					feedback.style.color = "var(--red)";
				} else {
					const count = data.result?.valid_count || data.valid_count || 0;
					feedback.textContent = "News synced: " + count + " articles validated and stored.";
					feedback.style.color = "var(--green)";
				}
				setTimeout(() => { feedback.textContent = ""; }, 5000);
			} catch (err) {
				console.error("Sync error:", err);
				feedback.textContent = "Failed to sync news: " + err.message;
				feedback.style.color = "var(--red)";
			} finally {
				syncBtn.disabled = false;
				syncBtn.innerHTML = "<span>📰</span> SYNC NEWS ONLY";
				fetchState();
			}
		}

		async function approveAndPublish(postId) {
			const targetId = postId || document.getElementById("dest-post-id")?.textContent?.trim() || "";
			const btn = document.getElementById("btn-approve-publish");
			if (btn) {
				btn.disabled = true;
				btn.textContent = "Publishing to Instagram...";
			}
			try {
				const res = await fetch("/api/dashboard/approve-and-publish", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ post_id: targetId })
				});
				const data = await res.json();
				if (data.success) {
					fetchState();
				} else {
					alert("Approval error: " + (data.error || "Unknown error"));
					if (btn) {
						btn.disabled = false;
						btn.textContent = "🚀 APPROVE & PUBLISH TO INSTAGRAM NOW";
					}
				}
			} catch (e) {
				alert("Network error: " + e.message);
				if (btn) {
					btn.disabled = false;
					btn.textContent = "🚀 APPROVE & PUBLISH TO INSTAGRAM NOW";
				}
			}
		}

		// Initial load
		fetchState();
		resetPolling(5000);
	</script>
</body>
</html>`;
}

export async function handleDashboardPage(
	request: Request,
	env: Env
): Promise<Response> {
	if (env.APP_ENV !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	return new Response(renderDashboardHtml(), {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store, no-cache, must-revalidate",
		},
	});
}

export async function handleDashboardState(
	request: Request,
	env: Env
): Promise<Response> {
	if (env.APP_ENV !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	const state = await getDashboardState(env);
	return new Response(JSON.stringify(state), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
	});
}

export async function handleDashboardRuns(
	request: Request,
	env: Env
): Promise<Response> {
	if (env.APP_ENV !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	const state = await getDashboardState(env);
	return new Response(JSON.stringify({ runs: state.recentRuns }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

export async function handleDashboardRunDetails(
	request: Request,
	env: Env,
	runId: string
): Promise<Response> {
	if (env.APP_ENV !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	try {
		const client = getSupabaseClient(env);
		const { data: run } = await client
			.from("pipeline_runs")
			.select("*")
			.eq("run_id", runId)
			.single();

		const { data: stageEvents } = await client
			.from("pipeline_stage_events")
			.select("*")
			.eq("run_id", runId)
			.order("created_at", { ascending: true });

		if (run) {
			return new Response(JSON.stringify({ run, stageEvents: stageEvents || [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
	} catch {
		// Fallback to in-memory
	}

	const inMemory =
		getRecentRunsList().find((r) => r.runId === runId) ||
		(getLastRunProgress()?.runId === runId ? getLastRunProgress() : null) ||
		(getActiveRunProgress()?.runId === runId ? getActiveRunProgress() : null);

	if (inMemory) {
		return new Response(JSON.stringify({ run: inMemory, stageEvents: [] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	return new Response(JSON.stringify({ error: "Run not found", run_id: runId }), {
		status: 404,
		headers: { "Content-Type": "application/json" },
	});
}

export async function handleDashboardRunTrigger(
	request: Request,
	env: Env
): Promise<Response> {
	if (env.APP_ENV !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (request.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
			status: 405,
			headers: { "Content-Type": "application/json" },
		});
	}

	let bodyOptions: any = {};
	try {
		const text = await request.text();
		if (text && text.trim().length > 0) {
			bodyOptions = JSON.parse(text);
		}
	} catch {
		// use defaults
	}

	const outcome = await executePipeline(env, {
		triggerType: "manual",
		...bodyOptions,
	});

	const status = outcome.success ? 200 : outcome.status || 500;
	return new Response(JSON.stringify(outcome), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function handleDashboardNewsSync(
	request: Request,
	env: Env
): Promise<Response> {
	if (env.APP_ENV !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (request.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
			status: 405,
			headers: { "Content-Type": "application/json" },
		});
	}

	let days = "3";
	let limit = "20";
	try {
		const text = await request.text();
		if (text && text.trim().length > 0) {
			const body = JSON.parse(text);
			if (body.days) days = String(body.days);
			if (body.limit) limit = String(body.limit);
		}
	} catch {
		// use defaults
	}

	const outcome = await executeNewsIngestion(env, days, limit);
	const status = outcome.success ? 200 : outcome.status || 500;
	return new Response(JSON.stringify(outcome), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function handleDashboardApproveAndPublish(
	request: Request,
	env: Env
): Promise<Response> {
	if (env.APP_ENV !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (request.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
			status: 405,
			headers: { "Content-Type": "application/json" },
		});
	}

	let body: any = {};
	try {
		const text = await request.text();
		if (text && text.trim().length > 0) {
			body = JSON.parse(text);
		}
	} catch {
		// empty body
	}

	const supabase = getSupabaseClient(env);
	const targetPostId = body.post_id || getActiveRunProgress()?.postId || getLastRunProgress()?.postId;
	if (!targetPostId) {
		return new Response(
			JSON.stringify({ success: false, error: "No post_id provided or available in recent runs." }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	try {
		const now = new Date().toISOString();
		// 1. Ensure approval request and post are approved in database
		await supabase
			.from("social_content_approval_requests")
			.update({
				decision_status: "approved",
				decided_at: now,
				decided_by_username: "Operator (Dashboard)",
				updated_at: now,
			})
			.eq("post_id", targetPostId);

		await supabase
			.from("social_content_posts")
			.update({
				post_status: "approved",
				updated_at: now,
			})
			.eq("id", targetPostId);

		// 2. Publish to Instagram (reusing existing finished container or preparing fresh)
		const publishResult = await publishApprovedCarousel(env, targetPostId, {
			prepareOnly: false,
			claimConfirmed: true,
		});

		// 3. Best-effort Telegram control message edit to reflect operator decision
		try {
			const { data: appReq } = await supabase
				.from("social_content_approval_requests")
				.select("telegram_chat_id, telegram_control_message_id")
				.eq("post_id", targetPostId)
				.maybeSingle();

			if (appReq && appReq.telegram_chat_id && appReq.telegram_control_message_id && env.TELEGRAM_BOT_TOKEN) {
				const botToken = normalizeBotToken(env.TELEGRAM_BOT_TOKEN);
				await editMessageReplyMarkup(botToken, appReq.telegram_chat_id, appReq.telegram_control_message_id, {
					inline_keyboard: [],
				}).catch(() => {});
			}
		} catch {
			// ignore telegram notification failure
		}

		// 4. Update in-memory run progress if applicable
		const targetRun = getActiveRunProgress() || getLastRunProgress();
		if (targetRun) {
			targetRun.stages["instagram_publication"] = {
				stage: "instagram_publication",
				status: "completed",
				metadata: {
					media_id: publishResult.instagram_media_id,
					permalink: publishResult.instagram_permalink,
					published_at: now,
				},
			};
		}

		return new Response(
			JSON.stringify({
				success: true,
				post_id: targetPostId,
				instagram_media_id: publishResult.instagram_media_id,
				instagram_permalink: publishResult.instagram_permalink,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } }
		);
	} catch (err: any) {
		return new Response(
			JSON.stringify({
				success: false,
				error: err?.message || "Failed to approve and publish to Instagram.",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } }
		);
	}
}
