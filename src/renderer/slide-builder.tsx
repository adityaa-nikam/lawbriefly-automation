import React from "react";
import { CoverSlide } from "./components/CoverSlide";
import { WhatHappenedSlide } from "./components/WhatHappenedSlide";
import { LegalDetailsSlide } from "./components/LegalDetailsSlide";
import { WhyItMattersSlide } from "./components/WhyItMattersSlide";
import { SourcesDisclaimerSlide } from "./components/SourcesDisclaimerSlide";
import type { CarouselSlideItem } from "../services/content-generation";

export interface RenderSlideContext {
	topicTitle?: string;
	legalDomain?: string;
	sources?: { domain: string; title: string; url?: string }[];
	isSingleSource?: boolean;
}

/**
 * Maps a legal domain to a refined editorial kicker badge
 */
export function getDomainKicker(domain?: string): string {
	switch (domain?.toLowerCase()) {
		case "tax_law":
			return "TAX LAW REFORM";
		case "constitutional_law":
			return "CONSTITUTIONAL LAW";
		case "defamation_law":
			return "MEDIA & DEFAMATION";
		case "criminal_law":
			return "CRIMINAL PROCEDURE";
		case "corporate_law":
			return "CORPORATE COMPLIANCE";
		default:
			return "SPECIAL LEGAL BRIEFING";
	}
}

/**
 * Builds the appropriate React element for a slide based on its editorial role
 */
export function buildSlideElement(
	slide: CarouselSlideItem,
	slideIndex: number,
	totalSlides: number,
	context: RenderSlideContext = {}
): React.ReactElement {
	const slideNumber = slide.slide_number || slideIndex + 1;
	const role = slide.slide_role || (slideNumber === 1 ? "cover" : "what_happened");
	const category = getDomainKicker(context.legalDomain);
	const bullets =
		slide.bullet_points && slide.bullet_points.length > 0
			? slide.bullet_points
			: slide.claims.map((c) => c.text);
	const visualElement = slide.visual_spec?.visual_elements?.[0] || "document";
	const primarySourceDomain = context.sources?.[0]?.domain;

	switch (role) {
		case "cover":
			return (
				<CoverSlide
					headline={slide.headline}
					subtitle={slide.subtitle}
					category={category}
					slideNumber={slideNumber}
					totalSlides={totalSlides}
					keyTakeaway={bullets[0]}
					sourceDomain={primarySourceDomain}
				/>
			);

		case "what_happened":
			return (
				<WhatHappenedSlide
					headline={slide.headline || "What Happened?"}
					bodyText={slide.body_text}
					bullets={bullets}
					category={category}
					slideNumber={slideNumber}
					totalSlides={totalSlides}
					sourceDomain={primarySourceDomain}
					visualElement={visualElement}
				/>
			);

		case "legal_details":
			return (
				<LegalDetailsSlide
					headline={slide.headline || "Statutory Details & Safeguards"}
					bodyText={slide.body_text}
					bullets={bullets}
					category={category}
					slideNumber={slideNumber}
					totalSlides={totalSlides}
					sourceDomain={primarySourceDomain}
					visualElement={visualElement}
					isCommencementAwaited={true}
				/>
			);

		case "why_it_matters":
			return (
				<WhyItMattersSlide
					headline={slide.headline || "Impact on Legal Practice & Industry"}
					bodyText={slide.body_text}
					bullets={bullets}
					category={category}
					slideNumber={slideNumber}
					totalSlides={totalSlides}
					sourceDomain={primarySourceDomain}
					visualElement={visualElement}
				/>
			);

		case "sources_disclaimer":
			return (
				<SourcesDisclaimerSlide
					headline={slide.headline || "Sources & Editorial Notice"}
					sources={context.sources || []}
					slideNumber={slideNumber}
					totalSlides={totalSlides}
					sourceDomain={primarySourceDomain}
					isSingleSource={context.isSingleSource ?? true}
				/>
			);

		default:
			// Fallback to structured content slide
			return (
				<WhatHappenedSlide
					headline={slide.headline}
					bodyText={slide.body_text}
					bullets={bullets}
					category={category}
					slideNumber={slideNumber}
					totalSlides={totalSlides}
					sourceDomain={primarySourceDomain}
					visualElement={visualElement}
				/>
			);
	}
}
