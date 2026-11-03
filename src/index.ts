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
import { handleRunPipeline } from "./services/pipeline-orchestrator";

export { type InstagramPublishingJobMessage };

export interface Env {
	LAWBRIEFLY_API_URL?: string;
	LAWBRIEFLY_API_KEY?: string;
	SUPABASE_URL?: string;
	SUPABASE_SECRET_KEY?: string;
	APP_ENV?: string;
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
		await handleInstagramPublishingQueue(batch, env, ctx);
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		if (!controller.cron || controller.cron === "30 0 * * *") {
			await handleScheduledNewsSync(controller, env);
		}
		if (env.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL === "true") {
			await recoverStrandedApprovedPosts(env).catch((err) => {
				console.error("[Scheduled] Stranded approved posts recovery error:", err);
			});
		}
	},
} satisfies ExportedHandler<Env>;
