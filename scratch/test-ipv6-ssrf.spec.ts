import { describe, it, expect } from "vitest";
import { validateArticleUrl } from "../src/services/jina-reader";

describe("IPv6 and SSRF Security Validation Audit", () => {
	it("rejects IPv6 loopback (::1)", () => {
		const res = validateArticleUrl("http://[::1]/secret");
		expect(res.valid).toBe(false);
		if (!res.valid) expect(res.error).toContain("prohibited");
	});

	it("rejects IPv6 unspecified (::)", () => {
		const res = validateArticleUrl("http://[::]/secret");
		expect(res.valid).toBe(false);
		if (!res.valid) expect(res.error).toContain("prohibited");
	});

	it("rejects IPv6 link-local (fe80::/10)", () => {
		const res1 = validateArticleUrl("http://[fe80::1]/admin");
		expect(res1.valid).toBe(false);
		const res2 = validateArticleUrl("https://[FE80::abcd:1234]/data");
		expect(res2.valid).toBe(false);
	});

	it("rejects IPv6 unique-local / private (fc00::/7)", () => {
		const res1 = validateArticleUrl("http://[fc00::1]/internal");
		expect(res1.valid).toBe(false);
		const res2 = validateArticleUrl("http://[fd00::1234]/internal");
		expect(res2.valid).toBe(false);
	});
});
