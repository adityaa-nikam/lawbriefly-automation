import * as fs from "node:fs";
import * as path from "node:path";
import { callGroqBatchAnalysis } from "../src/services/groq";

async function run() {
	const devVarsPath = path.join(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
		const idx = line.indexOf("=");
		if (idx > 0 && !line.trim().startsWith("#")) {
			vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		}
	}

	const articles = [
		{
			article_id: "art-test-1",
			title: "Supreme Court Overhauls Tax Enforcement Rules",
			description: "The Supreme Court of India held that Section 69 arrest powers under GST require prior judicial authorization, establishing significant taxpayer safeguards.",
			url: "https://example.com/sc-tax-ruling",
		},
		{
			article_id: "art-test-2",
			title: "Delhi High Court Directs Framing of Digital Copyright Rules",
			description: "The Delhi High Court ordered the central government to formulate guidelines for artificial intelligence training on copyrighted works.",
			url: "https://example.com/dhc-ai-copyright",
		},
	];

	console.log("Calling callGroqBatchAnalysis with GROQ_MODEL:", vars.GROQ_MODEL);
	const startTime = Date.now();
	const res = await callGroqBatchAnalysis(vars as any, articles);
	const elapsed = Date.now() - startTime;
	console.log(`Elapsed: ${elapsed}ms, Success:`, res.success);
	if (res.success) {
		console.log("Model used:", res.model);
		console.log("Topic clusters count:", res.data.topic_clusters?.length);
		console.log("First cluster:", JSON.stringify(res.data.topic_clusters?.[0], null, 2));
	} else {
		console.error("Batch analysis failed:", res.status, res.error);
	}
}

run().catch(console.error);

