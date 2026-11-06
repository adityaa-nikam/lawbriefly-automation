import * as fs from "node:fs";
import * as path from "node:path";

async function run() {
	const devVarsPath = path.join(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
		const idx = line.indexOf("=");
		if (idx > 0 && !line.trim().startsWith("#")) {
			vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		}
	}
	const res = await fetch("https://api.groq.com/openai/v1/models", {
		headers: {
			"Authorization": `Bearer ${vars.GROQ_API_KEY}`,
		},
	});
	const data: any = await res.json();
	console.log("Groq available models:", data.data?.map((m: any) => m.id));
}

run().catch(console.error);

