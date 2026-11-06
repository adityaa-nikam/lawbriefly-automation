import * as fs from "node:fs";
import * as path from "node:path";
import worker from "../src/index";

async function run() {
	const devVarsPath = path.join(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
		const idx = line.indexOf("=");
		if (idx > 0 && !line.trim().startsWith("#")) {
			vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		}
	}

	const req = new Request("http://127.0.0.1:8787/api/dashboard/news-sync", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ days: "1", limit: "3" }),
	});

	const res = await worker.fetch(req, vars as any);
	console.log("POST /api/dashboard/news-sync status:", res.status);
	const data = await res.json();
	console.log("Response payload:", JSON.stringify(data, null, 2));
}

run().catch(console.error);

