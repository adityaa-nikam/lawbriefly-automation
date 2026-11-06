/**
 * Local Telegram Webhook Bridge for Development
 * 
 * In local development (wrangler dev on localhost:8787), Telegram's cloud servers
 * cannot make HTTP POST requests to localhost directly without an open tunnel.
 * 
 * This bridge uses long-polling (getUpdates) to receive callback queries (APPROVE / REJECT clicks)
 * from Telegram and forwards them directly to http://127.0.0.1:8787/api/webhooks/telegram
 * with the correct X-Telegram-Bot-Api-Secret-Token authentication header.
 * 
 * Usage:
 *   npx tsx scripts/telegram-local-bridge.ts
 */

import fs from "fs";
import path from "path";

// 1. Read .dev.vars
function loadDevVars(): Record<string, string> {
	const devVarsPath = path.resolve(process.cwd(), ".dev.vars");
	if (!fs.existsSync(devVarsPath)) {
		throw new Error(".dev.vars file not found in current directory.");
	}

	const vars: Record<string, string> = {};
	const lines = fs.readFileSync(devVarsPath, "utf8").split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx !== -1) {
			const k = trimmed.slice(0, eqIdx).trim();
			let v = trimmed.slice(eqIdx + 1).trim();
			if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
				v = v.slice(1, -1);
			}
			vars[k] = v;
		}
	}
	return vars;
}

const vars = loadDevVars();
const BOT_TOKEN = vars.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = vars.TELEGRAM_WEBHOOK_SECRET;
const TARGET_URL = process.env.LOCAL_WORKER_URL || "http://127.0.0.1:8787/api/webhooks/telegram";

if (!BOT_TOKEN) {
	console.error("Error: TELEGRAM_BOT_TOKEN missing in .dev.vars.");
	process.exit(1);
}

if (!WEBHOOK_SECRET) {
	console.error("Error: TELEGRAM_WEBHOOK_SECRET missing in .dev.vars.");
	process.exit(1);
}

console.log("=================================================");
console.log("  LawBriefly Local Telegram Webhook Bridge");
console.log("=================================================");
console.log(`Bot Token:      ${BOT_TOKEN.slice(0, 10)}...`);
console.log(`Forward Target: ${TARGET_URL}`);
console.log("Polling Telegram for inline button clicks (APPROVE / REJECT)...");
console.log("=================================================\n");

let offset = 0;
let isRunning = true;

process.on("SIGINT", () => {
	console.log("\nShutting down Telegram bridge...");
	isRunning = false;
	process.exit(0);
});

async function pollUpdates() {
	while (isRunning) {
		try {
			const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=10&allowed_updates=["callback_query"]`;
			const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
			if (!res.ok) {
				console.warn(`[Bridge] Telegram getUpdates returned HTTP ${res.status}. Retrying in 3s...`);
				await new Promise((r) => setTimeout(r, 3000));
				continue;
			}

			const data = (await res.json()) as any;
			if (!data.ok || !Array.isArray(data.result)) {
				await new Promise((r) => setTimeout(r, 1000));
				continue;
			}

			for (const update of data.result) {
				offset = Math.max(offset, update.update_id + 1);

				if (update.callback_query) {
					const cb = update.callback_query;
					const user = cb.from?.username ? `@${cb.from.username}` : cb.from?.id;
					console.log(`[Bridge] Received button click from ${user}: data="${cb.data}" (query_id: ${cb.id})`);
					console.log(`[Bridge] Forwarding update ${update.update_id} to ${TARGET_URL}...`);

					try {
						const fwdRes = await fetch(TARGET_URL, {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET,
							},
							body: JSON.stringify(update),
						});

						const fwdBody = await fwdRes.text();
						console.log(`[Bridge] Worker Response: HTTP ${fwdRes.status} -> ${fwdBody}`);
					} catch (fwdErr: any) {
						console.error(`[Bridge] Forwarding failed to ${TARGET_URL}:`, fwdErr.message);
					}
				}
			}
		} catch (err: any) {
			if (err.name !== "TimeoutError") {
				console.warn(`[Bridge] Poll network error: ${err.message}. Retrying...`);
			}
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
}

pollUpdates();

