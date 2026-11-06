import * as fs from "node:fs";
import * as path from "node:path";
import { getDashboardState } from "../src/services/dashboard";
import { recordRunToHistory } from "../src/services/pipeline-orchestrator";

async function run() {
	const devVarsPath = path.join(process.cwd(), ".dev.vars");
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(devVarsPath, "utf-8").split("\n")) {
		const idx = line.indexOf("=");
		if (idx > 0 && !line.trim().startsWith("#")) {
			vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		}
	}

	// Record a run in history pointing to the actual published post
	recordRunToHistory({
		runId: "historical-run-sample",
		triggerType: "manual",
		currentStage: "editorial_notification",
		overallStatus: "completed",
		startedAt: new Date(Date.now() - 60000).toISOString(),
		completedAt: new Date().toISOString(),
		elapsedMs: 2400,
		postId: "9b618111-e3c6-4e4f-9000-0dcda8c90f9f",
		stages: {
			news_ingestion: { stage: "news_ingestion", status: "completed" },
			topic_selection: { stage: "topic_selection", status: "completed" },
			content_generation: { stage: "content_generation", status: "completed" },
			carousel_rendering: { stage: "carousel_rendering", status: "completed" },
			carousel_persistence: { stage: "carousel_persistence", status: "completed" },
			editorial_notification: { stage: "editorial_notification", status: "completed" },
			instagram_publication: { stage: "instagram_publication", status: "waiting" },
		},
	});

	const state = await getDashboardState(vars as any);
	console.log("Publication Info from real DB:", JSON.stringify(state.publication, null, 2));
	console.log("Last run Stage 7 status:", state.lastRun?.stages.instagram_publication);
}

run().catch(console.error);

