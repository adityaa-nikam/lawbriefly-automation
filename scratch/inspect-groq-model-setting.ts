import * as fs from "node:fs";
import * as path from "node:path";

const devVarsPath = path.join(process.cwd(), ".dev.vars");
for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
	const idx = line.indexOf("=");
	if (idx > 0 && !line.trim().startsWith("#")) {
		const k = line.slice(0, idx).trim();
		const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		if (k === "GROQ_MODEL") {
			console.log("GROQ_MODEL setting in .dev.vars:", v);
		}
	}
}

