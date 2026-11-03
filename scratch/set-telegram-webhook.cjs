const fs = require('fs');

const envContent = fs.readFileSync('.dev.vars', 'utf8');
const vars = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const idx = trimmed.indexOf('=');
  const key = trimmed.slice(0, idx).trim();
  const val = trimmed.slice(idx + 1).trim().replace(/^["']+|["']+$/g, '');
  vars[key] = val;
}

const botToken = vars.TELEGRAM_BOT_TOKEN;
const secretToken = vars.TELEGRAM_WEBHOOK_SECRET;
const webhookUrl = "https://replies-shadow-performing-peoples.trycloudflare.com/api/webhooks/telegram";

async function setWebhook() {
  console.log(`Setting Telegram webhook to: ${webhookUrl}`);
  const payload = {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ["callback_query"]
  };

  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  console.log('setWebhook response:', data);

  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const infoData = await infoRes.json();
  console.log('getWebhookInfo response:', infoData);
}

setWebhook();

