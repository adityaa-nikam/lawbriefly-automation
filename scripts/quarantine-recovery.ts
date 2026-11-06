/**
 * LawBriefly Quarantine Recovery Operator CLI (Task 21 - Component D)
 * 
 * Provides an authorized operator with safe, authenticated procedures for:
 * 1. Checking Supabase database health and migration status.
 * 2. Inspecting quarantined messages in dead_letter_events.
 * 3. Safely re-enqueueing unacknowledged DLQ messages for reprocessing.
 * 4. Preventing duplicate processing or direct external API calls.
 */

import { createClient } from "@supabase/supabase-js";

export interface QuarantineRecord {
	id: string;
	dlq_message_id: string;
	post_id: string | null;
	job_id: string | null;
	failure_category: string;
	processing_status: "quarantined" | "replayed" | "discarded";
	attempts: number;
	created_at: string;
	error_message?: string;
}

export interface QuarantineStatusResult {
	healthy: boolean;
	supabaseConnected: boolean;
	deadLetterTableExists: boolean;
	totalQuarantined: number;
	totalReplayed: number;
	oldestQuarantinedAt: string | null;
	oldestAgeSeconds: number | null;
	error?: string;
}

export async function checkQuarantineStatus(
	supabaseUrl: string,
	supabaseKey: string
): Promise<QuarantineStatusResult> {
	if (!supabaseUrl || !supabaseKey) {
		return {
			healthy: false,
			supabaseConnected: false,
			deadLetterTableExists: false,
			totalQuarantined: 0,
			totalReplayed: 0,
			oldestQuarantinedAt: null,
			oldestAgeSeconds: null,
			error: "Missing SUPABASE_URL or SUPABASE_SECRET_KEY",
		};
	}

	try {
		const supabase = createClient(supabaseUrl, supabaseKey);

		// 1. Check table existence and count quarantined
		const { data: quarantined, error: qErr } = await supabase
			.from("dead_letter_events")
			.select("id, created_at, processing_status")
			.eq("processing_status", "quarantined")
			.order("created_at", { ascending: true });

		if (qErr) {
			return {
				healthy: false,
				supabaseConnected: true,
				deadLetterTableExists: false,
				totalQuarantined: 0,
				totalReplayed: 0,
				oldestQuarantinedAt: null,
				oldestAgeSeconds: null,
				error: `dead_letter_events query failed: ${qErr.message}. Ensure migration 20261105000200 is applied.`,
			};
		}

		const { count: replayedCount } = await supabase
			.from("dead_letter_events")
			.select("*", { count: "exact", head: true })
			.eq("processing_status", "replayed");

		const count = quarantined?.length || 0;
		const oldest = quarantined && quarantined.length > 0 ? quarantined[0].created_at : null;
		let oldestAgeSeconds: number | null = null;
		if (oldest) {
			const ageMs = Date.now() - new Date(oldest).getTime();
			oldestAgeSeconds = Math.max(0, Math.floor(ageMs / 1000));
		}

		return {
			healthy: true,
			supabaseConnected: true,
			deadLetterTableExists: true,
			totalQuarantined: count,
			totalReplayed: replayedCount || 0,
			oldestQuarantinedAt: oldest,
			oldestAgeSeconds,
		};
	} catch (err: any) {
		return {
			healthy: false,
			supabaseConnected: false,
			deadLetterTableExists: false,
			totalQuarantined: 0,
			totalReplayed: 0,
			oldestQuarantinedAt: null,
			oldestAgeSeconds: null,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Replays a quarantined item via the Worker's authenticated administrative endpoint.
 * Strictly avoids calling Instagram API directly; re-enqueues only to the publishing queue.
 */
export async function triggerQuarantineReplay(
	workerBaseUrl: string,
	adminApiKey: string,
	target: { dlq_message_id?: string; post_id?: string; job_id?: string }
): Promise<{ success: boolean; status: number; data?: any; error?: string }> {
	if (!workerBaseUrl || !adminApiKey) {
		return {
			success: false,
			status: 400,
			error: "workerBaseUrl and adminApiKey are required",
		};
	}

	try {
		const endpoint = `${workerBaseUrl.replace(/\/$/, "")}/api/admin/quarantine/re-enqueue-dlq`;
		const res = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Admin-Key": adminApiKey,
			},
			body: JSON.stringify(target),
		});

		const text = await res.text();
		let data: any = {};
		try {
			data = JSON.parse(text);
		} catch {
			data = { raw: text };
		}

		return {
			success: res.ok,
			status: res.status,
			data,
			error: res.ok ? undefined : data.message || data.error || `HTTP ${res.status}`,
		};
	} catch (err: any) {
		return {
			success: false,
			status: 500,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * CLI runner
 */
if (typeof require !== "undefined" && require.main === module) {
	const args = process.argv.slice(2);
	const command = args[0] || "status";

	const envVars: Record<string, string | undefined> = { ...process.env };
	try {
		const fs = require("node:fs");
		const path = require("node:path");
		const devVarsPath = path.join(process.cwd(), ".dev.vars");
		if (fs.existsSync(devVarsPath)) {
			const content = fs.readFileSync(devVarsPath, "utf-8");
			for (const line of content.split("\n")) {
				const trimmed = line.trim();
				if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
					const eqIdx = trimmed.indexOf("=");
					const k = trimmed.slice(0, eqIdx).trim();
					const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
					if (!envVars[k]) {
						envVars[k] = v;
					}
				}
			}
		}
	} catch {
		// Ignore if .dev.vars is missing or inaccessible
	}

	const supabaseUrl = envVars.SUPABASE_URL || "";
	const supabaseKey = envVars.SUPABASE_SECRET_KEY || "";
	const workerUrl = envVars.WORKER_URL || "http://127.0.0.1:8787";
	const adminKey = envVars.ADMIN_API_KEY || "";

	console.log("================================================================================");
	console.log(`LAWBRIEFLY QUARANTINE RECOVERY TOOL - Command: [${command.toUpperCase()}]`);
	console.log("================================================================================");

	(async () => {
		if (command === "status") {
			console.log(`Checking Supabase connection and dead_letter_events...`);
			const status = await checkQuarantineStatus(supabaseUrl, supabaseKey);
			console.log(`Supabase Connected:    ${status.supabaseConnected ? "YES" : "NO"}`);
			console.log(`DLQ Table Exists:      ${status.deadLetterTableExists ? "YES" : "NO"}`);
			console.log(`Active Quarantined:    ${status.totalQuarantined}`);
			console.log(`Total Replayed:        ${status.totalReplayed}`);
			console.log(`Oldest Quarantined At: ${status.oldestQuarantinedAt || "None"}`);
			console.log(`Oldest Age (seconds):  ${status.oldestAgeSeconds !== null ? status.oldestAgeSeconds : "N/A"}`);
			if (status.error) {
				console.log(`Error:                 ${status.error}`);
			}
		} else if (command === "replay") {
			const targetId = args[1];
			if (!targetId) {
				console.error("Usage: npx tsx scripts/quarantine-recovery.ts replay <dlq_message_id_or_post_id>");
				process.exit(1);
			}

			console.log(`Replaying message '${targetId}' via Worker administrative endpoint...`);
			const res = await triggerQuarantineReplay(workerUrl, adminKey, {
				dlq_message_id: targetId,
				post_id: targetId,
			});

			console.log(`HTTP Status:  ${res.status}`);
			console.log(`Result:       ${res.success ? "SUCCESS" : "FAILED"}`);
			if (res.data) {
				console.log(`Payload:      ${JSON.stringify(res.data, null, 2)}`);
			}
			if (res.error) {
				console.log(`Error:        ${res.error}`);
			}
		} else {
			console.log("Available commands:");
			console.log("  status               - Check quarantine backlog and database status");
			console.log("  replay <message_id>  - Re-enqueue a quarantined message via admin endpoint");
		}
		console.log("================================================================================\n");
	})();
}

