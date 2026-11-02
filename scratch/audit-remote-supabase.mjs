import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// Load .dev.vars
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

const supabaseUrl = devVars.SUPABASE_URL;
const supabaseKey = devVars.SUPABASE_SECRET_KEY;

const serviceClient = createClient(supabaseUrl, supabaseKey);
// Create unauthenticated client using dummy key to verify RLS rejection
const anonClient = createClient(supabaseUrl, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummyAnonTokenForRlsVerificationTest");

async function runAudit() {
  console.log("=== SUPABASE AUDIT: kacfrcnzxstclzrceugg ===");
  console.log("Project URL:", supabaseUrl);

  const report = {};

  // 1. Storage Bucket Audit
  const { data: buckets, error: bErr } = await serviceClient.storage.listBuckets();
  if (bErr) {
    report.storage = { status: "FAIL", error: bErr.message };
  } else {
    const target = buckets.find(b => b.name === "lawbriefly-carousel-assets");
    report.storage = {
      status: target ? "PASS" : "FAIL",
      found: !!target,
      name: target?.name,
      is_public: target?.public,
      file_size_limit_bytes: target?.file_size_limit,
      allowed_mime_types: target?.allowed_mime_types,
    };
  }

  // 2. Table: social_content_posts query with service_role
  const { data: posts, error: pErr } = await serviceClient
    .from("social_content_posts")
    .select("id, content_fingerprint, topic_title, legal_domain, jurisdiction, generation_status, post_status, carousel_slide_count, instagram_caption, hashtags, content_package, source_metrics, source_attributions, renderer_version, human_review_required, storage_completed_at, created_at, updated_at")
    .limit(1);

  report.social_content_posts = {
    status: pErr ? "FAIL" : "PASS",
    accessible_by_service_role: !pErr,
    error: pErr?.message,
    row_count: posts?.length ?? 0,
  };

  // 3. Table: social_content_assets query with service_role
  const { data: assets, error: aErr } = await serviceClient
    .from("social_content_assets")
    .select("id, post_id, asset_type, asset_key, slide_number, storage_bucket, storage_path, mime_type, width, height, size_bytes, sha256, created_at")
    .limit(1);

  report.social_content_assets = {
    status: aErr ? "FAIL" : "PASS",
    accessible_by_service_role: !aErr,
    error: aErr?.message,
    row_count: assets?.length ?? 0,
  };

  // 4. RLS Audit: Verify unauthenticated/anon access is blocked
  const { data: anonPosts, error: anonPErr } = await anonClient
    .from("social_content_posts")
    .select("id")
    .limit(1);

  const { data: anonAssets, error: anonAErr } = await anonClient
    .from("social_content_assets")
    .select("id")
    .limit(1);

  report.rls_enforcement = {
    anon_posts_blocked: !!anonPErr || (anonPosts && anonPosts.length === 0),
    anon_posts_error: anonPErr?.message || (anonPosts?.length === 0 ? "Empty set (RLS filtered)" : "ALLOWED"),
    anon_assets_blocked: !!anonAErr || (anonAssets && anonAssets.length === 0),
    anon_assets_error: anonAErr?.message || (anonAssets?.length === 0 ? "Empty set (RLS filtered)" : "ALLOWED"),
  };

  // 5. Check existing news pipeline integrity: news_articles
  const { data: news, error: newsErr } = await serviceClient
    .from("news_articles")
    .select("id, title, description, url, first_seen_at")
    .limit(1);

  report.news_articles_table = {
    status: newsErr ? "FAIL" : "PASS",
    error: newsErr?.message,
    accessible: !newsErr,
  };

  // 6. Check existing ingest function with exact parameter name p_articles
  const { data: ingestRes, error: ingestErr } = await serviceClient.rpc("ingest_news_articles", {
    p_articles: [],
  });

  report.ingest_function = {
    status: ingestErr ? "FAIL" : "PASS",
    error: ingestErr?.message,
    result: ingestRes,
  };

  // 7. Check migration history
  // Try querying supabase_migrations schema if accessible
  const { data: migs, error: migErr } = await serviceClient
    .from("supabase_migrations")
    .select("*")
    .limit(5);

  report.migration_table = {
    accessible: !migErr,
    error: migErr?.message,
    migrations: migs,
  };

  console.log("AUDIT RESULTS:\n", JSON.stringify(report, null, 2));
}

runAudit().catch(console.error);
