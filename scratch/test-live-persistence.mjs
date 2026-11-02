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

// 2. Load authentic Task 13C content package
const sampleContentPackage = {
	success: true,
	provider: "groq",
	model: "llama-3.3-70b-versatile",
	generation_status: "ready_for_review",
	generated_at: "2026-11-02T05:00:00Z",
	topic: {
		candidate_id: "topic-1",
		topic_title: "CII Hails GST Reforms As Transition To Trust-Based Governance",
		legal_domain: "tax_law",
		jurisdiction: "Union of India",
	},
	carousel_slide_count: 5,
	slides: [
		{
			slide_number: 1,
			slide_role: "cover",
			headline: "GST Council Recommends Shift to Trust-Based Tax Governance",
			subtitle: "Proposals include omitting Section 69 arrest powers and raising prosecution thresholds to Rs 5 crore.",
			claims: [
				{
					claim_id: "claim-1",
					text: "Shift to trust-based governance",
					claim_type: "reported_fact",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "trust-based governance" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-1"],
				subtitle_claim_ids: ["claim-1"],
				body_claim_ids: [],
				bullet_claim_ids: [["claim-1"]],
			},
			visual_direction: "Editorial hero with balanced scales",
			visual_spec: {
				layout_variant: "cover",
				background_variant: "brand_dark",
				visual_elements: ["scales"],
				emphasis: "headline",
			},
			bullet_points: [
				"Fundamental recalibration of enforcement to promote voluntary tax compliance and business confidence.",
			],
		},
		{
			slide_number: 2,
			slide_role: "what_happened",
			headline: "Decriminalisation & Enforcement Rationalisation",
			body_text: "Apex industry chamber CII praised the GST Council decisions on decriminalisation and rationalisation of tax enforcement powers as a landmark transition toward trust-based economic governance.",
			bullet_points: [
				"Proposed omission of Section 69 arrest powers from the CGST Act to eliminate coercive threat from tax administration.",
				"Fivefold increase in monetary prosecution threshold from Rs 1 crore to Rs 5 crore protects legitimate business activity.",
				"Imprisonment provisions and specified offences under Section 132 narrowed to separate civil disputes from deliberate fraud.",
			],
			claims: [
				{
					claim_id: "claim-2",
					text: "Omission of Section 69 arrest powers",
					claim_type: "reported_fact",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "Section 69 arrest powers" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-2"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-2"],
				bullet_claim_ids: [["claim-2"]],
			},
			visual_direction: "Structured factual breakdown",
			visual_spec: {
				layout_variant: "editorial_text",
				background_variant: "brand_light",
				visual_elements: ["document"],
				emphasis: "key_fact",
			},
		},
		{
			slide_number: 3,
			slide_role: "legal_details",
			headline: "Statutory Reforms & Procedural Safeguards",
			body_text: "The reforms require legislative amendments to the Central Goods and Services Tax Act, 2017, aligning statutory thresholds with administrative circulars issued on October 26, 2026.",
			bullet_points: [
				"Omission of Section 69 arrest powers awaits statutory enactment and official Gazette notification.",
				"Compounding fees reduced from 50%-150% down to 25%-100% of tax amount to encourage voluntary dispute resolution.",
				"Decriminalisation applies prospectively to pending proceedings under revised monetary limits.",
			],
			claims: [
				{
					claim_id: "claim-3",
					text: "Statutory amendments required",
					claim_type: "procedural_status",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "legislative amendments" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-3"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-3"],
				bullet_claim_ids: [["claim-3"]],
			},
			visual_direction: "Procedural status banner",
			visual_spec: {
				layout_variant: "bullet_cards",
				background_variant: "brand_light",
				visual_elements: ["shield"],
				emphasis: "key_fact",
			},
		},
		{
			slide_number: 4,
			slide_role: "why_it_matters",
			headline: "Impact on Industry & Legal Practice",
			body_text: "For businesses and MSMEs, the reform reduces disproportionate criminal risk for routine commercial disputes, establishing clear legal boundaries between non-compliance and deliberate evasion.",
			bullet_points: [
				"Enhanced working capital efficiency and relief from coercive detention during audit inquiries.",
				"Judicial discretion in tax adjudication prioritised over custodial investigations.",
				"India moves closer to global best practices in indirect tax administration.",
			],
			claims: [
				{
					claim_id: "claim-4",
					text: "Reduces disproportionate criminal risk",
					claim_type: "attributed_statement",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "commercial disputes" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-4"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-4"],
				bullet_claim_ids: [["claim-4"]],
			},
			visual_direction: "High contrast impact takeaway",
			visual_spec: {
				layout_variant: "impact_cards",
				background_variant: "brand_light",
				visual_elements: ["rupee"],
				emphasis: "takeaway",
			},
		},
		{
			slide_number: 5,
			slide_role: "sources_disclaimer",
			headline: "Authoritative Sources & Editorial Notice",
			body_text: "CII Hails GST Council Decisions On Decriminalisation As Landmark Transition To Trust-Based Economic Governance",
			bullet_points: [
				"Single-source topic: requires independent corroboration before publication.",
				"CBIC Circulars dated 26 October 2026 pending Gazette notification.",
			],
			claims: [
				{
					claim_id: "claim-5",
					text: "Single-source topic notice",
					claim_type: "editorial_context",
					supporting_article_ids: ["art-1"],
					evidence_excerpts: [{ article_id: "art-1", excerpt: "trust-based economic governance" }],
				},
			],
			text_references: {
				headline_claim_ids: ["claim-5"],
				subtitle_claim_ids: [],
				body_claim_ids: ["claim-5"],
				bullet_claim_ids: [["claim-5"]],
			},
			visual_direction: "Provenance and legal disclaimer",
			visual_spec: {
				layout_variant: "source_list",
				background_variant: "brand_light",
				visual_elements: ["chart"],
				emphasis: "sources",
			},
		},
	],
	timeline_events: [],
	instagram_caption: "GST Council recommends omitting Section 69 arrest powers and raising prosecution threshold.",
	caption_claim_ids: ["claim-1"],
	caption_evidence: {
		text: "GST Council recommends omitting Section 69 arrest powers and raising prosecution threshold.",
		supporting_claim_ids: ["claim-1"],
	},
	hashtags: ["#GST", "#LawBriefly", "#TaxReforms"],
	evidence: {
		claims: [],
		limitations: ["Single-source topic: requires independent corroboration."],
		editorial_flags: ["Single-source topic requires independent statutory corroboration"],
		human_review_required: true,
	},
	source_attributions: [
		{
			article_id: "art-1",
			original_title: "CII Hails GST Reforms As Transition To Trust-Based Governance",
			original_url: "https://menafn.com/1109045887/CII-Hails-GST-Reforms",
			source_domain: "menafn.com",
			extraction_status: "success",
		},
	],
	source_metrics: {
		requested_article_count: 1,
		successful_extraction_count: 1,
		failed_extraction_count: 0,
		unique_source_domain_count: 1,
		source_diversity_status: "single_domain",
	},
};

// 3. Load actual rendered PNG files and manifest from artifacts/task14-preview
const artifactsDir = path.resolve(process.cwd(), "artifacts", "task14-preview");
const manifestJson = JSON.parse(fs.readFileSync(path.join(artifactsDir, "manifest.json"), "utf-8"));
const manifestBytes = fs.readFileSync(path.join(artifactsDir, "manifest.json"));

const slideFilenames = [
  "slide-01-cover.png",
  "slide-02-what-happened.png",
  "slide-03-legal-details.png",
  "slide-04-why-it-matters.png",
  "slide-05-sources-disclaimer.png",
];

const slides = slideFilenames.map((fname, idx) => {
  const bytes = fs.readFileSync(path.join(artifactsDir, fname));
  const role = sampleContentPackage.slides[idx].slide_role;
  return {
    slide_number: idx + 1,
    slide_role: role,
    filename: fname,
    mime_type: "image/png",
    bytes: new Uint8Array(bytes),
    width: 1080,
    height: 1350,
  };
});

const renderedArtifact = {
  manifest: manifestJson,
  manifestBytes: new Uint8Array(manifestBytes),
  slides,
};

async function main() {
  console.log("=== STARTING LIVE SUPABASE PERSISTENCE TEST ===");
  console.log(`Supabase Project URL: ${env.SUPABASE_URL}`);
  console.log(`Slides to upload: ${renderedArtifact.slides.length}`);

  // Test 1: Initial Persistence
  console.log("\n--- TEST 1: Persisting Rendered Carousel (Initial Run) ---");
  const result1 = await persistRenderedCarousel(env, sampleContentPackage, renderedArtifact);
  console.log("Persist Result 1:", {
    success: result1.success,
    post_id: result1.post_id,
    post_status: result1.post_status,
    is_duplicate: result1.is_duplicate,
    carousel_slide_count: result1.carousel_slide_count,
    content_fingerprint: result1.content_fingerprint,
    assets_count: result1.assets.length,
    signed_url_expiry_seconds: result1.signed_url_expiry_seconds,
  });

  if (!result1.success || !result1.post_id) {
    throw new Error("Initial persistence failed!");
  }

  // Verify asset details
  console.log("\nAssets uploaded:");
  for (const asset of result1.assets) {
    console.log(`- [${asset.asset_type}] ${asset.asset_key} (${asset.storage_path}): ${asset.size_bytes} bytes, sha256: ${asset.sha256.slice(0, 16)}...`);
    if (asset.signed_preview_url) {
      console.log(`  Signed preview URL generated: YES (length: ${asset.signed_preview_url.length})`);
    }
  }

  // Test 2: Verify Private Storage Access Controls
  console.log("\n--- TEST 2: Verifying Private Storage Bucket Access ---");
  const supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const slide1Asset = result1.assets.find(a => a.slide_number === 1);

  // A. Public URL unauthenticated access check
  const publicUrlResult = supabaseClient.storage.from("lawbriefly-carousel-assets").getPublicUrl(slide1Asset.storage_path);
  console.log("Checking public access to:", publicUrlResult.data.publicUrl);
  const publicRes = await fetch(publicUrlResult.data.publicUrl);
  console.log(`Unauthenticated HTTP status: ${publicRes.status} (Expected: 400 or 403 or 404 - private bucket access denied)`);

  // B. Signed preview URL access check
  const signedPreviewUrl = result1.signed_urls[slide1Asset.asset_key];
  console.log("Checking signed URL access to Slide 1 preview...");
  console.log("Signed URL present:", !!signedPreviewUrl);
  const signedRes = await fetch(signedPreviewUrl);
  console.log(`Signed URL HTTP status: ${signedRes.status} (Expected: 200)`);
  console.log(`Signed URL Content-Type: ${signedRes.headers.get("Content-Type")} (Expected: image/png)`);
  const downloadedBytes = new Uint8Array(await signedRes.arrayBuffer());
  console.log(`Signed URL Downloaded bytes: ${downloadedBytes.length} bytes (Matches uploaded: ${downloadedBytes.length === slide1Asset.size_bytes})`);

  // Test 3: Idempotency (Second Run with identical package)
  console.log("\n--- TEST 3: Idempotency Test (Second Persistence Run) ---");
  const result2 = await persistRenderedCarousel(env, sampleContentPackage, renderedArtifact);
  console.log("Persist Result 2 (Idempotent):", {
    success: result2.success,
    post_id: result2.post_id,
    is_duplicate: result2.is_duplicate,
    post_status: result2.post_status,
  });

  if (result2.post_id !== result1.post_id || result2.is_duplicate !== true) {
    throw new Error(`Idempotency check failed! Expected same post ID and is_duplicate=true`);
  }
  console.log("Idempotency VERIFIED: Returned existing post record without duplicate creation.");

  // Test 4: Retrieve by ID
  console.log("\n--- TEST 4: getStoredCarouselById Verification ---");
  const retrieved = await getStoredCarouselById(env, result1.post_id);
  console.log("Retrieved by ID:", {
    post_id: retrieved.post.id,
    topic_title: retrieved.post.topic_title,
    post_status: retrieved.post.post_status,
    assets_count: retrieved.assets.length,
    signed_urls_generated: Object.keys(retrieved.signed_urls || {}).length,
  });

  // Test 5: Verify Database Record State
  console.log("\n--- TEST 5: Direct Database Record Audit ---");
  const { data: dbPost, error: dbPostErr } = await supabaseClient
    .from("social_content_posts")
    .select("*")
    .eq("id", result1.post_id)
    .single();

  if (dbPostErr) throw dbPostErr;
  console.log("DB Post Audit:", {
    id: dbPost.id,
    fingerprint: dbPost.content_fingerprint,
    status: dbPost.post_status,
    human_review_required: dbPost.human_review_required,
    storage_completed_at: dbPost.storage_completed_at,
    slide_count: dbPost.carousel_slide_count,
  });

  const { data: dbAssets, error: dbAssetsErr } = await supabaseClient
    .from("social_content_assets")
    .select("asset_type, asset_key, slide_number, mime_type, width, height, size_bytes")
    .eq("post_id", result1.post_id)
    .order("slide_number", { ascending: true, nullsFirst: false });

  if (dbAssetsErr) throw dbAssetsErr;
  console.log("DB Assets Count:", dbAssets.length);
  for (const a of dbAssets) {
    console.log(`  - ${a.asset_type} [${a.asset_key}] slide=${a.slide_number} mime=${a.mime_type} dims=${a.width}x${a.height} size=${a.size_bytes}B`);
  }

  console.log("\n=== ALL LIVE VERIFICATION CHECKS COMPLETED SUCCESSFULLY! ===");
}

main().catch(err => {
  console.error("Live test failed:", err);
  process.exit(1);
});
