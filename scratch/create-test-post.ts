import fs from "node:fs";
import path from "node:path";
import { persistRenderedCarousel } from "../src/services/carousel-persistence";

// 1. Read .dev.vars
const envContent = fs.readFileSync(".dev.vars", "utf8");
const devVars: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const idx = trimmed.indexOf("=");
  const key = trimmed.slice(0, idx).trim();
  const val = trimmed.slice(idx + 1).trim().replace(/^["']+|["']+$/g, "");
  devVars[key] = val;
}

const env: any = {
  APP_ENV: "development",
  SUPABASE_URL: devVars.SUPABASE_URL,
  SUPABASE_SECRET_KEY: devVars.SUPABASE_SECRET_KEY,
};

const timestamp = Date.now();
const testTopicTitle = `CII Hails GST Reforms — Live E2E Integration Test ${timestamp}`;
const testCandidateId = `e2e-live-test-${timestamp}`;

console.log(`Preparing fresh test post: "${testTopicTitle}"`);

const contentPackage: any = {
  success: true,
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  generation_status: "ready_for_review",
  generated_at: new Date().toISOString(),
  topic: {
    candidate_id: testCandidateId,
    topic_title: testTopicTitle,
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
  instagram_caption: "GST Council recommends omitting Section 69 arrest powers and raising prosecution threshold. Landmark move to trust-based tax governance.",
  caption_claim_ids: ["claim-1"],
  caption_evidence: {
    text: "GST Council recommends omitting Section 69 arrest powers and raising prosecution threshold.",
    supporting_claim_ids: ["claim-1"],
  },
  hashtags: ["#GST", "#LawBriefly", "#TaxReforms", "#LegalUpdates"],
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

// 2. Load PNG artifacts
const artifactsDir = path.resolve(process.cwd(), "artifacts", "task14-preview");
const jpegsDir = path.resolve(process.cwd(), "artifacts", "task18-jpegs");

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
  const pad = String(idx + 1).padStart(2, "0");
  const pngBytes = fs.readFileSync(path.join(artifactsDir, fname));
  const jpegBytes = fs.readFileSync(path.join(jpegsDir, `slide-${pad}.jpg`));
  const role = contentPackage.slides[idx].slide_role;

  return {
    slide_number: idx + 1,
    slide_role: role,
    filename: fname,
    mime_type: "image/png" as const,
    bytes: new Uint8Array(pngBytes),
    jpeg_filename: `slide-${pad}.jpg`,
    jpeg_mime_type: "image/jpeg" as const,
    jpeg_bytes: new Uint8Array(jpegBytes),
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
  console.log("Persisting carousel to remote Supabase...");
  const res = await persistRenderedCarousel(env, contentPackage, renderedArtifact);
  console.log("\n=== PERSISTENCE SUCCESSFUL ===");
  console.log("Post ID:", res.post_id);
  console.log("Post Status:", res.post_status);
  console.log("Is Duplicate:", res.is_duplicate);
  console.log("Assets Uploaded:", res.assets.length);
  console.log("Signed URLs Generated:", Object.keys(res.signed_urls || {}).length);
  console.log("\nAsset breakdown:");
  for (const a of res.assets) {
    console.log(` - [${a.asset_type}] slide ${a.slide_number}: ${a.storage_path} (${a.size_bytes} bytes, ${a.mime_type})`);
  }
}

main().catch((err) => {
  console.error("Persistence failed:", err);
  process.exit(1);
});

