import type { Env } from "../index";

/**
 * Validates whether a given string represents a positive integer (>= 1).
 */
export function isValidPositiveInteger(val: string): boolean {
	const trimmed = val.trim();
	if (!/^\d+$/.test(trimmed)) {
		return false;
	}
	const num = Number(trimmed);
	return Number.isInteger(num) && num > 0;
}

/**
 * Sanitizes strings to ensure secret values are never exposed.
 */
function sanitizeString(str: string, secret?: string): string {
	if (!secret || secret.trim() === "") {
		return str;
	}
	return str.replaceAll(secret, "[REDACTED]");
}

/**
 * Recursively sanitizes details to prevent secret leakage in error payloads.
 */
function sanitizeDetails(details: unknown, secret?: string): unknown {
	if (!secret || secret.trim() === "") {
		return details;
	}
	if (typeof details === "string") {
		return sanitizeString(details, secret);
	}
	if (details instanceof Error) {
		return sanitizeString(details.message, secret);
	}
	if (details !== null && typeof details === "object") {
		try {
			const serialized = JSON.stringify(details);
			if (serialized.includes(secret)) {
				return JSON.parse(serialized.replaceAll(secret, "[REDACTED]"));
			}
		} catch {
			return "[Complex Object]";
		}
	}
	return details;
}

export interface FetchLawBrieflyNewsOptions {
	days?: number | string;
	limit?: number | string;
}

/**
 * Fetches news data from the LawBriefly API.
 * 
 * Handles:
 * - Missing environment configuration (returns 500)
 * - Invalid query parameters (returns 400)
 * - Network connection failures (returns 502)
 * - Network stream failures while reading body (returns 502)
 * - Non-2xx HTTP responses with valid JSON (returns 502 with parsed details)
 * - Non-2xx HTTP responses with invalid JSON / plain text (returns 502 with text details)
 * - Successful 2xx responses with invalid JSON (returns 502)
 * - Successful 2xx responses with valid JSON (returns 200 with raw upstream JSON)
 * 
 * Guarantees every upstream response body is read exactly once.
 */
export async function fetchLawBrieflyNews(
	env: Env,
	options?: FetchLawBrieflyNewsOptions | URLSearchParams
): Promise<Response> {
	if (!env || !env.LAWBRIEFLY_API_URL || !env.LAWBRIEFLY_API_KEY) {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Missing LawBriefly API configuration. LAWBRIEFLY_API_URL and LAWBRIEFLY_API_KEY environment variables must be defined.",
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	let targetUrl: URL;
	try {
		targetUrl = new URL(env.LAWBRIEFLY_API_URL);
	} catch {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Invalid LAWBRIEFLY_API_URL configured. Must be a valid URL.",
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	let days = "7";
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
			} else {
				targetUrl.searchParams.set(key, value);
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

	targetUrl.searchParams.set("days", days);
	targetUrl.searchParams.set("limit", limit);

	try {
		const response = await fetch(targetUrl.toString(), {
			method: "GET",
			headers: {
				"x-api-key": env.LAWBRIEFLY_API_KEY,
				"Accept": "application/json",
				"User-Agent": "LawBriefly-Automation/1.0",
			},
		});

		// Read the upstream response body exactly once
		let rawText: string;
		try {
			rawText = await response.text();
		} catch (readError) {
			const readMessage = readError instanceof Error ? readError.message : String(readError);
			return new Response(
				JSON.stringify({
					success: false,
					error: "Network failure while reading response from LawBriefly API",
					details: sanitizeString(readMessage, env.LAWBRIEFLY_API_KEY),
				}),
				{
					status: 502,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		if (!response.ok) {
			let errorDetails: unknown;
			try {
				errorDetails = JSON.parse(rawText);
			} catch {
				errorDetails = rawText;
			}

			return new Response(
				JSON.stringify({
					success: false,
					error: `LawBriefly API error: HTTP status ${response.status}`,
					status: response.status,
					details: sanitizeDetails(errorDetails, env.LAWBRIEFLY_API_KEY),
				}),
				{
					status: 502,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		let data: unknown;
		try {
			data = JSON.parse(rawText);
		} catch (parseError) {
			const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
			return new Response(
				JSON.stringify({
					success: false,
					error: "Invalid JSON response received from LawBriefly API",
					details: sanitizeString(parseMessage, env.LAWBRIEFLY_API_KEY),
				}),
				{
					status: 502,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		return new Response(JSON.stringify(data), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return new Response(
			JSON.stringify({
				success: false,
				error: "Network failure while connecting to LawBriefly API",
				details: sanitizeString(errorMessage, env.LAWBRIEFLY_API_KEY),
			}),
			{
				status: 502,
				headers: { "Content-Type": "application/json" },
			}
		);
	}
}
