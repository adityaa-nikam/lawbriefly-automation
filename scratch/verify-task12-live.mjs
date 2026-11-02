// Live verification script for Task 12
const BASE_URL = "http://127.0.0.1:8787";

async function runLiveVerification() {
	console.log("=== TASK 12 LIVE VERIFICATION ===");

	// Test 1: Multiple articles across distinct domains
	const id1 = "b979a75d-676b-40f2-9ad0-cb9e7ddd59dc"; // menafn.com (CII Hails GST Reforms)
	const id2 = "b4cde95b-0c70-4f2f-8017-b191bbdccb26"; // www.thestatesman.com (Trump loses final round)
	
	console.log(`\nTest 1: Extracting 2 real articles from distinct domains...`);
	console.log(`ID 1: ${id1} (menafn.com)`);
	console.log(`ID 2: ${id2} (www.thestatesman.com)`);

	const res1 = await fetch(`${BASE_URL}/api/ai/extract-topic-articles`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ article_ids: [id1, id2] }),
	});

	console.log(`HTTP Status: ${res1.status}`);
	const data1 = await res1.json();
	console.log(`Success: ${data1.success}`);
	console.log(`Provider: ${data1.provider}`);
	console.log(`Requested Article Count: ${data1.requested_article_count}`);
	console.log(`Successful Extraction Count: ${data1.successful_extraction_count}`);
	console.log(`Failed Extraction Count: ${data1.failed_extraction_count}`);
	console.log(`Unique Source Domain Count: ${data1.source_metrics?.unique_source_domain_count}`);
	console.log(`Source Diversity Status: ${data1.source_metrics?.source_diversity_status}`);

	console.log("\nArticle Details:");
	for (let i = 0; i < data1.articles.length; i++) {
		const art = data1.articles[i];
		console.log(`  [Article ${i + 1}]`);
		console.log(`    ID: ${art.article_id}`);
		console.log(`    Success: ${art.success}`);
		console.log(`    Original Title: ${art.original_title}`);
		console.log(`    Original URL: ${art.original_url}`);
		console.log(`    Extracted Title: ${art.extracted_title}`);
		console.log(`    Content Length: ${art.content_length} chars`);
		console.log(`    Paragraph Count: ${art.paragraph_count}`);
		console.log(`    Content Snippet: ${art.content?.slice(0, 150).replace(/\n/g, " ")}...`);
	}

	// Test 2: Partial failure (1 valid article + 1 non-existent UUID)
	const fakeId1 = "00000000-0000-4000-a000-000000000000";
	console.log(`\nTest 2: Partial failure (1 valid ID + 1 non-existent ID)...`);
	console.log(`Valid ID: ${id1}`);
	console.log(`Fake ID: ${fakeId1}`);

	const res2 = await fetch(`${BASE_URL}/api/ai/extract-topic-articles`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ article_ids: [id1, fakeId1] }),
	});

	console.log(`HTTP Status: ${res2.status}`);
	const data2 = await res2.json();
	console.log(`Success: ${data2.success}`);
	console.log(`Requested Article Count: ${data2.requested_article_count}`);
	console.log(`Successful Extraction Count: ${data2.successful_extraction_count}`);
	console.log(`Failed Extraction Count: ${data2.failed_extraction_count}`);
	console.log(`Unique Source Domain Count: ${data2.source_metrics?.unique_source_domain_count}`);
	console.log(`Source Diversity Status: ${data2.source_metrics?.source_diversity_status}`);

	for (let i = 0; i < data2.articles.length; i++) {
		const art = data2.articles[i];
		console.log(`  [Article ${i + 1}]`);
		console.log(`    ID: ${art.article_id}`);
		console.log(`    Success: ${art.success}`);
		if (art.success) {
			console.log(`    Original Title: ${art.original_title}`);
			console.log(`    Content Length: ${art.content_length}`);
		} else {
			console.log(`    Error Code: ${art.error_code}`);
			console.log(`    Error Message: ${art.error}`);
		}
	}

	// Test 3: Rejecting unexpected properties (strict schema enforcement)
	console.log(`\nTest 3: Rejecting unexpected properties (strict schema enforcement)...`);
	const res3 = await fetch(`${BASE_URL}/api/ai/extract-topic-articles`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ article_ids: [id1], unexpected_param: "should-be-rejected" }),
	});
	console.log(`HTTP Status (expected 400): ${res3.status}`);
	const data3 = await res3.json();
	console.log(`Error Response:`, data3);

	// Test 4: All-extractions failure (expected HTTP 502 Bad Gateway)
	const fakeId2 = "00000000-0000-4000-a000-000000000002";
	console.log(`\nTest 4: All-extractions failure (expected HTTP 502 Bad Gateway)...`);
	const res4 = await fetch(`${BASE_URL}/api/ai/extract-topic-articles`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ article_ids: [fakeId1, fakeId2] }),
	});
	console.log(`HTTP Status (expected 502): ${res4.status}`);
	const data4 = await res4.json();
	console.log(`Success: ${data4.success}`);
	console.log(`Error: ${data4.error}`);
	console.log(`Requested Article Count: ${data4.requested_article_count}`);
	console.log(`Failed Count: ${data4.failed_extraction_count}`);
	console.log(`Diversity Status: ${data4.source_metrics?.source_diversity_status}`);
	console.log(`Articles Count: ${data4.articles?.length}`);

	// Test 5: Duplicate ID deduplication
	console.log(`\nTest 5: Duplicate ID deduplication...`);
	const res5 = await fetch(`${BASE_URL}/api/ai/extract-topic-articles`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ article_ids: [id1, id2, id1, id2] }),
	});
	const data5 = await res5.json();
	console.log(`HTTP Status: ${res5.status}`);
	console.log(`Requested Article Count (after deduplication): ${data5.requested_article_count}`);
	console.log(`Articles length: ${data5.articles?.length}`);
	console.log(`Counts match: ${data5.requested_article_count === data5.articles?.length}`);

	console.log(`\n=== LIVE VERIFICATION FINISHED ===`);
}

runLiveVerification().catch(console.error);
