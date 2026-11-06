import type { Env } from "../index";

export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const DEFAULT_MERCURY_MODEL = "inception/mercury-decide";

export interface MercuryCandidateInput {
	candidate_id: string; // e.g. "T001"
	topic_title: string;
	topic_summary: string;
	legal_domain: string;
	jurisdiction: string;
	significance: string;
	emergence_status: string;
	editorial_angle: string;
	evidence_summary?: string;
	evidence: {
		unique_article_count: number;
		unique_source_host_count: number;
		supporting_batch_count: number;
		evidence_strength: "strong_multi_source" | "moderate_multi_source" | "limited_evidence";
	};
	supporting_article_titles: string[];
}

export interface MercuryDecisionOutcomeSuccess {
	success: true;
	provider: "openrouter";
	model: string;
	requested_model: string;
	resolved_model: string;
	choice: string; // candidate_id or "no_strong_topic"
	confidence: number;
	probabilities: Record<string, number>;
}

export interface MercuryDecisionOutcomeFailure {
	success: false;
	status: number;
	error: string;
	details?: string;
}

export type MercuryDecisionOutcome =
	| MercuryDecisionOutcomeSuccess
	| MercuryDecisionOutcomeFailure;

/**
 * Validates and resolves the configured MERCURY_MODEL.
 * Defaults to "inception/mercury-decide".
 */
export function resolveMercuryModel(env: Env): string {
	const configured = env.MERCURY_MODEL?.trim();
	if (!configured || configured.length === 0) {
		return DEFAULT_MERCURY_MODEL;
	}
	if (configured === "inception/mercury-decide:free") {
		return DEFAULT_MERCURY_MODEL;
	}
	return configured;
}

/**
 * Calls OpenRouter Decisions API using the FREE Mercury Decide model
 * (inception/mercury-decide) to make the final winner-selection decision.
 *
 * STRICT RETRY POLICY:
 * Exactly ONE request is made per run. No automatic retry on 429 or transient errors,
 * to preserve the free daily allowance and respect account rate limits.
 */
export async function callMercuryDecide(
	env: Env,
	options: {
		window_days: number;
		candidates: MercuryCandidateInput[];
		recently_covered_topics?: string[];
	}
): Promise<MercuryDecisionOutcome> {
	// 1. Verify OPENROUTER_API_KEY
	const apiKey = env.OPENROUTER_API_KEY?.trim();
	if (!apiKey) {
		return {
			success: false,
			status: 500,
			error: "Missing OPENROUTER_API_KEY configuration",
		};
	}

	// 2. Resolve configured model identifier
	const model = resolveMercuryModel(env);

	// 3. Validate candidate bounds (OpenRouter choice criteria supports max 255 options, 1 reserved for no_strong_topic)
	if (options.candidates.length > 254) {
		return {
			success: false,
			status: 400,
			error: "Candidate count exceeds OpenRouter Decisions API limit of 254 selectable candidates",
		};
	}

	// 4. Dynamically build choice criteria map
	const criteria: Record<string, string> = {};
	for (const cand of options.candidates) {
		criteria[cand.candidate_id] = `Candidate ${cand.candidate_id}: ${cand.topic_title}. Domain: ${cand.legal_domain}. Significance: ${cand.significance}. Evidence: ${cand.evidence.evidence_strength} (${cand.evidence.unique_article_count} article(s) across ${cand.evidence.unique_source_host_count} source(s)). Editorial Angle: ${cand.editorial_angle}.`;
	}
	criteria["no_strong_topic"] =
		"None of the consolidated candidate topics has sufficient legal significance and supporting evidence to justify selection.";

	// 5. Construct OpenRouter Decisions API request payload
	const requestBody = {
		model,
		state: {
			editorial_context:
				"LawBriefly is an Indian legal technology and education platform serving law students.",
			collection_window: {
				days: options.window_days,
			},
			candidates: options.candidates.map((c) => ({
				candidate_id: c.candidate_id,
				topic_title: c.topic_title,
				topic_summary: c.topic_summary,
				legal_domain: c.legal_domain,
				jurisdiction: c.jurisdiction,
				significance: c.significance,
				emergence_status: c.emergence_status,
				editorial_angle: c.editorial_angle,
				evidence: c.evidence,
				supporting_article_titles: c.supporting_article_titles,
			})),
		},
		questions: {
			topic_selection: {
				type: "choice",
				instructions:
					"Select the single most editorially valuable legal development for LawBriefly. Evaluate legal significance, supporting evidence, source diversity, relevance to Indian law students, and educational value. Do not equate article volume with legal importance. A single significant legal development can qualify without being a multi-source trend. Select no_strong_topic if none of the candidates merits selection." +
					(options.recently_covered_topics && options.recently_covered_topics.length > 0
						? ` MANDATORY EDITORIAL DIVERSITY RULE: The following topics have recently been published on LawBriefly: ${options.recently_covered_topics.slice(0, 5).map((t) => `"${t}"`).join(", ")}. Do NOT select any candidate that repeats or re-covers these legal developments under any circumstances. Select an entirely different legal topic or no_strong_topic.`
						: ""),
				criteria,
			},
		},
	};

	// 6. Execute native fetch - exactly ONE attempt, strictly no loop/retry
	let response: Response;
	try {
		response = await fetch(OPENROUTER_DECISIONS_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(requestBody),
		});
	} catch {
		return {
			success: false,
			status: 502,
			error: "Failed to connect to OpenRouter Decisions API",
		};
	}

	// 7. Handle HTTP error codes with secret-safe messages
	if (!response.ok) {
		const status = response.status;
		let detail = "";
		try {
			const errBody = (await response.json()) as { error?: { message?: string } };
			if (errBody?.error?.message) {
				detail = `: ${errBody.error.message}`;
			}
		} catch {
			// Ignore parse error
		}

		if (status === 401 || status === 403) {
			return {
				success: false,
				status: 502,
				error: "OpenRouter API authentication failed. Please check your OPENROUTER_API_KEY.",
			};
		}
		if (status === 429) {
			return {
				success: false,
				status: 429,
				error: "OpenRouter API rate limit exceeded or free allowance exhausted. Please retry later.",
			};
		}
		if (status >= 500) {
			return {
				success: false,
				status: 502,
				error: `OpenRouter Decisions API server error: HTTP ${status}`,
			};
		}
		return {
			success: false,
			status: 502,
			error: `OpenRouter Decisions API returned HTTP error ${status}${detail}`,
		};
	}

	// 8. Parse and validate decision response format
	let responseJson: unknown;
	try {
		responseJson = await response.json();
	} catch {
		return {
			success: false,
			status: 502,
			error: "Invalid JSON response received from OpenRouter Decisions API",
		};
	}

	if (!responseJson || typeof responseJson !== "object") {
		return {
			success: false,
			status: 502,
			error: "Invalid response format from OpenRouter Decisions API",
		};
	}

	const typedResponse = responseJson as {
		model?: string;
		answers?: {
			topic_selection?: {
				type?: string;
				choice?: string;
				confidence?: number;
				probabilities?: Record<string, number>;
			};
		};
	};

	const answer = typedResponse.answers?.topic_selection;
	if (!answer || typeof answer !== "object") {
		return {
			success: false,
			status: 502,
			error: "Missing topic_selection answer in OpenRouter Decisions response",
		};
	}

	if (answer.type !== "choice") {
		return {
			success: false,
			status: 502,
			error: `Expected choice answer type from Mercury Decide, received: "${answer.type}"`,
		};
	}

	const choice = answer.choice;
	if (typeof choice !== "string" || !choice.trim()) {
		return {
			success: false,
			status: 502,
			error: "Mercury Decide returned an empty or invalid choice identifier",
		};
	}

	// Validate choice exists in options
	if (!(choice in criteria)) {
		return {
			success: false,
			status: 502,
			error: `Mercury Decide returned unknown choice: "${choice}". Not present in candidates or no_strong_topic.`,
		};
	}

	const probabilities = answer.probabilities && typeof answer.probabilities === "object"
		? answer.probabilities
		: {};

	let confidence = typeof answer.confidence === "number" && !Number.isNaN(answer.confidence)
		? answer.confidence
		: typeof probabilities[choice] === "number"
			? probabilities[choice]
			: 0.8;

	// Clamp confidence to 0..1
	if (confidence < 0) confidence = 0;
	if (confidence > 1) confidence = 1;

	return {
		success: true,
		provider: "openrouter",
		model,
		requested_model: model,
		resolved_model: typedResponse.model || model,
		choice,
		confidence,
		probabilities,
	};
}
