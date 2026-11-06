import * as fs from "node:fs";
import * as path from "node:path";
import { fetchLawBrieflyNews } from "../src/services/lawbriefly";

async function run() {
	const devVarsPath = path.join(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
		const idx = line.indexOf("=");
		if (idx > 0 && !line.trim().startsWith("#")) {
			vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		}
	}
	const res = await fetchLawBrieflyNews(vars as any, { days: "1", limit: "1" });
	console.log("LawBriefly API status:", res.status, res.statusText);
	const data: any = await res.json();
	console.log("LawBriefly API success:", data.success, "articles count:", data.articles?.length);
	if (data.articles?.length > 0) {
		console.log("Sample article title:", data.articles[0].title);
	}
}

run().catch(console.error);

