import type { Env } from "../index";
import { getSupabaseClient } from "./supabase";

export const DEFAULT_PIPELINE_LOCK_NAME = "global_content_pipeline";
export const DEFAULT_LEASE_DURATION_SECONDS = 180; // 3-minute lease boundary

export interface AcquireLockParams {
	lockName?: string;
	ownerRunId: string;
	ownerToken: string;
	leaseDurationSeconds?: number;
}

export interface AcquireLockResult {
	success: boolean;
	lockName: string;
	ownerRunId: string;
	ownerToken: string;
	fencingToken: number;
	leaseExpiresAt: string;
	reason: "acquired" | "reacquired_same_owner" | "lease_active" | "lock_unavailable";
	error?: string;
}

export interface RenewLockParams {
	lockName?: string;
	ownerToken: string;
	fencingToken: number;
	leaseDurationSeconds?: number;
}

export interface RenewLockResult {
	renewed: boolean;
	lockName: string;
	fencingToken: number;
	leaseExpiresAt?: string;
	reason:
		| "renewed"
		| "lock_not_found"
		| "owner_mismatch"
		| "fencing_token_mismatch"
		| "lease_expired"
		| "lock_unavailable";
	error?: string;
}

export interface ReleaseLockParams {
	lockName?: string;
	ownerToken: string;
	fencingToken: number;
}

export interface ReleaseLockResult {
	released: boolean;
	lockName: string;
	reason:
		| "released"
		| "already_expired"
		| "lock_not_found"
		| "owner_mismatch"
		| "fencing_token_mismatch"
		| "lock_unavailable";
	error?: string;
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
	let timer: any;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
	});
	try {
		return await Promise.race([Promise.resolve(promise), timeoutPromise]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Atomically acquires the distributed pipeline lock via Supabase PostgreSQL RPC acquire_pipeline_run_lock.
 * Fails closed if Supabase credentials are not configured or if the RPC call fails.
 */
export async function acquireDistributedPipelineLock(
	env: Env,
	params: AcquireLockParams
): Promise<AcquireLockResult> {
	const lockName = params.lockName || DEFAULT_PIPELINE_LOCK_NAME;
	const leaseSecs = params.leaseDurationSeconds || DEFAULT_LEASE_DURATION_SECONDS;

	if (!env || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
		return {
			success: false,
			lockName,
			ownerRunId: params.ownerRunId,
			ownerToken: params.ownerToken,
			fencingToken: 0,
			leaseExpiresAt: new Date(0).toISOString(),
			reason: "lock_unavailable",
			error: "Supabase configuration is missing",
		};
	}

	try {
		const supabase = getSupabaseClient(env);
		const { data, error } = (await withTimeout(
			supabase.rpc("acquire_pipeline_run_lock", {
				p_lock_name: lockName,
				p_owner_run_id: params.ownerRunId,
				p_owner_token: params.ownerToken,
				p_lease_duration_seconds: leaseSecs,
			}),
			5000
		)) as any;

		if (error || !data) {
			return {
				success: false,
				lockName,
				ownerRunId: params.ownerRunId,
				ownerToken: params.ownerToken,
				fencingToken: 0,
				leaseExpiresAt: new Date(0).toISOString(),
				reason: "lock_unavailable",
				error: error ? error.message : "No data returned from acquire_pipeline_run_lock",
			};
		}

		const row = Array.isArray(data) ? data[0] : data;
		const acquired = Boolean(row.acquired ?? row.claimed ?? row.reserved);
		const fencingToken = typeof row.fencing_token === "number" ? row.fencing_token : Number(row.fencing_token || 1);

		return {
			success: acquired,
			lockName: row.lock_name || lockName,
			ownerRunId: row.owner_run_id || params.ownerRunId,
			ownerToken: row.owner_token || params.ownerToken,
			fencingToken,
			leaseExpiresAt: row.lease_expires_at || new Date().toISOString(),
			reason: row.reason || (acquired ? "acquired" : "lease_active"),
		};
	} catch (err: any) {
		return {
			success: false,
			lockName,
			ownerRunId: params.ownerRunId,
			ownerToken: params.ownerToken,
			fencingToken: 0,
			leaseExpiresAt: new Date(0).toISOString(),
			reason: "lock_unavailable",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Renews an actively held distributed pipeline lock via Supabase PostgreSQL RPC renew_pipeline_run_lock.
 * Rejects stale, expired, or mismatched owners.
 */
export async function renewDistributedPipelineLock(
	env: Env,
	params: RenewLockParams
): Promise<RenewLockResult> {
	const lockName = params.lockName || DEFAULT_PIPELINE_LOCK_NAME;
	const leaseSecs = params.leaseDurationSeconds || DEFAULT_LEASE_DURATION_SECONDS;

	if (!env || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
		return {
			renewed: false,
			lockName,
			fencingToken: params.fencingToken,
			reason: "lock_unavailable",
			error: "Supabase configuration is missing",
		};
	}

	try {
		const supabase = getSupabaseClient(env);
		const { data, error } = (await withTimeout(
			supabase.rpc("renew_pipeline_run_lock", {
				p_lock_name: lockName,
				p_owner_token: params.ownerToken,
				p_fencing_token: params.fencingToken,
				p_lease_duration_seconds: leaseSecs,
			}),
			5000
		)) as any;

		if (error || !data) {
			return {
				renewed: false,
				lockName,
				fencingToken: params.fencingToken,
				reason: "lock_unavailable",
				error: error ? error.message : "No data returned from renew_pipeline_run_lock",
			};
		}

		const row = Array.isArray(data) ? data[0] : data;
		const renewed = Boolean(row.renewed);
		const fencingToken = typeof row.fencing_token === "number" ? row.fencing_token : Number(row.fencing_token || params.fencingToken);

		return {
			renewed,
			lockName: row.lock_name || lockName,
			fencingToken,
			leaseExpiresAt: row.lease_expires_at,
			reason: row.reason || (renewed ? "renewed" : "lock_unavailable"),
		};
	} catch (err: any) {
		return {
			renewed: false,
			lockName,
			fencingToken: params.fencingToken,
			reason: "lock_unavailable",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Releases an actively held distributed pipeline lock via Supabase PostgreSQL RPC release_pipeline_run_lock.
 * Strictly verifies owner token and fencing token before expiring the lease.
 */
export async function releaseDistributedPipelineLock(
	env: Env,
	params: ReleaseLockParams
): Promise<ReleaseLockResult> {
	const lockName = params.lockName || DEFAULT_PIPELINE_LOCK_NAME;

	if (!env || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
		return {
			released: false,
			lockName,
			reason: "lock_unavailable",
			error: "Supabase configuration is missing",
		};
	}

	try {
		const supabase = getSupabaseClient(env);
		const { data, error } = (await withTimeout(
			supabase.rpc("release_pipeline_run_lock", {
				p_lock_name: lockName,
				p_owner_token: params.ownerToken,
				p_fencing_token: params.fencingToken,
			}),
			5000
		)) as any;

		if (error || !data) {
			return {
				released: false,
				lockName,
				reason: "lock_unavailable",
				error: error ? error.message : "No data returned from release_pipeline_run_lock",
			};
		}

		const row = Array.isArray(data) ? data[0] : data;
		const released = Boolean(row.released);

		return {
			released,
			lockName: row.lock_name || lockName,
			reason: row.reason || (released ? "released" : "lock_unavailable"),
		};
	} catch (err: any) {
		return {
			released: false,
			lockName,
			reason: "lock_unavailable",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
