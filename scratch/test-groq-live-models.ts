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

	const modelsToTest = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"];

	for (const model of modelsToTest) {
		console.log(`\nTesting model: ${model}...`);
		try {
			const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
				method: "POST",
				headers: {
					"Authorization": `Bearer ${vars.GROQ_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: "system", content: "You are an assistant. Output valid JSON only." },
						{ role: "user", content: "Return a JSON object with 'status': 'ok' and 'model': '" + model + "'." },
					],
					response_format: { type: "json_object" },
					temperature: 0.1,
					max_tokens: 50,
				}),
			});

			console.log(`Status for ${model}: ${res.status} ${res.statusText}`);
			const data: any = await res.json();
			if (res.ok) {
				console.log(`Response content for ${model}:`, data.choices?.[0]?.message?.content);
			} else {
				console.log(`Error for ${model}:`, JSON.stringify(data.error));
			}
		} catch (err: any) {
			console.error(`Fetch exception for ${model}:`, err.message);
		}
	}
}

run().catch(console.error);

