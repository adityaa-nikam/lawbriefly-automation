import type { Env } from "../index";
import { isValidPositiveInteger } from "./lawbriefly";
import { getSupabaseClient } from "./supabase";

export interface NewsArticleSummary {
	id: string;
	title: string;
	description: string;
	url: string;
	last_seen_at: string;
}

export interface NewsBatch {
	batch_number: number;
	article_count: number;
	articles: NewsArticleSummary[];
}

export interface NewsBatchesResponse {
	success: true;
	window_days: number;
	window_basis: "last_seen_at";
	window_start: string;
	window_end: string;
	total_articles: number;
	batch_size: number;
	batch_count: number;
	batches: NewsBatch[];
}

export interface GetNewsBatchesOptions {
	days?: number | string;
	batch_size?: number | string;
	page_size?: number | string;
	limit?: number | string;
	exclude_article_ids?: string[] | Set<string>;
}

export type GetNewsBatchesOutcome =
	| {
			success: true;
			data: NewsBatchesResponse;
	  }
	| {
			success: false;
			status: number;
			error: string;
			details?: string;
	  };

/**
 * Validates that batch_size is an integer between 10 and 20 inclusive.
 */
export function isValidBatchSize(value: unknown): boolean {
	if (typeof value !== "string" && typeof value !== "number") {
		return false;
	}
	const str = String(value).trim();
	if (!isValidPositiveInteger(str)) {
		return false;
	}
	const num = Number(str);
	return Number.isInteger(num) && num >= 10 && num <= 20;
}

/**
 * Retrieves accumulated news articles from Supabase based on the rolling observation
 * window (last_seen_at) and partitions them into batches of 10 to 20 articles.
 */
export async function getNewsBatches(
	env: Env,
	options?: GetNewsBatchesOptions | URLSearchParams
): Promise<GetNewsBatchesOutcome> {
	// 1. Verify service environment configuration
	if (!env || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
		return {
			success: false,
			status: 500,
			error: "Missing service configuration. Supabase environment variables must be defined.",
		};
	}

	// 2. Parse and validate query parameters (defaults: days=3, batch_size=10)
	let parsedDays = 3;
	let parsedBatchSize = 10;
	let parsedLimit: number | undefined = undefined;

	if (options instanceof URLSearchParams) {
		for (const [key, value] of options.entries()) {
			if (key === "days") {
				if (!isValidPositiveInteger(value)) {
					return {
						success: false,
						status: 400,
						error: "Invalid query parameter: 'days' must be a positive integer",
					};
				}
				parsedDays = Number.parseInt(value.trim(), 10);
			} else if (key === "batch_size") {
				if (!isValidBatchSize(value)) {
					return {
						success: false,
						status: 400,
						error: "Invalid query parameter: 'batch_size' must be an integer between 10 and 20 inclusive",
					};
				}
				parsedBatchSize = Number.parseInt(value.trim(), 10);
			} else if (key === "limit") {
				if (!isValidPositiveInteger(value)) {
					return {
						success: false,
						status: 400,
						error: "Invalid query parameter: 'limit' must be a positive integer",
					};
				}
				parsedLimit = Number.parseInt(value.trim(), 10);
			}
		}
	} else if (options) {
		if (options.days !== undefined) {
			const daysStr = String(options.days);
			if (!isValidPositiveInteger(daysStr)) {
				return {
					success: false,
					status: 400,
					error: "Invalid query parameter: 'days' must be a positive integer",
				};
			}
			parsedDays = Number.parseInt(daysStr.trim(), 10);
		}
		if (options.batch_size !== undefined) {
			const batchSizeStr = String(options.batch_size);
			if (!isValidBatchSize(batchSizeStr)) {
				return {
					success: false,
					status: 400,
					error: "Invalid query parameter: 'batch_size' must be an integer between 10 and 20 inclusive",
				};
			}
			parsedBatchSize = Number.parseInt(batchSizeStr.trim(), 10);
		}
		if (options.limit !== undefined) {
			const limitStr = String(options.limit);
			if (!isValidPositiveInteger(limitStr)) {
				return {
					success: false,
					status: 400,
					error: "Invalid query parameter: 'limit' must be a positive integer",
				};
			}
			parsedLimit = Number.parseInt(limitStr.trim(), 10);
		}
	}

	const seenExcludes: Set<string> =
		options && !(options instanceof URLSearchParams) && options.exclude_article_ids
			? options.exclude_article_ids instanceof Set
				? options.exclude_article_ids
				: new Set(options.exclude_article_ids)
			: new Set<string>();

	// 3. Compute rolling UTC observation window based on last_seen_at
	const now = new Date();
	const windowEnd = now.toISOString();
	const windowStartDate = new Date(now.getTime() - parsedDays * 24 * 60 * 60 * 1000);
	const windowStart = windowStartDate.toISOString();

	// 4. Query articles from Supabase sorted deterministically and paged using range()
	let parsedPageSize = 1000;
	if (options instanceof URLSearchParams) {
		const ps = options.get("page_size");
		if (ps && isValidPositiveInteger(ps)) {
			parsedPageSize = Math.max(1, Number.parseInt(ps.trim(), 10));
		}
	} else if (options && options.page_size !== undefined) {
		const psStr = String(options.page_size);
		if (isValidPositiveInteger(psStr)) {
			parsedPageSize = Math.max(1, Number.parseInt(psStr.trim(), 10));
		}
	}

	const rawArticles: unknown[] = [];
	try {
		const supabase = getSupabaseClient(env);
		let from = 0;

		while (true) {
			const to = from + parsedPageSize - 1;
			const result = await supabase
				.from("news_articles")
				.select("id, title, description, url, last_seen_at")
				.gte("last_seen_at", windowStart)
				.lte("last_seen_at", windowEnd)
				.order("last_seen_at", { ascending: false })
				.order("id", { ascending: true })
				.range(from, to);

			if (result.error) {
				return {
					success: false,
					status: 502,
					error: "Database error while retrieving news articles",
					details: "Supabase query on news_articles failed",
				};
			}

			const pageRows = Array.isArray(result.data) ? result.data : [];
			rawArticles.push(...pageRows);

			if (pageRows.length < parsedPageSize) {
				break;
			}

			from += parsedPageSize;
		}
	} catch {
		return {
			success: false,
			status: 502,
			error: "Database error while retrieving news articles",
			details: "Supabase connection error during retrieval",
		};
	}

	// 5. Filter out excluded articles (e.g. recently covered) and apply limit
	let eligibleArticles = rawArticles;
	if (seenExcludes.size > 0) {
		eligibleArticles = eligibleArticles.filter((item) => {
			const rec = item as Record<string, unknown>;
			return !seenExcludes.has(String(rec.id ?? ""));
		});
	}
	if (parsedLimit !== undefined && parsedLimit > 0) {
		eligibleArticles = eligibleArticles.slice(0, parsedLimit);
	}

	// 6. Partition articles into batches
	const totalArticles = eligibleArticles.length;
	const batches: NewsBatch[] = [];

	if (totalArticles > 0) {
		let batchIndex = 0;
		for (let i = 0; i < totalArticles; i += parsedBatchSize) {
			batchIndex++;
			const chunk = eligibleArticles.slice(i, i + parsedBatchSize).map((item) => {
				const rec = item as Record<string, unknown>;
				return {
					id: String(rec.id ?? ""),
					title: String(rec.title ?? ""),
					description: String(rec.description ?? ""),
					url: String(rec.url ?? ""),
					last_seen_at: String(rec.last_seen_at ?? ""),
				};
			});

			batches.push({
				batch_number: batchIndex,
				article_count: chunk.length,
				articles: chunk,
			});
		}
	}

	// 6. Return structured batch response
	const responsePayload: NewsBatchesResponse = {
		success: true,
		window_days: parsedDays,
		window_basis: "last_seen_at",
		window_start: windowStart,
		window_end: windowEnd,
		total_articles: totalArticles,
		batch_size: parsedBatchSize,
		batch_count: batches.length,
		batches,
	};

	return {
		success: true,
		data: responsePayload,
	};
}

/**
 * Handles HTTP requests for GET /api/news/batches.
 */
export async function handleGetNewsBatches(
	env: Env,
	searchParams: URLSearchParams
): Promise<Response> {
	const outcome = await getNewsBatches(env, searchParams);

	if (!outcome.success) {
		const errorBody: Record<string, unknown> = {
			success: false,
			error: outcome.error,
		};
		if (outcome.details) {
			errorBody.details = outcome.details;
		}

		return new Response(JSON.stringify(errorBody), {
			status: outcome.status,
			headers: { "Content-Type": "application/json" },
		});
	}

	return new Response(JSON.stringify(outcome.data), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
