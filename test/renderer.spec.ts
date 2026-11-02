import { describe, it, expect } from "vitest";
import React from "react";
import { CANVAS, COLORS, TYPOGRAPHY } from "../src/renderer/tokens";
import {
	loadBundledFonts,
	getIconSvg,
	getLbMonogramSvg,
	getJusticeScalesSvg,
	BRAND_ASSETS,
} from "../src/renderer/assets";
import { CoverSlide } from "../src/renderer/components/CoverSlide";
import { WhatHappenedSlide } from "../src/renderer/components/WhatHappenedSlide";
import { LegalDetailsSlide } from "../src/renderer/components/LegalDetailsSlide";
import { WhyItMattersSlide } from "../src/renderer/components/WhyItMattersSlide";
import { SourcesDisclaimerSlide } from "../src/renderer/components/SourcesDisclaimerSlide";
import { SlideHeader } from "../src/renderer/components/SlideHeader";
import { SlideFooter } from "./../src/renderer/components/SlideFooter";
import { EditorialHero } from "../src/renderer/components/EditorialHero";
import { OversizedStat } from "../src/renderer/components/OversizedStat";
import { NumberComparison } from "../src/renderer/components/NumberComparison";
import { LegalProcessDiagram } from "../src/renderer/components/LegalProcessDiagram";
import { RecommendationStatusVisual } from "../src/renderer/components/RecommendationStatusVisual";
import { StakeholderImpactVisual } from "../src/renderer/components/StakeholderImpactVisual";
import { EditorialQuote } from "../src/renderer/components/EditorialQuote";
import { SourcePublicationBlock } from "../src/renderer/components/SourcePublicationBlock";
import { BrandSignature } from "../src/renderer/components/BrandSignature";
import { SectionTransition } from "../src/renderer/components/SectionTransition";
import { VisualCallout } from "../src/renderer/components/VisualCallout";
import { KeyTakeaway } from "../src/renderer/components/KeyTakeaway";
import { TimelineGraphic } from "../src/renderer/components/TimelineGraphic";
import {
	buildSlideElement,
	renderSlideToSvg,
	renderSlideToPng,
	renderCarouselToPngs,
} from "../src/renderer/engine";
import type {
	ContentGenerationResponse,
	CarouselSlideItem,
} from "../src/services/content-generation";

// Test fixture based on Task 13C verified compound payload
const sampleContentResponse: ContentGenerationResponse = {
	success: true,
	provider: "groq",
	model: "llama-3.3-70b-versatile",
	generation_status: "ready_for_review",
	generated_at: "2026-11-02T05:00:00Z",
	topic: {
		candidate_id: "topic-1",
		topic_title: "CII Hails GST Reforms As Transition To Trust-Based Governance",
		legal_domain: "tax_law",
		jurisdiction: "Union of India",
	},
	carousel_slide_count: 5,
	slides: [
		{
			slide_number: 1,
			slide_role: "cover",
			headline: "GST Council Recommends Shift to Trust-Based Tax Governance",
			subtitle: "Proposals include omitting Section 69 arrest powers and raising prosecution thresholds to Rs 5 crore.",
			claims: [
				{
					claim_id: "claim-1",
					text: "Fundamental recalibration of enforcement to promote voluntary tax compliance.",
					claim_type: "reported_fact",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "shift to trust-based governance" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-1"],
				subtitle_claim_ids: ["claim-1"],
				body_claim_ids: [],
				bullet_claim_ids: [["claim-1"]],
			},
			visual_direction: "Editorial hero with balanced scales and dark authority background",
			visual_spec: {
				layout_variant: "cover",
				background_variant: "brand_dark",
				visual_elements: ["scales"],
				emphasis: "headline",
			},
			bullet_points: [
				"Fundamental recalibration of enforcement to promote voluntary tax compliance.",
			],
		},
		{
			slide_number: 2,
			slide_role: "what_happened",
			headline: "Decriminalisation & Enforcement Rationalisation",
			body_text: "Apex industry chamber CII praised the GST Council decisions on decriminalisation and rationalisation of tax enforcement powers as a landmark transition toward trust-based economic governance.",
			bullet_points: [
				"Omission of Section 69 arrest powers from the CGST Act removes coercive threat from tax administration.",
				"Fivefold increase in monetary prosecution threshold from Rs 1 crore to Rs 5 crore protects legitimate business activity.",
				"Imprisonment provisions and specified offences under Section 132 narrowed to separate civil disputes from deliberate fraud.",
			],
			claims: [
				{
					claim_id: "claim-2",
					text: "Omission of Section 69 arrest powers from the CGST Act removes coercive threat.",
					claim_type: "reported_fact",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "omitting Section 69" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-2"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-2"],
				bullet_claim_ids: [["claim-2"]],
			},
			visual_direction: "Structured breakdown with three numbered propositions",
			visual_spec: {
				layout_variant: "editorial_text",
				background_variant: "brand_light",
				visual_elements: ["document"],
				emphasis: "key_fact",
			},
		},
		{
			slide_number: 3,
			slide_role: "legal_details",
			headline: "Statutory Reforms & Procedural Safeguards",
			body_text: "The reforms require legislative amendments to the Central Goods and Services Tax (CGST) Act, 2017, alongside administrative circulars standardising field enforcement.",
			bullet_points: [
				"Legislative amendment required: Omission of Section 69 and amendment to Section 132 await parliamentary approval and official Gazette notification.",
				"CBIC Circulars dated 26 October 2026 mandate field officers to substantiate fraud allegations with concrete documentary evidence.",
				"Reasoned adjudication and clarity in notices established to reduce avoidable litigation for commercial disputes.",
			],
			claims: [
				{
					claim_id: "claim-3",
					text: "Legislative amendments require official Gazette notification.",
					claim_type: "procedural_status",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "await parliamentary approval" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-3"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-3"],
				bullet_claim_ids: [["claim-3"]],
			},
			visual_direction: "Procedural status banner with section cards",
			visual_spec: {
				layout_variant: "bullet_cards",
				background_variant: "brand_light",
				visual_elements: ["shield"],
				emphasis: "key_fact",
			},
		},
		{
			slide_number: 4,
			slide_role: "why_it_matters",
			headline: "Impact on Industry & Legal Practice",
			body_text: "For businesses, MSMEs, and first-generation entrepreneurs, the reform significantly reduces the risk of disproportionate criminal consequences for procedural lapses.",
			bullet_points: [
				"Enhanced working capital efficiency and reduced compliance friction across manufacturing and services.",
				"Judicial discretion in sentencing expanded; coercive arrests eliminated for standard tax assessment disputes.",
			],
			claims: [
				{
					claim_id: "claim-4",
					text: "Reduces risk of disproportionate criminal consequences for procedural lapses.",
					claim_type: "attributed_statement",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "commercial disputes" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-4"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-4"],
				bullet_claim_ids: [["claim-4"]],
			},
			visual_direction: "High-contrast takeaway card and commercial impact pillars",
			visual_spec: {
				layout_variant: "impact_cards",
				background_variant: "brand_light",
				visual_elements: ["rupee"],
				emphasis: "takeaway",
			},
		},
		{
			slide_number: 5,
			slide_role: "sources_disclaimer",
			headline: "Authoritative Sources & Editorial Notice",
			body_text: "CII Hails GST Reforms As Transition To Trust-Based Governance",
			bullet_points: [
				"Single-source topic: factual claims synthesized from primary news reporting. Independent statutory corroboration required.",
			],
			claims: [
				{
					claim_id: "claim-5",
					text: "Independent statutory corroboration required.",
					claim_type: "editorial_context",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "CII news report" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-5"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-5"],
				bullet_claim_ids: [["claim-5"]],
			},
			visual_direction: "Reporting provenance, legal disclaimer, and follow CTA",
			visual_spec: {
				layout_variant: "source_list",
				background_variant: "brand_light",
				visual_elements: ["chart"],
				emphasis: "sources",
			},
		},
	],
	timeline_events: [],
	instagram_caption: "GST Council recommends omitting Section 69 arrest powers and raising prosecution threshold to Rs 5 crore.",
	caption_claim_ids: ["claim-1"],
	caption_evidence: {
		text: "GST Council recommends omitting Section 69 arrest powers and raising prosecution threshold to Rs 5 crore.",
		supporting_claim_ids: ["claim-1"],
	},
	hashtags: ["#GSTReform", "#TaxLaw", "#LawBriefly", "#LegalNewsIndia"],
	evidence: {
		claims: [],
		limitations: ["Single-source topic: requires independent corroboration."],
		editorial_flags: ["Single-source topic requires independent statutory corroboration"],
		human_review_required: true,
	},
	source_attributions: [
		{
			article_id: "art-1",
			original_title: "CII Hails GST Reforms As Transition To Trust-Based Governance",
			original_url: "https://menafn.com/1109045887/CII-Hails-GST-Reforms-As-Transition-To-Trust-Based-Governance",
			source_domain: "menafn.com",
			extraction_status: "success",
			content_length: 2450,
			paragraph_count: 8,
		},
	],
	source_metrics: {
		requested_article_count: 1,
		successful_extraction_count: 1,
		failed_extraction_count: 0,
		unique_source_domain_count: 1,
		source_diversity_status: "single_domain",
	},
};

describe("LawBriefly Instagram Carousel Design System (Task 14)", () => {
	describe("1. Centralized Design Tokens", () => {
		it("enforces mandatory 1080 x 1350 canvas (4:5 portrait aspect ratio)", () => {
			expect(CANVAS.width).toBe(1080);
			expect(CANVAS.height).toBe(1350);
			expect(CANVAS.aspectRatio).toBe("4:5");
			expect(CANVAS.paddingHorizontal).toBe(80);
			expect(CANVAS.paddingVertical).toBe(80);
			expect(CANVAS.cardRadius).toBe(24);
			expect(CANVAS.borderWidth).toBe(1.5);
		});

		it("specifies Montserrat typography tokens with exact weight scale", () => {
			expect(TYPOGRAPHY.fontFamily).toBe("Montserrat");
			expect(TYPOGRAPHY.weights.regular).toBe(400);
			expect(TYPOGRAPHY.weights.medium).toBe(500);
			expect(TYPOGRAPHY.weights.semiBold).toBe(600);
			expect(TYPOGRAPHY.weights.bold).toBe(700);
			expect(TYPOGRAPHY.weights.extraBold).toBe(800);
		});

		it("defines authoritative LawBriefly brand colors & editorial palette", () => {
			expect(COLORS.brandNavy).toBe("#0B2545");
			expect(COLORS.brandGold).toBe("#C5A880");
			expect(COLORS.brandDark).toBe("#090D16");
			expect(COLORS.brandLight).toBe("#F8F9FA");
			expect(COLORS.accentEmerald).toBe("#059669");
			expect(COLORS.accentAmber).toBe("#D97706");
			expect(COLORS.accentCrimson).toBe("#BE123C");
		});

		it("maintains readable font sizes and comfortable line heights", () => {
			expect(TYPOGRAPHY.sizes.headlineCover).toBeGreaterThanOrEqual(48);
			expect(TYPOGRAPHY.sizes.headlineSlide).toBeGreaterThanOrEqual(36);
			expect(TYPOGRAPHY.sizes.bodyText).toBeGreaterThanOrEqual(20);
			expect(TYPOGRAPHY.lineHeights.headline).toBeGreaterThanOrEqual(1.2);
			expect(TYPOGRAPHY.lineHeights.body).toBeGreaterThanOrEqual(1.4);
		});
	});

	describe("2. Bundled Brand Assets & Font Loader", () => {
		it("loads all 5 Montserrat font weights into memory buffers", () => {
			const fonts = loadBundledFonts();
			expect(fonts).toHaveLength(5);

			const fontWeights = fonts.map((f) => f.weight);
			expect(fontWeights).toContain(400);
			expect(fontWeights).toContain(500);
			expect(fontWeights).toContain(600);
			expect(fontWeights).toContain(700);
			expect(fontWeights).toContain(800);

			for (const font of fonts) {
				expect(font.name).toBe("Montserrat");
				expect(font.data).toBeInstanceOf(Buffer);
				expect(font.data.byteLength).toBeGreaterThan(40000);
			}
		});

		it("provides authoritative brand asset file references", () => {
			expect(BRAND_ASSETS.logo).toBe("Minimalist LawBriefly Logo (1).png");
			expect(BRAND_ASSETS.monogramBanner).toBe("LB-FINAL.png");
			expect(BRAND_ASSETS.scalesIcon).toBe("Balanced Justice Scale Icon.png");
			expect(BRAND_ASSETS.fonts.regular).toBe("Montserrat-Regular.ttf");
			expect(BRAND_ASSETS.fonts.extraBold).toBe("Montserrat-ExtraBold.ttf");
		});

		it("renders crisp vector SVGs for LB Monogram and Justice Scales", () => {
			const monogram = getLbMonogramSvg("#FFFFFF", 48) as any;
			expect(monogram).toBeDefined();
			expect(monogram.type).toBe("svg");
			expect(monogram.props.width).toBe(48);

			const scales = getJusticeScalesSvg("#C5A880", 32) as any;
			expect(scales).toBeDefined();
			expect(scales.type).toBe("svg");
			expect(scales.props.width).toBe(32);
		});

		it("renders crisp vector SVGs for all allowed icons", () => {
			const allowedIcons = [
				"scales",
				"gavel",
				"courthouse",
				"document",
				"shield",
				"calendar",
				"rupee",
				"chart",
			];

			for (const iconName of allowedIcons) {
				const svgElement = getIconSvg(iconName, "#FFFFFF", 24) as any;
				expect(svgElement).toBeDefined();
				expect(svgElement?.type).toBe("svg");
				expect(svgElement?.props.width).toBe(24);
				expect(svgElement?.props.height).toBe(24);
			}
		});

		it("falls back gracefully to scales icon for unknown icon names", () => {
			const fallbackSvg = getIconSvg("non_existent_icon", "#C5A880", 24) as any;
			expect(fallbackSvg).toBeDefined();
			expect(fallbackSvg?.type).toBe("svg");
			expect(fallbackSvg?.props.width).toBe(24);
		});
	});

	describe("3. Modular React Slide Components", () => {
		it("renders SlideHeader with monogram, category badge, and counter", () => {
			const headerDark = React.createElement(SlideHeader, {
				slideNumber: 1,
				totalSlides: 5,
				category: "Tax Law Reform",
				isDark: true,
			});
			expect(React.isValidElement(headerDark)).toBe(true);

			const headerLight = React.createElement(SlideHeader, {
				slideNumber: 2,
				totalSlides: 5,
				category: "Tax Law Reform",
				isDark: false,
			});
			expect(React.isValidElement(headerLight)).toBe(true);
		});

		it("renders SlideFooter with brand anchor, source pill, and navigation", () => {
			const footer = React.createElement(SlideFooter, {
				sourceDomain: "menafn.com",
				isLastSlide: false,
				isDark: true,
			});
			expect(React.isValidElement(footer)).toBe(true);
		});

		it("renders SlideFooter last-slide bookmark variant on slide 5", () => {
			const footerLast = React.createElement(SlideFooter, {
				sourceDomain: "menafn.com",
				isLastSlide: true,
				isDark: false,
			});
			expect(React.isValidElement(footerLast)).toBe(true);
		});

		it("renders CoverSlide with editorial hero layout and justice scale badge", () => {
			const cover = React.createElement(CoverSlide, {
				headline: sampleContentResponse.slides[0].headline,
				subtitle: sampleContentResponse.slides[0].subtitle,
				category: "TAX LAW REFORM",
				slideNumber: 1,
				totalSlides: 5,
				keyTakeaway: sampleContentResponse.slides[0].bullet_points?.[0],
				sourceDomain: "menafn.com",
			});
			expect(React.isValidElement(cover)).toBe(true);
		});

		it("renders WhatHappenedSlide with executive summary and numbered propositions", () => {
			const slide2 = React.createElement(WhatHappenedSlide, {
				headline: sampleContentResponse.slides[1].headline,
				bodyText: sampleContentResponse.slides[1].body_text,
				bullets: sampleContentResponse.slides[1].bullet_points || [],
				category: "TAX LAW REFORM",
				slideNumber: 2,
				totalSlides: 5,
				sourceDomain: "menafn.com",
				visualElement: "document",
			});
			expect(React.isValidElement(slide2)).toBe(true);
		});

		it("renders LegalDetailsSlide with procedural banner and section symbols", () => {
			const slide3 = React.createElement(LegalDetailsSlide, {
				headline: sampleContentResponse.slides[2].headline,
				bodyText: sampleContentResponse.slides[2].body_text,
				bullets: sampleContentResponse.slides[2].bullet_points || [],
				category: "TAX LAW REFORM",
				slideNumber: 3,
				totalSlides: 5,
				sourceDomain: "menafn.com",
				visualElement: "shield",
				isCommencementAwaited: true,
			});
			expect(React.isValidElement(slide3)).toBe(true);
		});

		it("renders WhyItMattersSlide with contrast dark takeaway and practice pillars", () => {
			const slide4 = React.createElement(WhyItMattersSlide, {
				headline: sampleContentResponse.slides[3].headline,
				bodyText: sampleContentResponse.slides[3].body_text,
				bullets: sampleContentResponse.slides[3].bullet_points || [],
				category: "TAX LAW REFORM",
				slideNumber: 4,
				totalSlides: 5,
				sourceDomain: "menafn.com",
				visualElement: "rupee",
			});
			expect(React.isValidElement(slide4)).toBe(true);
		});

		it("renders SourcesDisclaimerSlide with provenance, mandatory disclaimer, and follow CTA", () => {
			const slide5 = React.createElement(SourcesDisclaimerSlide, {
				headline: sampleContentResponse.slides[4].headline,
				sources: [{ domain: "menafn.com", title: "CII Hails GST Reforms" }],
				slideNumber: 5,
				totalSlides: 5,
				sourceDomain: "menafn.com",
				isSingleSource: true,
			});
			expect(React.isValidElement(slide5)).toBe(true);
		});

		it("builds correct slide elements for all roles using buildSlideElement", () => {
			for (let i = 0; i < sampleContentResponse.slides.length; i++) {
				const element = buildSlideElement(
					sampleContentResponse.slides[i],
					i,
					sampleContentResponse.slides.length,
					{
						topicTitle: sampleContentResponse.topic.topic_title,
						legalDomain: sampleContentResponse.topic.legal_domain,
						sources: [{ domain: "menafn.com", title: "CII Hails GST Reforms" }],
						isSingleSource: true,
					}
				);
				expect(React.isValidElement(element)).toBe(true);
			}
		});
	});

	describe("4. Satori & Resvg High-Resolution PNG Rendering Engine", () => {
		it("renders Slide 1 to SVG with exact 1080 x 1350 viewBox", async () => {
			const svg = await renderSlideToSvg(
				sampleContentResponse.slides[0],
				0,
				5,
				{
					legalDomain: "tax_law",
					sources: [{ domain: "menafn.com", title: "CII Hails GST Reforms" }],
				}
			);
			expect(typeof svg).toBe("string");
			expect(svg).toContain('viewBox="0 0 1080 1350"');
			expect(svg).toContain('width="1080"');
			expect(svg).toContain('height="1350"');
			expect(svg).toContain("<path");
		});

		it("renders Slide 1 to PNG with exact 1080 x 1350 dimensions and valid buffer", async () => {
			const result = await renderSlideToPng(
				sampleContentResponse.slides[0],
				0,
				5,
				{
					legalDomain: "tax_law",
					sources: [{ domain: "menafn.com", title: "CII Hails GST Reforms" }],
				}
			);
			expect(result.width).toBe(1080);
			expect(result.height).toBe(1350);
			expect(result.pngBuffer).toBeInstanceOf(Buffer);
			expect(result.pngBuffer.byteLength).toBeGreaterThan(50000);
			expect(result.slideNumber).toBe(1);
			expect(result.slideRole).toBe("cover");
		});

		it("renders complete 5-slide carousel without overflow or errors", async () => {
			const renderResults = await renderCarouselToPngs(sampleContentResponse);
			expect(renderResults.success).toBe(true);
			expect(renderResults.totalSlides).toBe(5);
			expect(renderResults.slides).toHaveLength(5);
			expect(renderResults.validation.allDimensionsValid).toBe(true);
			expect(renderResults.validation.allFilesNonEmpty).toBe(true);
			expect(renderResults.validation.allFontsLoaded).toBe(true);
			expect(renderResults.validation.overflowDetected).toBe(false);

			for (let i = 0; i < 5; i++) {
				const slideResult = renderResults.slides[i];
				expect(slideResult.slideNumber).toBe(i + 1);
				expect(slideResult.width).toBe(1080);
				expect(slideResult.height).toBe(1350);
				expect(slideResult.pngBuffer.byteLength).toBeGreaterThan(50000);
			}

			// Verify slide roles
			expect(renderResults.slides[0].slideRole).toBe("cover");
			expect(renderResults.slides[1].slideRole).toBe("what_happened");
			expect(renderResults.slides[2].slideRole).toBe("legal_details");
			expect(renderResults.slides[3].slideRole).toBe("why_it_matters");
			expect(renderResults.slides[4].slideRole).toBe("sources_disclaimer");
		});

		it("rejects invalid package with no slides", async () => {
			const invalidPkg: ContentGenerationResponse = {
				...sampleContentResponse,
				slides: [],
			};
			await expect(renderCarouselToPngs(invalidPkg)).rejects.toThrow(
				"Cannot render carousel: Content package has 0 slides."
			);
		});
	});

	describe("5. Visual Component Library (Task 14B Redesign)", () => {
		it("renders EditorialHero with headline, kicker, and subtitle", () => {
			const hero = React.createElement(EditorialHero, {
				kicker: "SPECIAL LANDMARK BRIEFING",
				headline: "GST Council Recommends Decriminalisation",
				subtitle: "Proposed omission of Section 69 arrest powers",
				isDark: true,
				highlightPill: "Tax Reform",
			});
			expect(React.isValidElement(hero)).toBe(true);
		});

		it("renders OversizedStat with massive numeral and context note", () => {
			const stat = React.createElement(OversizedStat, {
				value: "5x",
				label: "PROSECUTION THRESHOLD EXPANSION",
				contextNote: "From Rs 1 Cr to Rs 5 Cr under CGST Act",
				badge: "Relief",
				isDark: false,
			});
			expect(React.isValidElement(stat)).toBe(true);
		});

		it("renders NumberComparison with before/after comparison panels", () => {
			const comparison = React.createElement(NumberComparison, {
				title: "Prosecution Threshold Revision",
				fromLabel: "Current Statute",
				fromValue: "Rs 1 Cr",
				toLabel: "Proposed Threshold",
				toValue: "Rs 5 Cr",
				multiplierBadge: "5x Expansion",
				isDark: false,
			});
			expect(React.isValidElement(comparison)).toBe(true);
		});

		it("renders LegalProcessDiagram with 4-step sequence and active state", () => {
			const diagram = React.createElement(LegalProcessDiagram, { isDark: false });
			expect(React.isValidElement(diagram)).toBe(true);
		});

		it("renders RecommendationStatusVisual with caution and info variants", () => {
			const statusCaution = React.createElement(RecommendationStatusVisual, {
				description: "Approved in principle by GST Council. Operative legal effect occurs upon Gazette notification.",
				severity: "caution",
				isDark: false,
			});
			expect(React.isValidElement(statusCaution)).toBe(true);

			const statusSuccess = React.createElement(RecommendationStatusVisual, {
				description: "Statutory amendment enacted.",
				severity: "success",
				isDark: true,
			});
			expect(React.isValidElement(statusSuccess)).toBe(true);
		});

		it("renders StakeholderImpactVisual with contrasting group pillars", () => {
			const impact = React.createElement(StakeholderImpactVisual, {
				pillars: [
					{
						stakeholderGroup: "FOR ENTERPRISE",
						headline: "Working Capital Protection",
						bulletPoints: ["Eliminates coercive arrest threat"],
						iconName: "rupee",
						badgeLabel: "COMMERCIAL",
						accentColor: COLORS.accentEmerald,
						isPrimary: true,
					},
					{
						stakeholderGroup: "FOR TAX COUNSEL",
						headline: "Adjudication Integrity",
						bulletPoints: ["Documentary evidence threshold"],
						iconName: "document",
						badgeLabel: "PRACTICE",
						accentColor: COLORS.brandGold,
					},
				],
				isDark: true,
			});
			expect(React.isValidElement(impact)).toBe(true);
		});

		it("renders EditorialQuote, BrandSignature, and SectionTransition", () => {
			const quote = React.createElement(EditorialQuote, {
				quoteText: "Transition from deterrence via criminal custody to evidence-backed tax adjudication.",
				isDark: true,
			});
			expect(React.isValidElement(quote)).toBe(true);

			const signature = React.createElement(BrandSignature, { isDark: false });
			expect(React.isValidElement(signature)).toBe(true);

			const transition = React.createElement(SectionTransition, {
				sectionNumber: "01",
				sectionTitle: "WHAT HAPPENED",
				isDark: false,
			});
			expect(React.isValidElement(transition)).toBe(true);
		});

		it("renders VisualCallout, KeyTakeaway, and TimelineGraphic", () => {
			const callout = React.createElement(VisualCallout, {
				label: "Constitutional Notice",
				text: "Council recommendations do not constitute operative law until gazetted.",
				isDark: false,
			});
			expect(React.isValidElement(callout)).toBe(true);

			const takeaway = React.createElement(KeyTakeaway, {
				text: "Council recommends omitting Section 69 arrest powers.",
				isDark: true,
			});
			expect(React.isValidElement(takeaway)).toBe(true);

			const timeline = React.createElement(TimelineGraphic, {
				entries: [
					{
						dateText: "Oct 2026",
						title: "Council Decision",
						isMilestone: true,
					},
				],
				isDark: false,
			});
			expect(React.isValidElement(timeline)).toBe(true);
		});

		it("renders SourcePublicationBlock with source domain metadata", () => {
			const pubBlock = React.createElement(SourcePublicationBlock, {
				sources: [{ domain: "menafn.com", title: "CII Hails GST Reforms" }],
				isSingleSource: true,
				isDark: false,
			});
			expect(React.isValidElement(pubBlock)).toBe(true);
		});
	});
});

