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

async function check() {
	const supabase = createClient(vars.SUPABASE_URL, vars.SUPABASE_SECRET_KEY);
	const { data, error } = await supabase
		.from("social_content_posts")
		.select("*")
		.order("created_at", { ascending: false })
		.limit(3);
	if (error) {
		console.error("Error:", error);
		return;
	}
	console.log("Found posts:", data?.length);
	data?.forEach((row, i) => {
		console.log(`\nRow ${i+1}:`);
		console.log("Keys:", Object.keys(row));
		console.log("ID:", row.id);
		console.log("topic_title:", row.topic_title);
		console.log("source_attributions:", JSON.stringify(row.source_attributions));
	});
}

check();
