import type { Env } from "../index";
import {
	type ArticleAssessment,
	type RawGroqGlobalTopicSelection,
	type RawSelectedTopic,
	type RawAlternativeCandidate,
	type CandidateClusterInput,
	type CandidateArticleInput,
	type RawCandidateTopic,
	callGroqCandidateConsolidation,
	callGroqGlobalTopicSelection,
	resolveGroqModel,
} from "./groq";
import {
	type GetNewsBatchesOptions,
	type NewsArticleSummary,
	getNewsBatches,
	isValidBatchSize,
} from "./news-retrieval";
import {
	analyzeNewsBatches,
} from "./news-analysis";
import { isValidPositiveInteger } from "./lawbriefly";
import {
	callMercuryDecide,
	resolveMercuryModel,
} from "./mercury-decide";
import { getSupabaseClient } from "./supabase";

export interface EvidenceMetrics {
	unique_article_count: number;
	unique_source_host_count: number;
	supporting_batch_count: number;
	evidence_strength: "strong_multi_source" | "moderate_multi_source" | "limited_evidence";
}

export interface SupportingArticleDetail {
	article_id: string;
	title: string;
	description: string;
	url: string;
	last_seen_at: string;
}

export interface SelectedTopic {
	candidate_id?: string;
	topic_title: string;
	topic_summary: string;
	legal_domain: string;
	jurisdiction: string;
	editorial_angle: string;
	selection_rationale: string;
	confidence: number;
	evidence_metrics: EvidenceMetrics;
	supporting_articles: SupportingArticleDetail[];
}

export interface AlternativeCandidate {
	topic_title: string;
	reason_not_selected: string;
	article_ids: string[];
}

export interface ValidatedCandidateTopic {
	candidate_id: string;
	topic_title: string;
	topic_summary: string;
	legal_domain: string;
	jurisdiction: string;
	significance: "high" | "medium" | "low";
	emergence_status: "emerging" | "developing" | "ongoing" | "unclear";
	editorial_angle: string;
	evidence_summary: string;
	article_ids: string[];
	evidence_metrics: EvidenceMetrics;
}

export type CandidateValidationResult =
	| {
			valid: true;
			candidates: ValidatedCandidateTopic[];
	  }
	| {
			valid: false;
			error: string;
	  };

export interface GlobalTopicSelectionResponse {
	success: true;
	provider: "openrouter" | "groq";
	model: string;
	requested_model?: string;
	resolved_model?: string;
	window_days: number;
	batch_size: number;
	total_articles: number;
	batch_count: number;
	selection_status: "selected" | "no_strong_topic";
	selection_kind: "multi_source_trend" | "single_significant_development" | "no_strong_topic";
	selected_topic: SelectedTopic | null;
	alternative_candidates: AlternativeCandidate[];
	quality_warnings: string[];
}

export type SelectHotTopicOutcome =
	| {
			success: true;
			data: GlobalTopicSelectionResponse;
	  }
	| {
			success: false;
			status: number;
			error: string;
			details?: string;
	  };

/**
 * Normalizes a URL hostname for source diversity analysis.
 * Parses the hostname, converts to lowercase, and strips any leading "www.".
 */
export function normalizeSourceHost(rawUrl: string): string {
	try {
		const parsed = new URL(rawUrl);
		return parsed.hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "unknown";
	}
}

/**
 * Computes evidence metrics in application code using validated article IDs.
 */
export function computeEvidenceMetrics(
	articleIds: string[],
	articlesMap: Map<string, NewsArticleSummary>,
	batchMap: Map<string, number>
): EvidenceMetrics {
	const uniqueArticleCount = articleIds.length;
	const hostnames = new Set<string>();
	const batchNumbers = new Set<number>();

	for (const id of articleIds) {
		const art = articlesMap.get(id);
		if (art) {
			hostnames.add(normalizeSourceHost(art.url));
		}
		const bNum = batchMap.get(id);
		if (bNum !== undefined) {
			batchNumbers.add(bNum);
		}
	}

	const uniqueSourceHostCount = hostnames.size;
	const supportingBatchCount = batchNumbers.size;

	let evidenceStrength: "strong_multi_source" | "moderate_multi_source" | "limited_evidence";
	if (uniqueArticleCount >= 3 && uniqueSourceHostCount >= 2) {
		evidenceStrength = "strong_multi_source";
	} else if (uniqueArticleCount >= 2 && uniqueSourceHostCount >= 2) {
		evidenceStrength = "moderate_multi_source";
	} else {
		evidenceStrength = "limited_evidence";
	}

	return {
		unique_article_count: uniqueArticleCount,
		unique_source_host_count: uniqueSourceHostCount,
		supporting_batch_count: supportingBatchCount,
		evidence_strength: evidenceStrength,
	};
}

export type ValidationResult =
	| {
			valid: true;
			result: {
				selection_status: "selected" | "no_strong_topic";
				selection_kind: "multi_source_trend" | "single_significant_development" | "no_strong_topic";
				selected_topic: SelectedTopic | null;
				alternative_candidates: AlternativeCandidate[];
				quality_warnings: string[];
			};
	  }
	| {
			valid: false;
			error: string;
	  };

/**
 * Validates the raw Groq global topic selection response:
 * 1. Checks consistency between selection_status, selection_kind, and selected_topic.
 * 2. Validates article ID existence, relevance (must be 'relevant'), and uniqueness.
 * 3. Validates alternative candidates using the same provenance rules.
 * 4. Computes evidence metrics in TypeScript and applies downgrade rules if source diversity is limited.
 * 5. Reconstructs supporting articles strictly from original Supabase records.
 */
export function validateAndEnrichGlobalSelection(
	rawSelection: RawGroqGlobalTopicSelection,
	articlesMap: Map<string, NewsArticleSummary>,
	assessmentsMap: Map<string, ArticleAssessment>,
	batchMap: Map<string, number>
): ValidationResult {
	if (!rawSelection || typeof rawSelection !== "object") {
		return { valid: false, error: "Global selection output must be an object" };
	}

	const { selection_status, selection_kind, selected_topic: rawSelected, alternative_candidates: rawAlternatives } = rawSelection;

	if (selection_status !== "selected" && selection_status !== "no_strong_topic") {
		return { valid: false, error: `Invalid selection_status: "${selection_status}". Must be 'selected' or 'no_strong_topic'.` };
	}

	const validKinds = ["multi_source_trend", "single_significant_development", "no_strong_topic"];
	if (!validKinds.includes(selection_kind)) {
		return { valid: false, error: `Invalid selection_kind: "${selection_kind}".` };
	}

	// Status and kind consistency
	if (selection_status === "no_strong_topic") {
		if (selection_kind !== "no_strong_topic") {
			return { valid: false, error: `Inconsistent output: selection_kind must be 'no_strong_topic' when selection_status is 'no_strong_topic', got '${selection_kind}'.` };
		}
		if (rawSelected !== null) {
			return { valid: false, error: "selected_topic must be null when selection_status is 'no_strong_topic'." };
		}
	} else if (selection_status === "selected") {
		if (rawSelected === null || typeof rawSelected !== "object") {
			return { valid: false, error: "selected_topic must not be null when selection_status is 'selected'." };
		}
		if (selection_kind === "no_strong_topic") {
			return { valid: false, error: "selection_kind cannot be 'no_strong_topic' when selection_status is 'selected'." };
		}
	}

	// Validate alternative candidates
	const validatedAlternatives: AlternativeCandidate[] = [];
	if (!Array.isArray(rawAlternatives)) {
		return { valid: false, error: "alternative_candidates must be an array." };
	}

	for (let i = 0; i < rawAlternatives.length; i++) {
		const alt = rawAlternatives[i];
		if (!alt || typeof alt !== "object") {
			return { valid: false, error: `Alternative candidate at index ${i} must be an object.` };
		}
		if (typeof alt.topic_title !== "string" || !alt.topic_title.trim()) {
			return { valid: false, error: `Alternative candidate at index ${i} missing topic_title.` };
		}
		if (typeof alt.reason_not_selected !== "string" || !alt.reason_not_selected.trim()) {
			return { valid: false, error: `Alternative candidate '${alt.topic_title}' missing reason_not_selected.` };
		}
		if (!Array.isArray(alt.article_ids)) {
			return { valid: false, error: `Alternative candidate '${alt.topic_title}' article_ids must be an array.` };
		}

		const seenAltIds = new Set<string>();
		for (const altId of alt.article_ids) {
			if (typeof altId !== "string" || !altId.trim()) {
				return { valid: false, error: `Alternative candidate '${alt.topic_title}' contains invalid article ID.` };
			}
			if (seenAltIds.has(altId)) {
				return { valid: false, error: `Duplicate article ID in alternative candidate '${alt.topic_title}': ${altId}` };
			}
			seenAltIds.add(altId);

			if (!articlesMap.has(altId)) {
				return { valid: false, error: `Unknown or fabricated article ID in alternative candidate '${alt.topic_title}': ${altId}` };
			}
			const assessment = assessmentsMap.get(altId);
			if (!assessment || assessment.relevance !== "relevant") {
				return {
					valid: false,
					error: `Article ${altId} in alternative candidate '${alt.topic_title}' was classified as ${assessment?.relevance ?? "unknown"}, cannot be used as supporting evidence.`,
				};
			}
		}

		validatedAlternatives.push({
			topic_title: alt.topic_title.trim(),
			reason_not_selected: alt.reason_not_selected.trim(),
			article_ids: [...alt.article_ids],
		});
	}

	const warnings: string[] = Array.isArray(rawSelection.quality_warnings)
		? rawSelection.quality_warnings.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
		: [];

	// If no_strong_topic, return cleanly
	if (selection_status === "no_strong_topic") {
		return {
			valid: true,
			result: {
				selection_status: "no_strong_topic",
				selection_kind: "no_strong_topic",
				selected_topic: null,
				alternative_candidates: validatedAlternatives,
				quality_warnings: warnings,
			},
		};
	}

	// Validate selected_topic fields
	const selected = rawSelected as RawSelectedTopic;
	const requiredStringFields: Array<keyof RawSelectedTopic> = [
		"topic_title",
		"topic_summary",
		"legal_domain",
		"jurisdiction",
		"editorial_angle",
		"selection_rationale",
	];

	for (const field of requiredStringFields) {
		const val = selected[field];
		if (typeof val !== "string" || !val.trim()) {
			return { valid: false, error: `Selected topic field '${field}' must be a non-empty string.` };
		}
	}

	if (typeof selected.confidence !== "number" || Number.isNaN(selected.confidence) || selected.confidence < 0 || selected.confidence > 1) {
		return { valid: false, error: `Selected topic confidence must be a number between 0 and 1, got: ${selected.confidence}` };
	}

	if (!Array.isArray(selected.article_ids) || selected.article_ids.length === 0) {
		return { valid: false, error: "Selected topic must have a non-empty article_ids array." };
	}

	const seenSelectedIds = new Set<string>();
	for (const id of selected.article_ids) {
		if (typeof id !== "string" || !id.trim()) {
			return { valid: false, error: "Selected topic contains an empty article ID." };
		}
		if (seenSelectedIds.has(id)) {
			return { valid: false, error: `Duplicate article ID in selected topic: ${id}` };
		}
		seenSelectedIds.add(id);

		if (!articlesMap.has(id)) {
			return { valid: false, error: `Unknown or fabricated article ID in selected topic: ${id}` };
		}

		const assessment = assessmentsMap.get(id);
		if (!assessment || assessment.relevance !== "relevant") {
			return {
				valid: false,
				error: `Article ${id} in selected topic was classified as ${assessment?.relevance ?? "unknown"}, cannot be used as supporting evidence.`,
			};
		}
	}

	// Compute evidence metrics in TypeScript
	const metrics = computeEvidenceMetrics(selected.article_ids, articlesMap, batchMap);

	let finalSelectionStatus: "selected" | "no_strong_topic" = "selected";
	let finalSelectionKind: "multi_source_trend" | "single_significant_development" | "no_strong_topic" = selection_kind;

	// Evidence downgrade rule:
	// If model claims multi_source_trend but computed evidence is limited:
	// downgrade to single_significant_development if defensible (unique_article_count >= 1), or no_strong_topic otherwise.
	if (finalSelectionKind === "multi_source_trend" && metrics.evidence_strength === "limited_evidence") {
		if (metrics.unique_article_count >= 1) {
			finalSelectionKind = "single_significant_development";
			warnings.push(
				`Downgraded selection_kind from 'multi_source_trend' to 'single_significant_development' due to limited source diversity (${metrics.unique_source_host_count} source host(s), ${metrics.unique_article_count} article(s)).`
			);
		} else {
			finalSelectionStatus = "no_strong_topic";
			finalSelectionKind = "no_strong_topic";
			warnings.push("Downgraded selection to 'no_strong_topic' due to zero supporting articles.");
		}
	}

	if (finalSelectionStatus === "no_strong_topic") {
		return {
			valid: true,
			result: {
				selection_status: "no_strong_topic",
				selection_kind: "no_strong_topic",
				selected_topic: null,
				alternative_candidates: validatedAlternatives,
				quality_warnings: warnings,
			},
		};
	}

	// Reconstruct supporting articles from Supabase records
	const supporting_articles: SupportingArticleDetail[] = selected.article_ids.map((id) => {
		const art = articlesMap.get(id)!;
		return {
			article_id: art.id,
			title: art.title,
			description: art.description,
			url: art.url,
			last_seen_at: art.last_seen_at,
		};
	});

	const enrichedSelectedTopic: SelectedTopic = {
		topic_title: selected.topic_title.trim(),
		topic_summary: selected.topic_summary.trim(),
		legal_domain: selected.legal_domain.trim(),
		jurisdiction: selected.jurisdiction.trim(),
		editorial_angle: selected.editorial_angle.trim(),
		selection_rationale: selected.selection_rationale.trim(),
		confidence: selected.confidence,
		evidence_metrics: metrics,
		supporting_articles,
	};

	return {
		valid: true,
		result: {
			selection_status: "selected",
			selection_kind: finalSelectionKind,
			selected_topic: enrichedSelectedTopic,
			alternative_candidates: validatedAlternatives,
			quality_warnings: warnings,
		},
	};
}

/**
 * Validates the candidate topics produced by Groq candidate consolidation.
 * Verifies required fields, enum bounds, article existence, article relevance,
 * removes duplicate article IDs, computes evidence metrics, and assigns deterministic candidate IDs (T001, T002...).
 */
export function validateAndEnrichCandidates(
	rawCandidates: RawCandidateTopic[],
	articlesMap: Map<string, NewsArticleSummary>,
	assessmentsMap: Map<string, ArticleAssessment>,
	batchMap: Map<string, number>
): CandidateValidationResult {
	if (!Array.isArray(rawCandidates)) {
		return { valid: false, error: "candidate_topics must be an array" };
	}

	const validated: ValidatedCandidateTopic[] = [];

	for (let i = 0; i < rawCandidates.length; i++) {
		const cand = rawCandidates[i];
		if (!cand || typeof cand !== "object") {
			return { valid: false, error: `Candidate topic at index ${i} must be an object` };
		}

		const requiredFields: Array<keyof RawCandidateTopic> = [
			"topic_title",
			"topic_summary",
			"legal_domain",
			"jurisdiction",
			"editorial_angle",
			"evidence_summary",
		];

		for (const field of requiredFields) {
			const val = cand[field];
			if (typeof val !== "string" || !val.trim()) {
				return { valid: false, error: `Candidate topic at index ${i} missing required string field '${field}'` };
			}
		}

		if (!["high", "medium", "low"].includes(cand.significance)) {
			return { valid: false, error: `Candidate '${cand.topic_title}' invalid significance: '${cand.significance}'` };
		}

		if (!["emerging", "developing", "ongoing", "unclear"].includes(cand.emergence_status)) {
			return { valid: false, error: `Candidate '${cand.topic_title}' invalid emergence_status: '${cand.emergence_status}'` };
		}

		if (!Array.isArray(cand.article_ids) || cand.article_ids.length === 0) {
			return { valid: false, error: `Candidate '${cand.topic_title}' must have a non-empty article_ids array` };
		}

		const seenIds = new Set<string>();
		const uniqueIds: string[] = [];
		for (const artId of cand.article_ids) {
			if (typeof artId !== "string" || !artId.trim()) {
				return { valid: false, error: `Candidate '${cand.topic_title}' contains invalid article ID` };
			}
			const trimmedId = artId.trim();
			if (!seenIds.has(trimmedId)) {
				seenIds.add(trimmedId);
				uniqueIds.push(trimmedId);

				if (!articlesMap.has(trimmedId)) {
					return { valid: false, error: `Unknown or fabricated article ID in candidate '${cand.topic_title}': ${trimmedId}` };
				}

				const assessment = assessmentsMap.get(trimmedId);
				if (!assessment || assessment.relevance !== "relevant") {
					return {
						valid: false,
						error: `Article ${trimmedId} in candidate '${cand.topic_title}' was classified as ${assessment?.relevance ?? "unknown"}, cannot be used as supporting evidence`,
					};
				}
			}
		}

		const metrics = computeEvidenceMetrics(uniqueIds, articlesMap, batchMap);
		const candidateId = `T${String(i + 1).padStart(3, "0")}`;

		validated.push({
			candidate_id: candidateId,
			topic_title: cand.topic_title.trim(),
			topic_summary: cand.topic_summary.trim(),
			legal_domain: cand.legal_domain.trim(),
			jurisdiction: cand.jurisdiction.trim(),
			significance: cand.significance,
			emergence_status: cand.emergence_status,
			editorial_angle: cand.editorial_angle.trim(),
			evidence_summary: cand.evidence_summary.trim(),
			article_ids: uniqueIds,
			evidence_metrics: metrics,
		});
	}

	return {
		valid: true,
		candidates: validated,
	};
}

/**
 * Orchestrates global hot-topic selection using a two-stage architecture:
 * 1. Groq performs batch-level relevance filtering and cross-batch candidate consolidation.
 * 2. TypeScript verifies article provenance, computes evidence metrics, and assigns deterministic IDs.
 * 3. Mercury Decide (inception/mercury-decide via OpenRouter Decisions API) evaluates candidates
 *    and makes the final winner or no_strong_topic choice.
 * 4. TypeScript reconstructs original Supabase URLs and formats the final editorial result.
 */
export async function selectHotTopic(
	env: Env,
	options?: GetNewsBatchesOptions | URLSearchParams
): Promise<SelectHotTopicOutcome> {
	// 1. Validate query parameters before initiating retrieval or LLM calls
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
			} else if (key === "batch_size") {
				if (!isValidBatchSize(value)) {
					return {
						success: false,
						status: 400,
						error: "Invalid query parameter: 'batch_size' must be an integer between 10 and 20 inclusive",
					};
				}
			} else if (key === "limit") {
				if (!isValidPositiveInteger(value)) {
					return {
						success: false,
						status: 400,
						error: "Invalid query parameter: 'limit' must be a positive integer",
					};
				}
			}
		}
	} else if (options) {
		if (options.days !== undefined && !isValidPositiveInteger(String(options.days))) {
			return {
				success: false,
				status: 400,
				error: "Invalid query parameter: 'days' must be a positive integer",
			};
		}
		if (options.batch_size !== undefined && !isValidBatchSize(options.batch_size)) {
			return {
				success: false,
				status: 400,
				error: "Invalid query parameter: 'batch_size' must be an integer between 10 and 20 inclusive",
			};
		}
		if (options.limit !== undefined && !isValidPositiveInteger(String(options.limit))) {
			return {
				success: false,
				status: 400,
				error: "Invalid query parameter: 'limit' must be a positive integer",
			};
		}
	}

	// 2. Validate Groq model configuration and OpenRouter credentials early
	const modelResolution = resolveGroqModel(env);
	if (!modelResolution.success) {
		return modelResolution;
	}

	if (!env.OPENROUTER_API_KEY?.trim()) {
		return {
			success: false,
			status: 500,
			error: "Missing OPENROUTER_API_KEY configuration",
		};
	}

	// 3. Query recently covered topics and articles from social_content_posts (last 7 days)
	// to prevent duplicate coverage of the same legal stories across pipeline runs.
	const coveredArticleIds = new Set<string>();
	const coveredTopicTitles: string[] = [];
	const isTestEnv = typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || process.env?.VITEST === "true");

	if (!isTestEnv && env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
		try {
			const supabase = getSupabaseClient(env);
			const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
			const { data: recentPosts } = await supabase
				.from("social_content_posts")
				.select("topic_title, source_attributions")
				.gte("created_at", sevenDaysAgo)
				.order("created_at", { ascending: false })
				.limit(30);

			if (Array.isArray(recentPosts)) {
				for (const p of recentPosts) {
					if (p.topic_title && typeof p.topic_title === "string") {
						const trimmed = p.topic_title.trim();
						if (trimmed && !coveredTopicTitles.includes(trimmed)) {
							coveredTopicTitles.push(trimmed);
						}
					}
					if (Array.isArray(p.source_attributions)) {
						for (const attr of p.source_attributions) {
							if (attr?.article_id && typeof attr.article_id === "string") {
								coveredArticleIds.add(attr.article_id.trim());
							}
						}
					}
				}
			}
		} catch {
			// Non-fatal if Supabase query fails (e.g. unit tests or local simulation)
		}
	}

	// 4. Retrieve batches using news-retrieval service with deduplication and limit
	let effectiveRetrievalOptions: GetNewsBatchesOptions;
	if (options instanceof URLSearchParams) {
		effectiveRetrievalOptions = {
			days: options.get("days") || undefined,
			batch_size: options.get("batch_size") || undefined,
			page_size: options.get("page_size") || undefined,
			limit: options.get("limit") || 20,
			exclude_article_ids: coveredArticleIds,
		};
	} else {
		effectiveRetrievalOptions = {
			...options,
			limit: options?.limit ?? 20,
			exclude_article_ids: options?.exclude_article_ids ?? coveredArticleIds,
		};
	}

	const retrievalOutcome = await getNewsBatches(env, effectiveRetrievalOptions);
	if (!retrievalOutcome.success) {
		return retrievalOutcome;
	}

	const batchData = retrievalOutcome.data;

	// 5. Handle zero articles cleanly without calling Groq or Mercury
	if (batchData.total_articles === 0) {
		const reqModel = resolveMercuryModel(env);
		return {
			success: true,
			data: {
				success: true,
				provider: "openrouter",
				model: reqModel,
				requested_model: reqModel,
				resolved_model: reqModel,
				window_days: batchData.window_days,
				batch_size: batchData.batch_size,
				total_articles: 0,
				batch_count: 0,
				selection_status: "no_strong_topic",
				selection_kind: "no_strong_topic",
				selected_topic: null,
				alternative_candidates: [],
				quality_warnings: ["No news articles found in the specified collection window"],
			},
		};
	}

	// 5. Verify GROQ_API_KEY before executing batch analysis
	if (!env.GROQ_API_KEY?.trim()) {
		return {
			success: false,
			status: 500,
			error: "Missing GROQ_API_KEY configuration",
		};
	}

	// 6. Build index of all articles for provenance validation and reconstruction
	const allArticlesMap = new Map<string, NewsArticleSummary>();
	const batchMap = new Map<string, number>();

	for (const batch of batchData.batches) {
		for (const art of batch.articles) {
			allArticlesMap.set(art.id, art);
			batchMap.set(art.id, batch.batch_number);
		}
	}

	// 7. Execute batch analysis reusing news-analysis functionality directly
	const analysisOutcome = await analyzeNewsBatches(env, options, batchData);
	if (!analysisOutcome.success) {
		return {
			success: false,
			status: analysisOutcome.status,
			error: analysisOutcome.error,
			details: analysisOutcome.details,
		};
	}

	const analysisData = analysisOutcome.data;

	// 8. Collect candidate clusters and article assessments across all batches
	const assessmentsMap = new Map<string, ArticleAssessment>();
	const candidateClusters: CandidateClusterInput[] = [];

	for (const batchRes of analysisData.batch_results) {
		for (const assessment of batchRes.article_assessments) {
			assessmentsMap.set(assessment.article_id, assessment);
		}
		for (const cluster of batchRes.topic_clusters) {
			candidateClusters.push({
				batch_number: batchRes.batch_number,
				cluster_id: cluster.cluster_id,
				topic_title: cluster.topic_title,
				topic_summary: cluster.topic_summary,
				legal_domain: cluster.legal_domain,
				jurisdiction: cluster.jurisdiction,
				significance: cluster.significance,
				emergence_status: cluster.emergence_status,
				editorial_angle: cluster.editorial_angle,
				article_ids: cluster.article_ids,
				confidence: cluster.confidence,
			});
		}
	}

	// If no candidate clusters were extracted from any batch, skip Mercury and return no_strong_topic
	if (candidateClusters.length === 0) {
		return {
			success: true,
			data: {
				success: true,
				provider: "openrouter",
				model: resolveMercuryModel(env),
				window_days: batchData.window_days,
				batch_size: batchData.batch_size,
				total_articles: batchData.total_articles,
				batch_count: batchData.batch_count,
				selection_status: "no_strong_topic",
				selection_kind: "no_strong_topic",
				selected_topic: null,
				alternative_candidates: [],
				quality_warnings: ["No candidate legal topic clusters identified during batch analysis"],
			},
		};
	}

	// 8b. Deduplicate and cap candidate clusters to protect Groq TPM budget and avoid repeating recently covered stories
	let effectiveClusters = candidateClusters;
	if (coveredTopicTitles.length > 0) {
		const nonDuplicateClusters = effectiveClusters.filter((c) => {
			const candLower = c.topic_title.toLowerCase();
			return !coveredTopicTitles.some((t) => {
				const coveredLower = t.toLowerCase();
				return candLower.includes(coveredLower) || coveredLower.includes(candLower);
			});
		});
		if (nonDuplicateClusters.length > 0) {
			effectiveClusters = nonDuplicateClusters;
		}
	}

	const significanceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
	const rankedClusters = [...effectiveClusters].sort((a, b) => {
		const rankA = significanceRank[a.significance] || 0;
		const rankB = significanceRank[b.significance] || 0;
		if (rankA !== rankB) return rankB - rankA;
		return (b.confidence || 0) - (a.confidence || 0);
	});
	const topClusters = rankedClusters.slice(0, 5);

	// 9. Prepare supporting relevant articles for prompt
	const supportingArticlesForPrompt: CandidateArticleInput[] = [];
	for (const [articleId, assessment] of assessmentsMap.entries()) {
		if (assessment.relevance === "relevant") {
			const art = allArticlesMap.get(articleId);
			if (art) {
				supportingArticlesForPrompt.push({
					article_id: art.id,
					title: art.title,
					source_host: normalizeSourceHost(art.url),
					batch_number: batchMap.get(art.id) ?? 1,
					description:
						art.description.length > 800
							? `${art.description.slice(0, 800)}...`
							: art.description,
					legal_domain: assessment.legal_domain,
					jurisdiction: assessment.jurisdiction,
				});
			}
		}
	}

	// 10. Call Groq for candidate consolidation ONLY (merging related topics across batches)
	await new Promise((resolve) => setTimeout(resolve, 2000));
	const consolidationResult = await callGroqCandidateConsolidation(env, {
		candidate_clusters: topClusters,
		supporting_articles: supportingArticlesForPrompt,
		covered_topics: coveredTopicTitles,
	});

	if (!consolidationResult.success) {
		return {
			success: false,
			status: consolidationResult.status,
			error: `Candidate consolidation failed: ${consolidationResult.error}`,
		};
	}

	const rawConsolidated = consolidationResult.data.candidate_topics;
	const warnings: string[] = Array.isArray(consolidationResult.data.quality_warnings)
		? consolidationResult.data.quality_warnings.filter((w) => typeof w === "string" && w.trim().length > 0)
		: [];

	// If no candidate topics returned by consolidation, skip Mercury
	if (rawConsolidated.length === 0) {
		return {
			success: true,
			data: {
				success: true,
				provider: "openrouter",
				model: resolveMercuryModel(env),
				window_days: batchData.window_days,
				batch_size: batchData.batch_size,
				total_articles: batchData.total_articles,
				batch_count: batchData.batch_count,
				selection_status: "no_strong_topic",
				selection_kind: "no_strong_topic",
				selected_topic: null,
				alternative_candidates: [],
				quality_warnings: warnings.length > 0 ? warnings : ["No candidate topics consolidated from batches"],
			},
		};
	}

	// 11. Validate and enrich consolidated candidates in TypeScript
	const candValidation = validateAndEnrichCandidates(
		rawConsolidated,
		allArticlesMap,
		assessmentsMap,
		batchMap
	);

	if (!candValidation.valid) {
		return {
			success: false,
			status: 502,
			error: `Candidate consolidation validation failed: ${candValidation.error}`,
		};
	}

	const candidates = candValidation.candidates;

	if (candidates.length === 0) {
		const reqModel = resolveMercuryModel(env);
		return {
			success: true,
			data: {
				success: true,
				provider: "openrouter",
				model: reqModel,
				requested_model: reqModel,
				resolved_model: reqModel,
				window_days: batchData.window_days,
				batch_size: batchData.batch_size,
				total_articles: batchData.total_articles,
				batch_count: batchData.batch_count,
				selection_status: "no_strong_topic",
				selection_kind: "no_strong_topic",
				selected_topic: null,
				alternative_candidates: [],
				quality_warnings: warnings.length > 0 ? warnings : ["No valid candidate topics remained after validation"],
			},
		};
	}

	// 12. Call Mercury Decide for the FINAL winner-selection decision
	const mercuryOutcome = await callMercuryDecide(env, {
		window_days: batchData.window_days,
		candidates: candidates.map((c) => ({
			candidate_id: c.candidate_id,
			topic_title: c.topic_title,
			topic_summary: c.topic_summary,
			legal_domain: c.legal_domain,
			jurisdiction: c.jurisdiction,
			significance: c.significance,
			emergence_status: c.emergence_status,
			editorial_angle: c.editorial_angle,
			evidence_summary: c.evidence_summary,
			evidence: c.evidence_metrics,
			supporting_article_titles: c.article_ids.map((id) => allArticlesMap.get(id)!.title),
		})),
		recently_covered_topics: coveredTopicTitles,
	});

	if (!mercuryOutcome.success) {
		return {
			success: false,
			status: mercuryOutcome.status,
			error: `Mercury Decide selection failed: ${mercuryOutcome.error}`,
		};
	}

	const {
		choice,
		confidence,
		probabilities,
		model: mercuryModel,
		requested_model: requestedModel,
		resolved_model: resolvedModel,
	} = mercuryOutcome;

	// 13. Process Mercury decision
	if (choice === "no_strong_topic") {
		const alternative_candidates: AlternativeCandidate[] = candidates.map((c) => ({
			topic_title: c.topic_title,
			reason_not_selected: `Mercury Decide selected no_strong_topic; candidate evaluated with probability ${(probabilities[c.candidate_id] ?? 0).toFixed(2)}`,
			article_ids: [...c.article_ids],
		}));

		return {
			success: true,
			data: {
				success: true,
				provider: "openrouter",
				model: mercuryModel,
				requested_model: requestedModel,
				resolved_model: resolvedModel,
				window_days: batchData.window_days,
				batch_size: batchData.batch_size,
				total_articles: batchData.total_articles,
				batch_count: batchData.batch_count,
				selection_status: "no_strong_topic",
				selection_kind: "no_strong_topic",
				selected_topic: null,
				alternative_candidates,
				quality_warnings: warnings,
			},
		};
	}

	// Finding winner candidate
	const winner = candidates.find((c) => c.candidate_id === choice);
	if (!winner) {
		return {
			success: false,
			status: 502,
			error: `Mercury Decide selected candidate ID "${choice}" which does not match any consolidated candidate`,
		};
	}

	// Remaining candidates become alternative candidates
	const alternative_candidates: AlternativeCandidate[] = candidates
		.filter((c) => c.candidate_id !== choice)
		.map((c) => ({
			topic_title: c.topic_title,
			reason_not_selected: `Not selected by Mercury Decide; candidate ${choice} selected with confidence ${confidence.toFixed(2)} (alternative probability: ${(probabilities[c.candidate_id] ?? 0).toFixed(2)})`,
			article_ids: [...c.article_ids],
		}));

	// Determine selection kind from evidence strength
	let selection_kind: "multi_source_trend" | "single_significant_development" = "single_significant_development";
	if (
		winner.evidence_metrics.evidence_strength === "strong_multi_source" ||
		winner.evidence_metrics.evidence_strength === "moderate_multi_source"
	) {
		selection_kind = "multi_source_trend";
	} else {
		selection_kind = "single_significant_development";
	}

	// Reconstruct supporting articles strictly from Supabase records
	const supporting_articles: SupportingArticleDetail[] = winner.article_ids.map((id) => {
		const art = allArticlesMap.get(id)!;
		return {
			article_id: art.id,
			title: art.title,
			description: art.description,
			url: art.url,
			last_seen_at: art.last_seen_at,
		};
	});

	const selected_topic: SelectedTopic = {
		candidate_id: winner.candidate_id,
		topic_title: winner.topic_title,
		topic_summary: winner.topic_summary,
		legal_domain: winner.legal_domain,
		jurisdiction: winner.jurisdiction,
		editorial_angle: winner.editorial_angle,
		selection_rationale: `${winner.evidence_summary} (Selected by Mercury Decide with decision confidence ${confidence.toFixed(2)})`,
		confidence,
		evidence_metrics: winner.evidence_metrics,
		supporting_articles,
	};

	return {
		success: true,
		data: {
			success: true,
			provider: "openrouter",
			model: mercuryModel,
			requested_model: requestedModel,
			resolved_model: resolvedModel,
			window_days: batchData.window_days,
			batch_size: batchData.batch_size,
			total_articles: batchData.total_articles,
			batch_count: batchData.batch_count,
			selection_status: "selected",
			selection_kind,
			selected_topic,
			alternative_candidates,
			quality_warnings: warnings,
		},
	};
}

/**
 * HTTP handler for POST /api/ai/select-hot-topic.
 */
export async function handleSelectHotTopic(
	env: Env,
	searchParams: URLSearchParams
): Promise<Response> {
	const outcome = await selectHotTopic(env, searchParams);

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
