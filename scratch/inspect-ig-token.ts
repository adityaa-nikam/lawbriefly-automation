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

const v = parseDevVars();
const token = v.INSTAGRAM_ACCESS_TOKEN || "";
console.log("Token length:", token.length);
console.log("Token prefix:", token.slice(0, 15));
console.log("Token suffix:", token.slice(-10));
console.log("Contains whitespace or quotes:", /\s/.test(token), token.startsWith('"'));

