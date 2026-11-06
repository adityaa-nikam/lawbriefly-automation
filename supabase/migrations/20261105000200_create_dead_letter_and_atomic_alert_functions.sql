-- Migration: 20261105000200_create_dead_letter_and_atomic_alert_functions.sql
-- Description: Creates persistent dead_letter_events table and atomic alert deduplication function (Task 20.1).

-- 1. Dead Letter Events Table (Durable DLQ Retention)
create table if not exists dead_letter_events (
    id uuid primary key default gen_random_uuid(),
    dlq_message_id text not null,
    source_queue text not null default 'instagram-publishing-jobs',
    timestamp_received timestamptz not null default now(),
    post_id uuid references social_content_posts(id) on delete set null,
    job_id text,
    failure_category text not null default 'MAX_RETRIES_EXHAUSTED',
    processing_status text not null default 'quarantined', -- 'quarantined', 'replayed', 'discarded'
    attempts integer not null default 1,
    payload jsonb not null default '{}'::jsonb,
    error_message text,
    created_at timestamptz not null default now(),
    constraint uq_dead_letter_events_dlq_message_id unique (dlq_message_id)
);

create index if not exists idx_dead_letter_events_post_id on dead_letter_events(post_id);
create index if not exists idx_dead_letter_events_created_at on dead_letter_events(created_at desc);
create index if not exists idx_dead_letter_events_status on dead_letter_events(processing_status);

-- Enable RLS on dead_letter_events
alter table dead_letter_events enable row level security;
create policy "Service role manages dead_letter_events"
    on dead_letter_events for all to service_role using (true) with check (true);

-- 2. Atomic Operational Alert Claim Function
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
    v_row operational_alert_dedup%rowtype;
    v_now timestamptz := clock_timestamp();
    v_cooldown interval := (p_cooldown_seconds || ' seconds')::interval;
    v_diff interval;
begin
    -- Atomic upsert:
    -- If key is new: insert with current timestamp and alert_count = 1.
    -- If key exists and cooldown elapsed: update last_alerted_at to v_now and increment alert_count.
    -- If key exists and within cooldown: retain existing last_alerted_at, increment alert_count.
    insert into operational_alert_dedup (dedup_key, last_alerted_at, alert_count, incident_metadata)
    values (p_dedup_key, v_now, 1, p_incident_metadata)
    on conflict (dedup_key) do update
    set
        last_alerted_at = case
            when operational_alert_dedup.last_alerted_at <= v_now - v_cooldown then v_now
            else operational_alert_dedup.last_alerted_at
        end,
        alert_count = operational_alert_dedup.alert_count + 1,
        incident_metadata = case
            when operational_alert_dedup.last_alerted_at <= v_now - v_cooldown then p_incident_metadata
            else operational_alert_dedup.incident_metadata
        end
    returning * into v_row;

    if v_row.last_alerted_at = v_now then
        return query select true, v_row.last_alerted_at, v_row.alert_count, 0;
    else
        v_diff := (v_row.last_alerted_at + v_cooldown) - v_now;
        return query select false, v_row.last_alerted_at, v_row.alert_count, greatest(0, extract(epoch from v_diff)::integer);
    end if;
end;
$$;

-- Security: Revoke public execution, restrict to service_role
revoke all on function claim_operational_alert(text, integer, jsonb) from public, anon, authenticated;
grant execute on function claim_operational_alert(text, integer, jsonb) to service_role;


