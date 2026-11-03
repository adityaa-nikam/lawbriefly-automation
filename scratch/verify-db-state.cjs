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
const postId = "c1afe262-12da-4034-b054-b990e038f4aa";

async function verifyDb() {
  const { data: post, error: postErr } = await supabase
    .from('social_content_posts')
    .select('id, post_status, topic_title, human_review_required, created_at, updated_at')
    .eq('id', postId)
    .single();

  const { data: approval, error: appErr } = await supabase
    .from('social_content_approval_requests')
    .select('*')
    .eq('id', '77fc6b12-74ee-485d-b1e2-92e19c8a57b4')
    .single();

  const { data: assets, error: assetErr } = await supabase
    .from('social_content_assets')
    .select('asset_type, slide_number, mime_type, width, height, size_bytes')
    .eq('post_id', postId)
    .order('slide_number', { ascending: true });

  console.log('Post Status:', post, 'Post Error:', postErr);
  console.log('Approval Request:', approval, 'Approval Error:', appErr);
  console.log(`Assets Count: ${assets?.length}`);
  console.log('Asset Types:', assets?.map(a => `${a.asset_type}${a.slide_number ? ` (#${a.slide_number})` : ''} [${a.mime_type}]`).join(', '));
}

verifyDb();
