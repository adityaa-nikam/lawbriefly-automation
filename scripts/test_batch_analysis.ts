import fs from 'fs';
import { callGroqBatchAnalysis } from '../src/services/groq';
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
	if (!retrieval.success) {
		console.error("Retrieval failed:", retrieval);
		return;
	}
	const firstBatch = retrieval.data.batches[0];
	console.log(`Input batch has ${firstBatch.articles.length} articles.`);
	firstBatch.articles.forEach((a, i) => console.log(`  [${i+1}] ${a.id}: ${a.title.slice(0, 50)}`));

	const res = await callGroqBatchAnalysis({ ...env, GROQ_MODEL: "qwen/qwen3.8-27b" }, firstBatch.articles);
	console.log("\nGroq success:", res.success);
	if (res.success) {
		console.log(`Returned assessments: ${res.data.article_assessments?.length}`);
		console.log(`Returned clusters: ${res.data.topic_clusters?.length}`);
		res.data.article_assessments.forEach((ass, i) => {
			console.log(`  [${i+1}] article_id: ${ass.article_id} | relevance: ${ass.relevance}`);
		});
	} else {
		console.error("Groq call failed:", res);
	}
}

run();
