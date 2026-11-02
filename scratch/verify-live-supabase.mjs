import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// Load .dev.vars manually
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

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .dev.vars");
  process.exit(1);
}

const client = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Checking Supabase connection to:", supabaseUrl);
  
  // 1. Check storage bucket
  const { data: buckets, error: bucketError } = await client.storage.listBuckets();
  if (bucketError) {
    console.error("Failed to list buckets:", bucketError.message);
  } else {
    console.log("Buckets found:", buckets.map(b => ({ name: b.name, public: b.public, file_size_limit: b.file_size_limit })));
    const targetBucket = buckets.find(b => b.name === "lawbriefly-carousel-assets");
    if (targetBucket) {
      console.log("Target bucket 'lawbriefly-carousel-assets' status: FOUND, public =", targetBucket.public);
    } else {
      console.warn("Target bucket 'lawbriefly-carousel-assets' NOT FOUND in list.");
    }
  }

  // 2. Check table public.social_content_posts
  const { data: posts, error: postsError } = await client
    .from("social_content_posts")
    .select("id, topic_title, post_status, created_at")
    .limit(3);
    
  if (postsError) {
    console.error("Error querying social_content_posts:", postsError.message);
  } else {
    console.log("Query social_content_posts SUCCESS, rows count:", posts.length);
  }

  // 3. Check table public.social_content_assets
  const { data: assets, error: assetsError } = await client
    .from("social_content_assets")
    .select("id, post_id, asset_type, storage_path")
    .limit(3);

  if (assetsError) {
    console.error("Error querying social_content_assets:", assetsError.message);
  } else {
    console.log("Query social_content_assets SUCCESS, rows count:", assets.length);
  }
}

main().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
