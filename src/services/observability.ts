import type { Env } from "../index";
import { sendMessage, escapeTelegramHtml, timingSafeEqualStrings } from "./telegram-bot";
import { getSupabaseClient } from "./supabase";

export type ObservabilityEventType =
	| "pipeline_run_started"
	| "pipeline_stage_started"
	| "pipeline_stage_completed"
	| "pipeline_stage_failed"
	| "pipeline_run_completed"
	| "pipeline_run_failed"
	| "pipeline_run_skipped"
	| "queue_message_received"
	| "queue_message_processed"
	| "queue_message_failed"
	| "queue_message_retried"
	| "dead_letter_received"
	| "dead_letter_persistence_failed"
	| "operational_alert_sent"
	| "operational_alert_suppressed"
	| "operational_alert_failed"
	| "operational_alert_fallback";

export interface ObservabilityLogEnvelope {
	event: ObservabilityEventType;
	timestamp: string;
	run_id?: string;
	trigger_type?: "scheduled" | "manual" | "queue";
	cron_expression?: string;
	stage?: string;
	status?: "success" | "failed" | "skipped" | "in_progress" | "concurrency_conflict" | "no_strong_topic";
	duration_ms?: number;
	environment?: string;
	error_code?: string;
	error_message?: string;
	details?: string;
	post_id?: string;
	counts?: Record<string, number>;
	metadata?: Record<string, any>;
}

const SENSITIVE_KEY_REGEX = /token|key|secret|auth|authorization|password|credential/i;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recursively redacts sensitive credentials, tokens, and authorization payloads from logs.
 * Truncates oversized text strings to prevent article body leakage.
 */
export function sanitizeLogPayload(data: any): any {
	if (data === null || data === undefined) return data;
	if (typeof data === "string") {
		let s = data;
		s = s.replace(/bot\d+:[A-Za-z0-9_-]+/gi, "bot[REDACTED]");
		s = s.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
		s = s.replace(/ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT_REDACTED]");
		if (s.length > 500) {
			s = s.slice(0, 500) + "... [truncated]";
		}
		return s;
	}
	if (typeof data !== "object") return data;
	if (Array.isArray(data)) {
		return data.map(sanitizeLogPayload);
	}
	const copy: Record<string, any> = {};
	for (const [key, value] of Object.entries(data)) {
		if (SENSITIVE_KEY_REGEX.test(key)) {
			copy[key] = "[REDACTED]";
		} else {
			copy[key] = sanitizeLogPayload(value);
		}
	}
	return copy;
}

/**
 * Emits a structured JSON operational log entry.
 */
export function logOperationalEvent(
	envelope: ObservabilityLogEnvelope,
	level: "info" | "warn" | "error" = "info"
): string {
	const sanitized = sanitizeLogPayload(envelope);
	const json = JSON.stringify(sanitized);
	if (level === "error") {
		console.error(json);
	} else if (level === "warn") {
		console.warn(json);
	} else {
		console.log(json);
	}
	return json;
}

export interface IsolateMetrics {
	totalExecutions: number;
	successfulExecutions: number;
	failedExecutions: number;
	skippedExecutions: number;
	noStrongTopicCount: number;
	durations: number[];
	lastRun?: {
		runId: string;
		triggerType: string;
		status: string;
		durationMs: number;
		timestamp: string;
		postId?: string;
	};
	lastSuccess?: {
		runId: string;
		timestamp: string;
		postId?: string;
		durationMs: number;
	};
	lastFailure?: {
		runId: string;
		stage: string;
		errorCode?: string;
		errorMessage?: string;
		timestamp: string;
	};
	deadLetterCount: number;
	queueProcessedCount: number;
	queueFailedCount: number;
}

const memoryMetrics: IsolateMetrics = {
	totalExecutions: 0,
	successfulExecutions: 0,
	failedExecutions: 0,
	skippedExecutions: 0,
	noStrongTopicCount: 0,
	durations: [],
	deadLetterCount: 0,
	queueProcessedCount: 0,
	queueFailedCount: 0,
};

export function getMemoryMetrics(): IsolateMetrics {
	return { ...memoryMetrics, durations: [...memoryMetrics.durations] };
}

export function resetMemoryMetrics(): void {
	memoryMetrics.totalExecutions = 0;
	memoryMetrics.successfulExecutions = 0;
	memoryMetrics.failedExecutions = 0;
	memoryMetrics.skippedExecutions = 0;
	memoryMetrics.noStrongTopicCount = 0;
	memoryMetrics.durations = [];
	delete memoryMetrics.lastRun;
	delete memoryMetrics.lastSuccess;
	delete memoryMetrics.lastFailure;
	memoryMetrics.deadLetterCount = 0;
	memoryMetrics.queueProcessedCount = 0;
	memoryMetrics.queueFailedCount = 0;
}

export function recordPipelineRunMetric(data: {
	runId: string;
	triggerType: string;
	cronExpression?: string;
	status: string;
	durationMs: number;
	stage?: string;
	postId?: string;
}): void {
	memoryMetrics.totalExecutions++;
	memoryMetrics.durations.push(data.durationMs);
	if (data.status === "concurrency_conflict") {
		memoryMetrics.skippedExecutions++;
	}
	memoryMetrics.lastRun = {
		runId: data.runId,
		triggerType: data.triggerType,
		status: data.status,
		durationMs: data.durationMs,
		timestamp: new Date().toISOString(),
		postId: data.postId,
	};
}

export function recordPipelineSuccessMetric(data: {
	runId: string;
	triggerType: string;
	cronExpression?: string;
	status: "completed" | "no_strong_topic";
	durationMs: number;
	postId?: string;
}): void {
	memoryMetrics.totalExecutions++;
	memoryMetrics.durations.push(data.durationMs);
	if (data.status === "completed") {
		memoryMetrics.successfulExecutions++;
		memoryMetrics.lastSuccess = {
			runId: data.runId,
			timestamp: new Date().toISOString(),
			postId: data.postId,
			durationMs: data.durationMs,
		};
	} else if (data.status === "no_strong_topic") {
		memoryMetrics.noStrongTopicCount++;
	}
	memoryMetrics.lastRun = {
		runId: data.runId,
		triggerType: data.triggerType,
		status: data.status,
		durationMs: data.durationMs,
		timestamp: new Date().toISOString(),
		postId: data.postId,
	};
}

export function recordPipelineFailureMetric(data: {
	runId: string;
	triggerType: string;
	cronExpression?: string;
	stage: string;
	errorCode?: string;
	errorMessage?: string;
	durationMs: number;
}): void {
	memoryMetrics.totalExecutions++;
	memoryMetrics.failedExecutions++;
	memoryMetrics.durations.push(data.durationMs);
	const nowIso = new Date().toISOString();
	memoryMetrics.lastFailure = {
		runId: data.runId,
		stage: data.stage,
		errorCode: data.errorCode,
		errorMessage: data.errorMessage,
		timestamp: nowIso,
	};
	memoryMetrics.lastRun = {
		runId: data.runId,
		triggerType: data.triggerType,
		status: "failed",
		durationMs: data.durationMs,
		timestamp: nowIso,
	};
}

export function recordQueueProcessed(): void {
	memoryMetrics.queueProcessedCount++;
}

export function recordQueueFailed(): void {
	memoryMetrics.queueFailedCount++;
}

async function withTimeout<T>(promise: PromiseLike<T>, ms = 2000): Promise<T> {
	let timer: any;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("Database observability operation timed out")), ms);
	});
	return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => clearTimeout(timer));
}

/**
 * Best-effort async persistence of pipeline run metrics to Supabase.
 * Never throws or disrupts pipeline execution.
 */
export async function persistPipelineRunMetric(
	env: Env,
	runData: {
		run_id: string;
		trigger_type: string;
		cron_expression?: string;
		status: string;
		started_at: string;
		completed_at: string;
		duration_ms: number;
		failed_stage?: string;
		error_code?: string;
		error_message?: string;
		post_id?: string;
	}
): Promise<void> {
	if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return;
	try {
		const supabase = getSupabaseClient(env);
		await withTimeout(supabase.from("pipeline_runs").upsert(runData));
	} catch (err: any) {
		console.warn(`[Observability] Best-effort pipeline_runs persistence skipped: ${err?.message || err}`);
	}
}

/**
 * Best-effort async persistence of stage execution events to Supabase.
 * Never throws or disrupts pipeline execution.
 */
export async function persistStageEventMetric(
	env: Env,
	stageData: {
		run_id: string;
		stage: string;
		status: string;
		started_at: string;
		completed_at: string;
		duration_ms: number;
		error_code?: string;
		error_message?: string;
		metadata?: Record<string, any>;
	}
): Promise<void> {
	if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return;
	try {
		const supabase = getSupabaseClient(env);
		await withTimeout(supabase.from("pipeline_stage_events").insert(stageData));
	} catch (err: any) {
		console.warn(`[Observability] Best-effort pipeline_stage_events persistence skipped: ${err?.message || err}`);
	}
}

const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15-minute cooldown per incident signature
const inMemoryAlertCooldown = new Map<string, number>();

export function resetAlertCooldowns(): void {
	inMemoryAlertCooldown.clear();
}

export interface AlertContext {
	runId?: string;
	triggerType?: string;
	stage?: string;
	errorCategory?: string;
	errorMessage: string;
	durationMs?: number;
	metadata?: Record<string, any>;
}

/**
 * Sends an actionable operational failure alert to Telegram when OPS_ALERTS_ENABLED is strictly "true".
 * Safe guarantees:
 * - Kill switch: only "true" enables
 * - Deduplication: suppresses repeated alerts for the same stage/category within 15 minutes
 * - Isolation: failure to send the alert is caught, logged, and NEVER masks the underlying pipeline error
 * - Secret sanitization: never exposes tokens or credentials
 */
export async function sendOperationalAlert(
	env: Env,
	context: AlertContext
): Promise<{ sent: boolean; reason?: string; error?: string }> {
	const timestamp = new Date().toISOString();

	// 1. Kill switch check: strictly exact string "true"
	if (env.OPS_ALERTS_ENABLED !== "true") {
		logOperationalEvent({
			event: "operational_alert_suppressed",
			timestamp,
			run_id: context.runId,
			stage: context.stage,
			details: "OPS_ALERTS_ENABLED is not set to 'true'",
			metadata: { reason: "kill_switch_disabled" },
		});
		return { sent: false, reason: "kill_switch_disabled" };
	}

	// 2. Resolve target chat ID
	const targetChatId = env.TELEGRAM_OPS_ALERT_CHAT_ID || env.TELEGRAM_CHAT_ID;
	const botToken = env.TELEGRAM_BOT_TOKEN;
	if (!botToken || !targetChatId) {
		logOperationalEvent(
			{
				event: "operational_alert_failed",
				timestamp,
				run_id: context.runId,
				stage: context.stage,
				error_message: "Missing TELEGRAM_BOT_TOKEN or target chat ID",
			},
			"error"
		);
		return { sent: false, error: "Missing Telegram credentials or chat ID" };
	}

	// 3. Distributed Atomic Deduplication Reservation via PostgreSQL RPC
	const dedupKey = `${context.stage || "pipeline"}:${context.errorCategory || "general"}`;
	const now = Date.now();

	// Fast-path in-memory optimization: only suppress if within confirmed cooldown
	const localLastSent = inMemoryAlertCooldown.get(dedupKey);
	if (localLastSent && now - localLastSent < ALERT_COOLDOWN_MS) {
		logOperationalEvent({
			event: "operational_alert_suppressed",
			timestamp,
			run_id: context.runId,
			stage: context.stage,
			details: `Alert suppressed: isolate cooldown active for '${dedupKey}'`,
			metadata: { dedup_key: dedupKey, reason: "cooldown_active" },
		});
		return { sent: false, reason: "cooldown_active" };
	}

	let dbDedupAvailable = false;

	if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
		try {
			const supabase = getSupabaseClient(env);
			const { data: reserveResult, error: reserveError } = await withTimeout(
				supabase.rpc("reserve_operational_alert", {
					p_dedup_key: dedupKey,
					p_cooldown_seconds: Math.floor(ALERT_COOLDOWN_MS / 1000),
					p_reservation_ttl_seconds: 60,
					p_retry_backoff_seconds: 30,
					p_incident_metadata: {
						run_id: context.runId,
						stage: context.stage,
						error_code: context.errorCategory,
					},
				}),
				2000
			);

			if (!reserveError && reserveResult) {
				dbDedupAvailable = true;
				const claim = Array.isArray(reserveResult) ? reserveResult[0] : reserveResult;
				const isReserved = claim.reserved ?? claim.claimed;
				if (typeof isReserved === "boolean") {
					if (!isReserved) {
						if (claim.reason === "cooldown_active" && claim.last_alerted_at) {
							inMemoryAlertCooldown.set(dedupKey, new Date(claim.last_alerted_at).getTime());
						}
						logOperationalEvent({
							event: "operational_alert_suppressed",
							timestamp,
							run_id: context.runId,
							stage: context.stage,
							details: `Alert suppressed: atomic reservation check returned not reserved for '${dedupKey}' (reason: ${claim.reason || "cooldown_active"})`,
							metadata: {
								dedup_key: dedupKey,
								reason: claim.reason || "cooldown_active",
								cooldown_remaining_seconds: claim.cooldown_remaining_seconds,
							},
						});
						return { sent: false, reason: claim.reason || "cooldown_active" };
					}
				}
			} else {
				// Fallback to legacy claim_operational_alert if reserve_operational_alert RPC is not present
				const { data: legacyResult, error: legacyError } = await withTimeout(
					supabase.rpc("claim_operational_alert", {
						p_dedup_key: dedupKey,
						p_cooldown_seconds: Math.floor(ALERT_COOLDOWN_MS / 1000),
						p_incident_metadata: {
							run_id: context.runId,
							stage: context.stage,
							error_code: context.errorCategory,
						},
					}),
					2000
				);
				if (!legacyError && legacyResult) {
					dbDedupAvailable = true;
					const claim = Array.isArray(legacyResult) ? legacyResult[0] : legacyResult;
					if (claim && typeof claim.claimed === "boolean" && !claim.claimed) {
						if (claim.last_alerted_at) {
							inMemoryAlertCooldown.set(dedupKey, new Date(claim.last_alerted_at).getTime());
						}
						logOperationalEvent({
							event: "operational_alert_suppressed",
							timestamp,
							run_id: context.runId,
							stage: context.stage,
							details: `Alert suppressed: persistent claim active for '${dedupKey}'`,
							metadata: { dedup_key: dedupKey, reason: "cooldown_active" },
						});
						return { sent: false, reason: "cooldown_active" };
					}
				}
			}
		} catch (err: any) {
			console.warn(`[Observability] Atomic database alert reservation unavailable: ${err?.message || err}`);
		}
	}

	if (!dbDedupAvailable) {
		// Log explicit fallback warning: cross-isolate deduplication is not guaranteed without database
		logOperationalEvent({
			event: "operational_alert_fallback",
			timestamp,
			run_id: context.runId,
			stage: context.stage,
			details: "Persistent alert deduplication unavailable; falling back to isolate-local cooldown. Cross-isolate deduplication not guaranteed.",
			metadata: { dedup_key: dedupKey },
		});
	}

	// 4. Format Actionable Telegram Alert Message
	const durationText =
		context.durationMs !== undefined ? `${(context.durationMs / 1000).toFixed(1)}s` : "N/A";
	const cleanError = sanitizeLogPayload(context.errorMessage || "Unknown pipeline error");
	const safeMsg = typeof cleanError === "string" ? cleanError.slice(0, 300) : JSON.stringify(cleanError).slice(0, 300);

	const alertText = [
		"🚨 <b>LAWBRIEFLY PIPELINE FAILURE</b>",
		"",
		`<b>Environment:</b> ${escapeTelegramHtml(env.APP_ENV || "production")}`,
		`<b>Trigger:</b> ${escapeTelegramHtml(context.triggerType || "scheduled")}`,
		`<b>Run ID:</b> <code>${escapeTelegramHtml(context.runId || "N/A")}</code>`,
		"",
		`<b>Failed Stage:</b> <code>${escapeTelegramHtml(context.stage || "unknown")}</code>`,
		`<b>Error Category:</b> ${escapeTelegramHtml(context.errorCategory || "pipeline_error")}`,
		`<b>Duration:</b> ${escapeTelegramHtml(durationText)}`,
		`<b>Error Details:</b> ${escapeTelegramHtml(safeMsg)}`,
		"",
		"<b>Status:</b> Pipeline execution failed.",
		"<b>Action:</b> Review operational run logs for root-cause analysis.",
	].join("\n");

	// 5. Send Alert via Telegram Bot (Outside of any DB transaction)
	try {
		await sendMessage(botToken, targetChatId, alertText, { parse_mode: "HTML" });

		// 6. Confirm Alert Delivery in Database (starts full 15-minute cooldown)
		if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
			try {
				const supabase = getSupabaseClient(env);
				await withTimeout(
					supabase.rpc("confirm_operational_alert_sent", {
						p_dedup_key: dedupKey,
						p_incident_metadata: {
							run_id: context.runId,
							stage: context.stage,
							error_code: context.errorCategory,
						},
					}),
					2000
				);
			} catch {
				// Best-effort confirmation
			}
		}

		inMemoryAlertCooldown.set(dedupKey, Date.now());

		logOperationalEvent({
			event: "operational_alert_sent",
			timestamp,
			run_id: context.runId,
			stage: context.stage,
			metadata: {
				dedup_key: dedupKey,
				target_chat_id: targetChatId,
			},
		});
		return { sent: true };
	} catch (err: any) {
		const alertDeliveryError = err instanceof Error ? err.message : String(err);

		// Record delivery failure in database (DOES NOT advance last_alerted_at or start 15-minute cooldown!)
		if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
			try {
				const supabase = getSupabaseClient(env);
				await withTimeout(
					supabase.rpc("record_operational_alert_failed", {
						p_dedup_key: dedupKey,
						p_error_message: alertDeliveryError,
					}),
					2000
				);
			} catch {
				// Best effort
			}
		}

		// In-memory: temporary 30-second backoff instead of consuming full 15-minute cooldown
		inMemoryAlertCooldown.set(dedupKey, Date.now() - ALERT_COOLDOWN_MS + 30000);

		logOperationalEvent(
			{
				event: "operational_alert_failed",
				timestamp,
				run_id: context.runId,
				stage: context.stage,
				error_message: alertDeliveryError,
			},
			"error"
		);
		// Never trigger recursive alerts
		return { sent: false, error: alertDeliveryError };
	}
}

/**
 * Durably persists a dead-letter event record to the Supabase dead_letter_events table.
 * Returns { success: boolean, error?: string }.
 */
export async function persistDeadLetterEvent(
	env: Env,
	event: {
		dlq_message_id: string;
		source_queue?: string;
		post_id?: string;
		job_id?: string;
		failure_category: string;
		processing_status?: string;
		attempts: number;
		payload: Record<string, any>;
		error_message?: string;
	}
): Promise<{ success: boolean; error?: string }> {
	if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
		return { success: false, error: "Missing Supabase configuration" };
	}

	try {
		const supabase = getSupabaseClient(env);
		const sanitizedPayload = sanitizeLogPayload(event.payload || {});

		const { error } = await withTimeout(
			supabase.from("dead_letter_events").upsert(
				{
					dlq_message_id: event.dlq_message_id,
					source_queue: event.source_queue || "instagram-publishing-jobs",
					timestamp_received: new Date().toISOString(),
					post_id: event.post_id && UUID_REGEX.test(event.post_id) ? event.post_id : null,
					job_id: event.job_id || null,
					failure_category: event.failure_category,
					processing_status: event.processing_status || "quarantined",
					attempts: event.attempts,
					payload: sanitizedPayload,
					error_message: event.error_message || null,
				},
				{ onConflict: "dlq_message_id" }
			),
			3000
		);

		if (error) {
			return { success: false, error: error.message };
		}
		return { success: true };
	} catch (err: any) {
		return { success: false, error: err?.message || String(err) };
	}
}

/**
 * Handles dead-letter queue messages delivered to instagram-publishing-dlq.
 * Emits dead_letter_received events, persists them durably before acknowledgment,
 * notifies operators when enabled, and acknowledges only after durable retention.
 */
export async function handleDeadLetterQueue(
	batch: MessageBatch<any>,
	env: Env,
	ctx?: ExecutionContext
): Promise<void> {
	const timestamp = new Date().toISOString();

	for (const message of batch.messages) {
		memoryMetrics.deadLetterCount++;
		const body = message.body || {};
		const postId = body.post_id || "unknown";
		const jobId = body.job_id || "unknown";
		const attempts = message.attempts || 1;
		const messageId = message.id || `dlq-${Date.now()}`;

		logOperationalEvent(
			{
				event: "dead_letter_received",
				timestamp,
				trigger_type: "queue",
				stage: "instagram_publishing_dlq",
				status: "failed",
				post_id: postId,
				error_code: "MAX_RETRIES_EXHAUSTED",
				metadata: {
					message_id: messageId,
					job_id: jobId,
					attempts,
				},
			},
			"error"
		);

		// 1. Attempt durable persistence BEFORE acknowledging
		const persistResult = await persistDeadLetterEvent(env, {
			dlq_message_id: messageId,
			source_queue: "instagram-publishing-jobs",
			post_id: postId,
			job_id: jobId,
			failure_category: "MAX_RETRIES_EXHAUSTED",
			processing_status: "quarantined",
			attempts,
			payload: body,
			error_message: `Instagram publishing job for post ${postId} exhausted all retries and landed in DLQ.`,
		});

		// 2. If persistence failed, DO NOT ACKNOWLEDGE! Retry with delay so message is retained in queue.
		if (!persistResult.success) {
			logOperationalEvent(
				{
					event: "dead_letter_persistence_failed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_dlq",
					status: "failed",
					post_id: postId,
					error_message: persistResult.error,
					metadata: { message_id: messageId },
				},
				"error"
			);
			message.retry({ delaySeconds: 60 });
			continue;
		}

		// 3. Dispatch operational alert (best effort, Telegram failure must NOT discard the persisted record)
		await sendOperationalAlert(env, {
			triggerType: "queue",
			stage: "queue_dead_letter",
			errorCategory: "MAX_RETRIES_EXHAUSTED",
			errorMessage: `Instagram publishing job for post ${postId} exhausted all retries and landed in DLQ (attempts: ${attempts}). Quarantined in dead_letter_events table.`,
			metadata: {
				post_id: postId,
				job_id: jobId,
				message_id: messageId,
			},
		}).catch(() => {});

		// 4. Safely acknowledge only after durable retention is confirmed
		message.ack();
	}
}

/**
 * Development-only operational health summary endpoint handler (GET /api/health/operations).
 */
export async function handleOperationsHealth(env: Env): Promise<Response> {
	const metrics = getMemoryMetrics();
	const avgDuration =
		metrics.durations.length > 0
			? Math.round(metrics.durations.reduce((a, b) => a + b, 0) / metrics.durations.length)
			: 0;
	const maxDuration =
		metrics.durations.length > 0 ? Math.max(...metrics.durations) : 0;
	const failureRate =
		metrics.totalExecutions > 0 ? Number((metrics.failedExecutions / metrics.totalExecutions).toFixed(3)) : 0;

	const healthPayload = {
		status: metrics.lastFailure && metrics.lastRun?.status === "failed" ? "degraded" : "healthy",
		timestamp: new Date().toISOString(),
		environment: env.APP_ENV || "unknown",
		config: {
			autonomous_cron_enabled: env.AUTONOMOUS_PIPELINE_ENABLED === "true",
			ops_alerts_enabled: env.OPS_ALERTS_ENABLED === "true",
			queue_configured: Boolean(env.INSTAGRAM_PUBLISHING_QUEUE),
			quarantine_queue_configured: Boolean(env.INSTAGRAM_QUARANTINE_QUEUE),
		},
		metrics: {
			total_executions: metrics.totalExecutions,
			successful_executions: metrics.successfulExecutions,
			failed_executions: metrics.failedExecutions,
			skipped_executions: metrics.skippedExecutions,
			no_strong_topic_count: metrics.noStrongTopicCount,
			average_duration_ms: avgDuration,
			max_duration_ms: maxDuration,
			failure_rate: failureRate,
			dead_letter_count: metrics.deadLetterCount,
			queue_processed_count: metrics.queueProcessedCount,
			queue_failed_count: metrics.queueFailedCount,
		},
		last_run: metrics.lastRun || null,
		last_success: metrics.lastSuccess || null,
		last_failure: metrics.lastFailure || null,
	};

	return new Response(JSON.stringify(healthPayload), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

export interface QuarantineBacklogStatus {
	monitored: boolean;
	backlogCount: number | null;
	backlogBytes: number | null;
	oldestMessageTimestamp: string | null;
	ageSeconds: number | null;
	thresholdExceeded: boolean;
	alertSent?: boolean;
	alertSuppressed?: boolean;
	error?: string;
}

/**
 * Checks the quarantine queue metrics using genuine Cloudflare Queues runtime metrics API.
 * Safely guards against missing binding, unsupported runtime, or unavailable metrics without fabricating counts.
 * Emits an operational alert (deduplicated with 15-minute cooldown) when backlog exceeds threshold.
 */
export async function checkQuarantineBacklog(
	env: Env,
	options: {
		maxBacklogCount?: number;
		maxAgeSeconds?: number;
	} = {}
): Promise<QuarantineBacklogStatus> {
	if (!env.INSTAGRAM_QUARANTINE_QUEUE) {
		return {
			monitored: false,
			backlogCount: null,
			backlogBytes: null,
			oldestMessageTimestamp: null,
			ageSeconds: null,
			thresholdExceeded: false,
			error: "INSTAGRAM_QUARANTINE_QUEUE is not bound",
		};
	}

	try {
		if (typeof (env.INSTAGRAM_QUARANTINE_QUEUE as any).metrics !== "function") {
			return {
				monitored: false,
				backlogCount: null,
				backlogBytes: null,
				oldestMessageTimestamp: null,
				ageSeconds: null,
				thresholdExceeded: false,
				error: "Queue metrics API is not supported in current environment",
			};
		}

		const metrics = await (env.INSTAGRAM_QUARANTINE_QUEUE as any).metrics();
		if (!metrics || typeof metrics.backlogCount !== "number") {
			return {
				monitored: false,
				backlogCount: null,
				backlogBytes: null,
				oldestMessageTimestamp: null,
				ageSeconds: null,
				thresholdExceeded: false,
				error: "Queue metrics returned unexpected empty payload",
			};
		}

		const backlogCount = metrics.backlogCount;
		const backlogBytes = typeof metrics.backlogBytes === "number" ? metrics.backlogBytes : null;
		let oldestMessageTimestamp: string | null = null;
		let ageSeconds: number | null = null;

		if (metrics.oldestMessageTimestamp) {
			const d =
				metrics.oldestMessageTimestamp instanceof Date
					? metrics.oldestMessageTimestamp
					: new Date(metrics.oldestMessageTimestamp);
			if (!isNaN(d.getTime())) {
				oldestMessageTimestamp = d.toISOString();
				ageSeconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
			}
		}

		const countThreshold = options.maxBacklogCount ?? 0;
		const ageThreshold = options.maxAgeSeconds ?? 86400; // 24 hours

		const countExceeded = backlogCount > countThreshold;
		const ageExceeded = ageSeconds !== null && ageSeconds > ageThreshold;
		const thresholdExceeded = countExceeded || ageExceeded;

		let alertSent = false;
		let alertSuppressed = false;

		if (thresholdExceeded && env.OPS_ALERTS_ENABLED === "true") {
			const alertRes = await sendOperationalAlert(env, {
				triggerType: "queue",
				stage: "quarantine_backlog",
				errorCategory: "QUARANTINE_BACKLOG_DETECTED",
				errorMessage: `Quarantine queue backlog threshold exceeded! Backlog count: ${backlogCount}, oldest age: ${
					ageSeconds !== null ? ageSeconds + "s" : "unknown"
				}. Operator inspection required.`,
				metadata: {
					backlog_count: backlogCount,
					backlog_bytes: backlogBytes,
					oldest_message_timestamp: oldestMessageTimestamp,
					age_seconds: ageSeconds,
				},
			}).catch(() => null);

			if (alertRes) {
				alertSent = Boolean(alertRes.sent);
				alertSuppressed = !alertRes.sent && alertRes.reason !== "kill_switch_disabled";
			}
		}

		return {
			monitored: true,
			backlogCount,
			backlogBytes,
			oldestMessageTimestamp,
			ageSeconds,
			thresholdExceeded,
			alertSent,
			alertSuppressed,
		};
	} catch (err: any) {
		return {
			monitored: false,
			backlogCount: null,
			backlogBytes: null,
			oldestMessageTimestamp: null,
			ageSeconds: null,
			thresholdExceeded: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Administrative endpoint handler for POST /api/admin/quarantine/re-enqueue-dlq.
 * Protected by ADMIN_API_KEY bearer token / header.
 * Replays an unacknowledged dead-letter message from dead_letter_events back into the publishing queue for recovery.
 * Idempotent: rejects messages already marked 'replayed'.
 * Rejects direct Instagram publication.
 */
export async function handleReplayQuarantinedMessage(
	request: Request,
	env: Env
): Promise<Response> {
	// 1. Gating & Authentication
	const adminKey = env.ADMIN_API_KEY?.trim();
	const authHeader = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
	const keyHeader = (request.headers.get("X-Admin-Key") || "").trim();
	const presentedKey = keyHeader || authHeader;

	if (!adminKey || !presentedKey || !timingSafeEqualStrings(presentedKey, adminKey)) {
		return new Response(
			JSON.stringify({ error: "Unauthorized", message: "Valid admin authorization required" }),
			{ status: 401, headers: { "Content-Type": "application/json" } }
		);
	}

	if (request.method !== "POST") {
		return new Response(
			JSON.stringify({ error: "Method Not Allowed", status: 405 }),
			{ status: 405, headers: { "Content-Type": "application/json" } }
		);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return new Response(
			JSON.stringify({ error: "Bad Request", message: "Malformed JSON payload" }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const { dlq_message_id, post_id, job_id } = body || {};
	if (!dlq_message_id && !post_id && !job_id) {
		return new Response(
			JSON.stringify({ error: "Bad Request", message: "Must provide dlq_message_id, post_id, or job_id" }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const supabase = getSupabaseClient(env);
	let query = supabase.from("dead_letter_events").select("*");
	if (dlq_message_id) query = query.eq("dlq_message_id", dlq_message_id);
	else if (job_id) query = query.eq("job_id", job_id);
	else if (post_id) query = query.eq("post_id", post_id);

	const { data: record, error: fetchErr } = await query.maybeSingle();
	if (fetchErr || !record) {
		return new Response(
			JSON.stringify({ error: "Not Found", message: "Quarantined event record not found in dead_letter_events" }),
			{ status: 404, headers: { "Content-Type": "application/json" } }
		);
	}

	// Idempotency: Reject already replayed messages
	if (record.processing_status === "replayed") {
		return new Response(
			JSON.stringify({
				success: false,
				is_duplicate: true,
				message: `Message ${record.dlq_message_id} has already been replayed.`,
				record,
			}),
			{ status: 409, headers: { "Content-Type": "application/json" } }
		);
	}

	// Target queue: Re-enqueue into primary publishing queue so consumer can re-attempt processing,
	// NEVER directly execute Instagram Graph API.
	if (!env.INSTAGRAM_PUBLISHING_QUEUE) {
		return new Response(
			JSON.stringify({ error: "Service Unavailable", message: "INSTAGRAM_PUBLISHING_QUEUE is not available" }),
			{ status: 503, headers: { "Content-Type": "application/json" } }
		);
	}

	const replayPayload = {
		job_id: record.job_id || `publish:${record.post_id}`,
		post_id: record.post_id,
		approval_request_id: record.payload?.approval_request_id,
		enqueued_at: new Date().toISOString(),
		replayed_from_dlq: true,
		replayed_dlq_message_id: record.dlq_message_id,
	};

	await env.INSTAGRAM_PUBLISHING_QUEUE.send(replayPayload);

	// Mark replayed in database
	await supabase
		.from("dead_letter_events")
		.update({
			processing_status: "replayed",
		})
		.eq("id", record.id);

	return new Response(
		JSON.stringify({
			success: true,
			replayed: true,
			dlq_message_id: record.dlq_message_id,
			post_id: record.post_id,
			job_id: replayPayload.job_id,
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } }
	);
}

