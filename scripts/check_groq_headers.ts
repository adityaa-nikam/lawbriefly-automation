import fs from 'fs';

const lines = fs.readFileSync('.dev.vars', 'utf8').split('\n');
const vars: Record<string, string> = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    const k = trimmed.slice(0, idx).trim();
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    vars[k] = v;
  }
}

async function testModel(modelName: string) {
  const apiKey = vars.GROQ_API_KEY;
  console.log(`\nTesting Groq model ${modelName}...`);
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: "hi" }]
    })
  });
  console.log("Status:", res.status);
  for (const [k, v] of res.headers.entries()) {
    if (k.includes("ratelimit") || k.includes("retry")) {
      console.log(`Header ${k}: ${v}`);
    }
  }
  const body = await res.json();
  if (res.ok) {
    console.log("Success! Choices:", (body as any).choices?.[0]?.message?.content);
  } else {
    console.log("Error Body:", JSON.stringify(body, null, 2));
  }
}

async function run() {
  await testModel("openai/gpt-oss-20b");
  await testModel("qwen/qwen3.8-27b");
}

run();
