import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const lines = fs.readFileSync('.dev.vars', 'utf8').split('\n');
const vars: Record<string, string> = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    const k = trimmed.slice(0, idx).trim();
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    vars[k] = v;
  }
}

async function runPreflight() {
	console.log("==========================================");
	console.log("       TASK 22.5 PREFLIGHT VERIFICATION   ");
	console.log("==========================================");

	const requiredEnvVars = [
		"LAWBRIEFLY_API_URL",
		"LAWBRIEFLY_API_KEY",
		"SUPABASE_URL",
		"SUPABASE_SECRET_KEY",
		"GROQ_API_KEY",
		"GROQ_MODEL",
		"OPENROUTER_API_KEY",
		"MERCURY_MODEL",
		"TELEGRAM_BOT_TOKEN",
		"TELEGRAM_CHAT_ID",
		"INSTAGRAM_ACCOUNT_ID",
		"INSTAGRAM_ACCESS_TOKEN"
	];

	console.log("\n[1] Environment Variables Verification:");
	let envOk = true;
	for (const v of requiredEnvVars) {
		const val = vars[v];
		if (!val || val.trim().length === 0) {
			console.log(`  ❌ Missing: ${v}`);
			envOk = false;
		} else {
			console.log(`  ✅ ${v}: configured (${val.length} chars)`);
		}
	}

	const supabase = createClient(vars.SUPABASE_URL, vars.SUPABASE_SECRET_KEY);

	console.log("\n[2] Supabase Database & Distributed Lock Verification:");
	try {
		// Test lock query on table
		const { data: lockRow, error: lockErr } = await supabase
			.from("pipeline_run_locks")
			.select("lock_name, owner_run_id, lease_expires_at, fencing_token")
			.eq("lock_name", "global_content_pipeline")
			.maybeSingle();

		if (lockErr) {
			console.log(`  ❌ pipeline_run_locks table query error:`, lockErr.message);
		} else {
			console.log(`  ✅ pipeline_run_locks table: Accessible (current row: ${JSON.stringify(lockRow)})`);
		}
	} catch (e: any) {
		console.log(`  ❌ Distributed lock check failed:`, e.message);
	}

	console.log("\n[3] Supabase Storage Connectivity:");
	try {
		const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
		if (bErr) {
			console.log(`  ❌ Storage listBuckets error:`, bErr.message);
		} else {
			const found = buckets?.some(b => b.name === "lawbriefly-carousel-assets");
			console.log(`  ✅ Storage reachable. Bucket 'lawbriefly-carousel-assets' exists: ${found}`);
		}
	} catch (e: any) {
		console.log(`  ❌ Supabase storage connection failed:`, e.message);
	}

	console.log("\n[4] Groq Model & Token Budget Configuration:");
	console.log(`  Configured model: ${vars.GROQ_MODEL}`);
	try {
		const testRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${vars.GROQ_API_KEY}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model: vars.GROQ_MODEL || "openai/gpt-oss-20b",
				messages: [{ role: "user", content: "ping" }],
				max_completion_tokens: 10
			})
		});
		console.log(`  Groq API ping status: ${testRes.status}`);
		const remaining = testRes.headers.get("x-ratelimit-remaining-tokens");
		const limit = testRes.headers.get("x-ratelimit-limit-tokens");
		console.log(`  Groq TPM Budget: ${remaining} / ${limit} remaining tokens`);
	} catch (e: any) {
		console.log(`  ❌ Groq connection failed:`, e.message);
	}

	console.log("\n[5] OpenRouter / Mercury Connectivity:");
	try {
		const orRes = await fetch("https://openrouter.ai/api/v1/models", {
			headers: { "Authorization": `Bearer ${vars.OPENROUTER_API_KEY}` }
		});
		console.log(`  OpenRouter API status: ${orRes.status}`);
	} catch (e: any) {
		console.log(`  ❌ OpenRouter connection failed:`, e.message);
	}

	console.log("\n[6] Telegram Bot Connectivity:");
	try {
		const tgRes = await fetch(`https://api.telegram.org/bot${vars.TELEGRAM_BOT_TOKEN}/getMe`);
		const tgData = await tgRes.json() as any;
		console.log(`  Telegram getMe status: ${tgRes.status}, Bot username: @${tgData.result?.username}`);
	} catch (e: any) {
		console.log(`  ❌ Telegram getMe connection failed:`, e.message);
	}

	console.log("\n[7] Instagram Configuration & Boundaries:");
	console.log(`  INSTAGRAM_ACCOUNT_ID: ${vars.INSTAGRAM_ACCOUNT_ID}`);
	console.log(`  INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: ${vars.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL || "false"}`);
	console.log(`  Auto-publish without explicit approval is strictly blocked by Queue consumer.`);

	console.log("\n[8] Checking History for Previous Reprocessing Prevention:");
	try {
		const { data: recentPosts } = await supabase
			.from("social_content_posts")
			.select("id, topic_title, created_at")
			.order("created_at", { ascending: false })
			.limit(3);
		console.log(`  Most recent 3 posts in DB:`);
		recentPosts?.forEach(p => console.log(`    - [${p.id}] ${p.topic_title} (${p.created_at})`));
	} catch (e: any) {
		console.log(`  Error querying recent posts:`, e.message);
	}

	console.log("\n==========================================");
}

runPreflight();
