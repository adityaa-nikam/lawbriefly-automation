import * as fs from "node:fs";
import * as path from "node:path";

async function run() {
	const devVarsPath = path.join(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
		const idx = line.indexOf("=");
		if (idx > 0 && !line.trim().startsWith("#")) {
			vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		}
	}
	const res = await fetch("https://r.jina.ai/https://example.com", {
		headers: {
			"Authorization": `Bearer ${vars.JINA_API_KEY}`,
			"X-Return-Format": "text",
		},
	});
	console.log("Jina ping status:", res.status, res.statusText);
	const text = await res.text();
	console.log("Jina body preview:", text.substring(0, 100));
}

run().catch(console.error);

