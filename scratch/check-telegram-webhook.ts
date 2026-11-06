import * as fs from "node:fs";
import * as path from "node:path";

async function checkTelegramWebhook() {
	const devVarsPath = path.join(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
		const idx = line.indexOf("=");
		if (idx > 0 && !line.trim().startsWith("#")) {
			vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		}
	}

	const botToken = vars.TELEGRAM_BOT_TOKEN;
	if (!botToken) {
		console.log("No TELEGRAM_BOT_TOKEN found in .dev.vars");
		return;
	}

	console.log("Bot Token is configured (length:", botToken.length, "chars, redacted)");

	try {
		const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
		const data: any = await res.json();
		console.log("Telegram getWebhookInfo response status:", res.status);
		if (data.ok && data.result) {
			const info = data.result;
			console.log("Webhook Registered URL:", info.url ? info.url : "[EMPTY / NO WEBHOOK SET]");
			console.log("Has Custom Certificate:", info.has_custom_certificate);
			console.log("Pending Update Count:", info.pending_update_count);
			console.log("Last Error Date:", info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : "None");
			console.log("Last Error Message:", info.last_error_message || "None");
			console.log("Max Connections:", info.max_connections);
			console.log("Allowed Updates:", info.allowed_updates || "All");
		} else {
			console.log("Telegram getWebhookInfo returned error:", data);
		}
	} catch (err: any) {
		console.error("Failed to query Telegram API:", err.message);
	}
}

checkTelegramWebhook().catch(console.error);

