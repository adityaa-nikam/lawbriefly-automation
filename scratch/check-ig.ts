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
	const accountId = v.INSTAGRAM_ACCOUNT_ID;
	const token = v.INSTAGRAM_ACCESS_TOKEN;

	console.log("Checking graph.instagram.com/me...");
	const res1 = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${token}`);
	console.log("graph.instagram.com status:", res1.status, await res1.json());

	console.log("\nChecking graph.facebook.com/v21.0/me...");
	const res2 = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`);
	console.log("graph.facebook.com status:", res2.status, await res2.json());

	console.log("\nChecking graph.instagram.com/v21.0/" + accountId);
	const res3 = await fetch(`https://graph.instagram.com/v21.0/${accountId}?fields=id,username&access_token=${token}`);
	console.log("graph.instagram.com/" + accountId + " status:", res3.status, await res3.json());
}

main().catch(console.error);
