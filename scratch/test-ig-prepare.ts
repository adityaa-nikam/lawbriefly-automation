import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { publishApprovedCarousel } from "../src/services/instagram-publishing";

function parseDevVars(): Record<string, string> {
	const devVarsPath = path.resolve(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	if (!fs.existsSync(devVarsPath)) return vars;
	const content = fs.readFileSync(devVarsPath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex > 0) {
			const key = trimmed.slice(0, eqIndex).trim();
			let val = trimmed.slice(eqIndex + 1).trim();
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			vars[key] = val;
		}
	}
	return vars;
}

async function main() {
	const v = parseDevVars();
	const supabase = createClient(v.SUPABASE_URL, v.SUPABASE_SECRET_KEY);
	const postId = "9a9841a9-59d7-49b3-9495-ba4a33687e52";

	// Temporarily mark post as approved in DB to test validation
	await supabase.from("social_content_posts").update({ post_status: "approved" }).eq("id", postId);

	console.log("Testing publishApprovedCarousel with prepareOnly: true...");
	const result = await publishApprovedCarousel(v as any, postId, { prepareOnly: true });
	console.log("Prepare result:", result);
}

main().catch(console.error);

