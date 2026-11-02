import type { Env } from "../index";
import {
	type ArticleAssessment,
	type ArticleLegalDomain,
	type ArticleRelevance,
	type ArticleJurisdiction,
	type TopicLegalDomain,
	type TopicJurisdiction,
	type TopicSignificance,
	type TopicEmergenceStatus,
	type RawGroqBatchAnalysis,
	callGroqBatchAnalysis,
	resolveGroqModel,
} from "./groq";
import {
	type GetNewsBatchesOptions,
	type NewsBatch,
	type NewsBatchesResponse,
	type NewsArticleSummary,
	getNewsBatches,
	isValidBatchSize,
} from "./news-retrieval";
import { isValidPositiveInteger } from "./lawbriefly";

export interface SupportingArticle {
	article_id: string;
	title: string;
	url: string;
}

export interface TopicCluster {
	cluster_id: string;
	topic_title: string;
	topic_summary: string;
	legal_domain: TopicLegalDomain;
	jurisdiction: TopicJurisdiction;
	significance: TopicSignificance;
	emergence_status: TopicEmergenceStatus;
	editorial_angle: string;
	article_ids: string[];
	confidence: number;
	supporting_articles: SupportingArticle[];
}

export interface BatchAnalysisResult {
	batch_number: number;
	article_count: number;
	legal_relevant_count: number;
	not_relevant_count: number;
	uncertain_count: number;
	batch_summary: string;
	article_assessments: ArticleAssessment[];
	topic_clusters: TopicCluster[];
	quality_warnings: string[];
}

export interface AggregateMetrics {
	total_articles_analyzed: number;
	total_legal_relevant: number;
	total_not_relevant: number;
	total_uncertain: number;
	total_candidate_topics: number;
}

export interface NewsAnalysisResponse {
	success: true;
	provider: "groq";
	model: string;
	window_days: number;
	batch_size: number;
	total_articles: number;
	batch_count: number;
	batch_results: BatchAnalysisResult[];
	aggregate_metrics: AggregateMetrics;
}

export type AnalyzeBatchesOutcome =
	| {
			success: true;
			data: NewsAnalysisResponse;
	  }
	| {
			success: false;
			status: number;
			error: string;
			details?: string;
	  };

const VALID_RELEVANCE_VALUES = new Set<ArticleRelevance>([
	"relevant",
	"not_relevant",
	"uncertain",
]);

const VALID_ARTICLE_DOMAINS = new Set<ArticleLegalDomain>([
	"constitutional_law",
	"criminal_law",
	"civil_law",
	"corporate_commercial_law",
	"intellectual_property",
	"technology_data_privacy_law",
	"family_law",
	"labour_employment_law",
	"environmental_law",
	"tax_law",
	"administrative_regulatory_law",
	"international_law",
	"legal_education",
	"legal_profession",
	"other",
	"not_applicable",
]);

const VALID_ARTICLE_JURISDICTIONS = new Set<ArticleJurisdiction>([
	"india",
	"international",
	"both",
	"unknown",
	"not_applicable",
]);

const VALID_TOPIC_DOMAINS = new Set<TopicLegalDomain>([
	"constitutional_law",
	"criminal_law",
	"civil_law",
	"corporate_commercial_law",
	"intellectual_property",
	"technology_data_privacy_law",
	"family_law",
	"labour_employment_law",
	"environmental_law",
	"tax_law",
	"administrative_regulatory_law",
	"international_law",
	"legal_education",
	"legal_profession",
	"other",
]);

const VALID_TOPIC_JURISDICTIONS = new Set<TopicJurisdiction>([
	"india",
	"international",
	"both",
	"unknown",
]);

const VALID_SIGNIFICANCE_VALUES = new Set<TopicSignificance>([
	"high",
	"medium",
	"low",
]);

const VALID_EMERGENCE_VALUES = new Set<TopicEmergenceStatus>([
	"emerging",
	"developing",
	"ongoing",
	"unclear",
]);

export type ValidationOutcome =
	| { valid: true; result: BatchAnalysisResult }
	| { valid: false; error: string };

/**
 * Validates the raw model output for a single batch against input articles
 * and reconstructs supporting article metadata from original Supabase records.
 */
export function validateAndEnrichBatchAnalysis(
	raw: unknown,
	batch: NewsBatch
): ValidationOutcome {
	if (!raw || typeof raw !== "object") {
		return { valid: false, error: "Model output is not an object" };
	}

	const data = raw as Partial<RawGroqBatchAnalysis>;

	if (typeof data.batch_summary !== "string" || !data.batch_summary.trim()) {
		return { valid: false, error: "Missing or invalid 'batch_summary'" };
	}

	if (!Array.isArray(data.quality_warnings)) {
		return { valid: false, error: "'quality_warnings' must be an array" };
	}

	const qualityWarnings: string[] = data.quality_warnings.map((w) =>
		String(w ?? "")
	);

	if (!Array.isArray(data.article_assessments)) {
		return { valid: false, error: "'article_assessments' must be an array" };
	}

	if (data.article_assessments.length !== batch.articles.length) {
		return {
			valid: false,
			error: `Expected ${batch.articles.length} article assessments, received ${data.article_assessments.length}`,
		};
	}

	const inputMap = new Map<string, NewsArticleSummary>();
	for (const article of batch.articles) {
		inputMap.set(article.id, article);
	}

	const assessedIds = new Set<string>();
	const assessmentByArticleId = new Map<string, ArticleAssessment>();

	let legalRelevantCount = 0;
	let notRelevantCount = 0;
	let uncertainCount = 0;

	for (const item of data.article_assessments) {
		if (!item || typeof item !== "object") {
			return { valid: false, error: "Invalid assessment item in article_assessments" };
		}

		const rec = item as unknown as Record<string, unknown>;
		const articleId = String(rec.article_id ?? "");

		if (!inputMap.has(articleId)) {
			return {
				valid: false,
				error: `Unknown article_id '${articleId}' in article assessments`,
			};
		}

		if (assessedIds.has(articleId)) {
			return {
				valid: false,
				error: `Duplicate assessment for article_id '${articleId}'`,
			};
		}
		assessedIds.add(articleId);

		const relevance = rec.relevance as ArticleRelevance;
		if (!VALID_RELEVANCE_VALUES.has(relevance)) {
			return {
				valid: false,
				error: `Invalid relevance value '${String(rec.relevance)}' for article '${articleId}'`,
			};
		}

		if (relevance === "relevant") {
			legalRelevantCount++;
		} else if (relevance === "not_relevant") {
			notRelevantCount++;
		} else {
			uncertainCount++;
		}

		const legalDomain = rec.legal_domain as ArticleLegalDomain;
		if (!VALID_ARTICLE_DOMAINS.has(legalDomain)) {
			return {
				valid: false,
				error: `Invalid legal_domain '${String(rec.legal_domain)}' for article '${articleId}'`,
			};
		}

		const jurisdiction = rec.jurisdiction as ArticleJurisdiction;
		if (!VALID_ARTICLE_JURISDICTIONS.has(jurisdiction)) {
			return {
				valid: false,
				error: `Invalid jurisdiction '${String(rec.jurisdiction)}' for article '${articleId}'`,
			};
		}

		const reason = String(rec.reason ?? "").trim();
		if (!reason) {
			return {
				valid: false,
				error: `Missing reason in assessment for article '${articleId}'`,
			};
		}

		let clusterId: string | null = null;
		if (rec.cluster_id !== null && rec.cluster_id !== undefined) {
			clusterId = String(rec.cluster_id).trim();
			if (!clusterId) {
				clusterId = null;
			}
		}

		const assessment: ArticleAssessment = {
			article_id: articleId,
			relevance,
			legal_domain: legalDomain,
			jurisdiction,
			reason,
			cluster_id: clusterId,
		};

		assessmentByArticleId.set(articleId, assessment);
	}

	// Verify all input articles were assessed
	for (const article of batch.articles) {
		if (!assessedIds.has(article.id)) {
			return {
				valid: false,
				error: `Missing assessment for input article '${article.id}'`,
			};
		}
	}

	// Validate topic clusters
	if (!Array.isArray(data.topic_clusters)) {
		return { valid: false, error: "'topic_clusters' must be an array" };
	}

	const seenClusterIds = new Set<string>();
	const articleToClusterMap = new Map<string, string>();
	const enrichedClusters: TopicCluster[] = [];

	for (const rawCluster of data.topic_clusters) {
		if (!rawCluster || typeof rawCluster !== "object") {
			return { valid: false, error: "Invalid cluster item in topic_clusters" };
		}

		const cluster = rawCluster as unknown as Record<string, unknown>;
		const clusterId = String(cluster.cluster_id ?? "").trim();
		if (!clusterId) {
			return { valid: false, error: "Topic cluster missing cluster_id" };
		}

		if (seenClusterIds.has(clusterId)) {
			return {
				valid: false,
				error: `Duplicate cluster_id '${clusterId}' in topic_clusters`,
			};
		}
		seenClusterIds.add(clusterId);

		const topicTitle = String(cluster.topic_title ?? "").trim();
		if (!topicTitle) {
			return {
				valid: false,
				error: `Topic cluster '${clusterId}' missing topic_title`,
			};
		}

		const topicSummary = String(cluster.topic_summary ?? "").trim();
		if (!topicSummary) {
			return {
				valid: false,
				error: `Topic cluster '${clusterId}' missing topic_summary`,
			};
		}

		const legalDomain = cluster.legal_domain as TopicLegalDomain;
		if (!VALID_TOPIC_DOMAINS.has(legalDomain)) {
			return {
				valid: false,
				error: `Topic cluster '${clusterId}' has invalid legal_domain '${String(cluster.legal_domain)}'`,
			};
		}

		const jurisdiction = cluster.jurisdiction as TopicJurisdiction;
		if (!VALID_TOPIC_JURISDICTIONS.has(jurisdiction)) {
			return {
				valid: false,
				error: `Topic cluster '${clusterId}' has invalid jurisdiction '${String(cluster.jurisdiction)}'`,
			};
		}

		const significance = cluster.significance as TopicSignificance;
		if (!VALID_SIGNIFICANCE_VALUES.has(significance)) {
			return {
				valid: false,
				error: `Topic cluster '${clusterId}' has invalid significance '${String(cluster.significance)}'`,
			};
		}

		const emergenceStatus = cluster.emergence_status as TopicEmergenceStatus;
		if (!VALID_EMERGENCE_VALUES.has(emergenceStatus)) {
			return {
				valid: false,
				error: `Topic cluster '${clusterId}' has invalid emergence_status '${String(cluster.emergence_status)}'`,
			};
		}

		const editorialAngle = String(cluster.editorial_angle ?? "").trim();
		if (!editorialAngle) {
			return {
				valid: false,
				error: `Topic cluster '${clusterId}' missing editorial_angle`,
			};
		}

		const confidence = Number(cluster.confidence);
		if (
			typeof cluster.confidence !== "number" ||
			Number.isNaN(confidence) ||
			confidence < 0 ||
			confidence > 1
		) {
			return {
				valid: false,
				error: `Topic cluster '${clusterId}' has invalid confidence score '${String(cluster.confidence)}' (must be between 0 and 1)`,
			};
		}

		if (!Array.isArray(cluster.article_ids) || cluster.article_ids.length === 0) {
			return {
				valid: false,
				error: `Topic cluster '${clusterId}' must contain at least one article_id`,
			};
		}

		const supportingArticles: SupportingArticle[] = [];
		for (const rawArtId of cluster.article_ids) {
			const artId = String(rawArtId ?? "").trim();
			if (!inputMap.has(artId)) {
				return {
					valid: false,
					error: `Topic cluster '${clusterId}' references unknown article_id '${artId}'`,
				};
			}

			const assessment = assessmentByArticleId.get(artId)!;
			if (assessment.relevance !== "relevant") {
				return {
					valid: false,
					error: `Topic cluster '${clusterId}' references article '${artId}' which is classified as '${assessment.relevance}', expected 'relevant'`,
				};
			}

			if (articleToClusterMap.has(artId)) {
				return {
					valid: false,
					error: `Article '${artId}' is assigned to multiple topic clusters`,
				};
			}
			articleToClusterMap.set(artId, clusterId);

			const originalArticle = inputMap.get(artId)!;
			supportingArticles.push({
				article_id: originalArticle.id,
				title: originalArticle.title,
				url: originalArticle.url,
			});
		}

		enrichedClusters.push({
			cluster_id: clusterId,
			topic_title: topicTitle,
			topic_summary: topicSummary,
			legal_domain: legalDomain,
			jurisdiction,
			significance,
			emergence_status: emergenceStatus,
			editorial_angle: editorialAngle,
			article_ids: cluster.article_ids.map(String),
			confidence,
			supporting_articles: supportingArticles,
		});
	}

	// Verify cross-consistency between article assessments and clusters
	for (const [articleId, assessment] of assessmentByArticleId.entries()) {
		if (assessment.cluster_id !== null) {
			if (!seenClusterIds.has(assessment.cluster_id)) {
				return {
					valid: false,
					error: `Article '${articleId}' assigned to non-existent cluster_id '${assessment.cluster_id}'`,
				};
			}
			const clusterForArticle = articleToClusterMap.get(articleId);
			if (clusterForArticle !== assessment.cluster_id) {
				return {
					valid: false,
					error: `Inconsistent cluster assignment for article '${articleId}': assessment has '${assessment.cluster_id}', but cluster '${clusterForArticle}' lists it`,
				};
			}
		} else {
			if (articleToClusterMap.has(articleId)) {
				return {
					valid: false,
					error: `Article '${articleId}' has cluster_id null in assessment but is included in cluster '${articleToClusterMap.get(articleId)}'`,
				};
			}
		}
	}

	return {
		valid: true,
		result: {
			batch_number: batch.batch_number,
			article_count: batch.article_count,
			legal_relevant_count: legalRelevantCount,
			not_relevant_count: notRelevantCount,
			uncertain_count: uncertainCount,
			batch_summary: data.batch_summary,
			article_assessments: Array.from(assessmentByArticleId.values()),
			topic_clusters: enrichedClusters,
			quality_warnings: qualityWarnings,
		},
	};
}

/**
 * Executes batch-level legal relevance filtering and topic extraction across
 * 3-day news batches sequentially using Groq AI.
 */
export async function analyzeNewsBatches(
	env: Env,
	options?: GetNewsBatchesOptions | URLSearchParams,
	preloadedBatches?: NewsBatchesResponse
): Promise<AnalyzeBatchesOutcome> {
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
	}

	// 2. Validate Groq model configuration early
	const modelResolution = resolveGroqModel(env);
	if (!modelResolution.success) {
		return modelResolution;
	}
	const model = modelResolution.model;

	// 3. Retrieve batches using existing news-retrieval service or use preloaded
	let batchData: NewsBatchesResponse;
	if (preloadedBatches) {
		batchData = preloadedBatches;
	} else {
		const retrievalOutcome = await getNewsBatches(env, options);
		if (!retrievalOutcome.success) {
			return retrievalOutcome;
		}
		batchData = retrievalOutcome.data;
	}

	// 4. Handle zero articles cleanly without calling Groq
	if (batchData.total_articles === 0) {
		return {
			success: true,
			data: {
				success: true,
				provider: "groq",
				model,
				window_days: batchData.window_days,
				batch_size: batchData.batch_size,
				total_articles: 0,
				batch_count: 0,
				batch_results: [],
				aggregate_metrics: {
					total_articles_analyzed: 0,
					total_legal_relevant: 0,
					total_not_relevant: 0,
					total_uncertain: 0,
					total_candidate_topics: 0,
				},
			},
		};
	}

	// 5. Verify GROQ_API_KEY before processing batches
	if (!env.GROQ_API_KEY?.trim()) {
		return {
			success: false,
			status: 500,
			error: "Missing GROQ_API_KEY configuration",
		};
	}

	// 6. Process each batch sequentially to control concurrency and rate limits
	const batchResults: BatchAnalysisResult[] = [];
	let totalLegalRelevant = 0;
	let totalNotRelevant = 0;
	let totalUncertain = 0;
	let totalCandidateTopics = 0;

	for (let i = 0; i < batchData.batches.length; i++) {
		const batch = batchData.batches[i];
		if (i > 0) {
			// Controlled pacing between sequential batches to mitigate rate-limit risk
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
		const groqResult = await callGroqBatchAnalysis(env, batch.articles);
		if (!groqResult.success) {
			return {
				success: false,
				status: groqResult.status,
				error: `Batch ${batch.batch_number} analysis failed: ${groqResult.error}`,
			};
		}

		const validation = validateAndEnrichBatchAnalysis(groqResult.data, batch);
		if (!validation.valid) {
			return {
				success: false,
				status: 502,
				error: `Batch ${batch.batch_number} analysis validation failed: ${validation.error}`,
			};
		}

		const result = validation.result;
		batchResults.push(result);

		totalLegalRelevant += result.legal_relevant_count;
		totalNotRelevant += result.not_relevant_count;
		totalUncertain += result.uncertain_count;
		totalCandidateTopics += result.topic_clusters.length;
	}

	return {
		success: true,
		data: {
			success: true,
			provider: "groq",
			model,
			window_days: batchData.window_days,
			batch_size: batchData.batch_size,
			total_articles: batchData.total_articles,
			batch_count: batchData.batch_count,
			batch_results: batchResults,
			aggregate_metrics: {
				total_articles_analyzed: batchData.total_articles,
				total_legal_relevant: totalLegalRelevant,
				total_not_relevant: totalNotRelevant,
				total_uncertain: totalUncertain,
				total_candidate_topics: totalCandidateTopics,
			},
		},
	};
}

/**
 * HTTP handler for POST /api/ai/analyze-batches.
 */
export async function handleAnalyzeBatches(
	env: Env,
	searchParams: URLSearchParams
): Promise<Response> {
	const outcome = await analyzeNewsBatches(env, searchParams);

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
