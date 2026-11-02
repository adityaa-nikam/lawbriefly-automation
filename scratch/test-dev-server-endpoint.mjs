import fs from "node:fs";

// Load sample content package
const devTestScript = fs.readFileSync("scratch/test-live-persistence.mjs", "utf-8");
const match = devTestScript.match(/const sampleContentPackage = (\{[\s\S]*?\n\};)/);
const sampleContentPackage = eval("(" + match[1].slice(0, -1) + ")");

async function testEndpoint() {
  console.log("Calling POST http://127.0.0.1:8787/api/ai/store-carousel...");
  const res = await fetch("http://127.0.0.1:8787/api/ai/store-carousel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content_package: sampleContentPackage }),
  });

  console.log("Response status:", res.status);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    console.log("Response JSON:", json);
  } catch {
    console.log("Response Text:", text);
  }
}

testEndpoint().catch(console.error);
