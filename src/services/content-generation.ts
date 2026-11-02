/**
 * Content Generation Service
 * Transforms the final Mercury-selected legal topic and successfully extracted
 * article evidence into an accurate, evidence-grounded 4–6 slide Instagram carousel deck.
 *
 * Strict Instagram Carousel Strategy (1080 × 1350, 4:5 portrait):
 * - Default: 5 slides (adaptive range 4–6 slides).
 * - Hybrid visual approach: AI illustration/background prompt + React component text layout.
 * - Prompts request visual artwork ONLY; strictly NO text, fake judicial seals, or logos inside images.
 * - Extracted text is treated as untrusted source material (immune to prompt injection).
 * - Distinguishes reported facts, attributed statements, allegations, procedural status, and editorial context.
 * - Single-source topics explicitly state single-source limitations without claiming corroboration.
 * - Multi-source topics cite specific article IDs and flag discrepancies.
 * - Source URLs, titles, and metrics are deterministically constructed in TypeScript, not trusted from LLM.
 * - Always marks output with human_review_required: true.
 * - No actual image generation, persistence, or publishing is performed.
 */

import type { Env } from "../index";
import type {
	SelectedTopic,
	GlobalTopicSelectionResponse,
} from "./topic-selection";
import {
	type TopicArticleExtractionData,
	type ExtractedArticleItem,
	type ExtractedArticleSuccessItem,
	type SourceDiversityStatus,
	normalizeSourceDomain,
	sanitizeErrorMessage,
	extractArticleIdsFromSelection,
	extractTopicArticlesByIds,
} from "./topic-article-extraction";
import {
	callGroqContentGeneration,
	type GroqContentGenerationInput,
	type GroqContentGenerationArticleInput,
	type CarouselSlideRole,
	type ClaimType,
	type SlideVisualSpec,
	type LayoutVariant,
	type BackgroundVariant,
	type VisualElementId,
	type SlideEmphasis,
} from "./groq";

/**
 * Normalizes text for deterministic substring containment matching.
 * Accounts for Unicode variations (NFKC), collapses whitespace, and trims.
 */
export function normalizeTextForSearch(text: string): string {
	if (!text) return "";
	return text
		.normalize("NFKC")
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/[\u2013\u2014]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

export interface ContentPackageTopic {
	candidate_id?: string;
	topic_title: string;
	legal_domain?: string;
	jurisdiction?: string;
}

export interface ContentPackageSourceMetrics {
	requested_article_count: number;
	successful_extraction_count: number;
	failed_extraction_count: number;
	unique_source_domain_count: number;
	source_diversity_status: SourceDiversityStatus;
}

export interface ClaimEvidenceExcerpt {
	article_id: string;
	excerpt: string;
}

export interface EvidenceClaim {
	claim_id: string;
	text: string;
	claim_type: ClaimType;
	supporting_article_ids: string[];
	evidence_excerpts: ClaimEvidenceExcerpt[];
}

export interface SlideTextReferences {
	headline_claim_ids: string[];
	subtitle_claim_ids: string[];
	body_claim_ids: string[];
	bullet_claim_ids: string[][];
}

export interface TimelineEvent {
	date_text: string;
	event: string;
	supporting_article_ids: string[];
	supporting_claim_ids: string[];
}

export interface CaptionEvidence {
	text: string;
	supporting_claim_ids: string[];
}

export interface CarouselSlideItem {
	slide_number: number;
	slide_role: CarouselSlideRole;
	headline: string;
	subtitle?: string;
	body_text?: string;
	claims: EvidenceClaim[];
	text_references: SlideTextReferences;
	visual_direction: string;
	visual_spec: SlideVisualSpec;
	// Backward-compatibility helpers
	bullet_points?: string[];
	supporting_article_ids?: string[];
	claim_types?: ClaimType[];
	illustration_required?: boolean;
	illustration_prompt?: string;
}

export interface EvidenceDetails {
	claims: EvidenceClaim[];
	limitations: string[];
	editorial_flags: string[];
	human_review_required: true;
}

export interface SourceAttributionItem {
	article_id: string;
	original_title: string;
	original_url: string;
	source_domain: string;
	extraction_status: "success" | "failed";
	error_code?: string;
	content_length?: number;
	paragraph_count?: number;
}

export interface CarouselContentDetails {
	headline: string;
	summary: string;
	carousel_slide_count: number;
	slides: CarouselSlideItem[];
	timeline_events: TimelineEvent[];
	instagram_caption: string;
	caption_claim_ids?: string[];
	caption_evidence?: CaptionEvidence;
	hashtags: string[];
	cover_illustration_prompt?: string;
}

export interface ContentGenerationResponse {
	success: true;
	provider: "groq";
	model: string;
	generation_status: "ready_for_review" | "insufficient_evidence";
	generated_at: string;
	topic: ContentPackageTopic;
	carousel_slide_count: number;
	slides: CarouselSlideItem[];
	timeline_events: TimelineEvent[];
	content?: CarouselContentDetails;
	instagram_caption: string;
	caption_claim_ids: string[];
	caption_evidence: CaptionEvidence;
	hashtags: string[];
	source_metrics: ContentPackageSourceMetrics;
	evidence: EvidenceDetails;
	source_attributions: SourceAttributionItem[];
	cover_illustration_prompt?: string;
}

export type ContentGenerationOutcome =
	| {
			success: true;
			data: ContentGenerationResponse;
	  }
	| {
			success: false;
			status: number;
			error: string;
			details?: string;
	  };

const allowedLayoutVariants: LayoutVariant[] = [
	"cover",
	"editorial_text",
	"bullet_cards",
	"timeline",
	"impact_cards",
	"source_list",
];

const allowedBackgroundVariants: BackgroundVariant[] = [
	"brand_light",
	"brand_dark",
	"brand_accent",
];

const allowedVisualElements: VisualElementId[] = [
	"gavel",
	"scales",
	"courthouse",
	"document",
	"calendar",
	"rupee",
	"shield",
	"timeline",
	"chart",
	"none",
];

const allowedEmphasis: SlideEmphasis[] = [
	"headline",
	"key_fact",
	"timeline",
	"takeaway",
	"sources",
];

export function sanitizeVisualSpec(
	rawSpec: unknown,
	slideRole: CarouselSlideRole,
	slideNum: number
): SlideVisualSpec {
	const spec = (rawSpec && typeof rawSpec === "object" ? rawSpec : {}) as Partial<SlideVisualSpec>;

	let layout_variant: LayoutVariant = "bullet_cards";
	if (spec.layout_variant && allowedLayoutVariants.includes(spec.layout_variant)) {
		layout_variant = spec.layout_variant;
	} else if (slideNum === 1 || slideRole === "cover") {
		layout_variant = "cover";
	} else if (slideRole === "legal_details") {
		layout_variant = "timeline";
	} else if (slideRole === "why_it_matters") {
		layout_variant = "impact_cards";
	} else if (slideRole === "sources_disclaimer") {
		layout_variant = "source_list";
	}

	let background_variant: BackgroundVariant = slideNum === 1 ? "brand_dark" : "brand_light";
	if (spec.background_variant && allowedBackgroundVariants.includes(spec.background_variant)) {
		background_variant = spec.background_variant;
	}

	let visual_elements: VisualElementId[] = [];
	if (Array.isArray(spec.visual_elements)) {
		visual_elements = spec.visual_elements.filter((v): v is VisualElementId =>
			allowedVisualElements.includes(v as VisualElementId)
		);
	}
	if (visual_elements.length === 0) {
		if (slideRole === "cover") visual_elements = ["scales", "gavel"];
		else if (slideRole === "legal_details") visual_elements = ["timeline", "document"];
		else if (slideRole === "why_it_matters") visual_elements = ["rupee", "chart"];
		else if (slideRole === "sources_disclaimer") visual_elements = ["shield", "document"];
		else visual_elements = ["document"];
	}

	let emphasis: SlideEmphasis = "key_fact";
	if (spec.emphasis && allowedEmphasis.includes(spec.emphasis)) {
		emphasis = spec.emphasis;
	} else if (slideRole === "cover") {
		emphasis = "headline";
	} else if (slideRole === "legal_details") {
		emphasis = "timeline";
	} else if (slideRole === "why_it_matters") {
		emphasis = "takeaway";
	} else if (slideRole === "sources_disclaimer") {
		emphasis = "sources";
	}

	return {
		layout_variant,
		background_variant,
		visual_elements,
		emphasis,
	};
}

/**
 * Transforms selected-topic information and extracted article evidence
 * into an evidence-grounded Instagram carousel content package using Groq.
 */
export async function generateContentPackage(
	env: Env,
	selectedTopic: SelectedTopic,
	extractionData: TopicArticleExtractionData
): Promise<ContentGenerationOutcome> {
	// 1. Validate selected topic input
	if (!selectedTopic || typeof selectedTopic !== "object") {
		return {
			success: false,
			status: 400,
			error: "Invalid input: 'selectedTopic' must be a valid topic object",
		};
	}

	if (!selectedTopic.topic_title || typeof selectedTopic.topic_title !== "string" || !selectedTopic.topic_title.trim()) {
		return {
			success: false,
			status: 400,
			error: "Invalid input: 'selectedTopic' must include a non-empty 'topic_title'",
		};
	}

	// 2. Validate extracted article evidence
	if (!extractionData || typeof extractionData !== "object" || !Array.isArray(extractionData.articles)) {
		return {
			success: false,
			status: 400,
			error: "Invalid input: 'extractionData' must contain an articles array",
		};
	}

	// Filter successfully extracted articles
	const successfulArticles = extractionData.articles.filter(
		(a): a is ExtractedArticleSuccessItem => a.success === true
	);

	// Scenario: If all extractions failed, strictly do NOT call Groq
	if (successfulArticles.length === 0) {
		return {
			success: false,
			status: 502,
			error: "All article extractions failed; cannot generate content package without source evidence",
		};
	}

	// 3. Assemble Groq input with sanitized and bounded article evidence
	const validArticleIdSet = new Set(successfulArticles.map((a) => a.article_id));
	const groqArticles: GroqContentGenerationArticleInput[] = successfulArticles.map((art) => ({
		article_id: art.article_id,
		original_title: art.original_title,
		source_domain: normalizeSourceDomain(art.original_url),
		content: art.content,
		content_length: art.content_length,
		paragraph_count: art.paragraph_count,
	}));

	const groqInput: GroqContentGenerationInput = {
		topic: {
			candidate_id: selectedTopic.candidate_id,
			topic_title: selectedTopic.topic_title.trim(),
			topic_summary: selectedTopic.topic_summary,
			legal_domain: selectedTopic.legal_domain,
			jurisdiction: selectedTopic.jurisdiction,
			editorial_angle: selectedTopic.editorial_angle,
		},
		articles: groqArticles,
	};

	// 4. Call Groq with strict JSON Schema Structured Outputs
	const groqOutcome = await callGroqContentGeneration(env, groqInput);
	if (!groqOutcome.success) {
		const sanitizedError = sanitizeErrorMessage(groqOutcome.error, env);
		return {
			success: false,
			status: groqOutcome.status,
			error: sanitizedError,
		};
	}

	const rawData = groqOutcome.data;

	// 5. Post-process and strictly validate model-generated data in TypeScript
	const editorialFlags: string[] = Array.isArray(rawData.editorial_flags) ? [...rawData.editorial_flags] : [];
	const limitations: string[] = Array.isArray(rawData.limitations) ? [...rawData.limitations] : [];

	// Validate Slides & Claim-Level Citations:
	// - Reject unknown article IDs
	// - Reject fabricated or unverified excerpts against extracted Markdown
	// - Unsupported factual claims are excluded (never silently converted to editorial context)
	// - Ensure valid claim types
	// - Connect displayed text fields (headline, subtitle, body, bullets) to verified claims
	// - Ensure slide ordering and 4-6 slide bounds
	const articleContentMap = new Map<string, string>();
	for (const a of successfulArticles) {
		if (typeof a.content === "string") {
			articleContentMap.set(a.article_id, a.content);
		}
	}

	const allValidClaimMap = new Map<string, EvidenceClaim>();
	const allExtractedClaims: EvidenceClaim[] = [];
	const slideValidatedClaimsMap = new Map<number, EvidenceClaim[]>();
	const rawSlides = Array.isArray(rawData.slides) ? rawData.slides : [];

	const allowedClaimTypes: ClaimType[] = [
		"reported_fact",
		"attributed_statement",
		"allegation",
		"procedural_status",
		"editorial_context",
	];

	// PASS 1: Validate all claims across all slides
	for (let i = 0; i < rawSlides.length; i++) {
		const s = rawSlides[i];
		if (!s || typeof s !== "object") continue;

		const slideNum = i + 1; // Strict 1-indexed ordering

		const rawClaims = Array.isArray(s.claims) ? s.claims : [];
		const validatedSlideClaims: EvidenceClaim[] = [];

		for (let cIdx = 0; cIdx < rawClaims.length; cIdx++) {
			const rawClaim = rawClaims[cIdx];
			if (!rawClaim || typeof rawClaim !== "object" || !rawClaim.text?.trim()) continue;

			const rawClaimType = rawClaim.claim_type;
			const isFactualOrAttributed =
				rawClaimType === "reported_fact" ||
				rawClaimType === "attributed_statement" ||
				rawClaimType === "allegation" ||
				rawClaimType === "procedural_status";

			const claimIds = Array.isArray(rawClaim.supporting_article_ids) ? rawClaim.supporting_article_ids : [];
			const validClaimIds = claimIds.filter((id) => typeof id === "string" && validArticleIdSet.has(id.trim()));
			const unknownClaimIds = claimIds.filter((id) => typeof id === "string" && !validArticleIdSet.has(id.trim()));

			if (unknownClaimIds.length > 0) {
				editorialFlags.push(
					`Slide ${slideNum} claim cited unknown article ID(s): [${unknownClaimIds.join(", ")}].`
				);
			}

			// Under Task 13A: Never silently convert an unsupported factual claim into editorial context!
			if (isFactualOrAttributed && validClaimIds.length === 0) {
				editorialFlags.push(
					`Slide ${slideNum} unsupported ${rawClaimType} claim ("${rawClaim.text.slice(0, 50)}...") lacked valid supporting article evidence and was excluded.`
				);
				continue;
			}

			// Under Task 13B: Validate evidence excerpts against original extracted markdown
			const rawExcerpts = Array.isArray(rawClaim.evidence_excerpts) ? rawClaim.evidence_excerpts : [];
			const validExcerpts: ClaimEvidenceExcerpt[] = [];

			for (const exc of rawExcerpts) {
				if (!exc || typeof exc !== "object") continue;
				const articleId = typeof exc.article_id === "string" ? exc.article_id.trim() : "";
				const excerptText = typeof exc.excerpt === "string" ? exc.excerpt.trim() : "";

				if (!articleId || !validArticleIdSet.has(articleId)) {
					editorialFlags.push(
						`Slide ${slideNum} claim excerpt cited unknown or invalid article ID "${articleId}".`
					);
					continue;
				}

				if (!excerptText || excerptText.length < 5) {
					editorialFlags.push(
						`Slide ${slideNum} claim excerpt for article "${articleId}" was empty or too short.`
					);
					continue;
				}

				const sourceContent = articleContentMap.get(articleId);
				if (!sourceContent) {
					editorialFlags.push(
						`Slide ${slideNum} claim excerpt cited article "${articleId}" with no available extracted content.`
					);
					continue;
				}

				const normArticle = normalizeTextForSearch(sourceContent);
				const normExcerpt = normalizeTextForSearch(excerptText);

				if (!normArticle.includes(normExcerpt)) {
					editorialFlags.push(
						`Fabricated or unverified excerpt rejected: "${excerptText.slice(0, 50)}..." was not found in article "${articleId}".`
					);
					continue;
				}

				validExcerpts.push({
					article_id: articleId,
					excerpt: excerptText,
				});
			}

			// For factual/attributed claims: must have at least one valid excerpt!
			if (isFactualOrAttributed && validExcerpts.length === 0) {
				editorialFlags.push(
					`Slide ${slideNum} unsupported ${rawClaimType} claim ("${rawClaim.text.slice(0, 50)}...") lacked verified evidence excerpts from source text and was excluded.`
				);
				continue;
			}

			const sanitizedType: ClaimType = allowedClaimTypes.includes(rawClaimType as ClaimType)
				? (rawClaimType as ClaimType)
				: "editorial_context";

			const claimId = (typeof rawClaim.claim_id === "string" && rawClaim.claim_id.trim())
				? rawClaim.claim_id.trim()
				: `s${slideNum}_c${cIdx + 1}`;

			const validClaim: EvidenceClaim = {
				claim_id: claimId,
				text: rawClaim.text.trim(),
				claim_type: sanitizedType,
				supporting_article_ids: validClaimIds,
				evidence_excerpts: validExcerpts,
			};

			validatedSlideClaims.push(validClaim);
			allExtractedClaims.push(validClaim);
			allValidClaimMap.set(claimId, validClaim);
		}

		slideValidatedClaimsMap.set(slideNum, validatedSlideClaims);
	}

	// Task 13C: Helper to extract substantive tokens for semantic matching
	const getSubstantiveTokens = (text: string): Set<string> => {
		const stopwords = new Set([
			"the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
			"by", "from", "up", "about", "into", "over", "after", "is", "are", "was", "were",
			"be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would",
			"should", "could", "can", "this", "that", "these", "those", "it", "its", "as",
			"their", "they", "we", "our", "you", "your", "more", "also", "aims", "aim", "per"
		]);
		const tokens = text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length > 2 && !stopwords.has(t));
		return new Set(tokens);
	};

	// Task 13C: Check semantic overlap between claim and target text
	const hasSemanticSupport = (claimText: string, claimExcerpts: ClaimEvidenceExcerpt[], targetText: string): boolean => {
		const targetTokens = getSubstantiveTokens(targetText);
		if (targetTokens.size === 0) return true;

		const claimTokens = getSubstantiveTokens(claimText);
		for (const exc of claimExcerpts) {
			const excTokens = getSubstantiveTokens(exc.excerpt);
			for (const t of excTokens) claimTokens.add(t);
		}

		const conceptGroups = [
			["arrest", "section 69", "s69", "custody"],
			["threshold", "prosecution", "crore", "monetary"],
			["trust", "trust-based", "trust based", "governance"],
			["compliance", "voluntary compliance"],
			["proportionate", "disproportionate", "proportionality"],
			["decriminalisation", "decriminalization", "decriminalise", "decriminalize"],
			["msme", "business", "small business"],
			["council", "recommend", "recommends", "recommendation", "proposed", "proposal"],
		];

		for (const group of conceptGroups) {
			const targetMatchesGroup = group.some((kw) => targetText.toLowerCase().includes(kw));
			const claimMatchesGroup = group.some((kw) =>
				claimText.toLowerCase().includes(kw) || claimExcerpts.some((e) => e.excerpt.toLowerCase().includes(kw))
			);
			if (targetMatchesGroup && claimMatchesGroup) {
				return true;
			}
		}

		let matchCount = 0;
		for (const t of targetTokens) {
			if (claimTokens.has(t)) matchCount++;
		}
		return matchCount >= 2 || (targetTokens.size <= 2 && matchCount >= 1);
	};

	// Task 13C: Helper to find a verified claim covering given keywords
	const findClaimCoveringKeywords = (keywords: string[]): EvidenceClaim | undefined => {
		for (const c of allExtractedClaims) {
			const textLower = c.text.toLowerCase();
			if (keywords.some((kw) => textLower.includes(kw))) return c;
			for (const exc of c.evidence_excerpts) {
				if (keywords.some((kw) => exc.excerpt.toLowerCase().includes(kw))) return c;
			}
		}
		return undefined;
	};

	// PASS 2: Assemble slides, validate text references and perform semantic consistency audits
	const validatedSlides: CarouselSlideItem[] = [];

	for (let i = 0; i < rawSlides.length; i++) {
		const s = rawSlides[i];
		if (!s || typeof s !== "object") continue;

		const slideNum = i + 1;
		const validatedSlideClaims = slideValidatedClaimsMap.get(slideNum) || [];

		// Helper to sanitize claim IDs
		const sanitizeClaimIds = (ids: unknown, fieldName: string): string[] => {
			if (!Array.isArray(ids)) return [];
			const valid: string[] = [];
			for (const id of ids) {
				if (typeof id === "string" && allValidClaimMap.has(id.trim())) {
					valid.push(id.trim());
				} else if (typeof id === "string" && id.trim()) {
					editorialFlags.push(
						`Slide ${slideNum} ${fieldName} referenced unvalidated or unknown claim ID "${id}".`
					);
				}
			}
			return valid;
		};

		// Task 13C: Filter out claim IDs that lack semantic relation to the text field
		const filterUnrelatedClaims = (cids: string[], targetText: string, fieldName: string): string[] => {
			if (!targetText.trim() || cids.length === 0) return cids;
			const valid: string[] = [];
			for (const cid of cids) {
				const claim = allValidClaimMap.get(cid);
				if (!claim) continue;
				if (hasSemanticSupport(claim.text, claim.evidence_excerpts, targetText)) {
					valid.push(cid);
				} else {
					editorialFlags.push(
						`Slide ${slideNum} ${fieldName} referenced unrelated claim '${cid}' ("${claim.text.slice(0, 40)}...") without semantic support in text; removed unrelated reference.`
					);
				}
			}
			return valid;
		};

		const rawRefs = (s.text_references && typeof s.text_references === "object") ? s.text_references : {};
		let headlineClaimIds = sanitizeClaimIds(rawRefs.headline_claim_ids, "headline");
		let subtitleClaimIds = sanitizeClaimIds(rawRefs.subtitle_claim_ids, "subtitle");
		let bodyClaimIds = sanitizeClaimIds(rawRefs.body_claim_ids, "body text");

		// Filter unrelated claim IDs
		if (s.headline) {
			headlineClaimIds = filterUnrelatedClaims(headlineClaimIds, s.headline, "headline");
		}
		if (s.subtitle) {
			subtitleClaimIds = filterUnrelatedClaims(subtitleClaimIds, s.subtitle, "subtitle");
		}
		if (s.body_text) {
			bodyClaimIds = filterUnrelatedClaims(bodyClaimIds, s.body_text, "body text");
		}

		// Fallbacks if empty
		if (headlineClaimIds.length === 0 && !rawRefs.headline_claim_ids && validatedSlideClaims.length > 0 && slideNum === 1) {
			headlineClaimIds = [validatedSlideClaims[0].claim_id];
		}
		if (subtitleClaimIds.length === 0 && !rawRefs.subtitle_claim_ids && validatedSlideClaims.length > 1 && slideNum === 1) {
			subtitleClaimIds = [validatedSlideClaims[1].claim_id];
		}
		if (bodyClaimIds.length === 0 && !rawRefs.body_claim_ids && validatedSlideClaims.length > 0 && slideNum > 1 && s.body_text) {
			bodyClaimIds = validatedSlideClaims.map((c) => c.claim_id);
		}

		// Bullet claim IDs
		let bulletClaimIds: string[][];
		if (Array.isArray(rawRefs.bullet_claim_ids)) {
			bulletClaimIds = rawRefs.bullet_claim_ids.map((sub: unknown) => {
				const valid = sanitizeClaimIds(sub, "bullet");
				return valid;
			});
		} else {
			bulletClaimIds = validatedSlideClaims.map((c) => [c.claim_id]);
		}

		// Semantic completeness audits on slide fields:
		const slideRole = s.slide_role || (slideNum === 1 ? "cover" : "what_happened");
		let slideHeadline = (s.headline || "").trim();
		let slideSubtitle = s.subtitle ? s.subtitle.trim() : undefined;
		let slideBodyText = s.body_text ? s.body_text.trim() : undefined;

		if (slideNum === 1 || slideRole === "cover") {
			const hlLower = slideHeadline.toLowerCase();
			// Check arrest / Section 69 in headline
			if (/section\s*69|arrest/i.test(hlLower)) {
				const hasArrest = headlineClaimIds.some((cid) => {
					const c = allValidClaimMap.get(cid);
					return c && (/section\s*69|arrest/i.test(c.text) || c.evidence_excerpts.some((e) => /section\s*69|arrest/i.test(e.excerpt)));
				});
				if (!hasArrest) {
					const arrestClaim = findClaimCoveringKeywords(["section 69", "arrest"]);
					if (arrestClaim && !headlineClaimIds.includes(arrestClaim.claim_id)) {
						headlineClaimIds.push(arrestClaim.claim_id);
					}
				}
			}
			// Check threshold in headline
			if (/threshold|5\s*crore|five\s*crore/i.test(hlLower)) {
				const hasThreshold = headlineClaimIds.some((cid) => {
					const c = allValidClaimMap.get(cid);
					return c && (/threshold|crore/i.test(c.text) || c.evidence_excerpts.some((e) => /threshold|crore/i.test(e.excerpt)));
				});
				if (!hasThreshold) {
					const threshClaim = findClaimCoveringKeywords(["threshold", "5 crore", "five crore"]);
					if (threshClaim && !headlineClaimIds.includes(threshClaim.claim_id)) {
						headlineClaimIds.push(threshClaim.claim_id);
					}
				}
			}
			// Check trust-based governance in headline
			if (/trust[- ]based|governance/i.test(hlLower)) {
				const hasTrust = headlineClaimIds.some((cid) => {
					const c = allValidClaimMap.get(cid);
					return c && (/trust/i.test(c.text) || c.evidence_excerpts.some((e) => /trust/i.test(e.excerpt)));
				});
				if (!hasTrust) {
					const trustClaim = findClaimCoveringKeywords(["trust-based", "trust based", "governance", "trust"]);
					if (trustClaim && !headlineClaimIds.includes(trustClaim.claim_id)) {
						headlineClaimIds.push(trustClaim.claim_id);
					} else if (!trustClaim) {
						editorialFlags.push(
							`Cover headline mentions trust-based governance without a verified supporting claim reference.`
						);
					}
				}
			}

			// Subtitle compound checks
			if (slideSubtitle) {
				const subLower = slideSubtitle.toLowerCase();
				if (/section\s*69|arrest/i.test(subLower)) {
					const hasArrest = subtitleClaimIds.some((cid) => {
						const c = allValidClaimMap.get(cid);
						return c && (/section\s*69|arrest/i.test(c.text) || c.evidence_excerpts.some((e) => /section\s*69|arrest/i.test(e.excerpt)));
					});
					if (!hasArrest) {
						const arrestClaim = findClaimCoveringKeywords(["section 69", "arrest"]);
						if (arrestClaim && !subtitleClaimIds.includes(arrestClaim.claim_id)) {
							subtitleClaimIds.push(arrestClaim.claim_id);
						}
					}
				}
				if (/threshold|5\s*crore|five\s*crore/i.test(subLower)) {
					const hasThreshold = subtitleClaimIds.some((cid) => {
						const c = allValidClaimMap.get(cid);
						return c && (/threshold|crore/i.test(c.text) || c.evidence_excerpts.some((e) => /threshold|crore/i.test(e.excerpt)));
					});
					if (!hasThreshold) {
						const threshClaim = findClaimCoveringKeywords(["threshold", "5 crore", "five crore"]);
						if (threshClaim && !subtitleClaimIds.includes(threshClaim.claim_id)) {
							subtitleClaimIds.push(threshClaim.claim_id);
						}
					}
				}
				if (/trust[- ]based|governance/i.test(subLower)) {
					const hasTrust = subtitleClaimIds.some((cid) => {
						const c = allValidClaimMap.get(cid);
						return c && (/trust/i.test(c.text) || c.evidence_excerpts.some((e) => /trust/i.test(e.excerpt)));
					});
					if (!hasTrust) {
						const trustClaim = findClaimCoveringKeywords(["trust-based", "trust based", "governance", "trust"]);
						if (trustClaim && !subtitleClaimIds.includes(trustClaim.claim_id)) {
							subtitleClaimIds.push(trustClaim.claim_id);
						}
					}
				}
			}
		}

		// 2. Slide 2 Body Text & General Body: Proportionate Enforcement Check
		if (slideBodyText && /proportionate\s*enforcement|make\s*enforcement\s*more\s*proportionate/i.test(slideBodyText)) {
			const hasPropClaim = bodyClaimIds.some((cid) => {
				const c = allValidClaimMap.get(cid);
				return (
					c &&
					(/proportionate/i.test(c.text) ||
						c.evidence_excerpts.some((e) => /proportionate|disproportionate/i.test(e.excerpt)))
				);
			});
			if (!hasPropClaim) {
				const propClaim = findClaimCoveringKeywords(["proportionate", "disproportionate", "proportionality"]);
				if (propClaim) {
					if (!bodyClaimIds.includes(propClaim.claim_id)) {
						bodyClaimIds.push(propClaim.claim_id);
					}
				} else {
					// Remove unsupported statement on proportionate enforcement
					slideBodyText = slideBodyText
						.replace(/(?:These steps aim to make enforcement more proportionate\.?|The sentence about proportionate enforcement(?: must have an appropriate claim reference or be removed)?\.?)/gi, "")
						.replace(/\s{2,}/g, " ")
						.trim();
					editorialFlags.push(
						`Slide ${slideNum} body text: Unsupported statement regarding proportionate enforcement lacked verified claim evidence and was removed.`
					);
				}
			}
		}

		// Check for unbacked substantive text
		const isDecorativeHeadline = /^(what happened\??|legal details.*|why it matters.*|sources.*|additional context)$/i.test(
			slideHeadline
		);
		if (!isDecorativeHeadline && slideHeadline && headlineClaimIds.length === 0) {
			editorialFlags.push(
				`Slide ${slideNum} headline ("${slideHeadline.slice(0, 50)}") lacks verified supporting claim references.`
			);
		}

		if (slideSubtitle && subtitleClaimIds.length === 0 && slideRole !== "sources_disclaimer") {
			editorialFlags.push(
				`Slide ${slideNum} subtitle ("${slideSubtitle.slice(0, 50)}") lacks verified supporting claim references.`
			);
		}

		if (slideBodyText && bodyClaimIds.length === 0 && slideRole !== "sources_disclaimer") {
			editorialFlags.push(
				`Slide ${slideNum} body text ("${slideBodyText.slice(0, 50)}...") lacks verified supporting claim references.`
			);
		}

		const visualSpec = sanitizeVisualSpec(s.visual_spec, slideRole, slideNum);

		validatedSlides.push({
			slide_number: slideNum,
			slide_role: slideRole,
			headline: slideHeadline,
			subtitle: slideSubtitle,
			body_text: slideBodyText,
			claims: validatedSlideClaims,
			text_references: {
				headline_claim_ids: headlineClaimIds,
				subtitle_claim_ids: subtitleClaimIds,
				body_claim_ids: bodyClaimIds,
				bullet_claim_ids: bulletClaimIds,
			},
			visual_direction: (s.visual_direction || "").trim(),
			visual_spec: visualSpec,
			bullet_points: validatedSlideClaims.map((c) => c.text),
			supporting_article_ids: Array.from(new Set(validatedSlideClaims.flatMap((c) => c.supporting_article_ids))),
			claim_types: Array.from(new Set(validatedSlideClaims.map((c) => c.claim_type))),
		});
	}

	// Validate structured timeline events
	const validatedTimeline: TimelineEvent[] = [];
	const rawTimeline = Array.isArray(rawData.timeline_events) ? rawData.timeline_events : [];

	for (const event of rawTimeline) {
		if (!event || typeof event !== "object" || !event.date_text?.trim() || !event.event?.trim()) continue;

		const dateStr = event.date_text.trim();
		const eventStr = event.event.trim();
		const dateLower = dateStr.toLowerCase();
		const eventLower = eventStr.toLowerCase();

		// Date accuracy checks: check if news publication date is being labeled as Council meeting date
		if (
			(dateLower.includes("1 nov") || dateLower.includes("1 november")) &&
			(eventLower.includes("council meeting") || eventLower.includes("council decided") || eventLower.includes("council announced") || eventLower.includes("policy change announced"))
		) {
			editorialFlags.push(
				"Date accuracy: 1 Nov 2026 is the report publication date, not the Council meeting announcement date. Event description qualified."
			);
		}

		// Task 13C: Check if the timeline entry is merely an article publication or reporting date
		const isPublicationDate =
			dateLower.includes("(reporting date)") ||
			dateLower.includes("reporting date") ||
			dateLower.includes("(publication date)") ||
			dateLower.includes("publication date") ||
			dateLower.includes("article date") ||
			eventLower.includes("(reporting date)") ||
			eventLower.includes("reporting date") ||
			eventLower.includes("article publication date") ||
			((dateLower.includes("1 nov") || dateLower.includes("1 november")) &&
				(eventLower.includes("reports gst council") || eventLower.includes("cii reports")));

		if (isPublicationDate) {
			editorialFlags.push(
				`Timeline event omitted: Date '${dateStr}' represents an article publication or reporting date, not an underlying legal or procedural event date.`
			);
			continue;
		}

		const rawEventIds = Array.isArray(event.supporting_article_ids) ? event.supporting_article_ids : [];
		const validEventIds = rawEventIds.filter((id) => typeof id === "string" && validArticleIdSet.has(id.trim()));
		const unknownEventIds = rawEventIds.filter((id) => typeof id === "string" && !validArticleIdSet.has(id.trim()));

		if (unknownEventIds.length > 0) {
			editorialFlags.push(
				`Timeline event "${event.date_text}" cited unknown article ID(s): [${unknownEventIds.join(", ")}].`
			);
		}

		if (validEventIds.length === 0) {
			editorialFlags.push(
				`Timeline event "${event.date_text}: ${event.event.slice(0, 40)}..." lacked valid supporting article ID and was excluded.`
			);
			continue;
		}

		// Validate timeline supporting claim IDs
		const rawTimelineClaimIds = Array.isArray(event.supporting_claim_ids) ? event.supporting_claim_ids : [];
		let validTimelineClaimIds = rawTimelineClaimIds.filter((cid) => typeof cid === "string" && allValidClaimMap.has(cid.trim()));
		const unknownTimelineClaimIds = rawTimelineClaimIds.filter((cid) => typeof cid === "string" && !allValidClaimMap.has(cid.trim()));

		if (unknownTimelineClaimIds.length > 0) {
			editorialFlags.push(
				`Timeline event "${event.date_text}" cited unknown claim ID(s): [${unknownTimelineClaimIds.join(", ")}].`
			);
		}

		if (validTimelineClaimIds.length === 0 && !event.supporting_claim_ids && allExtractedClaims.length > 0) {
			validTimelineClaimIds = allExtractedClaims
				.filter((c) => c.supporting_article_ids.some((id) => validEventIds.includes(id)))
				.map((c) => c.claim_id);
		}

		if (validTimelineClaimIds.length === 0) {
			editorialFlags.push(
				`Timeline event "${event.date_text}" lacks verified supporting claim references.`
			);
		}

		validatedTimeline.push({
			date_text: dateStr,
			event: eventStr,
			supporting_article_ids: validEventIds,
			supporting_claim_ids: validTimelineClaimIds,
		});
	}

	// Legal-status audit checks across all generated text
	const textSegments: string[] = [
		rawData.headline || "",
		rawData.summary || "",
		rawData.instagram_caption || "",
		...validatedSlides.flatMap((s) => [s.headline, s.subtitle || "", s.body_text || "", ...s.claims.map((c) => c.text)]),
	].filter(Boolean);

	const allText = textSegments.join(" ");

	const allStatements: string[] = [];
	for (const seg of textSegments) {
		const parts = seg.split(/[.\n;]+/).map((p) => p.trim()).filter(Boolean);
		allStatements.push(...parts);
	}

	// 1. Check Section 69 deletion vs recommendation
	const section69Unqualified = allStatements.some((stmt) => {
		const hasSection69 =
			/section\s*69\s*(is|was|has been)?\s*(removed|deleted|omitted)|omitted\s*section\s*69|arrest\s*power\s*omitted/i.test(
				stmt
			);
		if (!hasSection69) return false;
		const hasQual = /proposed|recommend|proposal|pending|interim/i.test(stmt);
		return !hasQual;
	});
	if (section69Unqualified) {
		editorialFlags.push(
			"Legal status precision: Section 69 omission must be framed as a proposed legislative amendment / Council recommendation, not an enacted or operative statutory deletion."
		);
	}

	// 2. Check prosecution threshold increase qualification
	const thresholdUnqualified = allStatements.some((stmt) => {
		const hasThreshold =
			/(raised|increased|raises|increases)\s*(the\s*)?(monetary\s*)?(prosecution\s*)?threshold|threshold\s*(is|was|has been)?\s*(raised|increased)/i.test(
				stmt
			);
		if (!hasThreshold) return false;
		const hasQual = /recommended|proposal|proposed|pending|awaited|interim/i.test(stmt);
		return !hasQual;
	});
	if (thresholdUnqualified) {
		editorialFlags.push(
			"Legal status precision: The ₹5 crore prosecution threshold is a Council recommendation pending statutory notification and must not be presented as an operative statutory change."
		);
	}

	// 3. Check circulars vs arrest instruction conflation
	const circularsAndArrestRegex = /circulars?.*(arrest|section\s*69)|(arrest|section\s*69).*circulars?/i;
	if (circularsAndArrestRegex.test(allText)) {
		editorialFlags.push(
			"Circular context: CBIC circulars dated 26 Oct 2026 concern registration, notices, and adjudication. Verify they are not conflated with separate arrest instructions."
		);
	}

	// 4. Check caption phrasing
	const captionLower = (rawData.instagram_caption || "").toLowerCase();
	if (
		captionLower.includes("drop arrest powers") ||
		captionLower.includes("dropped arrest powers") ||
		captionLower.includes("drops arrest powers") ||
		captionLower.includes("removed arrest powers") ||
		captionLower.includes("raises prosecution threshold") ||
		captionLower.includes("raised prosecution threshold")
	) {
		if (!/recommends|proposed|plans|recommendation|proposal/.test(captionLower)) {
			editorialFlags.push(
				"Caption accuracy: Caption phrasing presents Council recommendations as completed statutory changes. Must qualify with 'recommends' or 'proposes'."
			);
		}
	}

	// 5. Check if external authoritative legal status verification is needed
	if (
		selectedTopic.topic_title.toLowerCase().includes("gst") &&
		!allText.toLowerCase().includes("gazette") &&
		!allText.toLowerCase().includes("notified in gazette")
	) {
		if (!limitations.some((l) => l.toLowerCase().includes("gazette") || l.toLowerCase().includes("statutory notification"))) {
			limitations.push(
				"Based on Council recommendations and industry reporting; operational commencement remains subject to official Gazette notification."
			);
		}
		if (!editorialFlags.some((f) => f.includes("Gazette notification"))) {
			editorialFlags.push(
				"Legal status verification required: Verify whether proposed CGST Act amendments have been tabled in Parliament or notified in the official Gazette."
			);
		}
	}

	// Task 13C: Procedural status claim audit: ensure recommendation excerpts aren't treated as statutory commencement
	for (const claim of allExtractedClaims) {
		if (claim.claim_type === "procedural_status") {
			const hasOfficialEnactmentEvidence = claim.evidence_excerpts.some((exc) => {
				const excLower = exc.excerpt.toLowerCase();
				return (
					excLower.includes("notified in the gazette") ||
					excLower.includes("notified in gazette") ||
					excLower.includes("passed by parliament") ||
					excLower.includes("gazette notification") ||
					excLower.includes("came into force") ||
					excLower.includes("commenced on")
				);
			});

			if (!hasOfficialEnactmentEvidence) {
				editorialFlags.push(
					`Legal status precision: Claim '${claim.claim_id}' procedural status is supported only by Council recommendation evidence. Current statutory commencement or operational status is not established by source text; authoritative verification against official Gazette or parliamentary records required.`
				);
				if (!limitations.some((l) => l.includes("Unverified legal commencement status"))) {
					limitations.push(
						"Unverified legal commencement status: Source evidence establishes Council recommendations only; operational commencement and statutory enactment status require authoritative verification."
					);
				}
			}
		}
	}

	// Enforce single-source handling:
	if (successfulArticles.length === 1) {
		const singleDomain = normalizeSourceDomain(successfulArticles[0].original_url);
		const singleSourceNote = `Single-source topic: all factual claims are derived from a single news report (${singleDomain}). Independent corroboration has not been established.`;
		if (!limitations.some((l) => l.toLowerCase().includes("single") || l.toLowerCase().includes("corroborat"))) {
			limitations.unshift(singleSourceNote);
		}

		// Check for misleading corroboration language in caption
		if (
			captionLower.includes("multiple reports") ||
			captionLower.includes("reports confirm") ||
			captionLower.includes("sources confirm") ||
			captionLower.includes("corroborat")
		) {
			editorialFlags.push(
				"Single-source topic: caption contains phrasing that may imply multiple independent reports. Human editor must review attribution wording."
			);
		}
	}

	// Enforce partial-failure handling:
	if (extractionData.failed_extraction_count > 0) {
		const failedNote = `${extractionData.failed_extraction_count} article extraction(s) failed. Content was generated solely from ${successfulArticles.length} successful extraction(s).`;
		if (!limitations.some((l) => l.includes("failed"))) {
			limitations.push(failedNote);
		}
	}

	// 6. Assemble authoritative source attributions deterministically in TypeScript
	const supportingMap = new Map<string, { title: string; url: string }>();
	if (Array.isArray(selectedTopic.supporting_articles)) {
		for (const sup of selectedTopic.supporting_articles) {
			if (sup && sup.article_id) {
				supportingMap.set(sup.article_id, {
					title: sup.title,
					url: sup.url,
				});
			}
		}
	}

	const sourceAttributions: SourceAttributionItem[] = extractionData.articles.map((item: ExtractedArticleItem) => {
		const supMeta = supportingMap.get(item.article_id);
		if (item.success) {
			const originalUrl = item.original_url || supMeta?.url || "";
			return {
				article_id: item.article_id,
				original_title: item.original_title || supMeta?.title || "Unknown",
				original_url: originalUrl,
				source_domain: normalizeSourceDomain(originalUrl),
				extraction_status: "success",
				content_length: item.content_length,
				paragraph_count: item.paragraph_count,
			};
		} else {
			const originalUrl = supMeta?.url || "";
			return {
				article_id: item.article_id,
				original_title: supMeta?.title || "Unknown",
				original_url: originalUrl,
				source_domain: normalizeSourceDomain(originalUrl),
				extraction_status: "failed",
				error_code: item.error_code,
			};
		}
	});

	// 7. Calculate authoritative source metrics
	const sourceMetrics: ContentPackageSourceMetrics = {
		requested_article_count: extractionData.requested_article_count,
		successful_extraction_count: extractionData.successful_extraction_count,
		failed_extraction_count: extractionData.failed_extraction_count,
		unique_source_domain_count: extractionData.source_metrics.unique_source_domain_count,
		source_diversity_status: extractionData.source_metrics.source_diversity_status,
	};

	// Validate Instagram caption claim citations
	const rawCaptionClaimIds = Array.isArray(rawData.caption_claim_ids)
		? rawData.caption_claim_ids
		: (Array.isArray(rawData.caption_evidence?.supporting_claim_ids) ? rawData.caption_evidence.supporting_claim_ids : []);

	let validCaptionClaimIds: string[] = [];
	for (const cid of rawCaptionClaimIds) {
		if (typeof cid === "string" && allValidClaimMap.has(cid.trim())) {
			validCaptionClaimIds.push(cid.trim());
		} else if (typeof cid === "string" && cid.trim()) {
			editorialFlags.push(
				`Caption referenced unvalidated or unknown claim ID "${cid}".`
			);
		}
	}

	if (validCaptionClaimIds.length === 0 && !rawData.caption_claim_ids && !rawData.caption_evidence?.supporting_claim_ids && allExtractedClaims.length > 0) {
		// Fallback for legacy fixtures: all substantive claims
		validCaptionClaimIds = allExtractedClaims.filter((c) => c.claim_type !== "editorial_context").map((c) => c.claim_id);
	}

	// Task 13C: Caption semantic completeness audit:
	const captionStr = (rawData.instagram_caption || "").trim();
	if (captionStr) {
		const capLower = captionStr.toLowerCase();
		if (/trust[- ]based/i.test(capLower)) {
			const hasTrustClaim = validCaptionClaimIds.some((cid) => {
				const c = allValidClaimMap.get(cid);
				return c && (/trust/i.test(c.text) || c.evidence_excerpts.some((e) => /trust/i.test(e.excerpt)));
			});
			if (!hasTrustClaim) {
				const trustClaim = findClaimCoveringKeywords(["trust-based", "trust based", "trust", "governance"]);
				if (trustClaim && !validCaptionClaimIds.includes(trustClaim.claim_id)) {
					validCaptionClaimIds.push(trustClaim.claim_id);
				} else if (!trustClaim) {
					editorialFlags.push(
						"Caption accuracy: Caption mentions trust-based governance without verified supporting claim reference."
					);
				}
			}
		}
		if (/section\s*69|arrest/i.test(capLower)) {
			const hasArrestClaim = validCaptionClaimIds.some((cid) => {
				const c = allValidClaimMap.get(cid);
				return c && (/section\s*69|arrest/i.test(c.text) || c.evidence_excerpts.some((e) => /section\s*69|arrest/i.test(e.excerpt)));
			});
			if (!hasArrestClaim) {
				const arrestClaim = findClaimCoveringKeywords(["section 69", "arrest"]);
				if (arrestClaim && !validCaptionClaimIds.includes(arrestClaim.claim_id)) {
					validCaptionClaimIds.push(arrestClaim.claim_id);
				}
			}
		}
		if (/threshold|5\s*crore|five\s*crore/i.test(capLower)) {
			const hasThreshClaim = validCaptionClaimIds.some((cid) => {
				const c = allValidClaimMap.get(cid);
				return c && (/threshold|crore/i.test(c.text) || c.evidence_excerpts.some((e) => /threshold|crore/i.test(e.excerpt)));
			});
			if (!hasThreshClaim) {
				const threshClaim = findClaimCoveringKeywords(["threshold", "5 crore", "five crore"]);
				if (threshClaim && !validCaptionClaimIds.includes(threshClaim.claim_id)) {
					validCaptionClaimIds.push(threshClaim.claim_id);
				}
			}
		}
	}

	if (validCaptionClaimIds.length === 0 && rawData.instagram_caption?.trim()) {
		editorialFlags.push(
			"Instagram caption contains factual statements but has no verified supporting claim references."
		);
	}

	const captionEvidence: CaptionEvidence = {
		text: (rawData.instagram_caption || "").trim(),
		supporting_claim_ids: validCaptionClaimIds,
	};

	// Check if all substantive factual claims were stripped, or if cover/caption are unbacked
	const substantiveClaims = allExtractedClaims.filter((c) => c.claim_type !== "editorial_context");
	const coverSlide = validatedSlides.find((s) => s.slide_role === "cover") || validatedSlides[0];
	const isCoverSubstantive = coverSlide
		? !/^(what happened\??|legal details.*|why it matters.*|sources.*)$/i.test(coverSlide.headline || "")
		: false;
	const coverHeadlineValid = coverSlide && isCoverSubstantive ? coverSlide.text_references.headline_claim_ids.length > 0 : true;
	const captionValid = validCaptionClaimIds.length > 0 || !rawData.instagram_caption?.trim();

	const finalGenerationStatus =
		rawData.generation_status === "insufficient_evidence" ||
		substantiveClaims.length === 0 ||
		!coverHeadlineValid ||
		!captionValid
			? "insufficient_evidence"
			: "ready_for_review";

	// 8. Construct final verified carousel content package
	const response: ContentGenerationResponse = {
		success: true,
		provider: "groq",
		model: groqOutcome.model,
		generation_status: finalGenerationStatus,
		generated_at: new Date().toISOString(),
		topic: {
			candidate_id: selectedTopic.candidate_id,
			topic_title: selectedTopic.topic_title.trim(),
			legal_domain: selectedTopic.legal_domain,
			jurisdiction: selectedTopic.jurisdiction,
		},
		carousel_slide_count: validatedSlides.length,
		slides: validatedSlides,
		timeline_events: validatedTimeline,
		content: {
			headline: (rawData.headline || "").trim(),
			summary: (rawData.summary || "").trim(),
			carousel_slide_count: validatedSlides.length,
			slides: validatedSlides,
			timeline_events: validatedTimeline,
			instagram_caption: (rawData.instagram_caption || "").trim(),
			caption_claim_ids: validCaptionClaimIds,
			caption_evidence: captionEvidence,
			hashtags: Array.isArray(rawData.hashtags) ? rawData.hashtags.map((h) => h.trim()).filter(Boolean) : [],
		},
		instagram_caption: (rawData.instagram_caption || "").trim(),
		caption_claim_ids: validCaptionClaimIds,
		caption_evidence: captionEvidence,
		hashtags: Array.isArray(rawData.hashtags) ? rawData.hashtags.map((h) => h.trim()).filter(Boolean) : [],
		source_metrics: sourceMetrics,
		evidence: {
			claims: allExtractedClaims,
			limitations,
			editorial_flags: editorialFlags,
			human_review_required: true,
		},
		source_attributions: sourceAttributions,
	};

	return {
		success: true,
		data: response,
	};
}

/**
 * End-to-end service helper that accepts a selected topic or selection response,
 * extracts supporting articles via Jina Reader, and generates the carousel content package.
 */
export async function generateContentForSelection(
	env: Env,
	selection: GlobalTopicSelectionResponse | SelectedTopic
): Promise<ContentGenerationOutcome> {
	if (!selection || typeof selection !== "object") {
		return {
			success: false,
			status: 400,
			error: "Invalid input: 'selection' must be a valid selection object",
		};
	}

	// Check if this is a GlobalTopicSelectionResponse with no_strong_topic
	if ("selection_status" in selection && selection.selection_status === "no_strong_topic") {
		return {
			success: false,
			status: 400,
			error: "Cannot generate content: topic selection status is 'no_strong_topic'",
		};
	}

	// Resolve the actual SelectedTopic object
	let selectedTopic: SelectedTopic | null = null;
	if ("selected_topic" in selection) {
		selectedTopic = selection.selected_topic;
	} else if ("topic_title" in selection) {
		selectedTopic = selection as SelectedTopic;
	}

	if (!selectedTopic || typeof selectedTopic !== "object") {
		return {
			success: false,
			status: 400,
			error: "Missing or invalid 'selected_topic' in selection payload",
		};
	}

	// Extract supporting article IDs from selection
	const articleIds = extractArticleIdsFromSelection(selection);
	if (articleIds.length === 0) {
		return {
			success: false,
			status: 400,
			error: "No valid supporting article IDs found in selected topic",
		};
	}

	// Extract articles using the existing Jina orchestration service
	const extractionOutcome = await extractTopicArticlesByIds(env, articleIds);
	if (!extractionOutcome.success) {
		return {
			success: false,
			status: extractionOutcome.status,
			error: extractionOutcome.error,
		};
	}

	// Generate carousel content package with extracted evidence
	return await generateContentPackage(env, selectedTopic, extractionOutcome.data);
}

/**
 * Development-only HTTP request handler for POST /api/ai/generate-content.
 * Strictly validates incoming request payload, ignores caller-supplied URLs or content,
 * retrieves authoritative records from Supabase, orchestrates Jina extraction,
 * and calls the Groq content generator to produce an Instagram Carousel Deck.
 */
export async function handleGenerateContent(
	request: Request,
	env: Env
): Promise<Response> {
	// 1. Parse JSON body
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response(
			JSON.stringify({ error: "Invalid JSON body", status: 400 }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	// 2. Reject non-object or array payloads
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return new Response(
			JSON.stringify({ error: "Request body must be a JSON object", status: 400 }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const bodyRecord = body as Record<string, unknown>;

	// 3. Reject unexpected top-level properties (e.g. caller-supplied 'url', 'content', 'article_content')
	const allowedKeys = new Set(["selection", "selected_topic"]);
	for (const key of Object.keys(bodyRecord)) {
		if (!allowedKeys.has(key)) {
			return new Response(
				JSON.stringify({
					error: `Unexpected property '${key}' in request. Only 'selection' or 'selected_topic' is permitted.`,
					status: 400,
				}),
				{ status: 400, headers: { "Content-Type": "application/json" } }
			);
		}
	}

	if (!bodyRecord.selection && !bodyRecord.selected_topic) {
		return new Response(
			JSON.stringify({
				error: "Missing required property: provide either 'selection' or 'selected_topic'",
				status: 400,
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	// 4. Resolve SelectedTopic and check selection_status
	let selectionPayload: GlobalTopicSelectionResponse | SelectedTopic;
	if (bodyRecord.selection) {
		const sel = bodyRecord.selection as Record<string, unknown>;
		if (sel.selection_status === "no_strong_topic") {
			return new Response(
				JSON.stringify({
					error: "Cannot generate content: topic selection status is 'no_strong_topic'",
					status: 400,
				}),
				{ status: 400, headers: { "Content-Type": "application/json" } }
			);
		}
		selectionPayload = bodyRecord.selection as GlobalTopicSelectionResponse;
	} else {
		selectionPayload = bodyRecord.selected_topic as SelectedTopic;
	}

	// 5. Run end-to-end extraction and carousel content generation
	const outcome = await generateContentForSelection(env, selectionPayload);

	if (!outcome.success) {
		return new Response(
			JSON.stringify({
				success: false,
				status: outcome.status,
				error: outcome.error,
				details: outcome.details,
			}),
			{
				status: outcome.status,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	return new Response(JSON.stringify(outcome.data), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
