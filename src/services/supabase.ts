import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../index";

/**
 * Creates and returns an authenticated server-side Supabase client using environment bindings.
 * Disables frontend session management and auto-refresh since this runs in a stateless Worker isolate.
 */
export function getSupabaseClient(env: Env): SupabaseClient {
	if (!env || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
		throw new Error("Missing Supabase configuration");
	}

	return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
			detectSessionInUrl: false,
		},
	});
}

/**
 * Executes a lightweight read-only connectivity health check against Supabase PostgreSQL.
 * Verifies that the database is reachable and credentials have valid table access.
 * Returns safe status responses with no credentials or raw database error leakage.
 */
export async function checkSupabaseHealth(env: Env): Promise<Response> {
	if (!env || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
		return new Response(
			JSON.stringify({
				success: false,
				service: "supabase",
				status: "unavailable",
				error: "Supabase connection check failed",
			}),
			{
				status: 503,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	try {
		const supabase = getSupabaseClient(env);
		const { error } = await supabase
			.from("news_articles")
			.select("id")
			.limit(1);

		if (error) {
			return new Response(
				JSON.stringify({
					success: false,
					service: "supabase",
					status: "unavailable",
					error: "Supabase connection check failed",
				}),
				{
					status: 503,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		return new Response(
			JSON.stringify({
				success: true,
				service: "supabase",
				status: "connected",
				database: "reachable",
			}),
			{
				status: 200,
				headers: { "Content-Type": "application/json" },
			}
		);
	} catch {
		return new Response(
			JSON.stringify({
				success: false,
				service: "supabase",
				status: "unavailable",
				error: "Supabase connection check failed",
			}),
			{
				status: 503,
				headers: { "Content-Type": "application/json" },
			}
		);
	}
}
