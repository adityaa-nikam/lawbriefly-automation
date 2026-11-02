import { describe, it, expect } from "vitest";
import { runWithConcurrencyLimit } from "../src/services/topic-article-extraction";

describe("runWithConcurrencyLimit rejection safety audit", () => {
	it("aborts Promise.all and loses other results when a taskFn throws unhandled exception", async () => {
		const items = ["item-0", "item-1", "item-2", "item-3"];
		let item0Completed = false;

		let errorCaught: Error | null = null;
		try {
			await runWithConcurrencyLimit(items, 2, async (item, index) => {
				if (index === 0) {
					await new Promise((r) => setTimeout(r, 50));
					item0Completed = true;
					return { item, success: true };
				}
				if (index === 1) {
					// Deliberately reject unexpectedly
					throw new Error("Deliberate unhandled taskFn crash");
				}
				return { item, success: true };
			});
		} catch (err: unknown) {
			errorCaught = err as Error;
		}

		expect(errorCaught).not.toBeNull();
		expect(errorCaught?.message).toBe("Deliberate unhandled taskFn crash");
	});
});
