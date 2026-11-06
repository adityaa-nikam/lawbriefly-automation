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
    vars[k] = v;
  }
}

async function check() {
	const supabase = createClient(vars.SUPABASE_URL, vars.SUPABASE_SECRET_KEY);
	const { data, error } = await supabase.storage.listBuckets();
	console.log("Buckets:", data);
	console.log("Error:", error);
}

check();
