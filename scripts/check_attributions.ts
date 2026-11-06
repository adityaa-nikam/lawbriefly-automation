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

const supabase = createClient(vars.SUPABASE_URL, vars.SUPABASE_SECRET_KEY);

async function run() {
  const { data: posts } = await supabase
    .from('social_content_posts')
    .select('id, topic_title, post_status, source_attributions, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('Posts:', JSON.stringify(posts, null, 2));
}

run();

