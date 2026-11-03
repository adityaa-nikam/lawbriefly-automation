const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

const outDir = path.resolve(process.cwd(), 'artifacts', 'task18-jpegs');
fs.mkdirSync(outDir, { recursive: true });

async function downloadJpegs() {
  console.log('Downloading 5 JPEGs from post 9b618111...');
  for (let i = 1; i <= 5; i++) {
    const pad = String(i).padStart(2, '0');
    const storagePath = `posts/9b618111-e3c6-4e4f-9000-0dcda8c90f9f/publishing/slide-${pad}.jpg`;
    const { data, error } = await supabase.storage.from('lawbriefly-carousel-assets').download(storagePath);
    if (error || !data) {
      throw new Error(`Failed to download slide ${i}: ${error?.message}`);
    }
    const buf = Buffer.from(await data.arrayBuffer());
    const outPath = path.join(outDir, `slide-${pad}.jpg`);
    fs.writeFileSync(outPath, buf);
    console.log(`Saved slide ${i} JPEG: ${buf.length} bytes to ${outPath}`);
  }
  console.log('All 5 JPEGs downloaded successfully!');
}

downloadJpegs().catch(err => {
  console.error(err);
  process.exit(1);
});

