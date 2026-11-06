-- Migration: 20261106000200_fix_distributed_lock_variable_conflict.sql
-- Description: Fixes PL/pgSQL ambiguous column reference "lock_name" in distributed lock RPCs by adding #variable_conflict use_column and targeting constraint explicitly.

-- 1. Atomic Lock Acquisition RPC (with #variable_conflict use_column)
create or replace function acquire_pipeline_run_lock(
    p_lock_name text,
    p_owner_run_id text,
    p_owner_token text,
    p_lease_duration_seconds integer default 180
)
returns table (
    acquired boolean,
    lock_name text,
    owner_run_id text,
    owner_token text,
    fencing_token bigint,
    lease_expires_at timestamptz,
    reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
    v_row pipeline_run_locks%rowtype;
    v_now timestamptz := clock_timestamp();
    v_lease_duration interval := (p_lease_duration_seconds || ' seconds')::interval;
begin
    -- 1. Ensure the lock row exists initially in an expired/unheld state if not already created
    insert into pipeline_run_locks (
        lock_name,
        owner_run_id,
        owner_token,
        fencing_token,
        acquired_at,
        heartbeat_at,
        lease_expires_at,
        updated_at
    )
    values (
        p_lock_name,
        'none',
        'none',
        0,
        v_now,
        v_now,
        v_now - interval '1 second',
        v_now
    )
    on conflict on constraint pipeline_run_locks_pkey do nothing;

    -- 2. Lock row for update to serialize concurrent acquisitions across transactions
    select * into v_row
    from pipeline_run_locks
    where pipeline_run_locks.lock_name = p_lock_name
    for update;

    -- 3. Check if currently held by another unexpired owner
    if v_row.lease_expires_at > v_now and v_row.owner_token <> p_owner_token then
        return query select
            false,
            v_row.lock_name,
            v_row.owner_run_id,
            v_row.owner_token,
            v_row.fencing_token,
            v_row.lease_expires_at,
            'lease_active'::text;
        return;
    end if;

    -- 4. Re-entrant acquisition by the same owner token (does not increment fencing_token)
    if v_row.owner_token = p_owner_token and v_row.lease_expires_at > v_now then
        update pipeline_run_locks
        set
            heartbeat_at = v_now,
            lease_expires_at = v_now + v_lease_duration,
            updated_at = v_now
        where pipeline_run_locks.lock_name = p_lock_name
        returning * into v_row;

        return query select
            true,
            v_row.lock_name,
            v_row.owner_run_id,
            v_row.owner_token,
            v_row.fencing_token,
            v_row.lease_expires_at,
            'reacquired_same_owner'::text;
        return;
    end if;

    -- 5. Acquisition of expired or newly initialized lock (transfers ownership, increments fencing_token)
    update pipeline_run_locks
    set
        owner_run_id = p_owner_run_id,
        owner_token = p_owner_token,
        fencing_token = v_row.fencing_token + 1,
        acquired_at = v_now,
        heartbeat_at = v_now,
        lease_expires_at = v_now + v_lease_duration,
        updated_at = v_now
    where pipeline_run_locks.lock_name = p_lock_name
    returning * into v_row;

    return query select
        true,
        v_row.lock_name,
        v_row.owner_run_id,
        v_row.owner_token,
        v_row.fencing_token,
        v_row.lease_expires_at,
        'acquired'::text;
    return;
end;
$$;

-- 2. Atomic Lock Renewal RPC (with #variable_conflict use_column)
create or replace function renew_pipeline_run_lock(
    p_lock_name text,
    p_owner_token text,
    p_fencing_token bigint,
    p_lease_duration_seconds integer default 180
)
returns table (
    renewed boolean,
    lock_name text,
    owner_run_id text,
    fencing_token bigint,
    lease_expires_at timestamptz,
    reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
    v_row pipeline_run_locks%rowtype;
    v_now timestamptz := clock_timestamp();
    v_lease_duration interval := (p_lease_duration_seconds || ' seconds')::interval;
begin
    -- Lock row for update
    select * into v_row
    from pipeline_run_locks
    where pipeline_run_locks.lock_name = p_lock_name
    for update;

    if not found then
        return query select false, p_lock_name, ''::text, 0::bigint, v_now, 'lock_not_found'::text;
        return;
    end if;

    -- Validate owner token
    if v_row.owner_token <> p_owner_token then
        return query select false, v_row.lock_name, v_row.owner_run_id, v_row.fencing_token, v_row.lease_expires_at, 'owner_mismatch'::text;
        return;
    end if;

    -- Validate fencing token
    if v_row.fencing_token <> p_fencing_token then
        return query select false, v_row.lock_name, v_row.owner_run_id, v_row.fencing_token, v_row.lease_expires_at, 'fencing_token_mismatch'::text;
        return;
    end if;

    -- Validate that lease has not already expired and been reclaimed
    if v_row.lease_expires_at <= v_now then
        return query select false, v_row.lock_name, v_row.owner_run_id, v_row.fencing_token, v_row.lease_expires_at, 'lease_expired'::text;
        return;
    end if;

    -- All validations passed -> extend lease
    update pipeline_run_locks
    set
        heartbeat_at = v_now,
        lease_expires_at = v_now + v_lease_duration,
        updated_at = v_now
    where pipeline_run_locks.lock_name = p_lock_name
    returning * into v_row;

    return query select true, v_row.lock_name, v_row.owner_run_id, v_row.fencing_token, v_row.lease_expires_at, 'renewed'::text;
    return;
end;
$$;

-- 3. Atomic Lock Release RPC (with #variable_conflict use_column)
create or replace function release_pipeline_run_lock(
    p_lock_name text,
    p_owner_token text,
    p_fencing_token bigint
)
returns table (
    released boolean,
    lock_name text,
    reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
    v_row pipeline_run_locks%rowtype;
    v_now timestamptz := clock_timestamp();
begin
    -- Lock row for update
    select * into v_row
    from pipeline_run_locks
    where pipeline_run_locks.lock_name = p_lock_name
    for update;

    if not found then
        return query select false, p_lock_name, 'lock_not_found'::text;
        return;
    end if;

    -- Stale owner protection: reject if owner token does not match
    if v_row.owner_token <> p_owner_token then
        return query select false, v_row.lock_name, 'owner_mismatch'::text;
        return;
    end if;

    -- Stale owner protection: reject if fencing token does not match
    if v_row.fencing_token <> p_fencing_token then
        return query select false, v_row.lock_name, 'fencing_token_mismatch'::text;
        return;
    end if;

    -- If already expired, release is a no-op success
    if v_row.lease_expires_at <= v_now then
        return query select true, v_row.lock_name, 'already_expired'::text;
        return;
    end if;

    -- Expire lease immediately to allow subsequent acquisitions
    update pipeline_run_locks
    set
        lease_expires_at = v_now,
        updated_at = v_now
    where pipeline_run_locks.lock_name = p_lock_name;

    return query select true, v_row.lock_name, 'released'::text;
    return;
end;
$$;

-- Security: Revoke public execution on all distributed lock RPCs, grant to service_role
revoke all on function acquire_pipeline_run_lock(text, text, text, integer) from public, anon, authenticated;
grant execute on function acquire_pipeline_run_lock(text, text, text, integer) to service_role;

revoke all on function renew_pipeline_run_lock(text, text, bigint, integer) from public, anon, authenticated;
grant execute on function renew_pipeline_run_lock(text, text, bigint, integer) to service_role;

revoke all on function release_pipeline_run_lock(text, text, bigint) from public, anon, authenticated;
grant execute on function release_pipeline_run_lock(text, text, bigint) to service_role;

