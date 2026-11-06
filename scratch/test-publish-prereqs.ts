import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

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

	const { data: assets } = await supabase
		.from("social_content_assets")
		.select("*")
		.eq("post_id", postId)
		.eq("asset_type", "publishing_slide")
		.order("slide_number", { ascending: true });

	console.log("Publishing slides count:", assets?.length);
	for (const a of assets || []) {
		const { data: signed, error: signErr } = await supabase.storage
			.from(a.storage_bucket)
			.createSignedUrl(a.storage_path, 3600);
		console.log(`Slide ${a.slide_number}:`, signed?.signedUrl ? "Signed URL OK" : `Error: ${signErr?.message}`);
	}
}

main().catch(console.error);
