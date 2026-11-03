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

async function downloadSample() {
  const { data, error } = await supabase.storage.from('lawbriefly-carousel-assets').download('posts/9b618111-e3c6-4e4f-9000-0dcda8c90f9f/publishing/slide-01.jpg');
  console.log('Download error:', error);
  if (data) {
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log('Downloaded JPEG size:', buffer.length, 'bytes');
    console.log('Magic bytes:', buffer.slice(0, 4));
  }
}

downloadSample();
