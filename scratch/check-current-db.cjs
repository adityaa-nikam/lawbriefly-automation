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

async function check() {
  const { data: post } = await supabase
    .from('social_content_posts')
    .select('id, post_status, instagram_media_id, instagram_permalink, published_at, updated_at')
    .eq('id', postId)
    .single();

  const { data: pub } = await supabase
    .from('social_content_publications')
    .select('id, publication_status, carousel_container_id, child_container_ids, instagram_media_id, instagram_permalink, published_at, updated_at')
    .eq('post_id', postId)
    .single();

  console.log('Post:', post);
  console.log('Publication:', pub);
}

check();
