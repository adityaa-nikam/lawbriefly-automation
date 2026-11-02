import { runWithConcurrencyLimit } from "../src/services/topic-article-extraction.ts";

async function testUnexpectedRejection() {
	console.log("=== Testing runWithConcurrencyLimit with deliberate unexpected rejection ===");
	const items = ["item0", "item1", "item2", "item3"];

	try {
		const results = await runWithConcurrencyLimit(items, 2, async (item, index) => {
			if (index === 1) {
				throw new Error("Deliberate unhandled crash in taskFn for item1");
			}
			await new Promise((r) => setTimeout(r, 20));
			return { item, success: true };
		});
		console.log("Results returned:", results);
	} catch (err) {
		console.log("Caught rejection from runWithConcurrencyLimit:", err.message);
	}
}

testUnexpectedRejection().catch(console.error);
