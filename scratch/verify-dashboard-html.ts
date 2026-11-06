import { renderDashboardHtml } from "../src/services/dashboard";

console.log("--- Verifying Dashboard HTML Rendering ---");
const html = renderDashboardHtml();

// 1. Length & Basic Structure
console.log(`Rendered HTML size: ${html.length} bytes`);
if (!html.startsWith("<!DOCTYPE html>")) throw new Error("Missing DOCTYPE");
if (!html.includes("</html>")) throw new Error("Missing closing html tag");

// 2. Check Required Stage Cards (All 7 Stages)
const expectedStages = [
	"news_ingestion",
	"topic_selection",
	"content_generation",
	"carousel_rendering",
	"carousel_persistence",
	"editorial_notification",
	"instagram_publication",
];

for (const stage of expectedStages) {
	if (!html.includes(`id="card-${stage}"`)) throw new Error(`Missing card for stage ${stage}`);
	if (!html.includes(`id="err-${stage}"`)) throw new Error(`Missing error box for stage ${stage}`);
	if (!html.includes(`id="errmsg-${stage}"`)) throw new Error(`Missing error message element for stage ${stage}`);
	if (!html.includes(`id="badge-${stage}"`)) throw new Error(`Missing status badge for stage ${stage}`);
}
console.log("✓ All 7 stage cards and in-place error diagnostic elements verified.");

// 3. Check Green Progress Track Elements
if (!html.includes('class="pipeline-track-container"')) throw new Error("Missing pipeline-track-container");
if (!html.includes('id="pipeline-progress-fill"')) throw new Error("Missing pipeline-progress-fill");
if (!html.includes("--green: #22c55e")) throw new Error("Missing green CSS variable definition");
console.log("✓ Animated glowing green pipeline progress track elements verified.");

// 4. Check shadcn Monochrome Styling
if (!html.includes("--bg: #09090b")) throw new Error("Missing shadcn deep pitch black background");
if (!html.includes("--border: #27272a")) throw new Error("Missing zinc border");
if (!html.includes("--btn-primary-bg: #fafafa")) throw new Error("Missing solid white primary button background");
console.log("✓ Monochrome shadcn theme verified.");

// 5. Check Destination Banner (Post-Telegram Instagram Publication)
if (!html.includes('id="destination-banner"')) throw new Error("Missing destination-banner");
if (!html.includes('id="dest-post-id"')) throw new Error("Missing dest-post-id");
if (!html.includes('id="dest-media-id"')) throw new Error("Missing dest-media-id");
console.log("✓ Instagram Destination Banner verified.");

// 6. Check Modals & Buttons
if (!html.includes('id="modal-pipeline"')) throw new Error("Missing modal-pipeline");
if (!html.includes('id="modal-news"')) throw new Error("Missing modal-news");
if (!html.includes('id="btn-run-pipeline"')) throw new Error("Missing btn-run-pipeline");
if (!html.includes('id="btn-news-sync"')) throw new Error("Missing btn-news-sync");
console.log("✓ Execution Confirmation Modals and Trigger Buttons verified.");

// 7. Verify Client-side JS Syntax
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error("Missing <script> block in HTML");
const scriptCode = scriptMatch[1];
try {
	new Function(scriptCode);
	console.log("✓ Client-side JavaScript parses cleanly without syntax errors.");
} catch (err: any) {
	throw new Error(`Syntax error in dashboard client script: ${err.message}`);
}

console.log("--- ALL DASHBOARD HTML AUDIT CHECKS PASSED ---");

