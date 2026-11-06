import fs from 'fs';
import { getNewsBatches } from '../src/services/news-retrieval';
import type { Env } from '../src/index';

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

async function run() {
	const env = vars as unknown as Env;
	const retrieval = await getNewsBatches(env, {
		collection_window_days: 7,
		batch_size: 10,
	});
	console.log("Retrieval outcome:", JSON.stringify(retrieval, null, 2));
}

run();
