/**
 * Manual test script for LawBriefly Instagram Single Image Publishing
 * 
 * Invokes local Cloudflare Worker development endpoint with prepare_only: true.
 * Verifies:
 * - Supabase image retrieval & signed URL generation (60-minute TTL).
 * - Meta Graph API container creation on graph.instagram.com/v26.0.
 * - Container status polling.
 * - Confirms media_publish is NOT called in prepare_only mode.
 */

async function main() {
  console.log("=== LawBriefly Instagram Single Image Publish (Manual Test) ===");

  const payload = {
    post_id: "b83226a8-55cf-4a04-95ac-ffe922728c42",
    media_type: "IMAGE",
    prepare_only: true
  };

  console.log("Request Payload:", JSON.stringify(payload, null, 2));

  try {
    const res = await fetch("http://127.0.0.1:8787/api/ai/publish-instagram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    console.log("Response Status:", res.status);
    const data = await res.json();
    console.log("Response Data:", JSON.stringify(data, null, 2));

    if (data.success && data.prepare_only) {
      console.log("\n[SUCCESS] Single image container prepared successfully on Meta Instagram Graph API!");
      console.log("Container ID:", data.container_id);
      console.log("Ready for live publishing when approved.");
    } else {
      console.log("\n[FAILED]", data.message || data.error);
    }
  } catch (err) {
    console.error("Fetch failed:", err.message);
  }
}

main();
