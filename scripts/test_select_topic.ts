import fs from 'fs';
import { selectHotTopic } from '../src/services/topic-selection';
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

async function testTopicSelection() {
	console.log("Testing selectHotTopic with live env...");
	const env = vars as unknown as Env;
	const outcome = await selectHotTopic(env, {
		collection_window_days: 7,
		batch_size: 10,
	});

	console.log("\n--- RESULT ---");
	console.log("Success:", outcome.success);
	if (outcome.success) {
		console.log("Selection status:", outcome.data.selection_status);
		console.log("Selected topic:", JSON.stringify(outcome.data.selected_topic, null, 2));
	} else {
		console.log("Error status:", outcome.status);
		console.log("Error message:", outcome.error);
	}
}

testTopicSelection();
