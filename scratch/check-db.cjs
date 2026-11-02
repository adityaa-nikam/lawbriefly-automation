const { createClient } = require('@supabase/supabase-js');
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

const supabase = createClient(vars.SUPABASE_URL, vars.SUPABASE_SECRET_KEY);

async function check() {
  const { data: rpcRes, error: rpcErr } = await supabase.rpc('process_editorial_approval_decision', {
    p_token_hash: 'nonexistent_test_hash',
    p_action: 'approve',
    p_telegram_user_id: '1405876915',
    p_telegram_username: '@test',
    p_telegram_chat_id: '1405876915',
    p_telegram_message_id: 9,
    p_telegram_update_id: 12345,
    p_telegram_callback_query_id: 'cbq_test_1'
  });
  console.log('RPC Test result:', rpcRes, 'RPC Error:', rpcErr);
}

check();
