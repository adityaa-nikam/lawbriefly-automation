/**
 * LawBriefly Editorial Approval Service (Task 16)
 * Connects the Task 15 carousel persistence system to Telegram for human editorial review.
 * - Retrieves stored post assets and sends slide media albums via sendMediaGroup.
 * - Delivers editorial control message with one-time action buttons (APPROVE / REJECT).
 * - Enforces numeric Telegram user ID allowlisting and constant-time webhook secret authentication.
 * - Manages one-time callback tokens, SHA-256 token hashing, and atomic status transitions.
 * - Maintains complete editorial audit event history.
 */

import type { Env } from "../index";
import { getSupabaseClient } from "./supabase";
import { calculateSha256 } from "./carousel-persistence";
import {
	sendMediaGroup,
	sendMessage,
	editMessageText,
	editMessageReplyMarkup,
	answerCallbackQuery,
	escapeTelegramHtml,
	timingSafeEqualStrings,
	normalizeBotToken,
	type TelegramUpdate,
	type TelegramMediaItem,
} from "./telegram-bot";
import * as instagramPublishing from "./instagram-publishing";
import {
	logOperationalEvent,
	recordQueueProcessed,
	recordQueueFailed,
} from "./observability";

export const DEFAULT_APPROVAL_TTL_HOURS = 72;
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NotifyEditorOptions {
	postId: string;
	dryRun?: boolean;
	ttlHours?: number;
}

export interface NotifyEditorResult {
	success: boolean;
	dry_run?: boolean;
	post_id: string;
	topic_title?: string;
	carousel_slide_count?: number;
	caption_preview?: string;
	approval_request_id?: string;
	telegram_chat_id?: string;
	control_message_id?: number;
	media_message_ids?: number[];
	expires_at?: string;
	is_already_sent?: boolean;
	error?: string;
}

export interface InstagramPublishingJobMessage {
	job_id: string;
	post_id: string;
	approval_request_id?: string;
	enqueued_at: string;
	attempt?: number;
}

export interface ProcessCallbackResult {
	success: boolean;
	is_duplicate?: boolean;
	is_already_decided?: boolean;
	post_id?: string;
	approval_request_id?: string;
	action?: "approve" | "reject";
	decision_status?: "approved" | "rejected";
	auto_publish_dispatched?: boolean;
	queue_job_id?: string;
	error_code?: string;
	error?: string;
}

export interface AutoPublishResult {
	success: boolean;
	skipped?: boolean;
	reason?: string;
	result?: any;
	error?: string;
}

/**
 * Generates a cryptographically secure random token string using Web Crypto API.
 */
export function generateSecureRandomToken(byteLength = 16): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Validates and retrieves the required Telegram environment configuration.
 * Fails closed if any required secret is missing.
 */
export function getValidatedTelegramEnv(env: Env): {
	botToken: string;
	chatId: string;
	allowedUserIds: Set<string>;
	webhookSecret: string;
	ttlHours: number;
} {
	if (!env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN.trim().length === 0) {
		throw new Error("TELEGRAM_BOT_TOKEN is not configured in environment.");
	}
	const normalizedBotToken = normalizeBotToken(env.TELEGRAM_BOT_TOKEN);
	if (!normalizedBotToken) {
		throw new Error("TELEGRAM_BOT_TOKEN is invalid or empty after normalization.");
	}

	if (!env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT_ID.trim().length === 0) {
		throw new Error("TELEGRAM_CHAT_ID is not configured in environment.");
	}
	const normalizedChatId = env.TELEGRAM_CHAT_ID.trim().replace(/^["']+|["']+$/g, "").trim();
	if (!normalizedChatId) {
		throw new Error("TELEGRAM_CHAT_ID is empty after normalization.");
	}

	if (!env.TELEGRAM_ALLOWED_USER_IDS || env.TELEGRAM_ALLOWED_USER_IDS.trim().length === 0) {
		throw new Error("TELEGRAM_ALLOWED_USER_IDS is not configured in environment.");
	}
	const cleanedAllowedUsersRaw = env.TELEGRAM_ALLOWED_USER_IDS.trim().replace(/^["']+|["']+$/g, "").trim();

	if (!env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET.trim().length === 0) {
		throw new Error("TELEGRAM_WEBHOOK_SECRET is not configured in environment.");
	}
	const normalizedWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET.trim().replace(/^["']+|["']+$/g, "").trim();
	if (!normalizedWebhookSecret) {
		throw new Error("TELEGRAM_WEBHOOK_SECRET is empty after normalization.");
	}

	const allowedUserIds = new Set(
		cleanedAllowedUsersRaw.split(",")
			.map((id) => id.trim().replace(/^["']+|["']+$/g, "").trim())
			.filter((id) => id.length > 0)
	);

	if (allowedUserIds.size === 0) {
		throw new Error("TELEGRAM_ALLOWED_USER_IDS contains no valid user IDs.");
	}

	let ttlHours = DEFAULT_APPROVAL_TTL_HOURS;
	if (env.TELEGRAM_APPROVAL_TTL_HOURS) {
		const parsed = parseInt(String(env.TELEGRAM_APPROVAL_TTL_HOURS).trim().replace(/^["']+|["']+$/g, "").trim(), 10);
		if (!isNaN(parsed) && parsed > 0) {
			ttlHours = parsed;
		}
	}

	return {
		botToken: normalizedBotToken,
		chatId: normalizedChatId,
		allowedUserIds,
		webhookSecret: normalizedWebhookSecret,
		ttlHours,
	};
}

/**
 * Orchestrates sending carousel slide previews and approval controls to the editorial Telegram chat.
 * Idempotently handles existing notifications and guarantees atomic status transitions.
 */
export async function notifyEditorForStoredPost(
	env: Env,
	options: NotifyEditorOptions
): Promise<NotifyEditorResult> {
	if (!options || typeof options.postId !== "string" || !UUID_REGEX.test(options.postId)) {
		throw new Error(`Invalid or missing post ID: ${options?.postId}`);
	}

	const postId = options.postId;
	const isDryRun = Boolean(options.dryRun);
	const supabase = getSupabaseClient(env);

	// 1. Fetch Post from PostgreSQL
	const { data: post, error: postError } = await supabase
		.from("social_content_posts")
		.select("*")
		.eq("id", postId)
		.single();

	if (postError || !post) {
		throw new Error(`Stored carousel post not found: ${postId}`);
	}

	// 2. Validate Post State
	if (post.post_status === "approved" || post.post_status === "rejected") {
		throw new Error(`Post has already been decided (${post.post_status}) and cannot be notified.`);
	}

	if (post.post_status !== "stored" && post.post_status !== "pending_approval") {
		throw new Error(`Post must be in 'stored' or 'pending_approval' state (current: '${post.post_status}').`);
	}

	if (post.human_review_required !== true) {
		throw new Error("Post human_review_required flag must be true.");
	}

	// 3. Fetch Slide Assets
	const { data: assets, error: assetsError } = await supabase
		.from("social_content_assets")
		.select("*")
		.eq("post_id", postId)
		.order("slide_number", { ascending: true, nullsFirst: false });

	if (assetsError || !assets) {
		throw new Error(`Failed to retrieve assets for post ${postId}: ${assetsError?.message}`);
	}

	const slideAssets = assets.filter((a) => a.asset_type === "slide" && a.slide_number !== null);

	if (slideAssets.length < 4 || slideAssets.length > 6) {
		throw new Error(`Invalid slide count for post ${postId}: found ${slideAssets.length} slides (expected 4–6).`);
	}

	// 4. Handle Dry Run mode (validates post & assets without calling Telegram or mutating DB)
	if (isDryRun) {
		return {
			success: true,
			dry_run: true,
			post_id: postId,
			topic_title: post.topic_title,
			carousel_slide_count: slideAssets.length,
			caption_preview: post.instagram_caption?.slice(0, 200),
		};
	}

	// 5. Validate Telegram Environment Configuration
	const telegramConfig = getValidatedTelegramEnv(env);
	const ttlHours = options.ttlHours && options.ttlHours > 0 ? options.ttlHours : telegramConfig.ttlHours;
	const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

	// 6. Atomically claim notification via database lock to prevent concurrent duplicate albums
	let approvalRequestId: string;
	let existingMediaIds: number[] = [];

	// Attempt atomic database-level lock via claim_editorial_notification RPC
	const { data: claimRpcData, error: claimRpcErr } = await supabase.rpc("claim_editorial_notification", {
		p_post_id: postId,
		p_telegram_chat_id: telegramConfig.chatId,
		p_expires_at: expiresAt,
		p_stale_seconds: 300,
	});

	if (!claimRpcErr && claimRpcData) {
		const claim = claimRpcData as any;
		if (!claim.success) {
			if (claim.error_code === "DELIVERY_UNKNOWN") {
				throw new Error("Post notification status is 'delivery_unknown' due to a previous ambiguous network failure. Manual verification is required before retrying.");
			}
			if (claim.error_code === "ALREADY_DECIDED") {
				throw new Error(`Post approval request was already decided: ${claim.message}`);
			}
			throw new Error(`Failed to claim notification: ${claim.message}`);
		}

		if (!claim.claimed) {
			if (claim.is_already_sent) {
				return {
					success: true,
					is_already_sent: true,
					post_id: postId,
					approval_request_id: claim.approval_request_id,
					telegram_chat_id: telegramConfig.chatId,
					control_message_id: claim.telegram_control_message_id,
					media_message_ids: claim.telegram_media_message_ids,
					expires_at: claim.expires_at,
				};
			}
			return {
				success: true,
				is_already_sent: false,
				post_id: postId,
				approval_request_id: claim.approval_request_id,
				error: claim.error || "NOTIFICATION_IN_PROGRESS: Another notification worker is currently sending this carousel.",
			};
		}

		approvalRequestId = claim.approval_request_id;
		existingMediaIds = Array.isArray(claim.telegram_media_message_ids) ? claim.telegram_media_message_ids : [];
	} else {
		// Fallback for environments without claim RPC: atomic conditional claim with database constraints
		const { data: existingRequest } = await supabase
			.from("social_content_approval_requests")
			.select("*")
			.eq("post_id", postId)
			.maybeSingle();

		if (existingRequest) {
			if (existingRequest.decision_status === "approved" || existingRequest.decision_status === "rejected") {
				throw new Error(`Post approval request was already decided: ${existingRequest.decision_status}`);
			}

			if (existingRequest.notification_status === "sent") {
				return {
					success: true,
					is_already_sent: true,
					post_id: postId,
					approval_request_id: existingRequest.id,
					telegram_chat_id: existingRequest.telegram_chat_id,
					control_message_id: existingRequest.telegram_control_message_id,
					media_message_ids: existingRequest.telegram_media_message_ids,
					expires_at: existingRequest.expires_at,
				};
			}

			if (existingRequest.notification_status === "delivery_unknown") {
				throw new Error("Post notification status is 'delivery_unknown' due to a previous ambiguous network failure. Manual verification is required before retrying.");
			}

			if (existingRequest.notification_status === "sending") {
				const updatedAtMs = new Date(existingRequest.updated_at || existingRequest.created_at || Date.now()).getTime();
				const ageMs = Date.now() - updatedAtMs;
				if (ageMs < 5 * 60 * 1000) {
					return {
						success: true,
						is_already_sent: false,
						post_id: postId,
						approval_request_id: existingRequest.id,
						error: "NOTIFICATION_IN_PROGRESS: Another notification worker is currently sending this carousel.",
					};
				}
			}

			// Atomic conditional update: only update if not actively sending within stale window
			const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
			const { data: updatedReq, error: updateErr } = await supabase
				.from("social_content_approval_requests")
				.update({
					notification_status: "sending",
					telegram_chat_id: telegramConfig.chatId,
					expires_at: expiresAt,
					updated_at: new Date().toISOString(),
				})
				.eq("id", existingRequest.id)
				.or(`notification_status.neq.sending,updated_at.lt.${staleThreshold}`)
				.select("id, telegram_media_message_ids")
				.maybeSingle();

			if (updateErr || !updatedReq) {
				return {
					success: true,
					is_already_sent: false,
					post_id: postId,
					approval_request_id: existingRequest.id,
					error: "NOTIFICATION_IN_PROGRESS: Another notification worker is currently sending this carousel.",
				};
			}

			approvalRequestId = updatedReq.id;
			existingMediaIds = Array.isArray(updatedReq.telegram_media_message_ids) ? updatedReq.telegram_media_message_ids : [];
		} else {
			// First-time insert: guarded by UNIQUE (post_id) constraint in PostgreSQL
			const { data: newReq, error: reqErr } = await supabase
				.from("social_content_approval_requests")
				.insert({
					post_id: postId,
					notification_status: "sending",
					decision_status: "pending",
					telegram_chat_id: telegramConfig.chatId,
					expires_at: expiresAt,
				})
				.select("id")
				.single();

			if (reqErr || !newReq) {
				const { data: concurrentReq } = await supabase
					.from("social_content_approval_requests")
					.select("*")
					.eq("post_id", postId)
					.maybeSingle();

				if (concurrentReq) {
					return {
						success: true,
						is_already_sent: concurrentReq.notification_status === "sent",
						post_id: postId,
						approval_request_id: concurrentReq.id,
						control_message_id: concurrentReq.telegram_control_message_id,
						media_message_ids: concurrentReq.telegram_media_message_ids,
						expires_at: concurrentReq.expires_at,
						error: concurrentReq.notification_status === "sending"
							? "NOTIFICATION_IN_PROGRESS: Concurrent notification attempt detected."
							: undefined,
					};
				}

				throw new Error(`Failed to create approval request in database: ${reqErr?.message}`);
			}
			approvalRequestId = newReq.id;
			existingMediaIds = [];
		}
	}

	// 8. Generate one-time secure random tokens for Approve and Reject
	const approveToken = generateSecureRandomToken(16);
	const rejectToken = generateSecureRandomToken(16);

	const approveTokenHash = await calculateSha256(approveToken);
	const rejectTokenHash = await calculateSha256(rejectToken);

	// Remove any previous unconsumed action tokens for this request before inserting fresh ones
	await supabase
		.from("social_content_approval_actions")
		.delete()
		.eq("approval_request_id", approvalRequestId);

	const { error: actionsErr } = await supabase
		.from("social_content_approval_actions")
		.insert([
			{
				approval_request_id: approvalRequestId,
				action: "approve",
				token_hash: approveTokenHash,
			},
			{
				approval_request_id: approvalRequestId,
				action: "reject",
				token_hash: rejectTokenHash,
			},
		]);

	if (actionsErr) {
		throw new Error(`Failed to register approval callback tokens: ${actionsErr.message}`);
	}

	// 9. Download Slide PNG bytes from Supabase Storage
	let mediaMessageIds: number[] = existingMediaIds;

	// If media album was not already sent in a previous partial attempt, send it now
	if (!mediaMessageIds || mediaMessageIds.length === 0) {
		const mediaItems: TelegramMediaItem[] = [];

		for (const slide of slideAssets) {
			const { data: fileData, error: downloadError } = await supabase.storage
				.from(slide.storage_bucket)
				.download(slide.storage_path);

			if (downloadError || !fileData) {
				throw new Error(`Failed to download slide ${slide.slide_number} from Supabase Storage: ${downloadError?.message}`);
			}

			const bytes = new Uint8Array(await fileData.arrayBuffer());
			mediaItems.push({
				filename: `slide-${String(slide.slide_number).padStart(2, "0")}.png`,
				bytes,
				mimeType: "image/png",
			});
		}

		// Send carousel album via sendMediaGroup
		try {
			const albumResult = await sendMediaGroup(telegramConfig.botToken, telegramConfig.chatId, mediaItems);
			mediaMessageIds = albumResult.message_ids;

			// Record media_sent checkpoint in database
			await supabase
				.from("social_content_approval_requests")
				.update({
					notification_status: "media_sent",
					telegram_media_message_ids: mediaMessageIds,
					last_error_code: null,
					updated_at: new Date().toISOString(),
				})
				.eq("id", approvalRequestId);
		} catch (err: any) {
			const isTimeout =
				err.name === "TimeoutError" ||
				err.message?.toLowerCase().includes("timeout") ||
				err.message?.toLowerCase().includes("abort");

			await supabase
				.from("social_content_approval_requests")
				.update({
					notification_status: isTimeout ? "delivery_unknown" : "failed",
					last_error_code: isTimeout ? "MEDIA_ALBUM_TIMEOUT" : "MEDIA_ALBUM_SEND_FAILED",
					updated_at: new Date().toISOString(),
				})
				.eq("id", approvalRequestId);

			throw new Error(`Telegram slide album delivery failed: ${err.message}`);
		}
	}

	// 10. Format and send the separate editorial control message with inline buttons
	const safeTopic = escapeTelegramHtml(post.topic_title || "Untitled Topic");
	const safeDomain = escapeTelegramHtml(post.legal_domain || "General Legal");
	const safeJurisdiction = escapeTelegramHtml(post.jurisdiction || "India");
	const captionExcerpt = post.instagram_caption
		? escapeTelegramHtml(
				post.instagram_caption.length > 250
					? `${post.instagram_caption.slice(0, 247)}...`
					: post.instagram_caption
		  )
		: "<i>No caption provided</i>";

	const controlText = [
		"<b>LAWBRIEFLY — EDITORIAL REVIEW</b>",
		"",
		`<b>Topic:</b> ${safeTopic}`,
		`<b>Legal domain:</b> ${safeDomain}`,
		`<b>Jurisdiction:</b> ${safeJurisdiction}`,
		`<b>Slides:</b> ${slideAssets.length} slides`,
		"<b>Status:</b> Awaiting editorial approval.",
		"",
		"<b>Caption preview:</b>",
		`<i>${captionExcerpt}</i>`,
		"",
		"Please review the complete carousel album above before making a decision.",
		`<b>Approval expires:</b> <code>${expiresAt}</code>`,
	].join("\n");

	const inlineKeyboard = {
		inline_keyboard: [
			[
				{ text: "✅ APPROVE", callback_data: `a:${approveToken}` },
				{ text: "❌ REJECT", callback_data: `r:${rejectToken}` },
			],
		],
	};

	let controlMessageId: number;
	try {
		const controlResult = await sendMessage(telegramConfig.botToken, telegramConfig.chatId, controlText, {
			parse_mode: "HTML",
			reply_markup: inlineKeyboard,
		});
		controlMessageId = controlResult.message_id;
	} catch (err: any) {
		const isTimeout =
			err.name === "TimeoutError" ||
			err.message?.toLowerCase().includes("timeout") ||
			err.message?.toLowerCase().includes("abort");

		// If media album was already sent, preserve media_sent status so retry does not resend the album!
		const nextStatus = mediaMessageIds.length > 0 ? "media_sent" : isTimeout ? "delivery_unknown" : "failed";

		await supabase
			.from("social_content_approval_requests")
			.update({
				notification_status: nextStatus,
				last_error_code: isTimeout ? "CONTROL_MESSAGE_TIMEOUT" : "CONTROL_MESSAGE_SEND_FAILED",
				updated_at: new Date().toISOString(),
			})
			.eq("id", approvalRequestId);

		throw new Error(`Telegram control message delivery failed: ${err.message}`);
	}

	// 11. Finalize database state upon 100% successful delivery
	const completedAt = new Date().toISOString();

	// Update approval request to 'sent' and clear any previous error codes
	await supabase
		.from("social_content_approval_requests")
		.update({
			notification_status: "sent",
			telegram_control_message_id: controlMessageId,
			last_error_code: null,
			sent_at: completedAt,
			updated_at: completedAt,
		})
		.eq("id", approvalRequestId);

	// Update post status to 'pending_approval' (human_review_required remains true)
	await supabase
		.from("social_content_posts")
		.update({
			post_status: "pending_approval",
			updated_at: completedAt,
		})
		.eq("id", postId);

	// Record audit event in social_content_approval_events
	await supabase.from("social_content_approval_events").insert({
		approval_request_id: approvalRequestId,
		post_id: postId,
		event_type: "notification_sent",
		telegram_chat_id: telegramConfig.chatId,
		telegram_message_id: controlMessageId,
		details: {
			media_message_ids: mediaMessageIds,
			slide_count: slideAssets.length,
			expires_at: expiresAt,
			sent_at: completedAt,
		},
		created_at: completedAt,
	});

	return {
		success: true,
		post_id: postId,
		approval_request_id: approvalRequestId,
		telegram_chat_id: telegramConfig.chatId,
		control_message_id: controlMessageId,
		media_message_ids: mediaMessageIds,
		expires_at: expiresAt,
	};
}

/**
 * Processes an incoming Telegram callback query update from the webhook.
 * Enforces allowlist, verifies one-time token hash, executes atomic state transition,
 * answers callback query, and updates the Telegram message.
 */
export async function processTelegramCallback(
	update: TelegramUpdate,
	env: Env,
	ctx?: ExecutionContext
): Promise<ProcessCallbackResult> {
	if (!update || !update.callback_query) {
		console.warn("[Telegram Approval Stage 1] Update rejected: missing callback_query object.");
		return { success: false, error_code: "NO_CALLBACK_QUERY", error: "Update contains no callback_query." };
	}

	const cb = update.callback_query;
	const callbackQueryId = cb.id;
	const data = cb.data || "";
	const fromUser = cb.from;
	const message = cb.message;

	const telegramConfig = getValidatedTelegramEnv(env);

	// 1. Validate callback data format: "a:<token>" or "r:<token>"
	const match = data.match(/^([ar]):([0-9a-fA-F]{16,64})$/);
	if (!match) {
		console.warn(`[Telegram Webhook] Rejected malformed callback data (query_id: ${callbackQueryId || "unknown"})`);

		if (callbackQueryId) {
			await answerCallbackQuery(telegramConfig.botToken, callbackQueryId, {
				text: "Invalid callback query format.",
				show_alert: true,
			}).catch(() => {});
		}
		return { success: false, error_code: "INVALID_CALLBACK_DATA", error: "Callback data is malformed." };
	}

	const actionPrefix = match[1];
	const rawToken = match[2];
	const action: "approve" | "reject" = actionPrefix === "a" ? "approve" : "reject";

	// 2. Editor Allowlist Check (numeric Telegram user ID)
	const numericUserIdStr = String(fromUser.id);
	const isAuthorized = telegramConfig.allowedUserIds.has(numericUserIdStr);

	if (!isAuthorized) {
		console.warn(`[Telegram Webhook] Rejected unauthorized editor (user_id: ${numericUserIdStr})`);

		if (callbackQueryId) {
			await answerCallbackQuery(telegramConfig.botToken, callbackQueryId, {
				text: "Unauthorized: You do not have permission to review this post.",
				show_alert: true,
			}).catch(() => {});
		}
		return {
			success: false,
			error_code: "UNAUTHORIZED_USER",
			error: `User ID ${numericUserIdStr} is not in TELEGRAM_ALLOWED_USER_IDS.`,
		};
	}

	// 3. Chat ID Match Check
	const chatMatch = !message?.chat?.id || String(message.chat.id) === telegramConfig.chatId;

	if (!chatMatch) {
		console.warn("[Telegram Webhook] Rejected callback from mismatched chat ID");

		if (callbackQueryId) {
			await answerCallbackQuery(telegramConfig.botToken, callbackQueryId, {
				text: "Unauthorized: Message is from an unrecognized chat.",
				show_alert: true,
			}).catch(() => {});
		}
		return {
			success: false,
			error_code: "CHAT_ID_MISMATCH",
			error: "Telegram chat ID does not match configured TELEGRAM_CHAT_ID.",
		};
	}

	// 4. Compute SHA-256 token hash (never log raw token)
	const tokenHash = await calculateSha256(rawToken);
	const supabase = getSupabaseClient(env);
	const username = fromUser.username ? `@${fromUser.username}` : fromUser.first_name || numericUserIdStr;

	// 5. Execute Atomic Decision Transition
	let rawRpcResult: any = null;
	let rpcError: any = null;

	try {
		const res = await supabase.rpc("process_editorial_approval_decision", {
			p_token_hash: tokenHash,
			p_action: action,
			p_telegram_user_id: numericUserIdStr,
			p_telegram_username: username,
			p_telegram_chat_id: telegramConfig.chatId,
			p_telegram_message_id: message?.message_id || null,
			p_telegram_update_id: update.update_id || null,
			p_telegram_callback_query_id: callbackQueryId || null,
		});
		rawRpcResult = res.data;
		rpcError = res.error;
	} catch (err: any) {
		rpcError = { message: err?.message || String(err), code: "RPC_THROWN_EXCEPTION" };
	}

	let rpcResult = rawRpcResult;
	if (typeof rawRpcResult === "string") {
		try {
			rpcResult = JSON.parse(rawRpcResult);
		} catch {
			// keep raw string if not JSON
		}
	}

	let decisionSuccess = false;
	let postId = "";
	let approvalRequestId = "";
	let errorCode = "";
	let errorMessage = "";
	let isDuplicate = false;
	let decisionStatus: "approved" | "rejected" | undefined;

	if (rpcError) {
		// Fallback only if the stored procedure does not exist in the schema cache (e.g. unmocked test fixtures)
		const isFunctionMissing =
			rpcError.code === "PGRST202" ||
			rpcError.message?.toLowerCase().includes("function") ||
			rpcError.message?.toLowerCase().includes("does not exist");

		if (isFunctionMissing) {
			console.warn("[Telegram Webhook] Stored procedure missing from schema; executing direct table fallback.");
			// Check for duplicate callback query in events table (global deduplication)
			if (callbackQueryId) {
				const { data: existingEvent } = await supabase
					.from("social_content_approval_events")
					.select("*, social_content_approval_requests(*)")
					.eq("telegram_callback_query_id", callbackQueryId)
					.maybeSingle();

				if (existingEvent) {
					const req = existingEvent.social_content_approval_requests;
					isDuplicate = true;
					decisionSuccess = true;
					postId = existingEvent.post_id;
					approvalRequestId = existingEvent.approval_request_id;
					decisionStatus = req?.decision_status || (action === "approve" ? "approved" : "rejected");
					errorMessage = "Callback query already processed (idempotent duplicate)";
				}
			}

			if (!isDuplicate) {
				const { data: actionRow } = await supabase
					.from("social_content_approval_actions")
					.select("*, social_content_approval_requests(*)")
					.eq("token_hash", tokenHash)
					.maybeSingle();

				if (!actionRow) {
					errorCode = "TOKEN_NOT_FOUND";
					errorMessage = "Approval action token not found in database.";
				} else if (actionRow.action !== action) {
					errorCode = "ACTION_MISMATCH";
					errorMessage = "Action does not match token action.";
				} else if (actionRow.consumed_at !== null) {
					errorCode = "TOKEN_ALREADY_CONSUMED";
					errorMessage = "Callback token has already been consumed.";
					const req = actionRow.social_content_approval_requests;
					if (req) {
						decisionStatus = req.decision_status;
					}
				} else {
					const req = actionRow.social_content_approval_requests;
					if (!req || req.decision_status !== "pending") {
						errorCode = "ALREADY_DECIDED";
						errorMessage = `Request already decided: ${req?.decision_status || "unknown"}`;
						if (req) {
							decisionStatus = req.decision_status;
						}
					} else if (new Date(req.expires_at).getTime() <= Date.now()) {
						errorCode = "REQUEST_EXPIRED";
						errorMessage = "Approval request has expired.";
						await supabase
							.from("social_content_approval_requests")
							.update({ decision_status: "expired" })
							.eq("id", req.id);
					} else {
						const now = new Date().toISOString();
						const targetStatus = action === "approve" ? "approved" : "rejected";

						// Consume action token
						await supabase
							.from("social_content_approval_actions")
							.update({ consumed_at: now })
							.eq("id", actionRow.id);

						// Update approval request
						await supabase
							.from("social_content_approval_requests")
							.update({
								decision_status: targetStatus,
								decided_at: now,
								decided_by_telegram_user_id: numericUserIdStr,
								decided_by_username: username,
								last_error_code: null,
								updated_at: now,
							})
							.eq("id", req.id);

						// Update post status
						await supabase
							.from("social_content_posts")
							.update({
								post_status: targetStatus,
								updated_at: now,
							})
							.eq("id", req.post_id);

						// Insert event
						await supabase.from("social_content_approval_events").insert({
							approval_request_id: req.id,
							post_id: req.post_id,
							event_type: `decision_${targetStatus}`,
							telegram_update_id: update.update_id || null,
							telegram_callback_query_id: callbackQueryId,
							telegram_user_id: numericUserIdStr,
							telegram_username: username,
							telegram_chat_id: telegramConfig.chatId,
							telegram_message_id: message?.message_id || null,
							details: { action, previous_status: "pending_approval", new_status: targetStatus },
							created_at: now,
						});

						decisionSuccess = true;
						decisionStatus = targetStatus;
						postId = req.post_id;
						approvalRequestId = req.id;
					}
				}
			}
		} else {
			// Real database RPC error is NOT swallowed!
			decisionSuccess = false;
			errorCode = rpcError.code || "RPC_ERROR";
			errorMessage = `Supabase RPC execution failed: ${rpcError.message}`;
			console.error(`[Telegram Webhook] Approval decision RPC failed (code: ${errorCode}): ${errorMessage}`);
		}
	} else if (rpcResult && typeof rpcResult === "object") {
		decisionSuccess = Boolean(rpcResult.success);
		postId = rpcResult.post_id || "";
		approvalRequestId = rpcResult.approval_request_id || "";
		errorCode = rpcResult.error_code || "";
		errorMessage = rpcResult.message || "";
		isDuplicate = Boolean(rpcResult.is_duplicate);
		decisionStatus = rpcResult.decision_status;

		if (!decisionSuccess && errorCode) {
			console.warn(`[Telegram Webhook] Approval decision rejected (code: ${errorCode}): ${errorMessage}`);
		}
	} else {
		console.error("[Telegram Webhook] Supabase RPC returned unexpected empty/null result.");
		errorCode = "EMPTY_RPC_RESULT";
		errorMessage = "Supabase RPC returned an empty result.";
	}

	if (decisionSuccess) {
		console.log(`[Telegram Webhook] Decision recorded: action=${action}, post_id=${postId}, request_id=${approvalRequestId}, decision_status=${decisionStatus || action}`);
	}

	if (isDuplicate) {
		if (callbackQueryId) {
			await answerCallbackQuery(telegramConfig.botToken, callbackQueryId, {
				text: "Already processed (idempotent duplicate).",
				show_alert: false,
			}).catch(() => {});
		}
		if (message?.message_id && message?.chat?.id) {
			await editMessageReplyMarkup(telegramConfig.botToken, message.chat.id, message.message_id, {
				inline_keyboard: [],
			}).catch(() => {});
		}

		// Durable Outbox Delivery Recovery (Task 18.2):
		// If this was an approve action, auto-publish is enabled, but the post was stranded
		// in 'pending' (e.g. because Queue.send() failed on previous attempt or worker was killed),
		// re-attempt Queue.send()!
		let queueJobId: string | undefined;
		let autoPublishDispatched = false;
		if (action === "approve" && postId && env.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL === "true") {
			const { data: strandedPub } = await supabase
				.from("social_content_publications")
				.select("publication_status")
				.eq("post_id", postId)
				.eq("platform", "instagram")
				.maybeSingle();

			if (strandedPub && strandedPub.publication_status === "pending" && env.INSTAGRAM_PUBLISHING_QUEUE) {
				const deterministicJobId = deterministicPublishingJobId(postId);
				try {
					await env.INSTAGRAM_PUBLISHING_QUEUE.send({
						job_id: deterministicJobId,
						post_id: postId,
						approval_request_id: approvalRequestId,
						enqueued_at: new Date().toISOString(),
					});
					autoPublishDispatched = true;
					queueJobId = deterministicJobId;
					console.log(`[Queue Producer] Recovered and enqueued previously stranded post ${postId} on duplicate callback.`);
				} catch (retryErr: any) {
					console.error(`[Queue Producer] Retry Queue.send() failed for post ${postId}:`, retryErr);
					return {
						success: false,
						is_duplicate: true,
						post_id: postId,
						approval_request_id: approvalRequestId,
						action,
						decision_status: decisionStatus || "approved",
						error_code: "QUEUE_ENQUEUE_FAILED",
						error: `Post approved in database but Queue.send() failed: ${retryErr.message}`,
					};
				}
			}
		}

		return {
			success: true,
			is_duplicate: true,
			post_id: postId,
			approval_request_id: approvalRequestId,
			action,
			decision_status: decisionStatus || (action === "approve" ? "approved" : "rejected"),
			auto_publish_dispatched: autoPublishDispatched || undefined,
			queue_job_id: queueJobId,
		};
	}

	if (!decisionSuccess) {
		const isAlreadyDecided = errorCode === "TOKEN_ALREADY_CONSUMED" || errorCode === "ALREADY_DECIDED";
		if (callbackQueryId) {
			const alertMessage = isAlreadyDecided
				? "Notice: This post has already been decided. Actions are closed."
				: `Action rejected: ${errorMessage || errorCode || "Unknown error"}`;

			await answerCallbackQuery(telegramConfig.botToken, callbackQueryId, {
				text: alertMessage,
				show_alert: true,
			}).catch(() => {});
		}

		// If already decided, also remove keyboard from the message so buttons cannot be clicked again
		if (isAlreadyDecided && message?.message_id && message?.chat?.id) {
			await editMessageReplyMarkup(telegramConfig.botToken, message.chat.id, message.message_id, {
				inline_keyboard: [],
			}).catch(() => {});
		}

		return {
			success: false,
			is_already_decided: isAlreadyDecided,
			error_code: errorCode || "DECISION_REJECTED",
			error: errorMessage || "Approval decision could not be processed.",
		};
	}

	// 6. Answer Callback Query to dismiss loading indicator
	if (callbackQueryId) {
		const alertText = action === "approve" ? "✅ Post APPROVED for publication review" : "❌ Post REJECTED by editorial review";
		await answerCallbackQuery(telegramConfig.botToken, callbackQueryId, {
			text: alertText,
			show_alert: false,
		}).catch(() => {});
	}

	// 7. Update Control Message in Telegram: remove keyboard and append outcome
	if (message?.message_id && message?.chat?.id) {
		try {
			const originalText = message.text || "<b>LAWBRIEFLY — EDITORIAL REVIEW</b>";
			const outcomeBanner =
				action === "approve"
					? `\n\n━━━━━━━━━━━━━━━━━━━━\n<b>✅ APPROVED</b> by ${escapeTelegramHtml(username)} at ${new Date().toISOString()}`
					: `\n\n━━━━━━━━━━━━━━━━━━━━\n<b>❌ REJECTED</b> by ${escapeTelegramHtml(username)} at ${new Date().toISOString()}`;

			await editMessageText(
				telegramConfig.botToken,
				message.chat.id,
				message.message_id,
				`${originalText}${outcomeBanner}`,
				{
					parse_mode: "HTML",
					reply_markup: { inline_keyboard: [] },
				}
			);
		} catch (err) {
			// Message edit failure in Telegram does NOT roll back the database decision
			console.warn("Notice: Telegram control message edit failed after successful decision:", err);
		}
	}

	// 8. Automated Instagram Publishing Dispatch (Task 18 & Task 18.2)
	// Triggers ONLY on genuine, first-time successful editorial approval when enabled
	let autoPublishDispatched = false;
	let queueJobId: string | undefined;
	if (
		decisionSuccess &&
		action === "approve" &&
		decisionStatus === "approved" &&
		!isDuplicate &&
		postId &&
		isAutoPublishAllowed(env, postId)
	) {
		// 8.1. Create durable outbox record in social_content_publications (publication_status = 'pending')
		try {
			await recordApprovalPublicationOutbox(supabase, env, postId, approvalRequestId);
		} catch (outboxErr: any) {
			console.error(`[Queue Producer] Failed to record publication outbox for post ${postId}:`, outboxErr);
			return {
				success: false,
				post_id: postId,
				approval_request_id: approvalRequestId,
				decision_status: decisionStatus,
				action,
				error_code: "QUEUE_ENQUEUE_FAILED",
				error: `Approval succeeded but publication outbox failed: ${outboxErr.message}`,
			};
		}

		const deterministicJobId = deterministicPublishingJobId(postId);

		if (env.INSTAGRAM_PUBLISHING_QUEUE && typeof env.INSTAGRAM_PUBLISHING_QUEUE.send === "function") {
			try {
				// Requirement 2: Await Queue.send() before acknowledging successful webhook handling
				await env.INSTAGRAM_PUBLISHING_QUEUE.send({
					job_id: deterministicJobId,
					post_id: postId,
					approval_request_id: approvalRequestId,
					enqueued_at: new Date().toISOString(),
				});
				autoPublishDispatched = true;
				queueJobId = deterministicJobId;
				console.log(`[Queue Producer] Enqueued publishing job for post ${postId} (job_id: ${deterministicJobId})`);
			} catch (err: any) {
				console.error(`[Queue Producer] Queue.send() failed for approved post ${postId}:`, err);
				try {
					await supabase.from("social_content_publications").update({
						error_code: "QUEUE_ENQUEUE_FAILED",
						error_message: err.message || "Failed to enqueue to INSTAGRAM_PUBLISHING_QUEUE",
						updated_at: new Date().toISOString(),
					}).eq("post_id", postId).eq("platform", "instagram");
				} catch {
					// Outbox error record best-effort
				}

				return {
					success: false,
					post_id: postId,
					approval_request_id: approvalRequestId,
					action,
					decision_status: "approved",
					error_code: "QUEUE_ENQUEUE_FAILED",
					error: `Post approved in database but Queue.send() failed: ${err.message}`,
					auto_publish_dispatched: false,
				};
			}
		} else {
			// Fallback if queue binding not present (e.g. standalone test environment)
			autoPublishDispatched = true;
			const publishTask = dispatchAutoPublishOnApproval(env, postId).catch((err) => {
				console.error("[Auto-Publish] Background dispatch error:", err);
			});

			if (ctx && typeof ctx.waitUntil === "function") {
				ctx.waitUntil(publishTask);
			} else {
				await publishTask;
			}
		}
	}

	return {
		success: true,
		post_id: postId,
		approval_request_id: approvalRequestId,
		action,
		decision_status: action === "approve" ? "approved" : "rejected",
		is_duplicate: isDuplicate,
		auto_publish_dispatched: autoPublishDispatched,
		queue_job_id: queueJobId,
	};
}

/**
 * Automates Instagram publishing after successful editorial approval.
 * Invariant guarantees:
 * 1. Only runs when INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL === 'true'.
 * 2. Strictly verifies post_status is 'approved' and human_review_required is true.
 * 3. Enforces CAROUSEL only (slide count 2-10). IMAGE and REEL are never auto-published.
 * 4. Calls publishApprovedCarousel with prepareOnly: false (reuses existing finished container).
 * 5. Publishing failure or timeout NEVER reverses post approval or mutates post_status back.
 */
export async function dispatchAutoPublishOnApproval(
	env: Env,
	postId: string
): Promise<AutoPublishResult> {
	if (env.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL !== "true") {
		return { success: true, skipped: true, reason: "INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL is disabled" };
	}

	const supabase = getSupabaseClient(env);

	// 1. Fetch post and verify approval state
	const { data: post, error: postErr } = await supabase
		.from("social_content_posts")
		.select("*")
		.eq("id", postId)
		.single();

	if (postErr || !post) {
		console.error(`[Auto-Publish] Post not found in database: ${postId}`);
		return { success: false, error: `Post not found: ${postId}` };
	}

	if (post.post_status !== "approved") {
		console.warn(`[Auto-Publish] Post ${postId} is not in 'approved' status (current: '${post.post_status}'). Skipping.`);
		return { success: false, skipped: true, reason: `Post not approved (${post.post_status})` };
	}

	if (post.human_review_required !== true) {
		console.warn(`[Auto-Publish] Post ${postId} human_review_required is not true. Skipping.`);
		return { success: false, skipped: true, reason: "human_review_required is not true" };
	}

	// 2. Strict media_type guard: CAROUSEL only (Task 18 requirement 10)
	const slideCount = Number(post.carousel_slide_count);
	if (isNaN(slideCount) || slideCount < 2 || slideCount > 10) {
		console.warn(`[Auto-Publish] Post ${postId} slide count is ${slideCount}. Automatic publishing restricted to CAROUSEL only.`);
		return { success: false, skipped: true, reason: "Automatic publishing currently restricted to CAROUSEL media type only" };
	}

	// 3. Check existing publication record (idempotency & duplicate prevention)
	const { data: existingPub } = await supabase
		.from("social_content_publications")
		.select("*")
		.eq("post_id", postId)
		.eq("platform", "instagram")
		.maybeSingle();

	if (existingPub) {
		if (existingPub.publication_status === "published" || existingPub.instagram_media_id) {
			console.warn(`[Auto-Publish] Post ${postId} is already published to Instagram. Skipping.`);
			return { success: false, skipped: true, reason: "Post already published" };
		}
		if (existingPub.publication_status === "publishing") {
			console.warn(`[Auto-Publish] Post ${postId} is actively publishing. Skipping duplicate attempt.`);
			return { success: false, skipped: true, reason: "Publishing is already in progress" };
		}
		if (existingPub.publication_status === "unknown") {
			console.warn(`[Auto-Publish] Post ${postId} has publication status 'unknown'. Manual reconciliation required.`);
			return { success: false, skipped: true, reason: "Publication outcome unknown; manual reconciliation required" };
		}
	}

	// 4. Execute internal carousel publishing (never HTTP call to self)
	try {
		console.log(`[Auto-Publish] Executing automated carousel publication for post ${postId}`);
		const result = await instagramPublishing.publishApprovedCarousel(env, postId, { prepareOnly: false });
		console.log(`[Auto-Publish] Automated publication succeeded for post ${postId}: media_id=${result.instagram_media_id}`);
		return { success: true, result };
	} catch (err: any) {
		// Crucial: publishing failure NEVER reverses editorial approval!
		console.error(`[Auto-Publish] Automated publication failed for post ${postId}: ${err.message || err}`);
		return { success: false, error: err.message || "Failed to publish" };
	}
}

/**
 * Development-only handler for POST /api/ai/notify-editor.
 */
export async function handleNotifyEditor(request: Request, env: Env): Promise<Response> {
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

	const contentLength = request.headers.get("Content-Length");
	if (contentLength && parseInt(contentLength, 10) > 256 * 1024) {
		return new Response(JSON.stringify({ error: "Payload Too Large", message: "Request body exceeds 256KB limit" }), {
			status: 413,
			headers: { "Content-Type": "application/json" },
		});
	}

	const contentType = request.headers.get("Content-Type") || "";
	if (!contentType.includes("application/json")) {
		return new Response(JSON.stringify({ error: "Bad Request", message: "Content-Type must be application/json" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: "Bad Request", message: "Malformed JSON payload" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (!body || typeof body !== "object") {
		return new Response(JSON.stringify({ error: "Bad Request", message: "Payload must be a JSON object" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (!body.post_id || typeof body.post_id !== "string" || !UUID_REGEX.test(body.post_id)) {
		return new Response(JSON.stringify({ error: "Bad Request", message: "post_id must be a valid UUID" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	try {
		const result = await notifyEditorForStoredPost(env, {
			postId: body.post_id,
			dryRun: Boolean(body.dry_run),
			ttlHours: typeof body.ttl_hours === "number" ? body.ttl_hours : undefined,
		});

		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		const msg = err.message || "Failed to notify editor";
		const statusCode = msg.includes("not found") ? 404 : msg.includes("already been decided") ? 409 : 500;

		return new Response(JSON.stringify({ error: "Internal Error", message: msg }), {
			status: statusCode,
			headers: { "Content-Type": "application/json" },
		});
	}
}

/**
 * Public webhook handler for POST /api/webhooks/telegram.
 * Authenticates via X-Telegram-Bot-Api-Secret-Token constant-time comparison.
 */
export async function handleTelegramWebhook(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	if (request.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method Not Allowed", status: 405 }), {
			status: 405,
			headers: { "Content-Type": "application/json" },
		});
	}

	// 1. Authenticate Telegram Secret Token Header
	const secretHeader = (request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
	const configuredSecret = (env.TELEGRAM_WEBHOOK_SECRET || "").trim();

	if (!configuredSecret || !timingSafeEqualStrings(secretHeader, configuredSecret)) {
		console.warn("[Telegram Webhook] Authentication failed: invalid secret token header.");
		return new Response(JSON.stringify({ error: "Unauthorized", status: 401 }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	// 2. Validate Request Body Size (bounded to 256KB)
	const contentLength = request.headers.get("Content-Length");
	if (contentLength && parseInt(contentLength, 10) > 256 * 1024) {
		return new Response(JSON.stringify({ error: "Payload Too Large", message: "Webhook body exceeds 256KB limit" }), {
			status: 413,
			headers: { "Content-Type": "application/json" },
		});
	}

	// 3. Validate JSON Content-Type
	const contentType = request.headers.get("Content-Type") || "";
	if (!contentType.includes("application/json")) {
		return new Response(JSON.stringify({ error: "Bad Request", message: "Content-Type must be application/json" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	let update: TelegramUpdate;
	try {
		update = (await request.json()) as TelegramUpdate;
	} catch {
		return new Response(JSON.stringify({ error: "Bad Request", message: "Malformed JSON payload" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (!update || typeof update !== "object") {
		return new Response(JSON.stringify({ error: "Bad Request", message: "Payload must be an update object" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	// 3. Process update
	// If update is not a callback_query (e.g., normal chat message), return 200 OK ignored
	if (!update.callback_query) {
		return new Response(JSON.stringify({ status: "ignored", reason: "unsupported_update_type" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	try {
		const result = await processTelegramCallback(update, env, ctx);
		const httpStatus = (!result.success && result.error_code === "QUEUE_ENQUEUE_FAILED") ? 503 : 200;
		return new Response(JSON.stringify(result), {
			status: httpStatus,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		console.error("[Telegram Webhook] Unhandled error processing Telegram callback query:", err.message || err);
		// Return 200 to Telegram to prevent retry storm on unrecoverable logic errors
		return new Response(JSON.stringify({ success: false, error: err.message || "Failed to process update" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
}

/**
 * Checks whether automated Instagram publishing is permitted for a specific post.
 * Supports:
 * 1. Explicit allowlist: INSTAGRAM_AUTO_PUBLISH_POST_ALLOWLIST (comma-separated post UUIDs or single UUID)
 * 2. Global switch: INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL === "true" (when allowlist is not specified)
 * Guarantees that in controlled live tests, ONLY the designated allowlisted post can publish.
 */
export function isAutoPublishAllowed(env: Env, postId: string): boolean {
	const allowlist = (env as any).INSTAGRAM_AUTO_PUBLISH_POST_ALLOWLIST?.trim();
	if (allowlist) {
		const allowedIds = allowlist.split(",").map((id: string) => id.trim().toLowerCase());
		return allowedIds.includes(postId.toLowerCase());
	}
	return env.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL === "true";
}

/**
 * Generates a deterministic job_id for a given post and approval request.
 * Guarantees that duplicate Telegram callbacks or recovery sweeps generate
 * the identical job identifier, enabling idempotent deduplication across the queue.
 */
export function deterministicPublishingJobId(postId: string, approvalRequestId?: string): string {
	return approvalRequestId ? `publish:${postId}:${approvalRequestId}` : `publish:${postId}`;
}

/**
 * Creates or updates an outbox row in social_content_publications with publication_status = 'pending'.
 * This ensures that if Queue.send() fails or the Worker terminates between approval and enqueueing,
 * the approved post is recorded as 'pending' publication rather than lost.
 */
export async function recordApprovalPublicationOutbox(
	supabase: any,
	env: Env,
	postId: string,
	approvalRequestId?: string
): Promise<void> {
	const { data: post, error: postErr } = await supabase
		.from("social_content_posts")
		.select("*")
		.eq("id", postId)
		.single();

	if (postErr || !post) {
		console.error(`[Outbox] Post ${postId} not found for outbox recording:`, postErr?.message);
		throw new Error(`Post ${postId} not found: ${postErr?.message || "Not found"}`);
	}

	const { data: existingPub, error: pubErr } = await supabase
		.from("social_content_publications")
		.select("*")
		.eq("post_id", postId)
		.eq("platform", "instagram")
		.maybeSingle();

	if (pubErr) {
		console.error(`[Outbox] Error checking existing publication for post ${postId}:`, pubErr.message);
		throw new Error(`Failed to check existing publication: ${pubErr.message}`);
	}

	const now = new Date().toISOString();

	if (!existingPub) {
		const { error: insertErr } = await supabase
			.from("social_content_publications")
			.insert({
				post_id: postId,
				platform: "instagram",
				media_type: "CAROUSEL",
				publication_status: "pending",
				instagram_account_id: env.INSTAGRAM_ACCOUNT_ID || "17841422733573542",
				caption: post.instagram_caption || "LawBriefly update",
				slide_count: Number(post.carousel_slide_count) || 5,
				retry_count: 0,
				created_at: now,
				updated_at: now,
			});

		if (insertErr) {
			console.error("[Outbox] Initial insert into social_content_publications failed:", insertErr.message);
			throw new Error(`Failed to create publication outbox record: ${insertErr.message}`);
		}
	} else if (existingPub.publication_status === "failed") {
		const { error: updateErr } = await supabase
			.from("social_content_publications")
			.update({
				publication_status: "pending",
				error_code: null,
				error_message: null,
				updated_at: now,
			})
			.eq("id", existingPub.id);

		if (updateErr) {
			console.error("[Outbox] Update of failed publication to pending failed:", updateErr.message);
			throw new Error(`Failed to update publication outbox record: ${updateErr.message}`);
		}
	}
}

/**
 * Atomically claims publication work for a post before executing it.
 * Exclusively uses PostgreSQL RPC claim_publication_job with row-level locks (FOR UPDATE).
 * Fails safely without claiming if the atomic RPC is unavailable.
 */
export async function claimPublicationJob(
	supabase: any,
	postId: string,
	staleSeconds = 300
): Promise<{
	claimed: boolean;
	is_already_published?: boolean;
	is_unknown?: boolean;
	in_progress?: boolean;
	publication_id?: string;
	retry_count?: number;
	error_code?: string;
	error?: string;
}> {
	try {
		const res = await supabase.rpc("claim_publication_job", {
			p_post_id: postId,
			p_stale_seconds: staleSeconds,
		});

		if (res.error) {
			console.error(`[Atomic Claim] claim_publication_job RPC error for post ${postId}:`, res.error.message);
			return {
				claimed: false,
				error_code: "ATOMIC_CLAIM_UNAVAILABLE",
				error: `Atomic claim RPC failed: ${res.error.message}`,
			};
		}

		if (res.data) {
			const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
			return {
				claimed: Boolean(data.claimed),
				is_already_published: Boolean(data.is_already_published),
				is_unknown: Boolean(data.is_unknown),
				in_progress: !Boolean(data.claimed) && (Boolean(data.in_progress) || data.error_code === "PUBLISHING_IN_PROGRESS"),
				publication_id: data.publication_id,
				retry_count: data.retry_count,
				error_code: data.error_code,
				error: data.message,
			};
		}

		return {
			claimed: false,
			error_code: "ATOMIC_CLAIM_EMPTY_RESPONSE",
			error: "Atomic claim RPC returned no data",
		};
	} catch (err: any) {
		console.error(`[Atomic Claim] Exception calling claim_publication_job RPC for post ${postId}:`, err.message || err);
		return {
			claimed: false,
			error_code: "ATOMIC_CLAIM_EXCEPTION",
			error: `Atomic claim RPC exception: ${err.message || String(err)}`,
		};
	}
}

/**
 * Sweeps the database for approved posts that were stranded in 'pending' status
 * (e.g. if Queue.send() failed or the worker was interrupted) and enqueues them.
 */
export async function recoverStrandedApprovedPosts(env: Env): Promise<{
	success: boolean;
	checked: number;
	enqueued: number;
	recovered_count: number;
	post_ids: string[];
	errors: string[];
}> {
	if (!env.INSTAGRAM_PUBLISHING_QUEUE) {
		return { success: true, checked: 0, enqueued: 0, recovered_count: 0, post_ids: [], errors: [] };
	}

	const supabase = getSupabaseClient(env);
	const postIds: string[] = [];
	const errors: string[] = [];

	const { data: approvedPosts, error: postErr } = await supabase
		.from("social_content_posts")
		.select("*")
		.eq("post_status", "approved")
		.eq("human_review_required", true);

	if (postErr || !approvedPosts || approvedPosts.length === 0) {
		return { success: true, checked: 0, enqueued: 0, recovered_count: 0, post_ids: [], errors: [] };
	}

	const nowMs = Date.now();
	const STRANDED_THRESHOLD_MS = 60 * 1000;

	for (const post of approvedPosts) {
		if (!isAutoPublishAllowed(env, post.id)) {
			continue;
		}

		const slideCount = Number(post.carousel_slide_count);
		if (isNaN(slideCount) || slideCount < 2 || slideCount > 10) {
			continue;
		}

		const { data: pub } = await supabase
			.from("social_content_publications")
			.select("*")
			.eq("post_id", post.id)
			.eq("platform", "instagram")
			.maybeSingle();

		let isStranded = false;

		if (!pub) {
			isStranded = true;
		} else if (pub.publication_status === "pending") {
			// Bounded recovery sweeps: prevent repeated sweeps from dispatching duplicate jobs indefinitely
			if ((pub.retry_count || 0) >= 3) {
				console.warn(`[Outbox Recovery] Post ${post.id} reached maximum recovery sweeps (3). Skipping duplicate enqueue.`);
				continue;
			}

			const updatedAtMs = new Date(pub.updated_at || pub.created_at || 0).getTime();
			if (nowMs - updatedAtMs > STRANDED_THRESHOLD_MS) {
				isStranded = true;
			}
		}

		if (isStranded) {
			const jobId = deterministicPublishingJobId(post.id);
			try {
				await env.INSTAGRAM_PUBLISHING_QUEUE.send({
					job_id: jobId,
					post_id: post.id,
					enqueued_at: new Date().toISOString(),
				});
				postIds.push(post.id);

				if (pub) {
					await supabase
						.from("social_content_publications")
						.update({
							updated_at: new Date().toISOString(),
							retry_count: (pub.retry_count || 0) + 1,
						})
						.eq("id", pub.id);
				} else {
					await recordApprovalPublicationOutbox(supabase, env, post.id);
				}

				console.log(`[Outbox Recovery] Enqueued stranded approved post ${post.id}`);
			} catch (err: any) {
				errors.push(`Failed to enqueue stranded post ${post.id}: ${err.message}`);
				console.error(`[Outbox Recovery] Failed to enqueue stranded post ${post.id}:`, err);
			}
		}
	}

	return {
		success: errors.length === 0,
		checked: approvedPosts.length,
		enqueued: postIds.length,
		recovered_count: postIds.length,
		post_ids: postIds,
		errors,
	};
}

/**
 * Cloudflare Queue Consumer for Instagram Publishing (Task 18.2).
 * Consumes messages from instagram-publishing-jobs queue:
 * - Atomically claims publication work before executing it.
 * - Reuses existing publishApprovedCarousel().
 * - Acknowledges already-published jobs.
 * - Never blindly retries publication_status = unknown.
 * - Retries only errors proven safe to retry.
 * - Never retries media_publish when its outcome is uncertain.
 * - Handles messages already in publishing state safely.
 */
export async function handleInstagramPublishingQueue(
	batch: MessageBatch<InstagramPublishingJobMessage>,
	env: Env,
	ctx?: ExecutionContext
): Promise<void> {
	const supabase = getSupabaseClient(env);

	for (const message of batch.messages) {
		const startTime = Date.now();
		const body = message.body;
		const postId = body?.post_id;
		const jobId = body?.job_id;
		const messageId = message.id || `msg-${Date.now()}`;
		const attempts = message.attempts || 1;

		logOperationalEvent({
			event: "queue_message_received",
			timestamp: new Date().toISOString(),
			trigger_type: "queue",
			stage: "instagram_publishing_jobs",
			status: "in_progress",
			post_id: postId,
			metadata: {
				message_id: messageId,
				job_id: jobId,
				attempts,
			},
		});

		if (!postId || typeof postId !== "string" || !UUID_REGEX.test(postId)) {
			console.warn(`[Queue Consumer] Acknowledging invalid message payload: ${JSON.stringify(body)}`);
			logOperationalEvent(
				{
					event: "queue_message_failed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					status: "failed",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					error_code: "INVALID_MESSAGE_PAYLOAD",
					error_message: "Message payload missing or invalid post_id UUID",
					metadata: { message_id: messageId, job_id: jobId, is_permanent: true },
				},
				"warn"
			);
			recordQueueFailed();
			message.ack();
			continue;
		}

		// 1. Fetch post and enforce basic invariants
		const { data: post, error: postErr } = await supabase
			.from("social_content_posts")
			.select("*")
			.eq("id", postId)
			.single();

		if (postErr || !post) {
			console.warn(`[Queue Consumer] Post ${postId} not found in database. Acknowledging message.`);
			logOperationalEvent(
				{
					event: "queue_message_failed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					status: "failed",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					error_code: "POST_NOT_FOUND",
					error_message: `Post ${postId} not found in database`,
					metadata: { message_id: messageId, job_id: jobId, is_permanent: true },
				},
				"warn"
			);
			recordQueueFailed();
			message.ack();
			continue;
		}

		if (post.post_status === "published" || post.instagram_media_id) {
			console.log(`[Queue Consumer] Post ${postId} already published. Acknowledging message.`);
			logOperationalEvent({
				event: "queue_message_processed",
				timestamp: new Date().toISOString(),
				trigger_type: "queue",
				stage: "instagram_publishing_jobs",
				status: "success",
				post_id: postId,
				duration_ms: Date.now() - startTime,
				metadata: { message_id: messageId, job_id: jobId, already_published: true },
			});
			recordQueueProcessed();
			message.ack();
			continue;
		}

		if (post.post_status !== "approved" || post.human_review_required !== true) {
			console.warn(`[Queue Consumer] Post ${postId} is not approved or review not required (status: ${post.post_status}). Acknowledging without retry.`);
			logOperationalEvent(
				{
					event: "queue_message_failed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					status: "failed",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					error_code: "POST_NOT_APPROVED",
					error_message: `Post ${postId} is not approved or review not required (status: ${post.post_status})`,
					metadata: { message_id: messageId, job_id: jobId, is_permanent: true },
				},
				"warn"
			);
			recordQueueFailed();
			message.ack();
			continue;
		}

		const slideCount = Number(post.carousel_slide_count);
		if (isNaN(slideCount) || slideCount < 2 || slideCount > 10) {
			console.warn(`[Queue Consumer] Post ${postId} slide count (${slideCount}) is not a carousel. Automatic publishing restricted to CAROUSEL only. Acknowledging.`);
			logOperationalEvent(
				{
					event: "queue_message_failed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					status: "failed",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					error_code: "INVALID_SLIDE_COUNT",
					error_message: `Post ${postId} slide count (${slideCount}) is not a carousel`,
					metadata: { message_id: messageId, job_id: jobId, is_permanent: true },
				},
				"warn"
			);
			recordQueueFailed();
			message.ack();
			continue;
		}

		// Enforce allowlist / auto-publish guard
		if (!isAutoPublishAllowed(env, postId)) {
			console.warn(`[Queue Consumer] Post ${postId} is not in the auto-publish allowlist. Acknowledging message without publishing.`);
			logOperationalEvent(
				{
					event: "queue_message_failed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					status: "failed",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					error_code: "ALLOWLIST_DENIED",
					error_message: `Post ${postId} is not in the auto-publish allowlist`,
					metadata: { message_id: messageId, job_id: jobId, is_permanent: true },
				},
				"warn"
			);
			recordQueueFailed();
			message.ack();
			continue;
		}

		// 2. Atomically claim publication work before executing
		const claim = await claimPublicationJob(supabase, postId);

		if (claim.error_code === "ATOMIC_CLAIM_UNAVAILABLE" || claim.error_code === "ATOMIC_CLAIM_EXCEPTION") {
			console.warn(`[Queue Consumer] Atomic claim RPC unavailable for post ${postId}: ${claim.error}. Retrying message in 30s.`);
			logOperationalEvent({
				event: "queue_message_retried",
				timestamp: new Date().toISOString(),
				trigger_type: "queue",
				stage: "instagram_publishing_jobs",
				post_id: postId,
				duration_ms: Date.now() - startTime,
				error_code: claim.error_code,
				error_message: claim.error,
				metadata: { message_id: messageId, job_id: jobId, retry_delay_seconds: 30, reason: "atomic_claim_unavailable" },
			});
			message.retry({ delaySeconds: 30 });
			continue;
		}

		if (claim.is_already_published) {
			console.log(`[Queue Consumer] Post ${postId} already marked published in publication records. Acknowledging.`);
			logOperationalEvent({
				event: "queue_message_processed",
				timestamp: new Date().toISOString(),
				trigger_type: "queue",
				stage: "instagram_publishing_jobs",
				status: "success",
				post_id: postId,
				duration_ms: Date.now() - startTime,
				metadata: { message_id: messageId, job_id: jobId, already_published: true },
			});
			recordQueueProcessed();
			message.ack();
			continue;
		}

		if (claim.is_unknown) {
			console.warn(`[Queue Consumer] Post ${postId} publication status is 'unknown'. Manual reconciliation required. Never blindly retrying.`);
			logOperationalEvent(
				{
					event: "queue_message_failed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					status: "failed",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					error_code: "UNCERTAIN_OUTCOME_GUARD",
					error_message: `Post ${postId} publication status is unknown; acknowledged to prevent duplicate publishing`,
					metadata: { message_id: messageId, job_id: jobId, is_permanent: true },
				},
				"warn"
			);
			recordQueueFailed();
			message.ack();
			continue;
		}

		if (claim.in_progress) {
			console.warn(`[Queue Consumer] Post ${postId} is currently in progress by another execution. Retrying with delay.`);
			logOperationalEvent({
				event: "queue_message_retried",
				timestamp: new Date().toISOString(),
				trigger_type: "queue",
				stage: "instagram_publishing_jobs",
				post_id: postId,
				duration_ms: Date.now() - startTime,
				error_code: "IN_PROGRESS",
				error_message: `Post ${postId} publication is in progress by another worker isolate`,
				metadata: { message_id: messageId, job_id: jobId, retry_delay_seconds: 60, reason: "in_progress" },
			});
			message.retry({ delaySeconds: 60 });
			continue;
		}

		if (!claim.claimed) {
			console.warn(`[Queue Consumer] Unable to claim publication job for post ${postId}: ${claim.error || claim.error_code}. Acknowledging.`);
			logOperationalEvent(
				{
					event: "queue_message_failed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					status: "failed",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					error_code: claim.error_code || "CLAIM_FAILED",
					error_message: claim.error || "Unable to claim publication job",
					metadata: { message_id: messageId, job_id: jobId, is_permanent: true },
				},
				"warn"
			);
			recordQueueFailed();
			message.ack();
			continue;
		}

		// 3. Execute publishApprovedCarousel internally
		try {
			console.log(`[Queue Consumer] Executing publishApprovedCarousel for post ${postId} (job_id: ${jobId})`);
			const result = await instagramPublishing.publishApprovedCarousel(env, postId, {
				prepareOnly: false,
				claimConfirmed: true,
			});

			if (result.success) {
				const durationMs = Date.now() - startTime;
				logOperationalEvent({
					event: "queue_message_processed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					status: "success",
					post_id: postId,
					duration_ms: durationMs,
					metadata: {
						message_id: messageId,
						job_id: jobId,
						instagram_media_id: result.instagram_media_id,
					},
				});
				recordQueueProcessed();
				message.ack();
				console.log(`[Queue Consumer] Successfully published post ${postId} to Instagram! media_id: ${result.instagram_media_id}`);
			} else {
				logOperationalEvent({
					event: "queue_message_retried",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					error_message: "publishApprovedCarousel returned success=false",
					metadata: { message_id: messageId, job_id: jobId, retry_delay_seconds: 30 },
				});
				message.retry({ delaySeconds: 30 });
			}
		} catch (err: any) {
			const errMsg = err?.message || String(err);
			console.error(`[Queue Consumer] Error publishing post ${postId}: ${errMsg}`);

			// Uncertain outcome: NEVER blindly retry media_publish when outcome is unknown!
			const isUnknownOutcome =
				errMsg.includes("unknown") ||
				errMsg.includes("PUBLISH_TIMEOUT") ||
				errMsg.toLowerCase().includes("ambiguous") ||
				errMsg.toLowerCase().includes("timeout");

			const { data: checkPub } = await supabase
				.from("social_content_publications")
				.select("publication_status")
				.eq("post_id", postId)
				.eq("platform", "instagram")
				.maybeSingle();

			if (isUnknownOutcome || checkPub?.publication_status === "unknown") {
				console.warn(`[Queue Consumer] Post ${postId} outcome is uncertain. Acknowledging message to prevent duplicate Instagram post.`);
				logOperationalEvent(
					{
						event: "queue_message_failed",
						timestamp: new Date().toISOString(),
						trigger_type: "queue",
						stage: "instagram_publishing_jobs",
						status: "failed",
						post_id: postId,
						duration_ms: Date.now() - startTime,
						error_code: "UNCERTAIN_OUTCOME_GUARD",
						error_message: errMsg,
						metadata: { message_id: messageId, job_id: jobId, is_permanent: true },
					},
					"warn"
				);
				recordQueueFailed();
				message.ack();
				continue;
			}

			if (errMsg.includes("already been published") || checkPub?.publication_status === "published") {
				console.log(`[Queue Consumer] Post ${postId} already published. Acknowledging.`);
				logOperationalEvent({
					event: "queue_message_processed",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					status: "success",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					metadata: { message_id: messageId, job_id: jobId, already_published: true },
				});
				recordQueueProcessed();
				message.ack();
				continue;
			}

			if (errMsg.includes("currently in progress")) {
				console.warn(`[Queue Consumer] Post ${postId} currently in progress. Retrying in 60s.`);
				logOperationalEvent({
					event: "queue_message_retried",
					timestamp: new Date().toISOString(),
					trigger_type: "queue",
					stage: "instagram_publishing_jobs",
					post_id: postId,
					duration_ms: Date.now() - startTime,
					error_code: "IN_PROGRESS",
					error_message: errMsg,
					metadata: { message_id: messageId, job_id: jobId, retry_delay_seconds: 60, reason: "in_progress" },
				});
				message.retry({ delaySeconds: 60 });
				continue;
			}

			const isPermanent =
				errMsg.includes("not found") ||
				errMsg.includes("not approved") ||
				errMsg.includes("human_review_required") ||
				errMsg.includes("Invalid slide_count");

			if (isPermanent) {
				console.warn(`[Queue Consumer] Permanent validation failure for post ${postId}. Acknowledging.`);
				logOperationalEvent(
					{
						event: "queue_message_failed",
						timestamp: new Date().toISOString(),
						trigger_type: "queue",
						stage: "instagram_publishing_jobs",
						status: "failed",
						post_id: postId,
						duration_ms: Date.now() - startTime,
						error_code: "PERMANENT_PUBLISHING_FAILURE",
						error_message: errMsg,
						metadata: { message_id: messageId, job_id: jobId, is_permanent: true },
					},
					"warn"
				);
				recordQueueFailed();
				message.ack();
				continue;
			}

			// Transient failure before media_publish: retry with backoff
			console.warn(`[Queue Consumer] Transient error for post ${postId}. Requesting queue retry (delay: 30s).`);
			logOperationalEvent({
				event: "queue_message_retried",
				timestamp: new Date().toISOString(),
				trigger_type: "queue",
				stage: "instagram_publishing_jobs",
				post_id: postId,
				duration_ms: Date.now() - startTime,
				error_code: "TRANSIENT_RETRY",
				error_message: errMsg,
				metadata: { message_id: messageId, job_id: jobId, retry_delay_seconds: 30 },
			});
			message.retry({ delaySeconds: 30 });
		}
	}
}

/**
 * Development-only handler for POST /api/ai/recover-stranded-publications.
 */
export async function handleRecoverStrandedPublications(request: Request, env: Env): Promise<Response> {
	if (env.APP_ENV !== "development" && (env as any).ENVIRONMENT !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	try {
		const result = await recoverStrandedApprovedPosts(env);
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err.message || "Failed to recover stranded posts" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
}
