import fs from "node:fs";
import path from "node:path";
import { renderCarouselToPngs } from "../src/renderer/engine.tsx";

const outputDir = path.resolve(process.cwd(), "artifacts", "task14-preview");
fs.mkdirSync(outputDir, { recursive: true });

// Valid Task 13C fixture content
const sampleContentPackage = {
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
					text: "Shift to trust-based governance",
					claim_type: "reported_fact",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "trust-based governance" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-1"],
				subtitle_claim_ids: ["claim-1"],
				body_claim_ids: [],
				bullet_claim_ids: [["claim-1"]],
			},
			visual_direction: "Editorial hero with balanced scales",
			visual_spec: {
				layout_variant: "cover",
				background_variant: "brand_dark",
				visual_elements: ["scales"],
				emphasis: "headline",
			},
			bullet_points: [
				"Fundamental recalibration of enforcement to promote voluntary tax compliance and business confidence.",
			],
		},
		{
			slide_number: 2,
			slide_role: "what_happened",
			headline: "Decriminalisation & Enforcement Rationalisation",
			body_text: "Apex industry chamber CII praised the GST Council decisions on decriminalisation and rationalisation of tax enforcement powers as a landmark transition toward trust-based economic governance.",
			bullet_points: [
				"Proposed omission of Section 69 arrest powers from the CGST Act to eliminate coercive threat from tax administration.",
				"Fivefold increase in monetary prosecution threshold from Rs 1 crore to Rs 5 crore protects legitimate business activity.",
				"Imprisonment provisions and specified offences under Section 132 narrowed to separate civil disputes from deliberate fraud.",
			],
			claims: [
				{
					claim_id: "claim-2",
					text: "Omission of Section 69 arrest powers",
					claim_type: "reported_fact",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "Section 69 arrest powers" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-2"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-2"],
				bullet_claim_ids: [["claim-2"]],
			},
			visual_direction: "Structured factual breakdown",
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
				"CBIC Circulars mandate field officers to substantiate fraud allegations with concrete documentary evidence.",
				"Reasoned adjudication and clarity in notices established to reduce avoidable litigation for commercial disputes.",
			],
			claims: [
				{
					claim_id: "claim-3",
					text: "Awaits Gazette notification",
					claim_type: "procedural_status",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "awaiting notification" }],
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
				"Sentencing discretion expanded; proposal aims to eliminate coercive arrests for standard tax assessment disputes.",
			],
			claims: [
				{
					claim_id: "claim-4",
					text: "Reduces disproportionate criminal risk",
					claim_type: "attributed_statement",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "criminal risk reduced" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-4"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-4"],
				bullet_claim_ids: [["claim-4"]],
			},
			visual_direction: "High contrast impact takeaway",
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
					text: "Single-source topic",
					claim_type: "editorial_context",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "single source" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-5"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-5"],
				bullet_claim_ids: [["claim-5"]],
			},
			visual_direction: "Provenance and legal disclaimer",
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

console.log("Cleaning and preparing output directory:", outputDir);
if (fs.existsSync(outputDir)) {
	fs.rmSync(outputDir, { recursive: true, force: true });
}
fs.mkdirSync(outputDir, { recursive: true });

console.log("Rendering 5-slide carousel in memory...");
const renderResult = await renderCarouselToPngs(sampleContentPackage);

console.log("\n--- RENDER SUMMARY ---");
console.log("Success:", renderResult.success);
console.log("Validation details:", renderResult.validation);
for (const s of renderResult.slides) {
	for (const m of s.svg.matchAll(/undefined|NaN/g)) {
		console.log(`Slide ${s.slideNumber} match ${m[0]}:`, s.svg.slice(Math.max(0, m.index - 80), m.index + 80));
	}
}
console.log("Total Slides Rendered:", renderResult.totalSlides);

const manifest = {
	rendered_at: new Date().toISOString(),
	total_slides: renderResult.totalSlides,
	dimensions: "1080x1350",
	primary_category: sampleContentPackage.topic.legal_domain,
	topic_title: sampleContentPackage.topic.topic_title,
	slides: [],
};

const slideNames = [
	"slide-01-cover.png",
	"slide-02-what-happened.png",
	"slide-03-legal-details.png",
	"slide-04-why-it-matters.png",
	"slide-05-sources-disclaimer.png",
];

for (let i = 0; i < renderResult.slides.length; i++) {
	const slide = renderResult.slides[i];
	const targetFilename = slideNames[i];
	const targetPath = path.join(outputDir, targetFilename);
	fs.writeFileSync(targetPath, slide.pngBuffer);

	manifest.slides.push({
		slide_number: slide.slideNumber,
		slide_role: slide.slideRole,
		filename: targetFilename,
		dimensions: { width: slide.width, height: slide.height },
		size_bytes: slide.sizeBytes,
	});

	console.log(`Slide ${slide.slideNumber} (${slide.slideRole}): ${slide.width}x${slide.height} px, ${(slide.sizeBytes / 1024).toFixed(0)} KB -> ${targetFilename}`);
}

const manifestPath = path.join(outputDir, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log("\nSaved authoritative manifest.json to:", manifestPath);

// Generate Contact Sheet / Preview Index HTML
const contactSheetHtml = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>LawBriefly Carousel Preview — Task 14</title>
	<style>
		body {
			background: #0B0F19;
			color: #F8FAFC;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			padding: 40px;
			margin: 0;
		}
		h1 {
			font-size: 28px;
			font-weight: 700;
			margin-bottom: 8px;
			color: #FFFFFF;
		}
		p {
			color: #94A3B8;
			font-size: 15px;
			margin-top: 0;
			margin-bottom: 32px;
		}
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 24px;
		}
		.card {
			background: #161F30;
			border-radius: 12px;
			overflow: hidden;
			border: 1px solid #1E293B;
		}
		.card img {
			width: 100%;
			height: auto;
			display: block;
		}
		.card-info {
			padding: 16px;
		}
		.badge {
			display: inline-block;
			padding: 4px 10px;
			border-radius: 6px;
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			background: rgba(197, 168, 128, 0.15);
			color: #C5A880;
			margin-bottom: 8px;
		}
		.title {
			font-size: 14px;
			font-weight: 600;
			color: #F8FAFC;
		}
		.meta {
			font-size: 12px;
			color: #64748B;
			margin-top: 4px;
		}
	</style>
</head>
<body>
	<h1>LawBriefly — Instagram Carousel Design Preview</h1>
	<p>Target Canvas: 1080 × 1350 px (4:5 Portrait) | Typeface: Montserrat Bundled Weights | Total Slides: 5</p>
	<div class="grid">
		${manifest.slides
			.map(
				(s) => `
			<div class="card">
				<img src="${s.filename}" alt="${s.filename}" />
				<div class="card-info">
					<span class="badge">Slide ${s.slide_number} • ${s.slide_role}</span>
					<div class="title">${s.filename}</div>
					<div class="meta">${s.dimensions.width} × ${s.dimensions.height} px • ${(s.size_bytes / 1024).toFixed(0)} KB</div>
				</div>
			</div>
		`
			)
			.join("\n")}
	</div>
</body>
</html>`;

const contactSheetPath = path.join(outputDir, "index.html");
fs.writeFileSync(contactSheetPath, contactSheetHtml);
console.log("Saved preview index contact sheet to:", contactSheetPath);
