import type { Env } from "../index";
import { getSupabaseClient } from "./supabase";
import {
	extractArticleWithJina,
	validateArticleUrl,
	normalizeUnicodeText,
	type JinaExtractionSuccess,
} from "./jina-reader";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(str: unknown): str is string {
	return typeof str === "string" && UUID_REGEX.test(str.trim());
}

export interface ArticleExtractionResponse {
	success: true;
	provider: "jina";
	article: {
		article_id: string;
		original_title: string;
		original_description: string;
		original_url: string;
		last_seen_at: string;
	};
	extraction: JinaExtractionSuccess;
}

export type ExtractArticleOutcome =
	| {
			success: true;
			data: ArticleExtractionResponse;
	  }
	| {
			success: false;
			status: number;
			error: string;
			details?: string;
	  };

/**
 * Orchestrates full article extraction for a single article by its Supabase UUID.
 * 1. Retrieves the authoritative article record and original source URL from Supabase.
 * 2. Validates the stored URL for security against SSRF / private networks.
 * 3. Invokes Jina Reader API to extract the full readable markdown content.
 * 4. Combines original Supabase metadata with Jina extraction metrics.
 */
export async function extractArticleById(
	env: Env,
	articleId: string
): Promise<ExtractArticleOutcome> {
	// 1. Validate UUID format
	if (!isValidUuid(articleId)) {
		return {
			success: false,
			status: 400,
			error: "Invalid article_id: must be a valid UUID string",
		};
	}

	const cleanArticleId = articleId.trim();

	// 2. Retrieve authoritative article record from Supabase
	let supabase;
	try {
		supabase = getSupabaseClient(env);
	} catch {
		return {
			success: false,
			status: 500,
			error: "Missing Supabase configuration",
		};
	}

	let data: {
		id: string;
		title: string;
		description: string;
		url: string;
		last_seen_at: string;
	} | null = null;

	try {
		const result = await supabase
			.from("news_articles")
			.select("id, title, description, url, last_seen_at")
			.eq("id", cleanArticleId)
			.maybeSingle();

		if (result.error) {
			return {
				success: false,
				status: 502,
				error: "Supabase database error while retrieving article",
			};
		}

		data = result.data;
	} catch {
		return {
			success: false,
			status: 502,
			error: "Failed to connect to Supabase database",
		};
	}

	if (!data) {
		return {
			success: false,
			status: 404,
			error: `Article not found with ID: ${cleanArticleId}`,
		};
	}

	// 3. Security validation on the stored URL
	const urlValidation = validateArticleUrl(data.url);
	if (!urlValidation.valid) {
		return {
			success: false,
			status: 422,
			error: `Stored article URL is invalid or unsafe: ${urlValidation.error}`,
		};
	}

	// 4. Call Jina Reader with the validated original URL
	const extraction = await extractArticleWithJina(data.url, env.JINA_API_KEY);
	if (!extraction.success) {
		return {
			success: false,
			status: extraction.status,
			error: `Article extraction failed: ${extraction.error}`,
			details: extraction.details,
		};
	}

	// 5. Construct successful response object preserving Supabase source provenance
	const responseData: ArticleExtractionResponse = {
		success: true,
		provider: "jina",
		article: {
			article_id: data.id,
			original_title: normalizeUnicodeText(data.title),
			original_description: normalizeUnicodeText(data.description),
			original_url: data.url,
			last_seen_at: data.last_seen_at,
		},
		extraction,
	};

	return {
		success: true,
		data: responseData,
	};
}

/**
 * HTTP handler for POST /api/ai/extract-article.
 * Parses and validates request body, rejecting arbitrary URL injections,
 * and delegates extraction to extractArticleById.
 */
export async function handleExtractArticle(
	request: Request,
	env: Env
): Promise<Response> {
	// Parse JSON body safely
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

	// Security check: reject arbitrary URLs supplied by the caller
	if ("url" in body || "original_url" in body || "target_url" in body) {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Arbitrary URL properties are not permitted; provide only 'article_id'",
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	// Validate presence of article_id
	const articleId = body.article_id;
	if (typeof articleId !== "string" || !articleId.trim()) {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Missing required parameter: 'article_id'",
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	// Validate UUID format
	if (!isValidUuid(articleId)) {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Invalid parameter: 'article_id' must be a valid UUID string",
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	const outcome = await extractArticleById(env, articleId);

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
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	}

	return new Response(JSON.stringify(outcome.data), {
		status: 200,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}
