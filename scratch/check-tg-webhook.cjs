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

async function checkWebhook() {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const data = await res.json();
  console.log('Current Telegram Webhook Info:');
  console.log(JSON.stringify(data, null, 2));
}

checkWebhook();

