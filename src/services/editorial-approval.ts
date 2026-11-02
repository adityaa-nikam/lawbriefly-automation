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

export interface ProcessCallbackResult {
	success: boolean;
	is_duplicate?: boolean;
	is_already_decided?: boolean;
	post_id?: string;
	approval_request_id?: string;
	action?: "approve" | "reject";
	decision_status?: "approved" | "rejected";
	error_code?: string;
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

	// Update approval request to 'sent'
	await supabase
		.from("social_content_approval_requests")
		.update({
			notification_status: "sent",
			telegram_control_message_id: controlMessageId,
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
	env: Env
): Promise<ProcessCallbackResult> {
	if (!update || !update.callback_query) {
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
	if (!telegramConfig.allowedUserIds.has(numericUserIdStr)) {
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
	if (message?.chat?.id && String(message.chat.id) !== telegramConfig.chatId) {
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

	// 4. Compute SHA-256 token hash
	const tokenHash = await calculateSha256(rawToken);
	const supabase = getSupabaseClient(env);
	const username = fromUser.username ? `@${fromUser.username}` : fromUser.first_name || numericUserIdStr;

	// 5. Execute Atomic Decision Transition
	// First attempt atomic stored procedure: process_editorial_approval_decision
	const { data: rpcResult, error: rpcError } = await supabase.rpc("process_editorial_approval_decision", {
		p_token_hash: tokenHash,
		p_action: action,
		p_telegram_user_id: numericUserIdStr,
		p_telegram_username: username,
		p_telegram_chat_id: telegramConfig.chatId,
		p_telegram_message_id: message?.message_id || null,
		p_telegram_update_id: update.update_id || null,
		p_telegram_callback_query_id: callbackQueryId || null,
	});

	let decisionSuccess = false;
	let postId = "";
	let approvalRequestId = "";
	let errorCode = "";
	let errorMessage = "";
	let isDuplicate = false;
	let decisionStatus: "approved" | "rejected" | undefined;

	if (!rpcError && rpcResult && typeof rpcResult === "object") {
		decisionSuccess = Boolean(rpcResult.success);
		postId = rpcResult.post_id;
		approvalRequestId = rpcResult.approval_request_id;
		errorCode = rpcResult.error_code;
		errorMessage = rpcResult.message;
		isDuplicate = Boolean(rpcResult.is_duplicate);
		decisionStatus = rpcResult.decision_status;
	} else {
		// Fallback for mocked test environments where the RPC function is not mocked or installed
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
		return {
			success: true,
			is_duplicate: true,
			post_id: postId,
			approval_request_id: approvalRequestId,
			action,
			decision_status: decisionStatus || (action === "approve" ? "approved" : "rejected"),
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

	return {
		success: true,
		post_id: postId,
		approval_request_id: approvalRequestId,
		action,
		decision_status: action === "approve" ? "approved" : "rejected",
	};
}

/**
 * Development-only handler for POST /api/ai/notify-editor.
 */
export async function handleNotifyEditor(request: Request, env: Env): Promise<Response> {
	if (env.APP_ENV !== "development") {
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
export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
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
		const result = await processTelegramCallback(update, env);
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		console.error("Error processing Telegram callback query:", err);
		// Return 200 to Telegram to prevent retry storm on unrecoverable logic errors
		return new Response(JSON.stringify({ success: false, error: err.message || "Failed to process update" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
}
