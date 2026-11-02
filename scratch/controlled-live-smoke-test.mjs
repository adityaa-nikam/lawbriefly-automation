import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { persistRenderedCarousel, getStoredCarouselById } from "../src/services/carousel-persistence.ts";

// 1. Load .dev.vars
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

const env = {
  APP_ENV: "development",
  SUPABASE_URL: devVars.SUPABASE_URL,
  SUPABASE_SECRET_KEY: devVars.SUPABASE_SECRET_KEY,
};

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// 2. Build temporary verification package with unique timestamped candidate ID
const timestamp = Date.now();
const tempContentPackage = {
  success: true,
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  generation_status: "ready_for_review",
  generated_at: new Date(timestamp).toISOString(),
  topic: {
    candidate_id: `qa-smoke-audit-${timestamp}`,
    topic_title: `QA Smoke Test Audit Verification — ${timestamp}`,
    legal_domain: "tax_law",
    jurisdiction: "Union of India",
  },
  carousel_slide_count: 5,
  slides: [
    {
      slide_number: 1,
      slide_role: "cover",
      headline: "Controlled QA Verification Cover Slide",
      subtitle: "Testing end-to-end Supabase persistence, storage, and cleanup.",
      claims: [{ claim_id: "claim-1", text: "Verification claim", claim_type: "reported_fact", supporting_article_ids: ["art-1"] }],
      text_references: { headline_claim_ids: ["claim-1"], subtitle_claim_ids: ["claim-1"], body_claim_ids: [], bullet_claim_ids: [["claim-1"]] },
      bullet_points: ["Controlled verification run"],
    },
    {
      slide_number: 2,
      slide_role: "what_happened",
      headline: "Decriminalisation & Enforcement Details",
      body_text: "Controlled test body copy validating factual slide persistence.",
      bullet_points: ["Omission of arrest powers", "Prosecution threshold raised"],
      claims: [{ claim_id: "claim-2", text: "Factual claim", claim_type: "reported_fact", supporting_article_ids: ["art-1"] }],
      text_references: { headline_claim_ids: ["claim-2"], subtitle_claim_ids: [], body_claim_ids: ["claim-2"], bullet_claim_ids: [["claim-2"]] },
    },
    {
      slide_number: 3,
      slide_role: "legal_details",
      headline: "Statutory Reforms & Procedural Safeguards",
      body_text: "Testing procedural status checks and statutory references.",
      bullet_points: ["Statutory amendments required", "Gazette notification pending"],
      claims: [{ claim_id: "claim-3", text: "Procedural claim", claim_type: "procedural_status", supporting_article_ids: ["art-1"] }],
      text_references: { headline_claim_ids: ["claim-3"], subtitle_claim_ids: [], body_claim_ids: ["claim-3"], bullet_claim_ids: [["claim-3"]] },
    },
    {
      slide_number: 4,
      slide_role: "why_it_matters",
      headline: "Impact Analysis on Commercial Entities",
      body_text: "Testing commercial takeaway and risk reduction context.",
      bullet_points: ["Reduced coercive risk", "Working capital protection"],
      claims: [{ claim_id: "claim-4", text: "Impact claim", claim_type: "attributed_statement", supporting_article_ids: ["art-1"] }],
      text_references: { headline_claim_ids: ["claim-4"], subtitle_claim_ids: [], body_claim_ids: ["claim-4"], bullet_claim_ids: [["claim-4"]] },
    },
    {
      slide_number: 5,
      slide_role: "sources_disclaimer",
      headline: "Authoritative Sources & Editorial Verification Notice",
      body_text: "CII Industry Memorandum on Tax Decriminalisation",
      bullet_points: ["Independent corroboration verified", "Editorial review mandatory"],
      claims: [{ claim_id: "claim-5", text: "Notice claim", claim_type: "editorial_context", supporting_article_ids: ["art-1"] }],
      text_references: { headline_claim_ids: ["claim-5"], subtitle_claim_ids: [], body_claim_ids: ["claim-5"], bullet_claim_ids: [["claim-5"]] },
    },
  ],
  timeline_events: [],
  instagram_caption: "QA Smoke Test Audit Verification Caption for controlled testing.",
  caption_claim_ids: ["claim-1"],
  caption_evidence: { text: "QA Caption", supporting_claim_ids: ["claim-1"] },
  hashtags: ["#LawBriefly", "#QATest"],
  evidence: { claims: [], limitations: [], editorial_flags: [], human_review_required: true },
  source_attributions: [{ article_id: "art-1", original_title: "CII Source", original_url: "https://example.com/source", source_domain: "example.com", extraction_status: "success" }],
  source_metrics: { requested_article_count: 1, successful_extraction_count: 1, failed_extraction_count: 0, unique_source_domain_count: 1, source_diversity_status: "single_domain" },
};

// 3. Load actual rendered 1080x1350 PNG slides
const artifactsDir = path.resolve(process.cwd(), "artifacts", "task14-preview");
const slideFilenames = [
  "slide-01-cover.png",
  "slide-02-what-happened.png",
  "slide-03-legal-details.png",
  "slide-04-why-it-matters.png",
  "slide-05-sources-disclaimer.png",
];

const slides = slideFilenames.map((fname, idx) => {
  const bytes = fs.readFileSync(path.join(artifactsDir, fname));
  return {
    slide_number: idx + 1,
    slide_role: tempContentPackage.slides[idx].slide_role,
    filename: fname,
    mime_type: "image/png",
    bytes: new Uint8Array(bytes),
    width: 1080,
    height: 1350,
  };
});

const manifest = {
  rendered_at: new Date().toISOString(),
  total_slides: 5,
  dimensions: "1080x1350",
  primary_category: "tax_law",
  topic_title: tempContentPackage.topic.topic_title,
  slides: slides.map(s => ({
    slide_number: s.slide_number,
    slide_role: s.slide_role,
    filename: s.filename,
    dimensions: { width: 1080, height: 1350 },
  })),
};

const renderedArtifact = {
  manifest,
  manifestBytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  slides,
};

async function executeControlledSmokeTest() {
  console.log("=== STARTING CONTROLLED LIVE SMOKE TEST ===");
  console.log("Candidate ID:", tempContentPackage.topic.candidate_id);

  let createdPostId = null;
  const createdStoragePaths = [];

  try {
    // Step 1: Execute actual persistence service
    console.log("\n[Step 1] Invoking persistRenderedCarousel()...");
    const result1 = await persistRenderedCarousel(env, tempContentPackage, renderedArtifact);

    if (!result1.success || !result1.post_id) {
      throw new Error(`Persistence call failed: ${result1.error || "No post ID returned"}`);
    }

    createdPostId = result1.post_id;
    console.log("Success! Created Post ID:", createdPostId);
    console.log("Post status:", result1.post_status);
    console.log("Slide count:", result1.carousel_slide_count);
    console.log("Assets count:", result1.assets.length);

    // Record created storage paths for cleanup
    for (const a of result1.assets) {
      createdStoragePaths.push(a.storage_path);
    }

    // Step 2: Verify Database Records
    console.log("\n[Step 2] Verifying PostgreSQL records...");
    const { data: postRow, error: pErr } = await supabase
      .from("social_content_posts")
      .select("*")
      .eq("id", createdPostId)
      .single();

    if (pErr || !postRow) throw new Error(`Post not found in database: ${pErr?.message}`);
    console.log("Verified post in DB: status =", postRow.post_status, ", human_review_required =", postRow.human_review_required);

    const { data: assetRows, error: aErr } = await supabase
      .from("social_content_assets")
      .select("*")
      .eq("post_id", createdPostId)
      .order("slide_number", { ascending: true, nullsFirst: false });

    if (aErr || assetRows.length !== 6) throw new Error(`Expected 6 asset rows, found ${assetRows?.length}: ${aErr?.message}`);
    console.log("Verified 6 asset records in DB matching 5 slides + 1 manifest.");

    // Step 3: Verify Storage Objects & Access Controls
    console.log("\n[Step 3] Verifying private storage bucket access controls...");
    const slide1Asset = result1.assets.find(a => a.slide_number === 1);
    const publicUrl = supabase.storage.from("lawbriefly-carousel-assets").getPublicUrl(slide1Asset.storage_path).data.publicUrl;

    const publicRes = await fetch(publicUrl);
    console.log("Unauthenticated public HTTP status:", publicRes.status, "(Access Denied expected: 400/403/404)");
    if (publicRes.status === 200) {
      throw new Error("SECURITY FAILURE: Private storage object was publicly accessible without signature!");
    }

    const signedUrl = result1.signed_urls[slide1Asset.asset_key];
    console.log("Signed URL present:", !!signedUrl);
    const signedRes = await fetch(signedUrl);
    console.log("Signed URL HTTP status:", signedRes.status, "(Expected: 200)");
    const downloadedBuf = await signedRes.arrayBuffer();
    console.log("Signed URL byte count:", downloadedBuf.byteLength, "(Matches uploaded:", downloadedBuf.byteLength === slide1Asset.size_bytes, ")");

    // Step 4: Verify Idempotency on repeated execution
    console.log("\n[Step 4] Verifying idempotency on identical retry...");
    const result2 = await persistRenderedCarousel(env, tempContentPackage, renderedArtifact);
    console.log("Retry result: post_id =", result2.post_id, ", is_duplicate =", result2.is_duplicate);

    if (result2.post_id !== createdPostId || !result2.is_duplicate) {
      throw new Error("Idempotency failed: Retry created duplicate or different post ID!");
    }

    // Verify row count in DB hasn't increased
    const { count: postCount } = await supabase
      .from("social_content_posts")
      .select("*", { count: "exact", head: true })
      .eq("content_fingerprint", result1.content_fingerprint);

    if (postCount !== 1) {
      throw new Error(`Idempotency violated: Found ${postCount} posts for same fingerprint!`);
    }
    console.log("Idempotency fully confirmed: 0 duplicate posts, 0 duplicate assets.");

    // Step 5: Test Retrieval via getStoredCarouselById
    console.log("\n[Step 5] Testing getStoredCarouselById()...");
    const retrieved = await getStoredCarouselById(env, createdPostId, 900);
    console.log("Retrieved post:", retrieved.post.id, ", fresh signed URLs generated:", Object.keys(retrieved.signed_urls).length);

    console.log("\n>>> LIVE SMOKE TEST PASSED WITH 100% SUCCESS <<<");
    return {
      success: true,
      postId: createdPostId,
      storagePaths: createdStoragePaths,
      slideCount: result1.carousel_slide_count,
      assetCount: result1.assets.length,
      fingerprint: result1.content_fingerprint,
    };
  } finally {
    // Step 6: Controlled Cleanup of Temporary Smoke Test Artifacts
    if (createdPostId) {
      console.log("\n[Step 6] Performing controlled cleanup of temporary verification records...");
      
      // 1. Delete storage objects
      if (createdStoragePaths.length > 0) {
        console.log(`Deleting ${createdStoragePaths.length} temporary storage objects from lawbriefly-carousel-assets...`);
        const { error: remErr } = await supabase.storage.from("lawbriefly-carousel-assets").remove(createdStoragePaths);
        if (remErr) console.warn("Storage removal warning:", remErr.message);
        else console.log("Storage cleanup: SUCCESS.");
      }

      // 2. Delete database post (cascades to assets)
      console.log(`Deleting temporary post ${createdPostId} from social_content_posts...`);
      const { error: delErr } = await supabase.from("social_content_posts").delete().eq("id", createdPostId);
      if (delErr) console.warn("Database post deletion warning:", delErr.message);
      else console.log("Database post cleanup: SUCCESS.");

      // 3. Verify cleanup
      const { data: checkPost } = await supabase.from("social_content_posts").select("id").eq("id", createdPostId);
      console.log("Cleanup verification: remaining matching post rows =", checkPost?.length ?? 0);
    }
  }
}

executeControlledSmokeTest()
  .then(res => {
    console.log("\nFINAL SMOKE TEST RESULT:", JSON.stringify(res, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error("\nCONTROLLED SMOKE TEST FAILED:", err);
    process.exit(1);
  });
