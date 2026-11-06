-- Migration: 20261105000100_create_observability_and_alerting_tables.sql
-- Description: Creates persistent tables for pipeline run metrics, stage-level execution events, and operational alert deduplication (Task 20).

-- 1. Pipeline Execution Runs Table
create table if not exists pipeline_runs (
    run_id text primary key,
    trigger_type text not null default 'manual',
    cron_expression text,
    status text not null, -- 'completed', 'failed', 'concurrency_conflict', 'no_strong_topic'
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    duration_ms integer,
    failed_stage text,
    error_code text,
    error_message text,
    post_id uuid references social_content_posts(id) on delete set null,
    created_at timestamptz not null default now()
);

-- Indexes for pipeline_runs queries
create index if not exists idx_pipeline_runs_created_at on pipeline_runs(created_at desc);
create index if not exists idx_pipeline_runs_status on pipeline_runs(status);

-- 2. Pipeline Stage Execution Events Table
create table if not exists pipeline_stage_events (
    id uuid primary key default gen_random_uuid(),
    run_id text not null references pipeline_runs(run_id) on delete cascade,
    stage text not null,
    status text not null, -- 'started', 'completed', 'failed'
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    duration_ms integer,
    error_code text,
    error_message text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- Indexes for stage events
create index if not exists idx_pipeline_stage_events_run_id on pipeline_stage_events(run_id);
create index if not exists idx_pipeline_stage_events_stage on pipeline_stage_events(stage);

-- 3. Operational Alert Deduplication Table
create table if not exists operational_alert_dedup (
    dedup_key text primary key,
    last_alerted_at timestamptz not null default now(),
    alert_count integer not null default 1,
    incident_metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_operational_alert_dedup_last_alerted on operational_alert_dedup(last_alerted_at desc);

-- 4. Enable Row Level Security (RLS) on all observability tables
alter table pipeline_runs enable row level security;
alter table pipeline_stage_events enable row level security;
alter table operational_alert_dedup enable row level security;

-- 5. RLS Policies: Restrict access strictly to service_role (backend worker)
create policy "Service role manages pipeline_runs"
    on pipeline_runs for all to service_role using (true) with check (true);

create policy "Service role manages pipeline_stage_events"
    on pipeline_stage_events for all to service_role using (true) with check (true);

create policy "Service role manages operational_alert_dedup"
    on operational_alert_dedup for all to service_role using (true) with check (true);

