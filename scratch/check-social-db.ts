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
	const p = await c.from("social_content_posts").select("id, status").limit(3);
	console.log("social_content_posts response:", p.error ? p.error : `Found ${p.data?.length} rows`);
	const pub = await c.from("social_content_publications").select("id, publication_status").limit(3);
	console.log("social_content_publications response:", pub.error ? pub.error : `Found ${pub.data?.length} rows`);
}

run().catch(console.error);

