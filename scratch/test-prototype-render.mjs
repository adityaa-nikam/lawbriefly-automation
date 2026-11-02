import fs from "node:fs";
import path from "node:path";
import { renderSlideToPng } from "../src/renderer/engine.tsx";

const outputDir = path.resolve(process.cwd(), "artifacts", "task14b-prototype");
fs.mkdirSync(outputDir, { recursive: true });

const sampleSlide1 = {
	slide_number: 1,
	slide_role: "cover",
	headline: "GST Council Recommends Shift to Trust-Based Tax Governance",
	subtitle: "Proposals include omitting Section 69 arrest powers and raising prosecution thresholds to Rs 5 crore.",
	claims: [],
	visual_spec: {
		layout_variant: "cover",
		background_variant: "brand_dark",
		visual_elements: ["scales"],
		emphasis: "headline",
	},
	bullet_points: [
		"Fundamental recalibration of enforcement to promote voluntary tax compliance and business confidence.",
	],
};

const sampleSlide2 = {
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
		layout_variant: "editorial_text",
		background_variant: "brand_light",
		visual_elements: ["document"],
		emphasis: "key_fact",
	},
};

const context = {
	legalDomain: "tax_law",
	sources: [{ domain: "menafn.com", title: "CII Hails GST Reforms" }],
};

console.log("Rendering Slide 1 (Cover)...");
const res1 = await renderSlideToPng(sampleSlide1, 0, 5, context);
fs.writeFileSync(path.join(outputDir, "slide-01-cover.png"), res1.pngBuffer);
console.log(`Slide 1 rendered: ${res1.width}x${res1.height}, ${(res1.sizeBytes / 1024).toFixed(1)} KB`);

console.log("Rendering Slide 2 (What Happened)...");
const res2 = await renderSlideToPng(sampleSlide2, 1, 5, context);
fs.writeFileSync(path.join(outputDir, "slide-02-what-happened.png"), res2.pngBuffer);
console.log(`Slide 2 rendered: ${res2.width}x${res2.height}, ${(res2.sizeBytes / 1024).toFixed(1)} KB`);

console.log("Prototype render successful!");
