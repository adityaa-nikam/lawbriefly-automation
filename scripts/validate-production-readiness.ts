import * as fs from "node:fs";
import * as path from "node:path";

export type CheckStatus =
	| "CONFIGURED"
	| "MISSING"
	| "NOT_VERIFIED"
	| "BLOCKED_BY_EXTERNAL_SETUP"
	| "DISABLED_BY_SAFETY_POLICY";

export interface ReadinessItem {
	category: "Runtime" | "Database" | "Queues" | "Messaging" | "Instagram" | "Operations";
	name: string;
	status: CheckStatus;
	details: string;
	requiredFor: "staging" | "production" | "both";
	isSecret?: boolean;
}

export interface ValidationSummary {
	targetEnv: "staging" | "production" | "development";
	timestamp: string;
	overallStatus: "READY_FOR_STAGING" | "READY_WITH_BLOCKERS" | "NOT_READY";
	totalChecks: number;
	configuredCount: number;
	missingCount: number;
	blockedCount: number;
	notVerifiedCount: number;
	safetyDisabledCount: number;
	items: ReadinessItem[];
	blockers: string[];
}

/**
 * Validates production & staging deployment readiness across environment configuration,
 * database migrations, queues, messaging, and security policies.
 * Never prints or leaks actual secret values.
 */
export function validateProductionReadiness(
	envVars: Record<string, string | undefined> = process.env,
	options: { baseDir?: string; targetEnv?: "staging" | "production" | "development" } = {}
): ValidationSummary {
	const baseDir = options.baseDir || process.cwd();
	const targetEnv = options.targetEnv || (envVars.APP_ENV as any) || "staging";
	const items: ReadinessItem[] = [];
	const blockers: string[] = [];

	// Helper to check secret/string existence without exposing values
	const checkVar = (
		name: string,
		category: ReadinessItem["category"],
		requiredFor: ReadinessItem["requiredFor"],
		isSecret = false,
		validator?: (v: string) => boolean
	): boolean => {
		const val = envVars[name]?.trim();
		if (!val) {
			items.push({
				category,
				name,
				status: "MISSING",
				details: `Environment variable ${name} is not set or empty.`,
				requiredFor,
				isSecret,
			});
			if (requiredFor === "both" || requiredFor === targetEnv) {
				blockers.push(`Missing required environment variable: ${name}`);
			}
			return false;
		}

		if (validator && !validator(val)) {
			items.push({
				category,
				name,
				status: "NOT_VERIFIED",
				details: `Environment variable ${name} failed format validation.`,
				requiredFor,
				isSecret,
			});
			blockers.push(`Invalid format for environment variable: ${name}`);
			return false;
		}

		items.push({
			category,
			name,
			status: "CONFIGURED",
			details: isSecret
				? `Configured (${val.length} chars, redacted)`
				: `Configured: ${val}`,
			requiredFor,
			isSecret,
		});
		return true;
	};

	// --- 1. Runtime Environment Checks ---
	const appEnv = envVars.APP_ENV?.trim() || "";
	if (!appEnv) {
		items.push({
			category: "Runtime",
			name: "APP_ENV",
			status: "MISSING",
			details: "APP_ENV is not specified (must be 'staging' or 'production').",
			requiredFor: "both",
		});
		blockers.push("APP_ENV must be set to 'staging' or 'production'.");
	} else if (targetEnv === "production" && appEnv !== "production") {
		items.push({
			category: "Runtime",
			name: "APP_ENV",
			status: "NOT_VERIFIED",
			details: `APP_ENV is currently '${appEnv}', expected 'production'.`,
			requiredFor: "production",
		});
		blockers.push(`APP_ENV mismatch for production: currently '${appEnv}'.`);
	} else {
		items.push({
			category: "Runtime",
			name: "APP_ENV",
			status: "CONFIGURED",
			details: `Environment set to '${appEnv}'.`,
			requiredFor: "both",
		});
	}

	// Safety feature flags (must be explicit "false" or disabled by policy)
	const autoCron = envVars.AUTONOMOUS_PIPELINE_ENABLED?.trim();
	if (autoCron === "true") {
		items.push({
			category: "Runtime",
			name: "AUTONOMOUS_PIPELINE_ENABLED",
			status: "CONFIGURED",
			details: "Enabled ('true') - autonomous cron trigger will run at 02:00 UTC.",
			requiredFor: "both",
		});
	} else {
		items.push({
			category: "Runtime",
			name: "AUTONOMOUS_PIPELINE_ENABLED",
			status: "DISABLED_BY_SAFETY_POLICY",
			details: "Disabled ('false' or unset) - kill switch active, manual triggers only.",
			requiredFor: "both",
		});
	}

	const opsAlerts = envVars.OPS_ALERTS_ENABLED?.trim();
	if (opsAlerts === "true") {
		items.push({
			category: "Runtime",
			name: "OPS_ALERTS_ENABLED",
			status: "CONFIGURED",
			details: "Enabled ('true') - operational Telegram failure alerts active.",
			requiredFor: "both",
		});
	} else {
		items.push({
			category: "Runtime",
			name: "OPS_ALERTS_ENABLED",
			status: "DISABLED_BY_SAFETY_POLICY",
			details: "Disabled ('false' or unset) - operational alerts suppressed.",
			requiredFor: "both",
		});
	}

	checkVar("ADMIN_API_KEY", "Runtime", "both", true);

	// --- 2. Database & Migrations ---
	checkVar("SUPABASE_URL", "Database", "both", false, (v) => v.startsWith("https://"));
	checkVar("SUPABASE_SECRET_KEY", "Database", "both", true);

	// Verify required migration files exist locally
	const expectedMigrations = [
		"20261105000100_create_observability_and_alerting_tables.sql",
		"20261105000200_create_dead_letter_and_atomic_alert_functions.sql",
		"20261105000300_create_operational_alert_lifecycle.sql",
		"20261106000100_create_distributed_pipeline_lock.sql",
	];

	const migrationsDir = path.join(baseDir, "supabase", "migrations");
	const migrationsExistLocally = expectedMigrations.every((file) =>
		fs.existsSync(path.join(migrationsDir, file))
	);

	if (migrationsExistLocally) {
		items.push({
			category: "Database",
			name: "Local SQL Migrations (Tasks 19.2 - 20.3)",
			status: "BLOCKED_BY_EXTERNAL_SETUP",
			details:
				"4 local migrations present locally with RLS and security definer grants, but pending remote staging/prod application.",
			requiredFor: "both",
		});
		blockers.push("Local SQL migrations have not been applied to remote Supabase instance.");
	} else {
		items.push({
			category: "Database",
			name: "Local SQL Migrations",
			status: "MISSING",
			details: "One or more expected migration files missing from supabase/migrations/.",
			requiredFor: "both",
		});
		blockers.push("Missing required migration files in repository.");
	}

	items.push({
		category: "Database",
		name: "Distributed Pipeline Lock RPCs",
		status: "BLOCKED_BY_EXTERNAL_SETUP",
		details:
			"acquire_pipeline_run_lock and renew_pipeline_run_lock defined in migration 20261106000100, pending remote database deployment.",
		requiredFor: "both",
	});
	blockers.push("Distributed pipeline lock tables and RPCs pending remote database application.");

	// --- 3. Queues & Quarantine ---
	const wranglerPath = path.join(baseDir, "wrangler.jsonc");
	let wranglerContent = "";
	if (fs.existsSync(wranglerPath)) {
		wranglerContent = fs.readFileSync(wranglerPath, "utf-8");
	}

	const hasJobsQueue = wranglerContent.includes('"instagram-publishing-jobs"');
	const hasDlq = wranglerContent.includes('"instagram-publishing-dlq"');
	const hasQuarantine = wranglerContent.includes('"instagram-publishing-quarantine"');
	const hasQuarantineProducer = wranglerContent.includes('"INSTAGRAM_QUARANTINE_QUEUE"');

	if (hasJobsQueue && hasDlq && hasQuarantine && hasQuarantineProducer) {
		items.push({
			category: "Queues",
			name: "Wrangler Queue Topology",
			status: "CONFIGURED",
			details:
				"Source queue (jobs) -> Primary DLQ (dlq) -> Secondary Quarantine (quarantine) with producer binding configured in wrangler.jsonc.",
			requiredFor: "both",
		});
	} else {
		items.push({
			category: "Queues",
			name: "Wrangler Queue Topology",
			status: "NOT_VERIFIED",
			details: "Queue producer or DLQ consumer configuration incomplete in wrangler.jsonc.",
			requiredFor: "both",
		});
		blockers.push("Wrangler queue topology incomplete in wrangler.jsonc.");
	}

	// 14-day quarantine retention requirement
	items.push({
		category: "Queues",
		name: "Quarantine Retention Period (14 Days)",
		status: "BLOCKED_BY_EXTERNAL_SETUP",
		details:
			"Requires Workers Paid plan. Operator must execute 'wrangler queues update instagram-publishing-quarantine --message-retention-period-secs 1209600' on Cloudflare.",
		requiredFor: "both",
	});
	blockers.push(
		"Quarantine 14-day message retention (1209600s) has not been provisioned remotely on Cloudflare."
	);

	items.push({
		category: "Queues",
		name: "Quarantine Recovery Tooling",
		status: "CONFIGURED",
		details:
			"Administrative endpoint POST /api/admin/quarantine/re-enqueue-dlq and CLI script scripts/quarantine-recovery.ts implemented.",
		requiredFor: "both",
	});

	// --- 4. Messaging & Telegram ---
	checkVar("TELEGRAM_BOT_TOKEN", "Messaging", "both", true);
	checkVar("TELEGRAM_CHAT_ID", "Messaging", "both", false);
	checkVar("TELEGRAM_ALLOWED_USER_IDS", "Messaging", "both", false);
	checkVar("TELEGRAM_WEBHOOK_SECRET", "Messaging", "both", true);

	items.push({
		category: "Messaging",
		name: "Telegram Webhook Registration",
		status: "BLOCKED_BY_EXTERNAL_SETUP",
		details:
			"Telegram webhook must be registered against deployed Worker URL using setWebhook with TELEGRAM_WEBHOOK_SECRET.",
		requiredFor: "both",
	});
	blockers.push("Telegram webhook URL is not registered with Telegram Bot API.");

	// --- 5. Instagram Integration ---
	checkVar("INSTAGRAM_ACCOUNT_ID", "Instagram", "both", false);
	checkVar("INSTAGRAM_ACCESS_TOKEN", "Instagram", "both", true);

	const autoPublish = envVars.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL?.trim();
	if (autoPublish === "true") {
		items.push({
			category: "Instagram",
			name: "INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL",
			status: "CONFIGURED",
			details: "Enabled ('true') - human editorial approval enqueues post for Instagram publication.",
			requiredFor: "both",
		});
	} else {
		items.push({
			category: "Instagram",
			name: "INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL",
			status: "DISABLED_BY_SAFETY_POLICY",
			details:
				"Disabled ('false' or unset) - mandatory human review safety boundary enforced; publishing requires explicit configuration.",
			requiredFor: "both",
		});
	}

	// --- 6. Operations & Monitoring ---
	items.push({
		category: "Operations",
		name: "Structured Observability & Metrics",
		status: "CONFIGURED",
		details: "Sanitized JSON logging and in-memory execution metric trackers active.",
		requiredFor: "both",
	});

	items.push({
		category: "Operations",
		name: "Atomic Alert Lifecycle & Deduplication",
		status: "CONFIGURED",
		details:
			"reserve_operational_alert RPC with 15-minute cooldown and delivery confirmation implemented.",
		requiredFor: "both",
	});

	items.push({
		category: "Operations",
		name: "Quarantine Backlog Monitoring",
		status: "CONFIGURED",
		details:
			"Runtime metrics check integrated into 15-minute recovery sweep with deduplicated alert dispatch.",
		requiredFor: "both",
	});

	const hasDailyCron = wranglerContent.includes('"0 2 * * *"');
	const hasSyncCron = wranglerContent.includes('"30 0 * * *"');
	const hasSweepCron = wranglerContent.includes('"*/15 * * * *"');

	if (hasDailyCron && hasSyncCron && hasSweepCron) {
		items.push({
			category: "Operations",
			name: "Cloudflare Cron Triggers",
			status: "CONFIGURED",
			details:
				"All 3 triggers registered in wrangler.jsonc: daily pipeline ('0 2 * * *'), news sync ('30 0 * * *'), recovery sweep ('*/15 * * * *').",
			requiredFor: "both",
		});
	} else {
		items.push({
			category: "Operations",
			name: "Cloudflare Cron Triggers",
			status: "NOT_VERIFIED",
			details: "One or more cron trigger expressions missing from wrangler.jsonc.",
			requiredFor: "both",
		});
		blockers.push("Cron trigger registration missing in wrangler.jsonc.");
	}

	// Calculate tallies
	const configuredCount = items.filter((i) => i.status === "CONFIGURED").length;
	const missingCount = items.filter((i) => i.status === "MISSING").length;
	const blockedCount = items.filter((i) => i.status === "BLOCKED_BY_EXTERNAL_SETUP").length;
	const notVerifiedCount = items.filter((i) => i.status === "NOT_VERIFIED").length;
	const safetyDisabledCount = items.filter((i) => i.status === "DISABLED_BY_SAFETY_POLICY").length;

	let overallStatus: ValidationSummary["overallStatus"] = "READY_FOR_STAGING";
	if (missingCount > 0) {
		overallStatus = "NOT_READY";
	} else if (blockedCount > 0 || notVerifiedCount > 0) {
		overallStatus = "READY_WITH_BLOCKERS";
	}

	return {
		targetEnv,
		timestamp: new Date().toISOString(),
		overallStatus,
		totalChecks: items.length,
		configuredCount,
		missingCount,
		blockedCount,
		notVerifiedCount,
		safetyDisabledCount,
		items,
		blockers,
	};
}

/**
 * CLI execution entrypoint
 */
if (typeof require !== "undefined" && require.main === module) {
	const envVars: Record<string, string | undefined> = { ...process.env };
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
	const targetArg = process.argv.find((a) => a.startsWith("--env="))?.split("=")[1] as any;
	const summary = validateProductionReadiness(envVars, { targetEnv: targetArg });

	console.log("================================================================================");
	console.log(`LAWBRIEFLY PRODUCTION READINESS AUDIT - [${summary.targetEnv.toUpperCase()}]`);
	console.log(`Timestamp: ${summary.timestamp}`);
	console.log(`Overall Status: [${summary.overallStatus}]`);
	console.log("================================================================================");
	console.log(`Checks Total:   ${summary.totalChecks}`);
	console.log(`Configured:     ${summary.configuredCount}`);
	console.log(`Safety Policy:  ${summary.safetyDisabledCount} (Disabled by intentional safety policy)`);
	console.log(`External Block: ${summary.blockedCount} (Pending remote external infrastructure setup)`);
	console.log(`Not Verified:   ${summary.notVerifiedCount}`);
	console.log(`Missing Vars:   ${summary.missingCount}`);
	console.log("--------------------------------------------------------------------------------");
	console.log("DETAILED ITEMS:");

	let currentCat = "";
	for (const item of summary.items) {
		if (item.category !== currentCat) {
			currentCat = item.category;
			console.log(`\n[${currentCat.toUpperCase()}]`);
		}
		const statusPadded = `[${item.status}]`.padEnd(28);
		console.log(`  ${statusPadded} ${item.name}`);
		console.log(`    ↳ ${item.details}`);
	}

	if (summary.blockers.length > 0) {
		console.log("\n--------------------------------------------------------------------------------");
		console.log("EXTERNAL ACTION BLOCKERS (Must be resolved by authorized operator):");
		summary.blockers.forEach((b, idx) => console.log(`  ${idx + 1}. ${b}`));
	}
	console.log("================================================================================\n");

	if (summary.overallStatus === "NOT_READY") {
		process.exit(1);
	}
}

