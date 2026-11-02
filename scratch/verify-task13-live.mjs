// Controlled Live Integration Test for Task 13
import fs from "fs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8788";

async function runLiveTask13Test() {
	console.log("=== TASK 13 LIVE INTEGRATION TEST ===");

	const payload = {
		selection: {
			selection_status: "selected",
			selection_kind: "single_significant_development",
			selected_topic: {
				candidate_id: "T004",
				topic_title: "GST Reform: Decriminalisation and Enforcement Rationalisation",
				topic_summary: "Apex business chamber CII praises the GST Council's decisions on decriminalisation and rationalisation of enforcement powers.",
				legal_domain: "tax_law",
				jurisdiction: "india",
				editorial_angle: "Focus on voluntary tax compliance and institutional transition to trust-based taxation.",
				selection_rationale: "Significant tax policy development affecting business criminal liability.",
				supporting_articles: [
					{
						article_id: "b979a75d-676b-40f2-9ad0-cb9e7ddd59dc",
					},
				],
			},
		},
	};

	console.log(`Endpoint: POST ${BASE_URL}/api/ai/generate-content`);
	console.log(`Topic: ${payload.selection.selected_topic.topic_title}`);
	console.log(`Article ID: b979a75d-676b-40f2-9ad0-cb9e7ddd59dc`);

	const startTime = Date.now();
	const response = await fetch(`${BASE_URL}/api/ai/generate-content`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	const durationMs = Date.now() - startTime;
	console.log(`\nHTTP Status: ${response.status} (in ${durationMs}ms)`);

	const data = await response.json();
	fs.writeFileSync("./task13-response.json", JSON.stringify(data, null, 2));
	console.log(`Response written to ./task13-response.json`);

	console.log("\n--- RESULT SUMMARY ---");
	console.log(`Success: ${data.success}`);
	console.log(`Provider: ${data.provider}`);
	console.log(`Model: ${data.model}`);
	console.log(`Generation Status: ${data.generation_status}`);
	console.log(`Generated At: ${data.generated_at}`);
	console.log(`Slide Count: ${data.carousel_slide_count}`);

	if (data.success && data.slides) {
		console.log("\n==================================================");
		console.log("            INSTAGRAM CAROUSEL SLIDES             ");
		console.log("==================================================");

		for (const slide of data.slides) {
			console.log(`\n[SLIDE ${slide.slide_number}] Role: ${slide.slide_role.toUpperCase()}`);
			console.log(`  Headline: "${slide.headline}"`);
			if (slide.subtitle) console.log(`  Subtitle: "${slide.subtitle}"`);
			if (slide.body_text) {
				const wordCount = slide.body_text.split(/\s+/).filter(Boolean).length;
				console.log(`  Body (${wordCount} words): "${slide.body_text}"`);
			}
			console.log(`  Claims (${slide.claims?.length || 0}):`);
			if (slide.claims) {
				for (const c of slide.claims) {
					console.log(`    - [${c.claim_id}] [${c.claim_type}] "${c.text}"`);
					console.log(`      Sources: [${c.supporting_article_ids.join(", ")}]`);
					if (c.evidence_excerpts?.length) {
						for (const exc of c.evidence_excerpts) {
							console.log(`      Excerpt (${exc.article_id}): "${exc.excerpt}"`);
						}
					}
				}
			}
			console.log(`  Text References:`, JSON.stringify(slide.text_references));
			console.log(`  Visual Spec (React-first):`, JSON.stringify(slide.visual_spec));
			console.log(`  Visual Direction: ${slide.visual_direction}`);
		}

		console.log("\n==================================================");
		console.log("             STRUCTURED TIMELINE EVENTS           ");
		console.log("==================================================");
		if (data.timeline_events && data.timeline_events.length > 0) {
			for (const t of data.timeline_events) {
				console.log(`  * [${t.date_text}] ${t.event}`);
				console.log(`    Sources: [${t.supporting_article_ids.join(", ")}], Claims: [${t.supporting_claim_ids?.join(", ") || ""}]`);
			}
		} else {
			console.log("  (No timeline events generated)");
		}

		console.log("\n==================================================");
		console.log("               INSTAGRAM CAPTION                  ");
		console.log("==================================================");
		console.log(data.instagram_caption);
		console.log(`\nCaption Claim IDs: [${data.caption_claim_ids?.join(", ") || ""}]`);
		console.log(`Caption Evidence:`, JSON.stringify(data.caption_evidence));

		console.log("\nHashtags:", data.hashtags.join(" "));

		console.log("\n--- EVIDENCE & METRICS ---");
		console.log(`Source Metrics:`, JSON.stringify(data.source_metrics, null, 2));
		console.log(`Human Review Required: ${data.evidence.human_review_required}`);
		console.log(`Limitations:`, data.evidence.limitations);
		console.log(`Editorial Flags:`, data.evidence.editorial_flags);

		console.log("\n--- SOURCE ATTRIBUTION ---");
		for (const attr of data.source_attributions) {
			console.log(`- Article ID: ${attr.article_id}`);
			console.log(`  Title: ${attr.original_title}`);
			console.log(`  URL: ${attr.original_url}`);
			console.log(`  Domain: ${attr.source_domain}`);
			console.log(`  Status: ${attr.extraction_status}`);
			console.log(`  Length: ${attr.content_length} chars, Paragraphs: ${attr.paragraph_count}`);
		}
	} else {
		console.error("Content generation failed:", data);
	}
}

runLiveTask13Test().catch(console.error);
