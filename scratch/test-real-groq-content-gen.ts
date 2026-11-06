import * as fs from "node:fs";
import * as path from "node:path";
import { callGroqContentGeneration } from "../src/services/groq";

async function run() {
	const devVarsPath = path.join(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
		const idx = line.indexOf("=");
		if (idx > 0 && !line.trim().startsWith("#")) {
			vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		}
	}

	const articleContent = "In a major ruling, a division bench of the Supreme Court held that the power to arrest under Section 69 of the Central Goods and Services Tax (CGST) Act cannot be exercised routinely or arbitrarily. The bench clarified that tax authorities must establish reasoned suspicion of tax evasion exceeding the statutory threshold and comply with Article 21 and Section 41 CrPC requirements before executing an arrest. The Court observed that arrest is an extreme measure affecting personal liberty.";

	const input = {
		topic: {
			candidate_id: "cand-live-1",
			topic_title: "Supreme Court Curbs GST Section 69 Arrest Powers",
			topic_summary: "The Supreme Court mandated that arrest powers under Section 69 of the Central GST Act require demonstrable evidence and adherence to strict procedural safeguards.",
			legal_domain: "tax_law",
			jurisdiction: "Union of India",
			editorial_angle: "Procedural safeguards against arbitrary tax arrests",
		},
		articles: [
			{
				article_id: "art-101",
				original_title: "Supreme Court Curbs GST Section 69 Arrest Powers",
				source_domain: "livelaw.in",
				content: articleContent,
				content_length: articleContent.length,
				paragraph_count: 1,
			},
		],
	};

	console.log("Calling callGroqContentGeneration with GROQ_MODEL:", vars.GROQ_MODEL);
	const startTime = Date.now();
	const res = await callGroqContentGeneration(vars as any, input);
	const elapsed = Date.now() - startTime;
	console.log(`Elapsed: ${elapsed}ms, Success:`, res.success);
	if (res.success) {
		console.log("Model used:", res.model);
		console.log("Slide count:", res.data.slides?.length);
		console.log("First slide:", JSON.stringify(res.data.slides?.[0], null, 2));
		console.log("Instagram caption preview:", res.data.instagram_caption?.substring(0, 100));
	} else {
		console.error("Content generation failed:", res.status, res.error);
	}
}

run().catch(console.error);
