import * as fs from "node:fs";
import * as path from "node:path";
import { verifyInstagramCredentials } from "../src/services/instagram-publishing";

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
	const res = await verifyInstagramCredentials(v as any);
	console.log("verifyInstagramCredentials result:", res);
}

main().catch(console.error);

