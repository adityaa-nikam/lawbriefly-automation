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
  const { data: post, error } = await supabase
    .from('social_content_posts')
    .select('*')
    .eq('id', '9b618111-e3c6-4e4f-9000-0dcda8c90f9f')
    .single();
  console.log('Post 9b618111:', Object.keys(post || {}), error);
  if (post) {
    console.log('Status:', post.post_status);
    console.log('Topic title:', post.topic_title);
    console.log('Fingerprint:', post.content_fingerprint);
  }
}

check();
