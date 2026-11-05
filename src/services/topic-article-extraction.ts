import type { Env } from "../index";
import {
	extractArticleById,
	isValidUuid,
} from "./article-extraction";
import type {
	GlobalTopicSelectionResponse,
	SelectedTopic,
} from "./topic-selection";

export const MAX_TOPIC_ARTICLES = 5;
export const MAX_EXTRACTION_CONCURRENCY = 2;

export type SourceDiversityStatus = "multiple_domains" | "single_domain" | "no_sources";

export interface SourceMetrics {
	unique_source_domain_count: number;
	source_diversity_status: SourceDiversityStatus;
}

export interface ExtractedArticleSuccessItem {
	article_id: string;
	success: true;
	original_title: string;
	original_description: string;
	original_url: string;
	last_seen_at: string;
	extracted_title?: string;
	extracted_url?: string;
	content: string;
	content_length: number;
	paragraph_count: number;
	format: "markdown";
	extracted_at: string;
}

export interface ExtractedArticleFailureItem {
	article_id: string;
	success: false;
	error_code: string;
	error: string;
}

export type ExtractedArticleItem =
	| ExtractedArticleSuccessItem
	| ExtractedArticleFailureItem;

export interface TopicArticleExtractionData {
	success: boolean;
	provider: "jina";
	/** Total count of unique article IDs requested after deduplication. Exactly matches articles.length. */
	requested_article_count: number;
	successful_extraction_count: number;
	failed_extraction_count: number;
	source_metrics: SourceMetrics;
	articles: ExtractedArticleItem[];
	error?: string;
}

export type TopicArticleExtractionOutcome =
	| {
			success: true;
			data: TopicArticleExtractionData;
	  }
	| {
			success: false;
			status: number;
			error: string;
			data?: TopicArticleExtractionData;
	  };

/**
 * Normalizes a URL hostname consistently for source domain diversity metrics:
 * 1. Parses the URL safely.
 * 2. Lowercases the hostname.
 * 3. Strips any leading "www.".
 * 4. Ignores URL path, query parameters, port, and credentials.
 */
export function normalizeSourceDomain(rawUrl: string): string {
	if (!rawUrl || typeof rawUrl !== "string") {
		return "unknown";
	}
	try {
		const parsed = new URL(rawUrl.trim());
		return parsed.hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "unknown";
	}
}

/**
 * Redacts known environment secrets from error messages before exposure.
 */
export function sanitizeErrorMessage(message: string, env: Env): string {
	if (!message || typeof message !== "string") {
		return "An unexpected error occurred";
	}

	let sanitized = message;
	const secrets = [
		env.JINA_API_KEY,
		env.OPENROUTER_API_KEY,
		env.GROQ_API_KEY,
		env.SUPABASE_SECRET_KEY,
		env.LAWBRIEFLY_API_KEY,
	];

	for (const secret of secrets) {
		if (secret && typeof secret === "string" && secret.trim().length > 0) {
			sanitized = sanitized.replaceAll(secret.trim(), "[REDACTED]");
		}
	}

	return sanitized;
}

/**
 * Executes async tasks with a strict concurrency limit while preserving original index order.
 * Guarantees that at most `limit` tasks run simultaneously.
 */
export async function runWithConcurrencyLimit<T, R>(
	items: T[],
	limit: number,
	taskFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) {
		return [];
	}

	const results = new Array<R>(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const currentIndex = nextIndex++;
			results[currentIndex] = await taskFn(items[currentIndex], currentIndex);
		}
	}

	const workerCount = Math.min(Math.max(1, limit), items.length);
	const workers = Array.from({ length: workerCount }, () => worker());
	await Promise.all(workers);

	return results;
}

/**
 * Classifies an extraction failure into a safe, machine-readable error code.
 */
export function classifyExtractionErrorCode(status: number, errorMessage: string): string {
	const msg = errorMessage.toLowerCase();

	if (status === 404 || msg.includes("not found")) {
		return "ARTICLE_NOT_FOUND";
	}
	if (status === 422 && (msg.includes("unsafe") || msg.includes("invalid") || msg.includes("prohibited"))) {
		return "INVALID_ARTICLE_URL";
	}
	if (status === 504 || msg.includes("timed out") || msg.includes("timeout")) {
		return "JINA_TIMEOUT";
	}
	if (status === 429 || msg.includes("rate limit")) {
		return "JINA_RATE_LIMIT";
	}
	if (msg.includes("supabase database error") || msg.includes("failed to connect to supabase")) {
		return "DATABASE_ERROR";
	}
	if (msg.includes("missing supabase configuration")) {
		return "CONFIGURATION_ERROR";
	}
	if (msg.includes("authentication") || msg.includes("401") || msg.includes("403")) {
		return "JINA_AUTH_ERROR";
	}
	if (msg.includes("quota") || msg.includes("payment required") || status === 402) {
		return "JINA_QUOTA_EXHAUSTED";
	}

	return "EXTRACTION_FAILED";
}

/**
 * Adapts a Mercury-selected topic or GlobalTopicSelectionResponse
 * to extract its supporting Supabase article IDs.
 */
export function extractArticleIdsFromSelection(
	selection: GlobalTopicSelectionResponse | SelectedTopic
): string[] {
	if (!selection || typeof selection !== "object") {
		return [];
	}

	// Case 1: GlobalTopicSelectionResponse
	if ("selected_topic" in selection) {
		if (!selection.selected_topic) {
			return [];
		}
		const articles = selection.selected_topic.supporting_articles;
		if (Array.isArray(articles)) {
			return articles.map((a) => a.article_id).filter((id) => typeof id === "string" && id.trim().length > 0);
		}
		return [];
	}

	// Case 2: SelectedTopic direct
	if ("supporting_articles" in selection && Array.isArray(selection.supporting_articles)) {
		return selection.supporting_articles
			.map((a) => a.article_id)
			.filter((id) => typeof id === "string" && id.trim().length > 0);
	}

	return [];
}

/**
 * Orchestrates multi-article extraction for an array of Supabase article UUIDs:
 * 1. Validates article ID format (UUID).
 * 2. Deduplicates article IDs while preserving original order.
 * 3. Enforces bounds (non-empty, maximum 5 article IDs).
 * 4. Extracts each article with controlled concurrency (max 2 concurrent Jina extractions).
 * 5. Uses existing single-article extraction service (retrieving authoritative Supabase record & Jina Reader).
 * 6. Preserves original Supabase metadata without mutation.
 * 7. Computes source diversity metrics from successfully extracted articles.
 * 8. Returns individual extraction results and aggregate metrics with partial failure tolerance.
 */
export async function extractTopicArticlesByIds(
	env: Env,
	articleIds: string[]
): Promise<TopicArticleExtractionOutcome> {
	// 1. Array type check
	if (!Array.isArray(articleIds)) {
		return {
			success: false,
			status: 400,
			error: "Invalid parameter: 'article_ids' must be an array of UUID strings",
		};
	}

	// 2. Non-empty check
	if (articleIds.length === 0) {
		return {
			success: false,
			status: 400,
			error: "Invalid parameter: 'article_ids' array cannot be empty",
		};
	}

	// 3. Maximum 5 article IDs check
	if (articleIds.length > MAX_TOPIC_ARTICLES) {
		return {
			success: false,
			status: 400,
			error: `Too many article IDs: maximum ${MAX_TOPIC_ARTICLES} article IDs permitted per request`,
		};
	}

	// 4. Validate every UUID before processing
	for (let i = 0; i < articleIds.length; i++) {
		const id = articleIds[i];
		if (!isValidUuid(id)) {
			return {
				success: false,
				status: 400,
				error: `Invalid article ID at index ${i}: must be a valid UUID string`,
			};
		}
	}

	// 5. Deduplicate while strictly preserving original order
	const seen = new Set<string>();
	const uniqueArticleIds: string[] = [];
	for (const id of articleIds) {
		const cleanId = id.trim();
		if (!seen.has(cleanId)) {
			seen.add(cleanId);
			uniqueArticleIds.push(cleanId);
		}
	}

	// 6. Concurrently extract articles with limit = 2
	const extractionResults = await runWithConcurrencyLimit(
		uniqueArticleIds,
		MAX_EXTRACTION_CONCURRENCY,
		async (id: string): Promise<ExtractedArticleItem> => {
			try {
				const outcome = await extractArticleById(env, id);

				if (!outcome.success) {
					const sanitizedError = sanitizeErrorMessage(outcome.error, env);
					const errorCode = classifyExtractionErrorCode(outcome.status, outcome.error);
					return {
						article_id: id,
						success: false,
						error_code: errorCode,
						error: sanitizedError,
					};
				}

				const { article, extraction } = outcome.data;
				return {
					article_id: article.article_id,
					success: true,
					original_title: article.original_title,
					original_description: article.original_description,
					original_url: article.original_url,
					last_seen_at: article.last_seen_at,
					extracted_title: extraction.extracted_title,
					extracted_url: extraction.extracted_url,
					content: extraction.content,
					content_length: extraction.content_length,
					paragraph_count: extraction.paragraph_count,
					format: "markdown",
					extracted_at: extraction.extracted_at,
				};
			} catch (err: unknown) {
				const rawMsg = err instanceof Error ? err.message : "Unexpected extraction error";
				return {
					article_id: id,
					success: false,
					error_code: "EXTRACTION_FAILED",
					error: sanitizeErrorMessage(rawMsg, env),
				};
			}
		}
	);

	// 7. Calculate source diversity metrics from successfully extracted articles
	const successfulArticles: ExtractedArticleSuccessItem[] = [];
	let failedCount = 0;

	for (const item of extractionResults) {
		if (item.success) {
			successfulArticles.push(item);
		} else {
			failedCount++;
		}
	}

	const uniqueDomains = new Set<string>();
	for (const item of successfulArticles) {
		const domain = normalizeSourceDomain(item.original_url);
		if (domain && domain !== "unknown") {
			uniqueDomains.add(domain);
		}
	}

	const uniqueSourceDomainCount = uniqueDomains.size;
	let sourceDiversityStatus: SourceDiversityStatus;

	if (successfulArticles.length === 0) {
		sourceDiversityStatus = "no_sources";
	} else if (uniqueSourceDomainCount >= 2) {
		sourceDiversityStatus = "multiple_domains";
	} else {
		sourceDiversityStatus = "single_domain";
	}

	const data: TopicArticleExtractionData = {
		success: successfulArticles.length > 0,
		provider: "jina",
		requested_article_count: uniqueArticleIds.length,
		successful_extraction_count: successfulArticles.length,
		failed_extraction_count: failedCount,
		source_metrics: {
			unique_source_domain_count: uniqueSourceDomainCount,
			source_diversity_status: sourceDiversityStatus,
		},
		articles: extractionResults,
	};

	// 8. If every extraction fails, return overall failure response
	if (successfulArticles.length === 0) {
		data.error = "All article extractions failed";
		return {
			success: false,
			status: 502,
			error: "All article extractions failed",
			data,
		};
	}

	return {
		success: true,
		data,
	};
}

/**
 * Adapter helper to extract articles directly from a Mercury selection result.
 */
export async function extractTopicArticlesFromSelection(
	env: Env,
	selection: GlobalTopicSelectionResponse | SelectedTopic
): Promise<TopicArticleExtractionOutcome> {
	const articleIds = extractArticleIdsFromSelection(selection);
	if (articleIds.length === 0) {
		return {
			success: false,
			status: 400,
			error: "No supporting articles found in topic selection",
		};
	}
	return await extractTopicArticlesByIds(env, articleIds);
}

/**
 * HTTP handler for POST /api/ai/extract-topic-articles.
 * Validates request body, rejects arbitrary URL injections,
 * and delegates to extractTopicArticlesByIds.
 */
export async function handleExtractTopicArticles(
	request: Request,
	env: Env
): Promise<Response> {
	// Parse JSON safely
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Invalid request body: must be a valid JSON object",
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Invalid request body: expected a JSON object",
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	// Strict schema validation: accept ONLY the 'article_ids' property and reject all unexpected input fields
	const unexpectedKeys = Object.keys(body).filter((k) => k !== "article_ids");
	if (unexpectedKeys.length > 0) {
		return new Response(
			JSON.stringify({
				success: false,
				error: `Unexpected property '${unexpectedKeys[0]}' in request body: only 'article_ids' is permitted`,
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	// Validate presence of article_ids
	if (!("article_ids" in body)) {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Missing required parameter: 'article_ids'",
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	const articleIds = body.article_ids;
	if (!Array.isArray(articleIds)) {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Invalid parameter: 'article_ids' must be an array of UUID strings",
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	if (articleIds.length === 0) {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Invalid parameter: 'article_ids' array cannot be empty",
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	if (articleIds.length > MAX_TOPIC_ARTICLES) {
		return new Response(
			JSON.stringify({
				success: false,
				error: `Too many article IDs: maximum ${MAX_TOPIC_ARTICLES} article IDs permitted per request`,
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	for (let i = 0; i < articleIds.length; i++) {
		const id = articleIds[i];
		if (!isValidUuid(id)) {
			return new Response(
				JSON.stringify({
					success: false,
					error: `Invalid article ID at index ${i}: must be a valid UUID string`,
				}),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				}
			);
		}
	}

	const outcome = await extractTopicArticlesByIds(env, articleIds as string[]);

	if (!outcome.success) {
		// When data is present (all extractions failed), return the detailed data with the failure status
		if (outcome.data) {
			return new Response(JSON.stringify(outcome.data), {
				status: outcome.status,
				headers: { "Content-Type": "application/json; charset=utf-8" },
			});
		}

		return new Response(
			JSON.stringify({
				success: false,
				error: outcome.error,
			}),
			{
				status: outcome.status,
				headers: { "Content-Type": "application/json; charset=utf-8" },
			}
		);
	}

	return new Response(JSON.stringify(outcome.data), {
		status: 200,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}
