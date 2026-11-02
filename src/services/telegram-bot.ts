/**
 * LawBriefly Telegram Bot Service (Task 16)
 * Native Cloudflare Workers client for interacting with the official Telegram Bot API over HTTPS.
 * - Supports multipart sendMediaGroup for carousel slide albums.
 * - Supports sendMessage with inline approval keyboards.
 * - Supports answerCallbackQuery, editMessageText, and editMessageReplyMarkup.
 * - Provides HTML entity escaping, constant-time secret comparison, and token redaction.
 */

export const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

export interface TelegramMediaItem {
	filename: string;
	bytes: Uint8Array;
	mimeType?: string;
	caption?: string;
}

export interface TelegramUser {
	id: number | string;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
}

export interface TelegramChat {
	id: number | string;
	type: "private" | "group" | "supergroup" | "channel";
	title?: string;
	username?: string;
}

export interface TelegramMessage {
	message_id: number;
	from?: TelegramUser;
	chat: TelegramChat;
	date: number;
	text?: string;
}

export interface TelegramCallbackQuery {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	inline_message_id?: string;
	chat_instance?: string;
	data?: string;
}

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
	channel_post?: TelegramMessage;
	edited_channel_post?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
}

export interface TelegramInlineKeyboardButton {
	text: string;
	callback_data: string;
}

export interface TelegramInlineKeyboardMarkup {
	inline_keyboard: TelegramInlineKeyboardButton[][];
}

/**
 * Escapes characters with special meaning in Telegram HTML mode:
 * &, <, >, ", '
 */
export function escapeTelegramHtml(text: string): string {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Redacts bot tokens from error messages and string representations to prevent credential leaks.
 */
export function sanitizeTelegramError(error: unknown, botToken?: string): string {
	const rawMessage = error instanceof Error ? error.message : String(error);
	if (!botToken || botToken.trim().length === 0) {
		return rawMessage;
	}
	return rawMessage.split(botToken).join("[REDACTED_BOT_TOKEN]");
}

export const CONSTANT_TIME_BOUND_BYTES = 256;

/**
 * Performs constant-time comparison between two strings to prevent timing attacks.
 * To ensure execution time does NOT depend on input lengths:
 * - Always iterates for a fixed, bounded number of cycles (CONSTANT_TIME_BOUND_BYTES = 256).
 * - Incorporates the length difference (lenA ^ lenB) directly into the mismatch accumulator.
 * - Flags any input exceeding the bound without short-circuiting.
 */
export function timingSafeEqualStrings(
	a: string | null | undefined,
	b: string | null | undefined,
	fixedBound = CONSTANT_TIME_BOUND_BYTES
): boolean {
	const isStringA = typeof a === "string";
	const isStringB = typeof b === "string";

	const enc = new TextEncoder();
	const bufA = isStringA ? enc.encode(a) : new Uint8Array(0);
	const bufB = isStringB ? enc.encode(b) : new Uint8Array(0);

	const lenA = bufA.byteLength;
	const lenB = bufB.byteLength;

	// Incorporate type validity, length difference, and bound overflow into mismatch
	let mismatch = (isStringA && isStringB ? 0 : 1) | (lenA ^ lenB);
	if (lenA > fixedBound || lenB > fixedBound) {
		mismatch |= 1;
	}

	// Always iterate for exactly fixedBound cycles regardless of input contents or lengths
	for (let i = 0; i < fixedBound; i++) {
		const byteA = i < lenA ? bufA[i] : 0;
		const byteB = i < lenB ? bufB[i] : 0;
		mismatch |= byteA ^ byteB;
	}

	return mismatch === 0;
}

/**
 * Sends a carousel album of 2–10 photos to Telegram using multipart/form-data.
 * Returns the array of sent message_ids on success.
 */
export async function sendMediaGroup(
	botToken: string,
	chatId: string | number,
	mediaItems: TelegramMediaItem[]
): Promise<{ message_ids: number[] }> {
	if (!botToken || botToken.trim().length === 0) {
		throw new Error("TELEGRAM_BOT_TOKEN is missing or empty.");
	}
	if (!chatId) {
		throw new Error("TELEGRAM_CHAT_ID is missing or empty.");
	}
	if (!Array.isArray(mediaItems) || mediaItems.length < 2 || mediaItems.length > 10) {
		throw new Error(`sendMediaGroup requires between 2 and 10 media items (received ${mediaItems?.length || 0}).`);
	}

	const url = `${TELEGRAM_API_BASE}${botToken}/sendMediaGroup`;
	const formData = new FormData();
	formData.append("chat_id", String(chatId));

	const mediaDescriptors: Array<{
		type: "photo";
		media: string;
		caption?: string;
		parse_mode?: "HTML";
	}> = [];

	for (let i = 0; i < mediaItems.length; i++) {
		const item = mediaItems[i];
		const attachKey = `slide_${i + 1}`;
		const blob = new Blob([item.bytes], { type: item.mimeType || "image/png" });
		formData.append(attachKey, blob, item.filename || `slide-${String(i + 1).padStart(2, "0")}.png`);

		const descriptor: {
			type: "photo";
			media: string;
			caption?: string;
			parse_mode?: "HTML";
		} = {
			type: "photo",
			media: `attach://${attachKey}`,
		};

		if (item.caption) {
			descriptor.caption = item.caption;
			descriptor.parse_mode = "HTML";
		}

		mediaDescriptors.push(descriptor);
	}

	formData.append("media", JSON.stringify(mediaDescriptors));

	try {
		const response = await fetch(url, {
			method: "POST",
			body: formData,
			signal: AbortSignal.timeout(30000),
		});

		const text = await response.text();
		let data: any;
		try {
			data = JSON.parse(text);
		} catch {
			throw new Error(`Invalid JSON response from Telegram sendMediaGroup (HTTP ${response.status}): ${text.slice(0, 150)}`);
		}

		if (!response.ok || !data.ok) {
			const errDesc = data.description || `HTTP ${response.status}`;
			throw new Error(`Telegram sendMediaGroup failed (${data.error_code || response.status}): ${errDesc}`);
		}

		if (!Array.isArray(data.result)) {
			throw new Error("Telegram sendMediaGroup returned unexpected response shape: missing result array.");
		}

		const messageIds = data.result.map((m: any) => m.message_id);
		return { message_ids: messageIds };
	} catch (err) {
		throw new Error(sanitizeTelegramError(err, botToken));
	}
}

/**
 * Sends a text message to Telegram, optionally with HTML parsing and inline keyboard markup.
 */
export async function sendMessage(
	botToken: string,
	chatId: string | number,
	text: string,
	options: {
		parse_mode?: "HTML";
		reply_markup?: TelegramInlineKeyboardMarkup;
	} = {}
): Promise<{ message_id: number }> {
	if (!botToken || botToken.trim().length === 0) {
		throw new Error("TELEGRAM_BOT_TOKEN is missing or empty.");
	}
	if (!chatId) {
		throw new Error("TELEGRAM_CHAT_ID is missing or empty.");
	}

	const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
	const payload: any = {
		chat_id: String(chatId),
		text,
	};

	if (options.parse_mode) {
		payload.parse_mode = options.parse_mode;
	}

	if (options.reply_markup) {
		payload.reply_markup = options.reply_markup;
	}

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(15000),
		});

		const textResp = await response.text();
		let data: any;
		try {
			data = JSON.parse(textResp);
		} catch {
			throw new Error(`Invalid JSON response from Telegram sendMessage (HTTP ${response.status}): ${textResp.slice(0, 150)}`);
		}

		if (!response.ok || !data.ok) {
			const errDesc = data.description || `HTTP ${response.status}`;
			throw new Error(`Telegram sendMessage failed (${data.error_code || response.status}): ${errDesc}`);
		}

		if (!data.result || typeof data.result.message_id !== "number") {
			throw new Error("Telegram sendMessage returned unexpected response shape: missing result.message_id.");
		}

		return { message_id: data.result.message_id };
	} catch (err) {
		throw new Error(sanitizeTelegramError(err, botToken));
	}
}

/**
 * Edits the text and optionally inline keyboard markup of an existing Telegram message.
 */
export async function editMessageText(
	botToken: string,
	chatId: string | number,
	messageId: number,
	text: string,
	options: {
		parse_mode?: "HTML";
		reply_markup?: TelegramInlineKeyboardMarkup;
	} = {}
): Promise<void> {
	if (!botToken || botToken.trim().length === 0) {
		throw new Error("TELEGRAM_BOT_TOKEN is missing or empty.");
	}

	const url = `${TELEGRAM_API_BASE}${botToken}/editMessageText`;
	const payload: any = {
		chat_id: String(chatId),
		message_id: messageId,
		text,
	};

	if (options.parse_mode) {
		payload.parse_mode = options.parse_mode;
	}

	if (options.reply_markup !== undefined) {
		payload.reply_markup = options.reply_markup;
	}

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(15000),
		});

		const textResp = await response.text();
		let data: any;
		try {
			data = JSON.parse(textResp);
		} catch {
			throw new Error(`Invalid JSON response from Telegram editMessageText (HTTP ${response.status})`);
		}

		if (!response.ok || !data.ok) {
			const errDesc = data.description || `HTTP ${response.status}`;
			throw new Error(`Telegram editMessageText failed (${data.error_code || response.status}): ${errDesc}`);
		}
	} catch (err) {
		throw new Error(sanitizeTelegramError(err, botToken));
	}
}

/**
 * Modifies only the inline keyboard markup of an existing Telegram message.
 * Passing empty array removes the keyboard entirely.
 */
export async function editMessageReplyMarkup(
	botToken: string,
	chatId: string | number,
	messageId: number,
	replyMarkup: TelegramInlineKeyboardMarkup = { inline_keyboard: [] }
): Promise<void> {
	if (!botToken || botToken.trim().length === 0) {
		throw new Error("TELEGRAM_BOT_TOKEN is missing or empty.");
	}

	const url = `${TELEGRAM_API_BASE}${botToken}/editMessageReplyMarkup`;
	const payload = {
		chat_id: String(chatId),
		message_id: messageId,
		reply_markup: replyMarkup,
	};

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(15000),
		});

		const textResp = await response.text();
		let data: any;
		try {
			data = JSON.parse(textResp);
		} catch {
			throw new Error(`Invalid JSON response from Telegram editMessageReplyMarkup (HTTP ${response.status})`);
		}

		if (!response.ok || !data.ok) {
			const errDesc = data.description || `HTTP ${response.status}`;
			throw new Error(`Telegram editMessageReplyMarkup failed (${data.error_code || response.status}): ${errDesc}`);
		}
	} catch (err) {
		throw new Error(sanitizeTelegramError(err, botToken));
	}
}

/**
 * Answers a Telegram callback query to dismiss the client-side loading spinner
 * and optionally display a notification or alert to the user.
 */
export async function answerCallbackQuery(
	botToken: string,
	callbackQueryId: string,
	options: {
		text?: string;
		show_alert?: boolean;
		cache_time?: number;
	} = {}
): Promise<void> {
	if (!botToken || botToken.trim().length === 0) {
		throw new Error("TELEGRAM_BOT_TOKEN is missing or empty.");
	}
	if (!callbackQueryId) {
		throw new Error("callback_query_id is required.");
	}

	const url = `${TELEGRAM_API_BASE}${botToken}/answerCallbackQuery`;
	const payload: any = {
		callback_query_id: callbackQueryId,
	};

	if (options.text !== undefined) {
		payload.text = options.text;
	}

	if (options.show_alert !== undefined) {
		payload.show_alert = options.show_alert;
	}

	if (options.cache_time !== undefined) {
		payload.cache_time = options.cache_time;
	}

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(15000),
		});

		const textResp = await response.text();
		let data: any;
		try {
			data = JSON.parse(textResp);
		} catch {
			throw new Error(`Invalid JSON response from Telegram answerCallbackQuery (HTTP ${response.status})`);
		}

		if (!response.ok || !data.ok) {
			const errDesc = data.description || `HTTP ${response.status}`;
			throw new Error(`Telegram answerCallbackQuery failed (${data.error_code || response.status}): ${errDesc}`);
		}
	} catch (err) {
		throw new Error(sanitizeTelegramError(err, botToken));
	}
}
