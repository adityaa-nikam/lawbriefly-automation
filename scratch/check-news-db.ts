import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

async function run() {
	const devVarsPath = path.join(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
		const idx = line.indexOf("=");
		if (idx > 0 && !line.trim().startsWith("#")) {
			vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		}
	}
	const c = createClient(vars.SUPABASE_URL, vars.SUPABASE_SECRET_KEY);
	const res = await c.from("news_articles").select("id, title, url, created_at").limit(3);
	console.log("news_articles response:", res.error ? res.error : `Found ${res.data?.length} rows`);
}

run().catch(console.error);

