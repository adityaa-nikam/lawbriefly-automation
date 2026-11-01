import { fetchLawBrieflyNews } from "./services/lawbriefly";
import { checkSupabaseHealth } from "./services/supabase";
import { syncNewsArticles, handleScheduledNewsSync } from "./services/news-ingestion";

export interface Env {
	LAWBRIEFLY_API_URL?: string;
	LAWBRIEFLY_API_KEY?: string;
	SUPABASE_URL?: string;
	SUPABASE_SECRET_KEY?: string;
	APP_ENV?: string;
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

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		await handleScheduledNewsSync(controller, env);
	},
} satisfies ExportedHandler<Env>;
