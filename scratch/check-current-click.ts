import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { calculateSha256 } from "../src/services/carousel-persistence";

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
	const rawToken = "895b4daf581c77b3b9fa0a0776a31956";
	const tokenHash = await calculateSha256(rawToken);

	const { data: actionRow, error } = await supabase
		.from("social_content_approval_actions")
		.select("*, social_content_approval_requests(*)")
		.eq("token_hash", tokenHash)
		.maybeSingle();

	console.log("Action Row:", actionRow);
	console.log("Error:", error);
}

main().catch(console.error);
