import type { Env } from "../index";
import { fetchLawBrieflyNews, isValidPositiveInteger } from "./lawbriefly";
import { getSupabaseClient } from "./supabase";
import { normalizeUnicodeText } from "./jina-reader";

export interface SyncNewsArticlesOptions {
	days?: number | string;
	limit?: number | string;
}

export interface ValidatedArticle {
	title: string;
	description: string;
	url: string;
}

export interface IngestionResult {
	success: boolean;
	message: string;
	source: "lawbriefly";
	fetched_count: number;
	valid_count: number;
	invalid_count: number;
	duplicate_count: number;
	database_affected_count: number;
}

export interface IngestionCounts {
	fetched_count: number;
	valid_count: number;
	invalid_count: number;
	duplicate_count: number;
	database_affected_count: number;
}

export type IngestionOutcome =
	| {
			success: true;
			result: IngestionResult;
	  }
	| {
			success: false;
			error: string;
			status: number;
			details?: string;
			upstream_status?: number;
			counts?: IngestionCounts;
	  };

export interface ScheduledIngestionLog {
	scheduled_time: number;
	cron_expression: string;
	fetched_count: number;
	valid_count: number;
	invalid_count: number;
	duplicate_count: number;
	database_affected_count: number;
	status: "success" | "failed";
	error?: string;
}

const URL_REGEX = /^https?:\/\/[^\s/?#]+([/?#][^\s]*)?$/i;

/**
 * Validates a single article item extracted from LawBriefly API response.
 */
function isValidArticle(item: unknown): item is ValidatedArticle {
	if (!item || typeof item !== "object") {
		return false;
	}

	const article = item as Record<string, unknown>;

	if (typeof article.title !== "string" || !/\S/.test(article.title)) {
		return false;
	}

	if (typeof article.description !== "string" || !/\S/.test(article.description)) {
		return false;
	}

	if (typeof article.url !== "string") {
		return false;
	}

	const trimmedUrl = article.url.trim();
	if (!URL_REGEX.test(trimmedUrl)) {
		return false;
	}

	return true;
}

/**
 * Core news ingestion operation: fetches from LawBriefly, validates,
 * deduplicates within the batch, and upserts into Supabase via RPC.
 */
export async function executeNewsIngestion(
	env: Env,
	days = "1",
	limit = "10"
): Promise<IngestionOutcome> {
	// 1. Verify environment configuration
	if (
		!env ||
		!env.LAWBRIEFLY_API_URL ||
		!env.LAWBRIEFLY_API_KEY ||
		!env.SUPABASE_URL ||
		!env.SUPABASE_SECRET_KEY
	) {
		return {
			success: false,
			error: "Missing service configuration. LawBriefly and Supabase environment variables must be defined.",
			status: 500,
		};
	}

	// 2. Fetch news articles from LawBriefly API
	const upstreamResponse = await fetchLawBrieflyNews(env, { days, limit });
	if (!upstreamResponse.ok) {
		let upstreamError = "Failed to retrieve news from LawBriefly API";
		try {
			const errorBody = (await upstreamResponse.json()) as { error?: string };
			if (errorBody && typeof errorBody.error === "string") {
				upstreamError = errorBody.error;
			}
		} catch {
			// keep default message if body cannot be parsed
		}
		return {
			success: false,
			error: upstreamError,
			status: 502,
			upstream_status: upstreamResponse.status,
		};
	}

	let payload: unknown;
	try {
		payload = await upstreamResponse.json();
	} catch {
		return {
			success: false,
			error: "Invalid JSON response received from LawBriefly API",
			status: 502,
		};
	}

	// 3. Validate upstream response schema
	if (
		!payload ||
		typeof payload !== "object" ||
		(payload as Record<string, unknown>).success !== true ||
		!Array.isArray((payload as Record<string, unknown>).articles)
	) {
		return {
			success: false,
			error: "Unexpected upstream response structure from LawBriefly API",
			status: 502,
		};
	}

	const rawArticles = (payload as { articles: unknown[] }).articles;
	const fetchedCount = rawArticles.length;

	let validCount = 0;
	let invalidCount = 0;
	let duplicateCount = 0;

	// Deterministic deduplication using normalized URL
	const uniqueArticlesMap = new Map<string, ValidatedArticle>();

	for (const rawItem of rawArticles) {
		if (!isValidArticle(rawItem)) {
			invalidCount++;
			continue;
		}

		const normalizedUrl = rawItem.url.trim();

		if (uniqueArticlesMap.has(normalizedUrl)) {
			duplicateCount++;
			continue;
		}

		uniqueArticlesMap.set(normalizedUrl, {
			title: normalizeUnicodeText(rawItem.title.trim()),
			description: normalizeUnicodeText(rawItem.description.trim()),
			url: normalizedUrl,
		});
		validCount++;
	}

	const articlesToIngest = Array.from(uniqueArticlesMap.values());
	let databaseAffectedCount = 0;

	// 4. Save valid articles into Supabase PostgreSQL via RPC function
	if (articlesToIngest.length > 0) {
		try {
			const supabase = getSupabaseClient(env);
			const { data, error } = await supabase.rpc("ingest_news_articles", {
				p_articles: articlesToIngest,
			});

			if (error) {
				return {
					success: false,
					error: "Database error while storing news articles",
					details: "Supabase RPC ingest_news_articles failed",
					status: 502,
					counts: {
						fetched_count: fetchedCount,
						valid_count: validCount,
						invalid_count: invalidCount,
						duplicate_count: duplicateCount,
						database_affected_count: 0,
					},
				};
			}

			databaseAffectedCount = typeof data === "number" ? data : articlesToIngest.length;
		} catch {
			return {
				success: false,
				error: "Database error while storing news articles",
				details: "Supabase connection error during ingestion",
				status: 502,
				counts: {
					fetched_count: fetchedCount,
					valid_count: validCount,
					invalid_count: invalidCount,
					duplicate_count: duplicateCount,
					database_affected_count: 0,
				},
			};
		}
	}

	// 5. Return structured ingestion result
	const result: IngestionResult = {
		success: true,
		message: "News articles successfully synchronized",
		source: "lawbriefly",
		fetched_count: fetchedCount,
		valid_count: validCount,
		invalid_count: invalidCount,
		duplicate_count: duplicateCount,
		database_affected_count: databaseAffectedCount,
	};

	return {
		success: true,
		result,
	};
}

/**
 * Handles HTTP synchronization requests for POST /api/news/sync.
 */
export async function syncNewsArticles(
	env: Env,
	options?: SyncNewsArticlesOptions | URLSearchParams
): Promise<Response> {
	// Parse and validate query parameters (defaults: days=1, limit=10)
	let days = "1";
	let limit = "10";

	if (options instanceof URLSearchParams) {
		for (const [key, value] of options.entries()) {
			if (key === "days") {
				if (!isValidPositiveInteger(value)) {
					return new Response(
						JSON.stringify({
							success: false,
							error: "Invalid query parameter: 'days' must be a positive integer",
						}),
						{
							status: 400,
							headers: { "Content-Type": "application/json" },
						}
					);
				}
				days = value.trim();
			} else if (key === "limit") {
				if (!isValidPositiveInteger(value)) {
					return new Response(
						JSON.stringify({
							success: false,
							error: "Invalid query parameter: 'limit' must be a positive integer",
						}),
						{
							status: 400,
							headers: { "Content-Type": "application/json" },
						}
					);
				}
				limit = value.trim();
			}
		}
	} else if (options) {
		if (options.days !== undefined) {
			const daysStr = String(options.days);
			if (!isValidPositiveInteger(daysStr)) {
				return new Response(
					JSON.stringify({
						success: false,
						error: "Invalid query parameter: 'days' must be a positive integer",
					}),
					{
						status: 400,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			days = daysStr.trim();
		}
		if (options.limit !== undefined) {
			const limitStr = String(options.limit);
			if (!isValidPositiveInteger(limitStr)) {
				return new Response(
					JSON.stringify({
						success: false,
						error: "Invalid query parameter: 'limit' must be a positive integer",
					}),
					{
						status: 400,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			limit = limitStr.trim();
		}
	}

	const outcome = await executeNewsIngestion(env, days, limit);

	if (!outcome.success) {
		const errorBody: Record<string, unknown> = {
			success: false,
			error: outcome.error,
		};
		if (outcome.details) errorBody.details = outcome.details;
		if (outcome.upstream_status) errorBody.upstream_status = outcome.upstream_status;

		return new Response(JSON.stringify(errorBody), {
			status: outcome.status,
			headers: { "Content-Type": "application/json" },
		});
	}

	return new Response(JSON.stringify(outcome.result), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Handles scheduled cron events by executing daily ingestion with default parameters (days=1, limit=10)
 * and safely logging the outcome.
 */
export async function handleScheduledNewsSync(
	controller: ScheduledController,
	env: Env
): Promise<ScheduledIngestionLog> {
	const cronExpression = controller.cron || "30 0 * * *";
	const scheduledTime = controller.scheduledTime;

	try {
		const outcome = await executeNewsIngestion(env, "1", "10");

		if (outcome.success) {
			const logData: ScheduledIngestionLog = {
				scheduled_time: scheduledTime,
				cron_expression: cronExpression,
				fetched_count: outcome.result.fetched_count,
				valid_count: outcome.result.valid_count,
				invalid_count: outcome.result.invalid_count,
				duplicate_count: outcome.result.duplicate_count,
				database_affected_count: outcome.result.database_affected_count,
				status: "success",
			};
			console.log(JSON.stringify(logData));
			return logData;
		} else {
			const logData: ScheduledIngestionLog = {
				scheduled_time: scheduledTime,
				cron_expression: cronExpression,
				fetched_count: outcome.counts?.fetched_count ?? 0,
				valid_count: outcome.counts?.valid_count ?? 0,
				invalid_count: outcome.counts?.invalid_count ?? 0,
				duplicate_count: outcome.counts?.duplicate_count ?? 0,
				database_affected_count: 0,
				status: "failed",
				error: outcome.error,
			};
			console.error(JSON.stringify(logData));
			return logData;
		}
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		const logData: ScheduledIngestionLog = {
			scheduled_time: scheduledTime,
			cron_expression: cronExpression,
			fetched_count: 0,
			valid_count: 0,
			invalid_count: 0,
			duplicate_count: 0,
			database_affected_count: 0,
			status: "failed",
			error: errorMessage,
		};
		console.error(JSON.stringify(logData));
		return logData;
	}
}
