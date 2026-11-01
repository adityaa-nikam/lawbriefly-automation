import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/index";
import { fetchLawBrieflyNews } from "../src/services/lawbriefly";
import { checkSupabaseHealth } from "../src/services/supabase";
import { syncNewsArticles } from "../src/services/news-ingestion";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Hello World worker", () => {
	it("responds with Hello World! (unit style)", async () => {
		const request = new IncomingRequest("http://example.com");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});

	it("responds with Hello World! (integration style)", async () => {
		const response = await SELF.fetch("https://example.com");
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});

	it("responds with 404 for unknown routes", async () => {
		const request = new IncomingRequest("http://example.com/unknown-route");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		const json = await response.json();
		expect(json).toEqual({ error: "Not Found", status: 404 });
	});
});

describe("LawBriefly API Service - Error Handling", () => {
	const mockEnv = {
		LAWBRIEFLY_API_URL: "https://api.lawbriefly.test/v1/news",
		LAWBRIEFLY_API_KEY: "super-secret-test-key-12345",
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("handles missing environment configuration", async () => {
		const emptyEnv = {};
		const response = await fetchLawBrieflyNews(emptyEnv);
		expect(response.status).toBe(500);

		const data = await response.json() as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("Missing LawBriefly API configuration");
	});

	it("handles successful JSON response, uses x-api-key header and defaults days=7&limit=10", async () => {
		const mockPayload = { articles: [{ id: "art-1", title: "Legal Update" }] };
		const mockResponse = new Response(JSON.stringify(mockPayload), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});

		const textSpy = vi.spyOn(mockResponse, "text");
		const jsonSpy = vi.spyOn(mockResponse, "json");
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await fetchLawBrieflyNews(mockEnv);
		expect(response.status).toBe(200);

		const data = await response.json();
		expect(data).toEqual(mockPayload);
		expect(textSpy).toHaveBeenCalledTimes(1);
		expect(jsonSpy).toHaveBeenCalledTimes(0);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.lawbriefly.test/v1/news?days=7&limit=10",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					"x-api-key": mockEnv.LAWBRIEFLY_API_KEY,
					"Accept": "application/json",
				}),
			})
		);
	});

	it("passes custom days=3&limit=10 query parameters and constructs correct upstream URL", async () => {
		const mockResponse = new Response(JSON.stringify({ articles: [] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await fetchLawBrieflyNews(mockEnv, { days: 3, limit: 10 });
		expect(response.status).toBe(200);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.lawbriefly.test/v1/news?days=3&limit=10",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					"x-api-key": mockEnv.LAWBRIEFLY_API_KEY,
					"Accept": "application/json",
				}),
			})
		);
	});

	it("returns HTTP 400 for invalid days parameter", async () => {
		const invalidDays = ["-1", "0", "abc", "1.5", ""];
		for (const val of invalidDays) {
			const searchParams = new URLSearchParams(`days=${val}&limit=10`);
			const response = await fetchLawBrieflyNews(mockEnv, searchParams);
			expect(response.status).toBe(400);

			const data = await response.json() as Record<string, unknown>;
			expect(data.success).toBe(false);
			expect(data.error).toContain("Invalid query parameter: 'days'");
		}
	});

	it("returns HTTP 400 for invalid limit parameter", async () => {
		const invalidLimits = ["-5", "0", "xyz", "2.3", ""];
		for (const val of invalidLimits) {
			const searchParams = new URLSearchParams(`days=7&limit=${val}`);
			const response = await fetchLawBrieflyNews(mockEnv, searchParams);
			expect(response.status).toBe(400);

			const data = await response.json() as Record<string, unknown>;
			expect(data.success).toBe(false);
			expect(data.error).toContain("Invalid query parameter: 'limit'");
		}
	});

	it("preserves additional query parameters when adding days and limit", async () => {
		const mockResponse = new Response(JSON.stringify({ articles: [] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const searchParams = new URLSearchParams("category=tax&sort=desc&days=3&limit=10");
		const response = await fetchLawBrieflyNews(mockEnv, searchParams);
		expect(response.status).toBe(200);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.lawbriefly.test/v1/news?category=tax&sort=desc&days=3&limit=10",
			expect.any(Object)
		);
	});

	it("handles invalid LAWBRIEFLY_API_URL configuration", async () => {
		const badEnv = {
			LAWBRIEFLY_API_URL: "not-a-valid-url",
			LAWBRIEFLY_API_KEY: "test-key",
		};
		const response = await fetchLawBrieflyNews(badEnv);
		expect(response.status).toBe(500);
		const data = await response.json() as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("Invalid LAWBRIEFLY_API_URL configured");
	});

	it("handles non-2xx response containing valid JSON and consumes body only once", async () => {
		const errorPayload = { error: "Unauthorized", code: 401 };
		const mockResponse = new Response(JSON.stringify(errorPayload), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});

		const textSpy = vi.spyOn(mockResponse, "text");
		const jsonSpy = vi.spyOn(mockResponse, "json");
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await fetchLawBrieflyNews(mockEnv);
		expect(response.status).toBe(502);

		const data = await response.json() as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toBe("LawBriefly API error: HTTP status 401");
		expect(data.status).toBe(401);
		expect(data.details).toEqual(errorPayload);
		expect(textSpy).toHaveBeenCalledTimes(1);
		expect(jsonSpy).toHaveBeenCalledTimes(0);
	});

	it("handles non-2xx response containing invalid JSON without double-read failure", async () => {
		const malformedBody = '{"error": "Incomplete json';
		const mockResponse = new Response(malformedBody, {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});

		const textSpy = vi.spyOn(mockResponse, "text");
		const jsonSpy = vi.spyOn(mockResponse, "json");
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await fetchLawBrieflyNews(mockEnv);
		expect(response.status).toBe(502);

		const data = await response.json() as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toBe("LawBriefly API error: HTTP status 500");
		expect(data.status).toBe(500);
		expect(data.details).toBe(malformedBody);
		expect(textSpy).toHaveBeenCalledTimes(1);
		expect(jsonSpy).toHaveBeenCalledTimes(0);
	});

	it("handles non-2xx response containing plain text and consumes body only once", async () => {
		const plainTextBody = "503 Service Unavailable: High load";
		const mockResponse = new Response(plainTextBody, {
			status: 503,
			headers: { "Content-Type": "text/plain" },
		});

		const textSpy = vi.spyOn(mockResponse, "text");
		const jsonSpy = vi.spyOn(mockResponse, "json");
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await fetchLawBrieflyNews(mockEnv);
		expect(response.status).toBe(502);

		const data = await response.json() as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toBe("LawBriefly API error: HTTP status 503");
		expect(data.status).toBe(503);
		expect(data.details).toBe(plainTextBody);
		expect(textSpy).toHaveBeenCalledTimes(1);
		expect(jsonSpy).toHaveBeenCalledTimes(0);
	});

	it("handles invalid JSON in a successful 2xx response and consumes body only once", async () => {
		const htmlResponse = "<html><body>502 Bad Gateway</body></html>";
		const mockResponse = new Response(htmlResponse, {
			status: 200,
			headers: { "Content-Type": "text/html" },
		});

		const textSpy = vi.spyOn(mockResponse, "text");
		const jsonSpy = vi.spyOn(mockResponse, "json");
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await fetchLawBrieflyNews(mockEnv);
		expect(response.status).toBe(502);

		const data = await response.json() as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toBe("Invalid JSON response received from LawBriefly API");
		expect(typeof data.details).toBe("string");
		expect(textSpy).toHaveBeenCalledTimes(1);
		expect(jsonSpy).toHaveBeenCalledTimes(0);
	});

	it("handles network connection failure", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused (ECONNREFUSED)"));

		const response = await fetchLawBrieflyNews(mockEnv);
		expect(response.status).toBe(502);

		const data = await response.json() as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toBe("Network failure while connecting to LawBriefly API");
		expect(data.details).toContain("Connection refused");
	});

	it("never exposes API key in error responses", async () => {
		const secret = mockEnv.LAWBRIEFLY_API_KEY;
		const mockResponse = new Response(`Error with token ${secret}`, {
			status: 403,
			headers: { "Content-Type": "text/plain" },
		});

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await fetchLawBrieflyNews(mockEnv);
		const bodyText = await response.text();

		expect(bodyText).not.toContain(secret);
		expect(bodyText).toContain("[REDACTED]");
	});

	it("routes GET /api/news in worker fetch handler correctly and forwards query parameters", async () => {
		const mockPayload = { articles: [] };
		const mockResponse = new Response(JSON.stringify(mockPayload), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const request = new IncomingRequest("http://example.com/api/news?days=5&limit=20");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, mockEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toEqual(mockPayload);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.lawbriefly.test/v1/news?days=5&limit=20",
			expect.objectContaining({
				headers: expect.objectContaining({
					"x-api-key": mockEnv.LAWBRIEFLY_API_KEY,
				}),
			})
		);
	});
});

describe("Supabase Connection & Health Check", () => {
	const mockSupabaseEnv = {
		SUPABASE_URL: "https://test-project.supabase.co",
		SUPABASE_SECRET_KEY: "sb_secret_test_key_123456",
		APP_ENV: "development",
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 404 for /api/health/supabase outside development mode", async () => {
		const prodEnv = { ...mockSupabaseEnv, APP_ENV: "production" };
		const request = new IncomingRequest("http://example.com/api/health/supabase");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, prodEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
		const json = await response.json();
		expect(json).toEqual({ error: "Not Found", status: 404 });
	});

	it("returns 404 for /api/health/supabase when APP_ENV is undefined", async () => {
		const noEnv = { ...mockSupabaseEnv, APP_ENV: undefined };
		const request = new IncomingRequest("http://example.com/api/health/supabase");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, noEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
	});

	it("handles missing SUPABASE_URL", async () => {
		const missingUrlEnv = { ...mockSupabaseEnv, SUPABASE_URL: undefined };
		const response = await checkSupabaseHealth(missingUrlEnv);

		expect(response.status).toBe(503);
		const json = await response.json();
		expect(json).toEqual({
			success: false,
			service: "supabase",
			status: "unavailable",
			error: "Supabase connection check failed",
		});
	});

	it("handles missing SUPABASE_SECRET_KEY", async () => {
		const missingKeyEnv = { ...mockSupabaseEnv, SUPABASE_SECRET_KEY: undefined };
		const response = await checkSupabaseHealth(missingKeyEnv);

		expect(response.status).toBe(503);
		const json = await response.json();
		expect(json).toEqual({
			success: false,
			service: "supabase",
			status: "unavailable",
			error: "Supabase connection check failed",
		});
	});

	it("reports successful connection with zero returned rows", async () => {
		const mockResponse = new Response(JSON.stringify([]), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await checkSupabaseHealth(mockSupabaseEnv);
		expect(response.status).toBe(200);

		const json = await response.json();
		expect(json).toEqual({
			success: true,
			service: "supabase",
			status: "connected",
			database: "reachable",
		});
	});

	it("reports successful connection with one returned row", async () => {
		const mockResponse = new Response(JSON.stringify([{ id: "987e6543-e21b-12d3-a456-426614174000" }]), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await checkSupabaseHealth(mockSupabaseEnv);
		expect(response.status).toBe(200);

		const json = await response.json();
		expect(json).toEqual({
			success: true,
			service: "supabase",
			status: "connected",
			database: "reachable",
		});
	});

	it("handles Supabase authentication failure (HTTP 401)", async () => {
		const mockResponse = new Response(JSON.stringify({ message: "Invalid API key" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await checkSupabaseHealth(mockSupabaseEnv);
		expect(response.status).toBe(503);

		const json = await response.json();
		expect(json).toEqual({
			success: false,
			service: "supabase",
			status: "unavailable",
			error: "Supabase connection check failed",
		});
	});

	it("handles database permission failure (HTTP 403)", async () => {
		const mockResponse = new Response(JSON.stringify({ message: "permission denied for table news_articles" }), {
			status: 403,
			headers: { "Content-Type": "application/json" },
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const response = await checkSupabaseHealth(mockSupabaseEnv);
		expect(response.status).toBe(503);

		const json = await response.json();
		expect(json).toEqual({
			success: false,
			service: "supabase",
			status: "unavailable",
			error: "Supabase connection check failed",
		});
	});

	it("handles network connection failure", async () => {
		const networkError = new Error("Connection refused (ECONNREFUSED)");
		networkError.name = "AbortError";
		vi.spyOn(globalThis, "fetch").mockRejectedValue(networkError);

		const response = await checkSupabaseHealth(mockSupabaseEnv);
		expect(response.status).toBe(503);

		const json = await response.json();
		expect(json).toEqual({
			success: false,
			service: "supabase",
			status: "unavailable",
			error: "Supabase connection check failed",
		});
	});

	it("routes GET /api/health/supabase in worker fetch handler during development", async () => {
		const mockResponse = new Response(JSON.stringify([]), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

		const request = new IncomingRequest("http://example.com/api/health/supabase");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, mockSupabaseEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json).toEqual({
			success: true,
			service: "supabase",
			status: "connected",
			database: "reachable",
		});
	});
});

describe("News Ingestion & Synchronization", () => {
	const mockFullEnv = {
		LAWBRIEFLY_API_URL: "https://api.lawbriefly.test/v1/news",
		LAWBRIEFLY_API_KEY: "super-secret-test-key-12345",
		SUPABASE_URL: "https://test-project.supabase.co",
		SUPABASE_SECRET_KEY: "sb_secret_test_key_123456",
		APP_ENV: "development",
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 404 for POST /api/news/sync outside development mode", async () => {
		const prodEnv = { ...mockFullEnv, APP_ENV: "production" };
		const request = new IncomingRequest("http://example.com/api/news/sync", {
			method: "POST",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, prodEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
		const json = await response.json();
		expect(json).toEqual({ error: "Not Found", status: 404 });
	});

	it("returns 404 for POST /api/news/sync when APP_ENV is undefined", async () => {
		const noEnv = { ...mockFullEnv, APP_ENV: undefined };
		const request = new IncomingRequest("http://example.com/api/news/sync", {
			method: "POST",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, noEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
	});

	it("returns 400 for invalid days query parameter", async () => {
		const request = new IncomingRequest("http://example.com/api/news/sync?days=-1", {
			method: "POST",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, mockFullEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		const json = await response.json() as Record<string, unknown>;
		expect(json.success).toBe(false);
		expect(json.error).toContain("Invalid query parameter: 'days'");
	});

	it("returns 400 for invalid limit query parameter", async () => {
		const request = new IncomingRequest("http://example.com/api/news/sync?days=1&limit=abc", {
			method: "POST",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, mockFullEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		const json = await response.json() as Record<string, unknown>;
		expect(json.success).toBe(false);
		expect(json.error).toContain("Invalid query parameter: 'limit'");
	});

	it("handles missing service configuration", async () => {
		const emptyEnv = {};
		const response = await syncNewsArticles(emptyEnv);

		expect(response.status).toBe(500);
		const json = await response.json() as Record<string, unknown>;
		expect(json.success).toBe(false);
		expect(json.error).toContain("Missing service configuration");
	});

	it("successfully ingests multiple valid articles with defaults days=1 and limit=10", async () => {
		const mockArticles = [
			{ title: "Court Ruling", description: "Important judgment", url: "https://example.com/court" },
			{ title: "Statute Amendment", description: "Tax revision details", url: "https://example.com/tax" },
		];

		let lawbrieflyRequestedUrl = "";
		let rpcCalledWith: Record<string, unknown> | null = null;

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

			if (url.includes("api.lawbriefly.test")) {
				lawbrieflyRequestedUrl = url;
				return new Response(JSON.stringify({ success: true, count: 2, articles: mockArticles }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				rpcCalledWith = JSON.parse((init?.body as string) || "{}");
				return new Response("2", {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			return new Response("Not Found", { status: 404 });
		});

		const response = await syncNewsArticles(mockFullEnv);
		expect(response.status).toBe(200);

		const result = await response.json() as Record<string, unknown>;
		expect(result).toEqual({
			success: true,
			message: "News articles successfully synchronized",
			source: "lawbriefly",
			fetched_count: 2,
			valid_count: 2,
			invalid_count: 0,
			duplicate_count: 0,
			database_affected_count: 2,
		});

		expect(lawbrieflyRequestedUrl).toContain("days=1");
		expect(lawbrieflyRequestedUrl).toContain("limit=10");

		expect(rpcCalledWith).toEqual({
			p_articles: mockArticles,
		});
	});

	it("handles empty article array safely without calling RPC", async () => {
		let rpcCalled = false;

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: true, count: 0, articles: [] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				rpcCalled = true;
				return new Response("0", { status: 200, headers: { "Content-Type": "application/json" } });
			}

			return new Response("Not Found", { status: 404 });
		});

		const response = await syncNewsArticles(mockFullEnv);
		expect(response.status).toBe(200);

		const result = await response.json() as Record<string, unknown>;
		expect(result.fetched_count).toBe(0);
		expect(result.valid_count).toBe(0);
		expect(result.database_affected_count).toBe(0);
		expect(rpcCalled).toBe(false);
	});

	it("discards invalid articles and ingests only valid ones", async () => {
		const mixedArticles = [
			{ title: "Valid Headline", description: "Valid Description", url: "https://example.com/valid" },
			{ title: "", description: "Missing title", url: "https://example.com/notitle" },
			{ title: "   ", description: "Whitespace title", url: "https://example.com/wtitle" },
			{ title: "Headline", description: "   ", url: "https://example.com/nodesc" },
			{ title: "Bad URL", description: "Invalid protocol", url: "ftp://example.com/bad" },
			{ title: "Malformed URL", description: "Not a link", url: "just-a-string" },
			null,
			"not-an-object",
		];

		let ingestedPayload: unknown[] = [];

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: true, count: mixedArticles.length, articles: mixedArticles }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				const body = JSON.parse((init?.body as string) || "{}");
				ingestedPayload = body.p_articles;
				return new Response("1", { status: 200, headers: { "Content-Type": "application/json" } });
			}

			return new Response("Not Found", { status: 404 });
		});

		const response = await syncNewsArticles(mockFullEnv);
		expect(response.status).toBe(200);

		const result = await response.json() as Record<string, unknown>;
		expect(result.fetched_count).toBe(mixedArticles.length);
		expect(result.valid_count).toBe(1);
		expect(result.invalid_count).toBe(7);
		expect(result.database_affected_count).toBe(1);

		expect(ingestedPayload).toEqual([
			{ title: "Valid Headline", description: "Valid Description", url: "https://example.com/valid" },
		]);
	});

	it("deduplicates articles sharing identical URLs within the same batch", async () => {
		const duplicateArticles = [
			{ title: "First Version", description: "Description A", url: "https://example.com/duplicate-article" },
			{ title: "Second Version", description: "Description B", url: "https://example.com/duplicate-article" },
			{ title: "Third Unique", description: "Description C", url: "https://example.com/unique-article" },
		];

		let rpcPayload: unknown[] = [];

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: true, count: 3, articles: duplicateArticles }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				const body = JSON.parse((init?.body as string) || "{}");
				rpcPayload = body.p_articles;
				return new Response("2", { status: 200, headers: { "Content-Type": "application/json" } });
			}

			return new Response("Not Found", { status: 404 });
		});

		const response = await syncNewsArticles(mockFullEnv);
		expect(response.status).toBe(200);

		const result = await response.json() as Record<string, unknown>;
		expect(result.fetched_count).toBe(3);
		expect(result.valid_count).toBe(2);
		expect(result.duplicate_count).toBe(1);
		expect(result.database_affected_count).toBe(2);

		expect(rpcPayload).toHaveLength(2);
		expect(rpcPayload[0]).toEqual({
			title: "First Version",
			description: "Description A",
			url: "https://example.com/duplicate-article",
		});
	});

	it("handles LawBriefly upstream API error gracefully", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: false, error: "Upstream maintenance" }), {
					status: 502,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("Not Found", { status: 404 });
		});

		const response = await syncNewsArticles(mockFullEnv);
		expect(response.status).toBe(502);

		const json = await response.json() as Record<string, unknown>;
		expect(json.success).toBe(false);
		expect(json.error).toContain("LawBriefly API error");
	});

	it("handles invalid upstream JSON response", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
			if (url.includes("api.lawbriefly.test")) {
				return new Response("This is not JSON", {
					status: 200,
					headers: { "Content-Type": "text/html" },
				});
			}
			return new Response("Not Found", { status: 404 });
		});

		const response = await syncNewsArticles(mockFullEnv);
		expect(response.status).toBe(502);

		const json = await response.json() as Record<string, unknown>;
		expect(json.success).toBe(false);
		expect(json.error).toContain("Invalid JSON response received");
	});

	it("handles unexpected upstream response structure", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: false, unexpected: "payload" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("Not Found", { status: 404 });
		});

		const response = await syncNewsArticles(mockFullEnv);
		expect(response.status).toBe(502);

		const json = await response.json() as Record<string, unknown>;
		expect(json.success).toBe(false);
		expect(json.error).toContain("Unexpected upstream response structure");
	});

	it("handles Supabase database RPC error", async () => {
		const validArticles = [
			{ title: "Legal Article", description: "Summary", url: "https://example.com/article" },
		];

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: true, count: 1, articles: validArticles }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				return new Response(JSON.stringify({ message: "permission denied for function ingest_news_articles", code: "42501" }), {
					status: 403,
					headers: { "Content-Type": "application/json" },
				});
			}

			return new Response("Not Found", { status: 404 });
		});

		const response = await syncNewsArticles(mockFullEnv);
		expect(response.status).toBe(502);

		const json = await response.json() as Record<string, unknown>;
		expect(json.success).toBe(false);
		expect(json.error).toBe("Database error while storing news articles");
		expect(json.details).toBe("Supabase RPC ingest_news_articles failed");
	});

	it("handles network connection failure during sync", async () => {
		const networkError = new Error("Connection failed");
		networkError.name = "AbortError";
		vi.spyOn(globalThis, "fetch").mockRejectedValue(networkError);

		const response = await syncNewsArticles(mockFullEnv);
		expect(response.status).toBe(502);

		const json = await response.json() as Record<string, unknown>;
		expect(json.success).toBe(false);
		expect(json.error).toContain("Network failure");
	});

	it("routes POST /api/news/sync through worker fetch handler in development", async () => {
		const mockArticles = [
			{ title: "Worker Sync Test", description: "Testing via worker", url: "https://example.com/worker-sync" },
		];

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: true, count: 1, articles: mockArticles }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				return new Response("1", { status: 200, headers: { "Content-Type": "application/json" } });
			}

			return new Response("Not Found", { status: 404 });
		});

		const request = new IncomingRequest("http://example.com/api/news/sync?days=2&limit=5", {
			method: "POST",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, mockFullEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const json = await response.json() as Record<string, unknown>;
		expect(json.success).toBe(true);
		expect(json.fetched_count).toBe(1);
		expect(json.database_affected_count).toBe(1);
	});
});

describe("Scheduled News Ingestion (Cron Trigger)", () => {
	const mockFullEnv = {
		LAWBRIEFLY_API_URL: "https://api.lawbriefly.test/v1/news",
		LAWBRIEFLY_API_KEY: "super-secret-test-key-12345",
		SUPABASE_URL: "https://test-project.supabase.co",
		SUPABASE_SECRET_KEY: "sb_secret_test_key_123456",
		APP_ENV: "production",
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("successfully triggers scheduled news ingestion using defaults days=1 and limit=10", async () => {
		const mockArticles = [
			{ title: "Legal Article 1", description: "Desc 1", url: "https://example.com/art-1" },
			{ title: "Legal Article 2", description: "Desc 2", url: "https://example.com/art-2" },
		];

		let requestedUrl = "";
		let rpcPayload: Record<string, unknown> | null = null;

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
			if (url.includes("api.lawbriefly.test")) {
				requestedUrl = url;
				return new Response(JSON.stringify({ success: true, count: 2, articles: mockArticles }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				rpcPayload = JSON.parse((init?.body as string) || "{}");
				return new Response("2", { status: 200, headers: { "Content-Type": "application/json" } });
			}
			return new Response("Not Found", { status: 404 });
		});

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const controller: ScheduledController = {
			cron: "30 0 * * *",
			scheduledTime: 1761957000000,
			noRetry: vi.fn(),
		};
		const ctx = createExecutionContext();

		await worker.scheduled(controller, mockFullEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(requestedUrl).toContain("days=1");
		expect(requestedUrl).toContain("limit=10");
		expect(rpcPayload).toEqual({ p_articles: mockArticles });

		expect(consoleLogSpy).toHaveBeenCalled();
		const loggedJson = JSON.parse(consoleLogSpy.mock.calls[0][0]) as Record<string, unknown>;
		expect(loggedJson).toEqual({
			scheduled_time: 1761957000000,
			cron_expression: "30 0 * * *",
			fetched_count: 2,
			valid_count: 2,
			invalid_count: 0,
			duplicate_count: 0,
			database_affected_count: 2,
			status: "success",
		});
	});

	it("safely logs scheduled ingestion metrics without exposing credentials or keys", async () => {
		const mockArticles = [
			{ title: "Safe Log Test", description: "Check logs", url: "https://example.com/safe" },
		];

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: true, count: 1, articles: mockArticles }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				return new Response("1", { status: 200, headers: { "Content-Type": "application/json" } });
			}
			return new Response("Not Found", { status: 404 });
		});

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const controller: ScheduledController = {
			cron: "30 0 * * *",
			scheduledTime: 1761957000000,
			noRetry: vi.fn(),
		};
		const ctx = createExecutionContext();

		await worker.scheduled(controller, mockFullEnv, ctx);
		await waitOnExecutionContext(ctx);

		const allCalls = [
			...consoleLogSpy.mock.calls.map((c) => String(c[0])),
			...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
		].join(" ");

		expect(allCalls).not.toContain(mockFullEnv.LAWBRIEFLY_API_KEY);
		expect(allCalls).not.toContain(mockFullEnv.SUPABASE_SECRET_KEY);
		expect(allCalls).not.toContain("x-api-key");
		expect(allCalls).not.toContain("Authorization");
	});

	it("handles LawBriefly API failure during scheduled execution gracefully", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ error: "Upstream maintenance" }), {
					status: 502,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("Not Found", { status: 404 });
		});

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const controller: ScheduledController = {
			cron: "30 0 * * *",
			scheduledTime: 1761957000000,
			noRetry: vi.fn(),
		};
		const ctx = createExecutionContext();

		await worker.scheduled(controller, mockFullEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(consoleErrorSpy).toHaveBeenCalled();
		const loggedJson = JSON.parse(consoleErrorSpy.mock.calls[0][0]) as Record<string, unknown>;
		expect(loggedJson.status).toBe("failed");
		expect(loggedJson.cron_expression).toBe("30 0 * * *");
		expect(loggedJson.scheduled_time).toBe(1761957000000);
		expect(loggedJson.fetched_count).toBe(0);
		expect(loggedJson.database_affected_count).toBe(0);
		expect(loggedJson.error).toContain("LawBriefly API error");
	});

	it("handles Supabase RPC database failure during scheduled execution gracefully", async () => {
		const mockArticles = [
			{ title: "Article", description: "Desc", url: "https://example.com/art" },
		];

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: true, count: 1, articles: mockArticles }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				return new Response(JSON.stringify({ message: "DB timeout", code: "57014" }), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("Not Found", { status: 404 });
		});

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const controller: ScheduledController = {
			cron: "30 0 * * *",
			scheduledTime: 1761957000000,
			noRetry: vi.fn(),
		};
		const ctx = createExecutionContext();

		await worker.scheduled(controller, mockFullEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(consoleErrorSpy).toHaveBeenCalled();
		const loggedJson = JSON.parse(consoleErrorSpy.mock.calls[0][0]) as Record<string, unknown>;
		expect(loggedJson.status).toBe("failed");
		expect(loggedJson.cron_expression).toBe("30 0 * * *");
		expect(loggedJson.scheduled_time).toBe(1761957000000);
		expect(loggedJson.fetched_count).toBe(1);
		expect(loggedJson.database_affected_count).toBe(0);
		expect(loggedJson.error).toBe("Database error while storing news articles");
	});

	it("executes in production environment without APP_ENV check", async () => {
		const prodEnv = { ...mockFullEnv, APP_ENV: "production" };
		const mockArticles = [
			{ title: "Prod Article", description: "Desc", url: "https://example.com/prod" },
		];

		let rpcCalled = false;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
			if (url.includes("api.lawbriefly.test")) {
				return new Response(JSON.stringify({ success: true, count: 1, articles: mockArticles }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.includes("/rest/v1/rpc/ingest_news_articles")) {
				rpcCalled = true;
				return new Response("1", { status: 200, headers: { "Content-Type": "application/json" } });
			}
			return new Response("Not Found", { status: 404 });
		});

		vi.spyOn(console, "log").mockImplementation(() => {});

		const controller: ScheduledController = {
			cron: "30 0 * * *",
			scheduledTime: 1761957000000,
			noRetry: vi.fn(),
		};
		const ctx = createExecutionContext();

		await worker.scheduled(controller, prodEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(rpcCalled).toBe(true);
	});
});
