import { renderCarouselToPngs } from "../src/renderer/engine.tsx";
import fs from "fs";
import path from "path";

// Load sample content package from test fixtures
const gstCarouselPackage = {
	success: true,
	provider: "groq",
	model: "openai/gpt-oss-120b",
	generation_status: "ready_for_review",
	topic: {
		candidate_id: "T004",
		topic_title: "GST Council Recommends Decriminalisation & Enforcement Rationalisation",
		legal_domain: "tax_law",
		jurisdiction: "india",
	},
	carousel_slide_count: 5,
	slides: [
		{
			slide_number: 1,
			slide_role: "cover",
			headline: "GST Council Recommends Shift to Trust-Based Tax Governance",
			subtitle: "Proposals include omitting Section 69 arrest powers and raising prosecution thresholds to Rs 5 crore.",
			bullet_points: [
				"Fundamental recalibration of enforcement to promote voluntary tax compliance and business confidence.",
			],
			claims: [
				{
					claim_id: "s1_c1",
					text: "Decriminalisation reform proposed",
					claim_type: "reported_fact",
					supporting_article_ids: ["art1"],
					evidence_excerpts: [],
				},
			],
			visual_spec: {
				layout_variant: "cover",
				background_variant: "brand_dark",
				visual_elements: ["scales"],
				emphasis: "headline",
			},
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
			claims: [],
			visual_spec: {
				layout_variant: "bullet_cards",
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
			claims: [],
			visual_spec: {
				layout_variant: "timeline",
				background_variant: "brand_light",
				visual_elements: ["shield"],
				emphasis: "timeline",
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
			claims: [],
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
			body_text: "Based on official GST Council recommendations, CBIC circulars, and statements by CII Director General Chandrajit Banerjee.",
			bullet_points: [
				"Source reporting: Confederation of Indian Industry (CII) & National Business Media.",
				"For informational and educational purposes only. Does not constitute formal legal advice.",
			],
			claims: [],
			visual_spec: {
				layout_variant: "source_list",
				background_variant: "brand_light",
				visual_elements: ["document"],
				emphasis: "sources",
			},
		},
	],
	source_metrics: {
		requested_article_count: 1,
		successful_extraction_count: 1,
		failed_extraction_count: 0,
		unique_source_domain_count: 1,
		source_diversity_status: "single_domain",
	},
	source_attributions: [
		{
			article_id: "b979a75d-676b-40f2-9ad0-cb9e7ddd59dc",
			original_title: "CII Hails GST Reforms As Transition To Trust-Based Governance",
			original_url: "https://menafn.com/1111898393/CII-Hails-GST-Reforms-As-Transition-To-Trust-Based-Governance",
			source_domain: "menafn.com",
			extraction_status: "success",
		},
	],
};

async function run() {
	const outputDir = path.resolve("output/carousel");
	console.log("Rendering carousel slides to:", outputDir);
	const result = await renderCarouselToPngs(gstCarouselPackage, outputDir);
	console.log("\n--- RENDER SUMMARY ---");
	console.log("Success:", result.success);
	console.log("Total Slides Rendered:", result.totalSlides);
	for (const s of result.slides) {
		console.log(
			`Slide ${s.slideNumber} (${s.slideRole}): ${s.width}x${s.height} px, ${Math.round(s.sizeBytes / 1024)} KB`
		);
	}
	console.log("\nValidation Details:");
	for (const d of result.validation.details) {
		console.log(" - " + d);
	}
}

run().catch((err) => {
	console.error("Render error:", err);
	process.exit(1);
});
