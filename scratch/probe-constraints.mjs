import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import crypto from "node:crypto";

const devVarsContent = fs.readFileSync(".dev.vars", "utf-8");
const devVars = {};
for (const line of devVarsContent.split("\n")) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith("#")) {
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      devVars[key] = val;
    }
  }
}

const client = createClient(devVars.SUPABASE_URL, devVars.SUPABASE_SECRET_KEY);

async function testVariations() {
  const hex64 = crypto.createHash("sha256").update("test-probe-" + Date.now()).digest("hex");
  const testPost = {
    content_fingerprint: hex64,
    topic_title: "Probe Topic",
    legal_domain: "tax_law",
    jurisdiction: "Union of India",
    generation_status: "ready_for_review",
    post_status: "storing",
    carousel_slide_count: 5,
    instagram_caption: "Probe caption",
    hashtags: [],
    content_package: {},
    source_metrics: {},
    source_attributions: [],
    renderer_version: "v2",
    human_review_required: true,
  };
  const { data: post, error: pErr } = await client.from("social_content_posts").insert(testPost).select().single();
  if (pErr) return console.error(pErr);

  console.log("Post ID:", post.id);

  // Test 1: asset_key = "slide-01", storage_path = "posts/.../slide-01.png"
  const t1 = {
    post_id: post.id,
    asset_type: "slide",
    asset_key: "slide-01",
    slide_number: 1,
    storage_bucket: "lawbriefly-carousel-assets",
    storage_path: `posts/${post.id}/slide-01.png`,
    mime_type: "image/png",
    width: 1080,
    height: 1350,
    size_bytes: 1000,
    sha256: hex64,
  };
  const { error: e1 } = await client.from("social_content_assets").insert(t1);
  console.log("Test 1 (slide-01, slide-01.png):", e1 ? e1.message : "SUCCESS");

  // Test 2: asset_key = "slide_1", storage_path = "posts/.../slide-01.png"
  const t2 = {
    post_id: post.id,
    asset_type: "slide",
    asset_key: "slide_1",
    slide_number: 2,
    storage_bucket: "lawbriefly-carousel-assets",
    storage_path: `posts/${post.id}/slide-02.png`,
    mime_type: "image/png",
    width: 1080,
    height: 1350,
    size_bytes: 1000,
    sha256: hex64,
  };
  const { error: e2 } = await client.from("social_content_assets").insert(t2);
  console.log("Test 2 (slide_1, slide-02.png):", e2 ? e2.message : "SUCCESS");

  // Test 3: asset_key = "slide-03", storage_path = "posts/.../slide-03-legal-details.png"
  const t3 = {
    post_id: post.id,
    asset_type: "slide",
    asset_key: "slide-03",
    slide_number: 3,
    storage_bucket: "lawbriefly-carousel-assets",
    storage_path: `posts/${post.id}/slide-03-legal-details.png`,
    mime_type: "image/png",
    width: 1080,
    height: 1350,
    size_bytes: 1000,
    sha256: hex64,
  };
  const { error: e3 } = await client.from("social_content_assets").insert(t3);
  console.log("Test 3 (slide-03, slide-03-legal-details.png):", e3 ? e3.message : "SUCCESS");

  await client.from("social_content_posts").delete().eq("id", post.id);
}

testVariations().catch(console.error);
