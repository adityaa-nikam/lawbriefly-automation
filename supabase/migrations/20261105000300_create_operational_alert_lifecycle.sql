-- Migration: 20261105000300_create_operational_alert_lifecycle.sql
-- Description: Upgrades operational_alert_dedup to support full incident-alert lifecycle
-- (pending, sent, failed, suppressed) to prevent alert failures from consuming cooldown (Task 20.2).

-- 1. Alter operational_alert_dedup to add delivery lifecycle tracking columns
alter table operational_alert_dedup
    add column if not exists delivery_status text not null default 'pending',
    add column if not exists reserved_at timestamptz not null default now(),
    add column if not exists failure_count integer not null default 0,
    add column if not exists last_failed_at timestamptz,
    add column if not exists last_error text;

-- 2. Index for lifecycle queries
create index if not exists idx_operational_alert_dedup_status on operational_alert_dedup(delivery_status, reserved_at);

-- 3. Atomic Alert Reservation RPC
-- Reserves an alert claim without starting the full cooldown until delivery is confirmed.
create or replace function reserve_operational_alert(
    p_dedup_key text,
    p_cooldown_seconds integer default 900,
    p_reservation_ttl_seconds integer default 60,
    p_retry_backoff_seconds integer default 30,
    p_incident_metadata jsonb default '{}'::jsonb
)
returns table (
    reserved boolean,
    delivery_status text,
    alert_count integer,
    cooldown_remaining_seconds integer,
    reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_row operational_alert_dedup%rowtype;
    v_now timestamptz := clock_timestamp();
    v_cooldown interval := (p_cooldown_seconds || ' seconds')::interval;
    v_res_ttl interval := (p_reservation_ttl_seconds || ' seconds')::interval;
    v_retry_backoff interval := (p_retry_backoff_seconds || ' seconds')::interval;
    v_diff interval;
begin
    -- 1. Insert new key if not present
    insert into operational_alert_dedup (
        dedup_key,
        delivery_status,
        reserved_at,
        last_alerted_at,
        alert_count,
        failure_count,
        incident_metadata
    )
    values (
        p_dedup_key,
        'pending',
        v_now,
        null,
        1,
        0,
        p_incident_metadata
    )
    on conflict (dedup_key) do update
    set
        delivery_status = case
            -- Case A: Successfully sent previously, cooldown expired -> re-reserve as pending
            when operational_alert_dedup.delivery_status = 'sent'
                 and operational_alert_dedup.last_alerted_at <= v_now - v_cooldown then 'pending'
            -- Case B: Stale pending reservation (> TTL) -> reclaim as pending
            when operational_alert_dedup.delivery_status = 'pending'
                 and operational_alert_dedup.reserved_at <= v_now - v_res_ttl then 'pending'
            -- Case C: Delivery failed previously, backoff elapsed (< 5 retries) -> retry as pending
            when operational_alert_dedup.delivery_status = 'failed'
                 and (operational_alert_dedup.last_failed_at is null or operational_alert_dedup.last_failed_at <= v_now - v_retry_backoff)
                 and operational_alert_dedup.failure_count < 5 then 'pending'
            -- Otherwise keep existing status
            else operational_alert_dedup.delivery_status
        end,
        reserved_at = case
            when (operational_alert_dedup.delivery_status = 'sent' and operational_alert_dedup.last_alerted_at <= v_now - v_cooldown)
              or (operational_alert_dedup.delivery_status = 'pending' and operational_alert_dedup.reserved_at <= v_now - v_res_ttl)
              or (operational_alert_dedup.delivery_status = 'failed' and (operational_alert_dedup.last_failed_at is null or operational_alert_dedup.last_failed_at <= v_now - v_retry_backoff) and operational_alert_dedup.failure_count < 5)
            then v_now
            else operational_alert_dedup.reserved_at
        end,
        alert_count = operational_alert_dedup.alert_count + 1,
        incident_metadata = case
            when (operational_alert_dedup.delivery_status = 'sent' and operational_alert_dedup.last_alerted_at <= v_now - v_cooldown)
              or (operational_alert_dedup.delivery_status = 'pending' and operational_alert_dedup.reserved_at <= v_now - v_res_ttl)
              or (operational_alert_dedup.delivery_status = 'failed' and (operational_alert_dedup.last_failed_at is null or operational_alert_dedup.last_failed_at <= v_now - v_retry_backoff) and operational_alert_dedup.failure_count < 5)
            then p_incident_metadata
            else operational_alert_dedup.incident_metadata
        end
    returning * into v_row;

    -- Evaluate outcome based on row state
    if v_row.delivery_status = 'pending' and v_row.reserved_at = v_now then
        return query select true, 'pending'::text, v_row.alert_count, 0, 'reserved'::text;
    elsif v_row.delivery_status = 'sent' then
        v_diff := (v_row.last_alerted_at + v_cooldown) - v_now;
        return query select false, 'suppressed'::text, v_row.alert_count, greatest(0, extract(epoch from v_diff)::integer), 'cooldown_active'::text;
    elsif v_row.delivery_status = 'pending' then
        v_diff := (v_row.reserved_at + v_res_ttl) - v_now;
        return query select false, 'suppressed'::text, v_row.alert_count, greatest(0, extract(epoch from v_diff)::integer), 'pending_in_progress'::text;
    elsif v_row.delivery_status = 'failed' and v_row.failure_count >= 5 then
        return query select false, 'suppressed'::text, v_row.alert_count, 0, 'max_failures_exceeded'::text;
    else
        v_diff := (v_row.last_failed_at + v_retry_backoff) - v_now;
        return query select false, 'suppressed'::text, v_row.alert_count, greatest(0, extract(epoch from v_diff)::integer), 'retry_backoff_active'::text;
    end if;
end;
$$;

-- 4. Confirm Alert Sent RPC
-- Sets status to 'sent' and starts the 15-minute cooldown.
create or replace function confirm_operational_alert_sent(
    p_dedup_key text,
    p_incident_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    update operational_alert_dedup
    set
        delivery_status = 'sent',
        last_alerted_at = clock_timestamp(),
        failure_count = 0,
        last_error = null,
        incident_metadata = case
            when p_incident_metadata <> '{}'::jsonb then p_incident_metadata
            else incident_metadata
        end
    where dedup_key = p_dedup_key;

    return found;
end;
$$;

-- 5. Record Alert Failed RPC
-- Sets status to 'failed' without advancing last_alerted_at, allowing controlled retry.
create or replace function record_operational_alert_failed(
    p_dedup_key text,
    p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    update operational_alert_dedup
    set
        delivery_status = 'failed',
        last_failed_at = clock_timestamp(),
        failure_count = failure_count + 1,
        last_error = p_error_message
    where dedup_key = p_dedup_key;

    return found;
end;
$$;

-- 6. Backwards-compatible claim_operational_alert wrapper
create or replace function claim_operational_alert(
    p_dedup_key text,
    p_cooldown_seconds integer default 900,
    p_incident_metadata jsonb default '{}'::jsonb
)
returns table (
    claimed boolean,
    last_alerted_at timestamptz,
    alert_count integer,
    cooldown_remaining_seconds integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_res record;
begin
    select * into v_res from reserve_operational_alert(p_dedup_key, p_cooldown_seconds, 60, 30, p_incident_metadata);
    return query select v_res.reserved, clock_timestamp(), v_res.alert_count, v_res.cooldown_remaining_seconds;
end;
$$;

-- Security: Revoke public execution on all operational alert RPCs, grant to service_role
revoke all on function reserve_operational_alert(text, integer, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function reserve_operational_alert(text, integer, integer, integer, jsonb) to service_role;

revoke all on function confirm_operational_alert_sent(text, jsonb) from public, anon, authenticated;
grant execute on function confirm_operational_alert_sent(text, jsonb) to service_role;

revoke all on function record_operational_alert_failed(text, text) from public, anon, authenticated;
grant execute on function record_operational_alert_failed(text, text) to service_role;

revoke all on function claim_operational_alert(text, integer, jsonb) from public, anon, authenticated;
grant execute on function claim_operational_alert(text, integer, jsonb) to service_role;


