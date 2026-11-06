import { fetchLawBrieflyNews } from "./services/lawbriefly";
import { checkSupabaseHealth } from "./services/supabase";
import { syncNewsArticles, handleScheduledNewsSync } from "./services/news-ingestion";
import { handleGetNewsBatches } from "./services/news-retrieval";
import { handleAnalyzeBatches } from "./services/news-analysis";
import { handleSelectHotTopic } from "./services/topic-selection";
import { handleExtractArticle } from "./services/article-extraction";
import { handleExtractTopicArticles } from "./services/topic-article-extraction";
import { handleGenerateContent } from "./services/content-generation";
import { handleRenderCarousel } from "./services/carousel-rendering";
import { handleStoreCarousel } from "./services/carousel-persistence";
import {
	handleNotifyEditor,
	handleTelegramWebhook,
	handleInstagramPublishingQueue,
	handleRecoverStrandedPublications,
	recoverStrandedApprovedPosts,
	type InstagramPublishingJobMessage,
} from "./services/editorial-approval";
import { handlePublishInstagram } from "./services/instagram-publishing";
import {
	handleRunPipeline,
	handleScheduledPipelineRun,
} from "./services/pipeline-orchestrator";
import {
	handleOperationsHealth,
	handleDeadLetterQueue,
	checkQuarantineBacklog,
	handleReplayQuarantinedMessage,
} from "./services/observability";
import {
	handleDashboardPage,
	handleDashboardState,
	handleDashboardRuns,
	handleDashboardRunDetails,
	handleDashboardRunTrigger,
	handleDashboardNewsSync,
} from "./services/dashboard";

export {
	type InstagramPublishingJobMessage,
	handleScheduledPipelineRun,
	handleOperationsHealth,
	handleDeadLetterQueue,
	checkQuarantineBacklog,
	handleReplayQuarantinedMessage,
	handleDashboardPage,
	handleDashboardState,
	handleDashboardRuns,
	handleDashboardRunDetails,
	handleDashboardRunTrigger,
	handleDashboardNewsSync,
};

export interface Env {
	LAWBRIEFLY_API_URL?: string;
	LAWBRIEFLY_API_KEY?: string;
	SUPABASE_URL?: string;
	SUPABASE_SECRET_KEY?: string;
	APP_ENV?: string;
	AUTONOMOUS_PIPELINE_ENABLED?: string;
	OPS_ALERTS_ENABLED?: string;
	TELEGRAM_OPS_ALERT_CHAT_ID?: string;
	GROQ_API_KEY?: string;
	GROQ_MODEL?: string;
	OPENROUTER_API_KEY?: string;
	MERCURY_MODEL?: string;
	JINA_API_KEY?: string;
	MYBROWSER?: any;
	TELEGRAM_BOT_TOKEN?: string;
	TELEGRAM_CHAT_ID?: string;
	TELEGRAM_ALLOWED_USER_IDS?: string;
	TELEGRAM_WEBHOOK_SECRET?: string;
	TELEGRAM_APPROVAL_TTL_HOURS?: string;
	INSTAGRAM_AUTH_MODE?: string;
	INSTAGRAM_ACCESS_TOKEN?: string;
	INSTAGRAM_ACCOUNT_ID?: string;
	INSTAGRAM_USER_ID?: string;
	INSTAGRAM_GRAPH_VERSION?: string;
	INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL?: string;
	INSTAGRAM_AUTO_PUBLISH_POST_ALLOWLIST?: string;
	INSTAGRAM_PUBLISHING_QUEUE?: Queue<InstagramPublishingJobMessage>;
	INSTAGRAM_QUARANTINE_QUEUE?: Queue<any>;
	ADMIN_API_KEY?: string;
	META_APP_ID?: string;
	META_APP_SECRET?: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/news" && request.method === "GET") {
			return await fetchLawBrieflyNews(env, url.searchParams);
		}

		if (url.pathname === "/api/news/sync" && request.method === "POST") {
			if (env.APP_ENV !== "development") {
				return new Response(
					JSON.stringify({ error: "Not Found", status: 404 }),
					{
						status: 404,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			return await syncNewsArticles(env, url.searchParams);
		}

		if (url.pathname === "/api/news/batches" && request.method === "GET") {
			if (env.APP_ENV !== "development") {
				return new Response(
					JSON.stringify({ error: "Not Found", status: 404 }),
					{
						status: 404,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			return await handleGetNewsBatches(env, url.searchParams);
		}

		if (url.pathname === "/api/ai/analyze-batches" && request.method === "POST") {
			if (env.APP_ENV !== "development") {
				return new Response(
					JSON.stringify({ error: "Not Found", status: 404 }),
					{
						status: 404,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			return await handleAnalyzeBatches(env, url.searchParams);
		}

		if (url.pathname === "/api/ai/select-hot-topic" && request.method === "POST") {
			if (env.APP_ENV !== "development") {
				return new Response(
					JSON.stringify({ error: "Not Found", status: 404 }),
					{
						status: 404,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			return await handleSelectHotTopic(env, url.searchParams);
		}

		if (url.pathname === "/api/ai/extract-article" && request.method === "POST") {
			if (env.APP_ENV !== "development") {
				return new Response(
					JSON.stringify({ error: "Not Found", status: 404 }),
					{
						status: 404,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			return await handleExtractArticle(request, env);
		}

		if (url.pathname === "/api/ai/extract-topic-articles" && request.method === "POST") {
			if (env.APP_ENV !== "development") {
				return new Response(
					JSON.stringify({ error: "Not Found", status: 404 }),
					{
						status: 404,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			return await handleExtractTopicArticles(request, env);
		}

		if (url.pathname === "/api/ai/generate-content" && request.method === "POST") {
			if (env.APP_ENV !== "development") {
				return new Response(
					JSON.stringify({ error: "Not Found", status: 404 }),
					{
						status: 404,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			return await handleGenerateContent(request, env);
		}

		if (url.pathname === "/api/ai/render-carousel" && request.method === "POST") {
			return await handleRenderCarousel(request, env);
		}

		if (url.pathname === "/api/ai/store-carousel") {
			return await handleStoreCarousel(request, env);
		}

		if (url.pathname === "/api/ai/notify-editor") {
			return await handleNotifyEditor(request, env);
		}

		if (url.pathname === "/api/webhooks/telegram") {
			return await handleTelegramWebhook(request, env, ctx);
		}

		if (url.pathname === "/api/ai/publish-instagram") {
			return await handlePublishInstagram(request, env);
		}

		if (url.pathname === "/api/ai/recover-stranded-publications" && request.method === "POST") {
			return await handleRecoverStrandedPublications(request, env);
		}

		if (url.pathname === "/api/ai/run-pipeline") {
			return await handleRunPipeline(request, env);
		}

		if (url.pathname === "/api/health/supabase" && request.method === "GET") {
			if (env.APP_ENV !== "development") {
				return new Response(
					JSON.stringify({ error: "Not Found", status: 404 }),
					{
						status: 404,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			return await checkSupabaseHealth(env);
		}

		if (url.pathname === "/api/health/operations" && request.method === "GET") {
			if (env.APP_ENV !== "development" && (env as any).ENVIRONMENT !== "development") {
				return new Response(
					JSON.stringify({ error: "Not Found", status: 404 }),
					{
						status: 404,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
			return await handleOperationsHealth(env);
		}

		if (url.pathname === "/api/admin/quarantine/re-enqueue-dlq" && request.method === "POST") {
			return await handleReplayQuarantinedMessage(request, env);
		}

		if (url.pathname === "/dashboard") {
			return await handleDashboardPage(request, env);
		}

		if (url.pathname === "/api/dashboard/state" && request.method === "GET") {
			return await handleDashboardState(request, env);
		}

		if (url.pathname === "/api/dashboard/runs" && request.method === "GET") {
			return await handleDashboardRuns(request, env);
		}

		if (url.pathname.startsWith("/api/dashboard/runs/") && request.method === "GET") {
			const runId = url.pathname.replace("/api/dashboard/runs/", "");
			return await handleDashboardRunDetails(request, env, runId);
		}

		if (url.pathname === "/api/dashboard/run" && request.method === "POST") {
			return await handleDashboardRunTrigger(request, env);
		}

		if (url.pathname === "/api/dashboard/news-sync" && request.method === "POST") {
			return await handleDashboardNewsSync(request, env);
		}

		if (url.pathname === "/") {
			return new Response("Hello World!");
		}

		return new Response(
			JSON.stringify({ error: "Not Found", status: 404 }),
			{
				status: 404,
				headers: { "Content-Type": "application/json" },
			}
		);
	},

	async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext): Promise<void> {
		if (batch.queue === "instagram-publishing-dlq") {
			await handleDeadLetterQueue(batch, env, ctx);
		} else if (batch.queue === "instagram-publishing-jobs") {
			await handleInstagramPublishingQueue(batch, env, ctx);
		} else {
			// Unconsumed queue (e.g. instagram-publishing-quarantine or unrecognized queue):
			// No consumer is registered in wrangler.jsonc. If invoked unexpectedly, throwing
			// prevents Cloudflare Queues from auto-acknowledging or silently dropping messages.
			console.error(`[Queue] Unexpected batch received on unconsumed queue '${batch.queue}'. Refusing auto-ack.`);
			throw new Error(`Queue '${batch.queue}' has no registered consumer in Worker and must not be processed.`);
		}
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const cron = controller.cron;

		// 1. Autonomous daily content generation pipeline (02:00 UTC / 07:30 AM IST)
		if (cron === "0 2 * * *") {
			await handleScheduledPipelineRun(controller, env);
			return;
		}

		// 2. Scheduled news ingestion sync (00:30 UTC / 06:00 AM IST) or legacy invocation without cron
		if (!cron || cron === "30 0 * * *") {
			await handleScheduledNewsSync(controller, env);
		}

		// 3. Stranded publishing outbox queue recovery sweep (every 15 min) or legacy invocation without cron
		if (!cron || cron === "*/15 * * * *" || cron === "30 0 * * *") {
			if (env.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL === "true") {
				await recoverStrandedApprovedPosts(env).catch((err) => {
					console.error("[Scheduled] Stranded approved posts recovery error:", err);
				});
			}

			// Operational quarantine backlog check (Task 21)
			await checkQuarantineBacklog(env).catch((err) => {
				console.error("[Scheduled] Quarantine backlog check error:", err);
			});
		}

		// 4. Log any unrecognized cron expression
		if (cron && cron !== "0 2 * * *" && cron !== "30 0 * * *" && cron !== "*/15 * * * *") {
			console.log(`[Scheduled] Unrecognized cron trigger: '${cron}' - no scheduled task registered.`);
		}
	},
} satisfies ExportedHandler<Env>;
