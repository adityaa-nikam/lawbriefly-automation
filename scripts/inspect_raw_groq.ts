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
	const env = { ...vars, GROQ_MODEL: "qwen/qwen3.8-27b" } as unknown as Env;
	const retrieval = await getNewsBatches(env, {
		collection_window_days: 7,
		batch_size: 10,
	});
	if (!retrieval.success) {
		console.error("Retrieval failed:", retrieval);
		return;
	}
	const firstBatch = retrieval.data.batches[0];
	const res = await callGroqBatchAnalysis(env, firstBatch.articles);
	if (res.success) {
		console.log("=== ARTICLE ASSESSMENTS ===");
		res.data.article_assessments.forEach(a => console.log(`${a.article_id} -> cluster_id: ${a.cluster_id}`));
		console.log("\n=== TOPIC CLUSTERS ===");
		res.data.topic_clusters.forEach(c => console.log(`Cluster ID: ${c.cluster_id} | Articles: ${c.article_ids}`));
	}
}

run();
