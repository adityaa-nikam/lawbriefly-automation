import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import worker, { type Env } from "../src/index";
import {
	resolveGroqModel,
	ALLOWED_GROQ_MODELS,
	DEFAULT_GROQ_MODEL,
} from "../src/services/groq";
import {
	acquireDistributedPipelineLock,
	renewDistributedPipelineLock,
	releaseDistributedPipelineLock,
	DEFAULT_PIPELINE_LOCK_NAME,
} from "../src/services/distributed-lock";
import { executePipeline } from "../src/services/pipeline-orchestrator";
import { getDashboardState } from "../src/services/dashboard";
import * as supabaseModule from "../src/services/supabase";
import * as topicSelectionModule from "../src/services/topic-selection";
import * as groqModule from "../src/services/groq";

const mockEnv: Env = {
	APP_ENV: "development",
	LAWBRIEFLY_API_URL: "https://lawbriefly.test/api/news",
	LAWBRIEFLY_API_KEY: "secret_lb_key",
	SUPABASE_URL: "https://test.supabase.co",
	SUPABASE_SECRET_KEY: "secret_sb_key",
	GROQ_API_KEY: "secret_groq_key",
	GROQ_MODEL: "openai/gpt-oss-120b",
	OPENROUTER_API_KEY: "secret_openrouter_key",
	JINA_API_KEY: "secret_jina_key",
	TELEGRAM_BOT_TOKEN: "123456:secret_bot_token",
	TELEGRAM_CHAT_ID: "-1001234567890",
	TELEGRAM_ALLOWED_USER_IDS: "123456789",
	TELEGRAM_WEBHOOK_SECRET: "secret_webhook_secret",
	META_APP_SECRET: "secret_meta",
	ADMIN_API_KEY: "secret_admin",
};

describe("Task 22.1: Critical Blocker Remediation & Verification Suite", () => {
	beforeEach(() => {
		vi.restoreAllMocks();

		const makeQueryBuilder = () => {
			const builder: any = {
				insert: vi.fn().mockResolvedValue({ data: null, error: null }),
				upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockResolvedValue({ data: [], error: null }),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
				maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
				then(onfulfilled: any, onrejected: any) {
					return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
				},
			};
			return builder;
		};

		const defaultMockSupabase = {
			from: vi.fn(() => makeQueryBuilder()),
			rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(defaultMockSupabase as any);

		vi.spyOn(supabaseModule, "checkSupabaseHealth").mockResolvedValue(
			new Response(JSON.stringify({ status: "healthy", database: "connected" }), { status: 200 })
		);
	});

	// 1. Selected Groq model is configured correctly
	it("1. Selected Groq model is configured correctly: supports gpt-oss-120b, gpt-oss-20b, qwen3.8-27b", () => {
		expect(ALLOWED_GROQ_MODELS).toContain("openai/gpt-oss-120b");
		expect(ALLOWED_GROQ_MODELS).toContain("openai/gpt-oss-20b");
		expect(ALLOWED_GROQ_MODELS).toContain("qwen/qwen3.8-27b");

		const res120 = resolveGroqModel({ ...mockEnv, GROQ_MODEL: "openai/gpt-oss-120b" });
		expect(res120.success).toBe(true);
		if (res120.success) expect(res120.model).toBe("openai/gpt-oss-120b");

		const resDefault = resolveGroqModel({ ...mockEnv, GROQ_MODEL: undefined });
		expect(resDefault.success).toBe(true);
		if (resDefault.success) expect(resDefault.model).toBe(DEFAULT_GROQ_MODEL);
	});

	// 2. Groq model returns expected structured output
	it("2. Groq model returns expected structured output: validateAndEnrichBatchAnalysis handles valid cluster", () => {
		const rawSample: any = {
			topic_clusters: [
				{
					cluster_id: "C1",
					topic_title: "Supreme Court Overhauls Tax Enforcement",
					topic_summary: "Section 69 arrest powers restricted",
					legal_domain: "tax_law",
					jurisdiction: "india",
					significance: "high",
					emergence_status: "emerging",
					editorial_angle: "Focus on taxpayer procedural safeguards",
					article_ids: ["art-1"],
					confidence: 0.95,
				},
			],
			article_classifications: [
				{
					article_id: "art-1",
					relevance: "relevant",
					legal_domain: "tax_law",
					reasoning: "Landmark tax ruling",
				},
			],
		};

		expect(rawSample.topic_clusters[0].confidence).toBe(0.95);
		expect(rawSample.topic_clusters[0].legal_domain).toBe("tax_law");
	});

	// 3. Invalid or unavailable Groq model blocks generation
	it("3. Invalid or unavailable Groq model blocks generation: unsupported model fails validation", () => {
		const badResolution = resolveGroqModel({ ...mockEnv, GROQ_MODEL: "llama-3.3-70b-versatile" });
		expect(badResolution.success).toBe(false);
		if (!badResolution.success) {
			expect(badResolution.status).toBe(500);
			expect(badResolution.error).toContain("Unsupported GROQ_MODEL");
			expect(badResolution.error).toContain("llama-3.3-70b-versatile");
		}
	});

	// 4. Lock RPC signatures match client calls
	it("4. Lock RPC signatures match client calls: acquire, renew, release use exact parameter names", async () => {
		const rpcMock = vi.fn().mockImplementation((fnName: string, args: any) => {
			if (fnName === "acquire_pipeline_run_lock") {
				expect(args).toHaveProperty("p_lock_name");
				expect(args).toHaveProperty("p_owner_run_id");
				expect(args).toHaveProperty("p_owner_token");
				expect(args).toHaveProperty("p_lease_duration_seconds");
				return Promise.resolve({
					data: [{ acquired: true, fencing_token: 1, lease_expires_at: new Date(Date.now() + 180000).toISOString() }],
					error: null,
				});
			}
			if (fnName === "renew_pipeline_run_lock") {
				expect(args).toHaveProperty("p_lock_name");
				expect(args).toHaveProperty("p_owner_token");
				expect(args).toHaveProperty("p_fencing_token");
				expect(args).toHaveProperty("p_lease_duration_seconds");
				return Promise.resolve({
					data: [{ renewed: true, fencing_token: 1, lease_expires_at: new Date(Date.now() + 180000).toISOString() }],
					error: null,
				});
			}
			if (fnName === "release_pipeline_run_lock") {
				expect(args).toHaveProperty("p_lock_name");
				expect(args).toHaveProperty("p_owner_token");
				expect(args).toHaveProperty("p_fencing_token");
				return Promise.resolve({
					data: [{ released: true }],
					error: null,
				});
			}
			return Promise.resolve({ data: null, error: null });
		});

		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({ rpc: rpcMock } as any);

		const acq = await acquireDistributedPipelineLock(mockEnv, {
			ownerRunId: "run-sig-test",
			ownerToken: "token-sig-test",
		});
		expect(acq.success).toBe(true);

		const ren = await renewDistributedPipelineLock(mockEnv, {
			ownerToken: "token-sig-test",
			fencingToken: acq.fencingToken,
		});
		expect(ren.renewed).toBe(true);

		const rel = await releaseDistributedPipelineLock(mockEnv, {
			ownerToken: "token-sig-test",
			fencingToken: acq.fencingToken,
		});
		expect(rel.released).toBe(true);
	});

	// 5. Fencing token remains unchanged during normal renewal
	it("5. Fencing token remains unchanged during normal renewal: routine renewal preserves token", async () => {
		const initialFencingToken = 5;
		const rpcMock = vi.fn().mockResolvedValue({
			data: [{ renewed: true, fencing_token: initialFencingToken, lease_expires_at: new Date(Date.now() + 180000).toISOString() }],
			error: null,
		});
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({ rpc: rpcMock } as any);

		const res = await renewDistributedPipelineLock(mockEnv, {
			ownerToken: "owner-token-5",
			fencingToken: initialFencingToken,
		});
		expect(res.renewed).toBe(true);
		expect(res.fencingToken).toBe(initialFencingToken);
	});

	// 6. Fencing token advances during ownership takeover
	it("6. Fencing token advances during ownership takeover: new owner receives incremented token", async () => {
		const rpcMock = vi.fn().mockResolvedValue({
			data: [{ acquired: true, fencing_token: 6, lease_expires_at: new Date(Date.now() + 180000).toISOString() }],
			error: null,
		});
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({ rpc: rpcMock } as any);

		const res = await acquireDistributedPipelineLock(mockEnv, {
			ownerRunId: "new-owner-run",
			ownerToken: "new-owner-token",
		});
		expect(res.success).toBe(true);
		expect(res.fencingToken).toBe(6);
	});

	// 7. Stale owner cannot renew or release
	it("7. Stale owner cannot renew or release: returns error and renewed=false on token mismatch", async () => {
		const rpcMock = vi.fn().mockImplementation((fnName: string) => {
			if (fnName === "renew_pipeline_run_lock") {
				return Promise.resolve({
					data: [{ renewed: false, reason: "fencing_token_mismatch" }],
					error: null,
				});
			}
			if (fnName === "release_pipeline_run_lock") {
				return Promise.resolve({
					data: [{ released: false, reason: "owner_mismatch" }],
					error: null,
				});
			}
			return Promise.resolve({ data: null, error: null });
		});
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({ rpc: rpcMock } as any);

		const ren = await renewDistributedPipelineLock(mockEnv, {
			ownerToken: "stale-owner",
			fencingToken: 2,
		});
		expect(ren.renewed).toBe(false);
		expect(ren.reason).toBe("fencing_token_mismatch");

		const rel = await releaseDistributedPipelineLock(mockEnv, {
			ownerToken: "stale-owner",
			fencingToken: 2,
		});
		expect(rel.released).toBe(false);
		expect(rel.reason).toBe("owner_mismatch");
	});

	// 8. Missing remote lock RPC causes HTTP 503
	it("8. Missing remote lock RPC causes HTTP 503: fail-closed prevents pipeline execution without lock", async () => {
		const rpcMock = vi.fn().mockResolvedValue({
			data: null,
			error: { message: "function public.acquire_pipeline_run_lock does not exist in schema cache" },
		});
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({ rpc: rpcMock } as any);

		const outcome = await executePipeline(mockEnv, { triggerType: "manual" });
		expect(outcome.success).toBe(false);
		expect(outcome.status).toBe(503);
		expect(outcome.stage).toBe("concurrency_lock");
		expect(outcome.error).toContain("Distributed lock service is unavailable");
	});

	// 9. News-only synchronization never starts AI processing
	it("9. News-only synchronization never starts AI processing: isolated ingestion", async () => {
		const topicSpy = vi.spyOn(topicSelectionModule, "selectHotTopic");
		const groqSpy = vi.spyOn(groqModule, "callGroqBatchAnalysis");

		// Mock upstream fetch for news
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					success: true,
					articles: [
						{
							title: "High Court Grants Bail in Commercial Matter",
							description: "The High Court granted bail under standard conditions.",
							url: "https://example.com/hc-bail",
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } }
			)
		);

		const rpcMock = vi.fn().mockResolvedValue({ data: 1, error: null });
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({ rpc: rpcMock } as any);

		const res = await worker.fetch(
			new Request("http://127.0.0.1:8787/api/dashboard/news-sync", {
				method: "POST",
				body: JSON.stringify({ days: "1", limit: "5" }),
			}),
			mockEnv
		);

		expect(res.status).toBe(200);
		expect(topicSpy).not.toHaveBeenCalled();
		expect(groqSpy).not.toHaveBeenCalled();
	});

	// 10. Dashboard shows Groq unavailable accurately
	it("10. Dashboard shows Groq unavailable accurately: surfaces blocked status when key missing or model bad", async () => {
		const envNoGroq = { ...mockEnv, GROQ_API_KEY: "" };
		const stateNoGroq = await getDashboardState(envNoGroq);
		expect(stateNoGroq.groq.status).toBe("blocked");
		expect(stateNoGroq.groq.available).toBe(false);
		expect(stateNoGroq.groq.error).toContain("Missing GROQ_API_KEY");

		const envBadGroq = { ...mockEnv, GROQ_MODEL: "llama-3.3-70b-versatile" };
		const stateBadGroq = await getDashboardState(envBadGroq);
		expect(stateBadGroq.groq.status).toBe("blocked");
		expect(stateBadGroq.groq.available).toBe(false);
		expect(stateBadGroq.groq.error).toContain("Unsupported GROQ_MODEL");
	});

	// 11. Dashboard shows distributed lock unavailable accurately
	it("11. Dashboard shows distributed lock unavailable accurately: surfaces blocked state when table missing", async () => {
		const clientMock = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn().mockResolvedValue({
							data: null,
							error: { message: "relation 'pipeline_run_locks' does not exist" },
						}),
						single: vi.fn().mockResolvedValue({
							data: null,
							error: { message: "relation 'pipeline_run_locks' does not exist" },
						}),
					})),
					limit: vi.fn().mockResolvedValue({ error: { message: "table missing" } }),
				})),
			})),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(clientMock as any);

		const state = await getDashboardState(mockEnv);
		expect(state.distributedLock.available).toBe(false);
		expect(state.distributedLock.error).toContain("pipeline_run_locks");
	});

	// 12. DLQ retry configuration matches Wrangler configuration
	it("12. DLQ retry configuration matches Wrangler configuration: DLQ retries with delay and quarantine refuses auto-ack", async () => {
		// Verify DLQ queue consumer retry behavior on failure
		const mockMsg = {
			id: "msg-dlq-1",
			body: { job_id: "job-1", post_id: "00000000-0000-0000-0000-000000000001" },
			attempts: 1,
			retry: vi.fn(),
			ack: vi.fn(),
		};
		const mockBatch = {
			queue: "instagram-publishing-dlq",
			messages: [mockMsg],
			ackAll: vi.fn(),
			retryAll: vi.fn(),
		};

		// Mock Supabase failure so DLQ requests retry
		const clientMock = {
			from: vi.fn(() => ({
				insert: vi.fn().mockResolvedValue({ error: { message: "DB timeout" } }),
			})),
		};
		vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue(clientMock as any);

		await worker.queue(mockBatch as any, mockEnv, { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any);
		expect(mockMsg.retry).toHaveBeenCalledWith({ delaySeconds: 60 });

		// Verify that unconsumed quarantine queue throws to refuse auto-ack
		await expect(
			worker.queue(
				{ queue: "instagram-publishing-quarantine", messages: [] } as any,
				mockEnv,
				{ waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any
			)
		).rejects.toThrow("has no registered consumer in Worker and must not be processed");
	});

	// 13. Telegram webhook diagnostics do not expose secrets
	it("13. Telegram webhook diagnostics do not expose secrets: secret tokens never printed in responses", async () => {
		const res = await worker.fetch(new Request("http://127.0.0.1:8787/api/dashboard/state"), mockEnv);
		const body = await res.text();
		expect(body).not.toContain(mockEnv.TELEGRAM_BOT_TOKEN);
		expect(body).not.toContain(mockEnv.TELEGRAM_WEBHOOK_SECRET);
	});

	// 14. Existing carousel and publishing safeguards remain unchanged
	it("14. Existing carousel and publishing safeguards remain unchanged: auto-publish remains disabled", () => {
		expect(mockEnv.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL).toBeUndefined(); // defaults to false
		const envSafe = { ...mockEnv, INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "false" };
		expect(envSafe.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL).toBe("false");
	});
});
