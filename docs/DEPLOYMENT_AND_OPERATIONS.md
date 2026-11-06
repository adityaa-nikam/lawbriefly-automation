# LawBriefly Automation — Production Deployment, Operations & Disaster Recovery Guide

## 1. Local Development Setup
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Copy `.dev.vars.example` to `.dev.vars` (never committed to git) and configure local API keys:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
3. Run local dev server:
   ```bash
   npx wrangler dev
   ```
4. Run tests and TypeScript validation:
   ```bash
   npm test
   npx tsc --noEmit
   ```

## 2. Staging Environment Setup
- Cloudflare Environment: `staging`
- Staging Supabase Project: Dedicated staging PostgreSQL and Storage bucket (`lawbriefly-carousel-assets`).
- Staging Telegram Bot / Group: Dedicated staging bot token and editor chat to prevent mixing editorial requests.
- Staging Instagram Account: Meta Test User or Sandbox Instagram account.
- Feature flags:
  - `APP_ENV="staging"`
  - `AUTONOMOUS_PIPELINE_ENABLED="false"` (manually triggered until verified)
  - `OPS_ALERTS_ENABLED="true"` (verify alert routing)
  - `INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL="false"`

## 3. Production Environment Setup
- Cloudflare Environment: `production` (root / production Worker)
- Production Supabase Project: Production instance with strictly provisioned `service_role` secrets.
- Production Telegram Bot: Dedicated editorial channel/group with strictly allowlisted numeric user IDs.
- Production Instagram Professional Account: Validated token with `instagram_content_publish` permission.
- Feature flags:
  - `APP_ENV="production"`
  - `AUTONOMOUS_PIPELINE_ENABLED="false"` (initial canary; enable after manual verification)
  - `OPS_ALERTS_ENABLED="true"` (dedicated operations alert group)
  - `INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL="false"` (mandatory editorial approval gate)

## 4. Required Environment Variables
| Variable | Type | Secret? | Description |
|---|---|---|---|
| `APP_ENV` | String | No | `"development"`, `"staging"`, or `"production"` |
| `AUTONOMOUS_PIPELINE_ENABLED` | String | No | `"true"` to enable 02:00 UTC daily cron; default `"false"` |
| `OPS_ALERTS_ENABLED` | String | No | `"true"` to enable Telegram failure alerts; default `"false"` |
| `ADMIN_API_KEY` | String | Yes | Bearer secret for administrative DLQ recovery endpoint |
| `SUPABASE_URL` | String | No | Supabase project URL (`https://...supabase.co`) |
| `SUPABASE_SECRET_KEY` | String | Yes | Supabase `service_role` private key |
| `GROQ_API_KEY` | String | Yes | Groq API authentication key |
| `GROQ_MODEL` | String | No | Groq LLM model name |
| `OPENROUTER_API_KEY` | String | Yes | OpenRouter Mercury API key |
| `MERCURY_MODEL` | String | No | Mercury topic selection model name |
| `JINA_API_KEY` | String | Yes | Jina Reader API key |
| `TELEGRAM_BOT_TOKEN` | String | Yes | Bot token issued by BotFather |
| `TELEGRAM_CHAT_ID` | String | No | Editorial group chat ID (numeric string) |
| `TELEGRAM_OPS_ALERT_CHAT_ID` | String | No | Optional dedicated operational alert chat ID |
| `TELEGRAM_ALLOWED_USER_IDS` | String | No | Comma-separated numeric Telegram user IDs of editors |
| `TELEGRAM_WEBHOOK_SECRET` | String | Yes | Secret token for validating incoming Telegram updates |
| `INSTAGRAM_ACCESS_TOKEN` | String | Yes | Long-lived Graph API user access token |
| `INSTAGRAM_ACCOUNT_ID` | String | No | Instagram Professional / Business account ID |
| `INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL` | String | No | `"false"` preserves human approval boundary |

## 5. Secret Provisioning Process
Use the Wrangler CLI to securely provision secrets directly into Cloudflare Workers without committing files:
```bash
# Example for production secrets
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put JINA_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN
npx wrangler secret put ADMIN_API_KEY
```

## 6. Supabase Migration Order
Apply the 4 local migrations to staging/production in strict chronological order:
1. `20261105000100_create_observability_and_alerting_tables.sql`
   - Creates `pipeline_runs`, `pipeline_stage_events`, and `operational_alert_dedup`.
   - Enables RLS on all three tables with `service_role` management policies.
2. `20261105000200_create_dead_letter_and_atomic_alert_functions.sql`
   - Creates `dead_letter_events` table with RLS.
   - Defines `claim_operational_alert` RPC with `security definer` and `search_path = public, pg_temp`.
   - Revokes public execution and grants to `service_role`.
3. `20261105000300_create_operational_alert_lifecycle.sql`
   - Adds alert delivery lifecycle columns (`delivery_status`, `reserved_at`, `failure_count`, `last_failed_at`, `last_error`).
   - Defines `reserve_operational_alert`, `confirm_operational_alert_sent`, `record_operational_alert_failed`.
   - Revokes public execution and grants to `service_role`.
4. `20261106000100_create_distributed_pipeline_lock.sql`
   - Creates `pipeline_run_locks` table with RLS.
   - Defines `acquire_pipeline_run_lock`, `renew_pipeline_run_lock`, `release_pipeline_run_lock`.
   - Revokes public execution and grants to `service_role`.

## 7. RPC Privilege Verification
Verify via PostgreSQL psql or Supabase SQL Editor that no public/anon access is permitted:
```sql
SELECT routine_name, grantee, privilege_type 
FROM information_schema.routine_privileges 
WHERE routine_name IN (
    'acquire_pipeline_run_lock',
    'renew_pipeline_run_lock',
    'release_pipeline_run_lock',
    'reserve_operational_alert',
    'confirm_operational_alert_sent',
    'record_operational_alert_failed'
);
-- Grantees must strictly be 'service_role' and 'postgres'. PUBLIC, anon, and authenticated must NOT appear.
```

## 8. Cloudflare Queue Provisioning
Provision the 3 queues in Cloudflare:
```bash
npx wrangler queues create instagram-publishing-jobs
npx wrangler queues create instagram-publishing-dlq
npx wrangler queues create instagram-publishing-quarantine
```

## 9. Queue Retry Configuration
Configured in `wrangler.jsonc`:
- `instagram-publishing-jobs`:
  - `max_batch_size: 1`, `max_retries: 3`, `retry_delay: 30`, `dead_letter_queue: "instagram-publishing-dlq"`
- `instagram-publishing-dlq`:
  - `max_batch_size: 1`, `max_retries: 3`, `retry_delay: 60`, `dead_letter_queue: "instagram-publishing-quarantine"`
- `instagram-publishing-quarantine`:
  - No consumer in Worker; retains failed messages safely.

## 10. Quarantine Retention
Cloudflare Workers Queues default retention is 4 days on paid plans. To configure the maximum 14-day retention:
```bash
# Requires Cloudflare Workers Paid plan:
npx wrangler queues update instagram-publishing-quarantine --message-retention-period-secs 1209600
```
Verify the queue configuration:
```bash
npx wrangler queues info instagram-publishing-quarantine
```

## 11. Backlog Monitoring
The Worker monitors quarantine queue metrics (`backlogCount`, `backlogBytes`, `oldestMessageTimestamp`) during the scheduled 15-minute recovery sweep (`*/15 * * * *`).
- When `backlogCount > 0` or oldest message age exceeds 24 hours, an operational alert is sent to Telegram.
- Alerts are deduplicated using atomic PostgreSQL reservation with a 15-minute cooldown to avoid alert storms.

## 12. Telegram Webhook Setup
Register the deployed Worker webhook URL with Telegram Bot API:
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<WORKER_DOMAIN>/api/webhooks/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["callback_query"]
  }'
```

## 13. Instagram Configuration and Token Rotation
- Long-lived Instagram Graph API user tokens expire every 60 days.
- Refresh before 50 days using Meta Graph API:
  ```bash
  curl -i -X GET "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<CURRENT_TOKEN>"
  ```
- Update Worker secret:
  ```bash
  npx wrangler secret put INSTAGRAM_ACCESS_TOKEN
  ```

## 14. Cron Schedules
- `30 0 * * *` (00:30 UTC / 06:00 AM IST): News ingestion sync.
- `0 2 * * *` (02:00 UTC / 07:30 AM IST): Autonomous AI content pipeline.
- `*/15 * * * *` (Every 15 minutes): Outbox recovery sweep & quarantine backlog monitor.

## 15. Distributed Lock Behavior
- Row resource: `pipeline_run_locks` (`global_content_pipeline`).
- Lease duration: 180 seconds, renewed before every pipeline stage.
- Fencing token: Monotonically increasing BIGINT; protects against stale isolate side effects.
- Database failure: Fails closed (503 Service Unavailable).

## 16. Feature Flag Controls
- `AUTONOMOUS_PIPELINE_ENABLED`:
  - Set to `"true"` to enable 02:00 UTC cron.
  - Set to `"false"` to halt autonomous execution immediately.
- `OPS_ALERTS_ENABLED`:
  - Set to `"true"` to deliver operational failure alerts to Telegram.
- `INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL`:
  - Must remain `"false"` until operator authorizes live publishing.

## 17. Failure Alerts
Operational alerts to Telegram include:
- Environment, Trigger type, Run ID
- Failed Stage and Error Code
- Sanitized, truncated error details (credentials and API keys redacted)
- 15-minute deduplication window per failure stage/category.

## 18. DLQ Inspection
Inspect quarantined messages in Supabase:
```sql
SELECT id, dlq_message_id, post_id, job_id, failure_category, processing_status, attempts, created_at, error_message
FROM dead_letter_events
WHERE processing_status = 'quarantined'
ORDER BY created_at DESC;
```

## 19. Quarantine Recovery Procedure
1. Check quarantine backlog and database status:
   ```bash
   npx tsx scripts/quarantine-recovery.ts status
   ```
2. Diagnose root cause (e.g. database connectivity, rate limits).
3. Safely replay the quarantined message via authenticated admin endpoint:
   ```bash
   npx tsx scripts/quarantine-recovery.ts replay <dlq_message_id_or_post_id>
   ```
4. Confirm message is marked `replayed` in `dead_letter_events` and enqueued into `instagram-publishing-jobs`.

## 20. Deployment Sequence
1. Verify configuration locally:
   ```bash
   npx tsx scripts/validate-production-readiness.ts
   npm test
   npx tsc --noEmit
   ```
2. Apply Supabase database migrations 1–4 to staging/production.
3. Provision Cloudflare Queues and update retention.
4. Set Cloudflare secrets (`npx wrangler secret put`).
5. Deploy Worker to Cloudflare:
   ```bash
   npx wrangler deploy
   ```
6. Register Telegram webhook.
7. Perform manual test run (`POST /api/ai/run-pipeline` in staging, or verify scheduled execution).
8. Enable `OPS_ALERTS_ENABLED="true"`.
9. Enable `AUTONOMOUS_PIPELINE_ENABLED="true"` once canary is verified.

## 21. Rollback Sequence
If critical issues are identified in production:
1. **Instant Kill Switch**: Disable autonomous cron execution:
   ```bash
   npx wrangler secret put AUTONOMOUS_PIPELINE_ENABLED
   # Enter: false
   ```
2. **Rollback Worker Deployment**:
   ```bash
   npx wrangler rollback [deployment-id]
   ```
3. **Pause Queue Delivery** (if Instagram publishing is failing):
   ```bash
   npx wrangler queues pause-delivery instagram-publishing-jobs
   ```

## 22. Incident Response Procedure
1. Identify incident via Telegram operational alert or `GET /api/health/operations`.
2. Inspect `pipeline_runs` and `pipeline_stage_events` in Supabase.
3. Check `dead_letter_events` for any messages routed to DLQ.
4. If rate-limited by Groq or OpenRouter, no manual intervention needed; next scheduled run will proceed automatically.
5. If distributed lock is held by a crashed run, lease expires automatically after 180 seconds.
6. Once issue is resolved, resume queues or replay quarantined messages.

## 23. LawBriefly Operator Dashboard (Local Console)

The Operator Dashboard provides a minimal, visual interface for local pipeline operations, eliminating the need to parse raw PowerShell logs.

### Access & Security
- **URL**: `http://127.0.0.1:8787/dashboard`
- **Environment Gate**: Strictly limited to `APP_ENV="development"`. In staging or production environments, `GET /dashboard` and `/api/dashboard/*` return HTTP 404.
- **Zero-Dependency Architecture**: Embedded vanilla HTML/CSS/JavaScript with zero external CDN dependencies, npm runtime overhead, or tracking scripts. Works fully offline in sandbox environments.
- **Secret Safety**: No API keys, database secrets, bot tokens, or webhook secrets are rendered in the HTML or exposed in API payloads.

### Key Capabilities
1. **Full Pipeline Execution (`POST /api/dashboard/run`)**:
   - Triggers end-to-end autonomous pipeline via `executePipeline(env)`.
   - Competes for the database-backed distributed lock (`DEFAULT_PIPELINE_LOCK_NAME`).
   - Prevents double-clicks via confirmation modal and button state disabling.
   - Transitions through live stages (`news_ingestion` → `topic_selection` → `content_generation` → `carousel_rendering` → `carousel_persistence` → `editorial_notification`).
   - Displays editorial prompt: *"Awaiting your editorial approval in Telegram"*.
2. **Sync News Only (`POST /api/dashboard/news-sync`)**:
   - Executes `executeNewsIngestion(env, days, limit)` to ingest and store raw legal news articles.
   - Does **not** trigger AI topic selection, carousel generation, or Telegram notifications.
3. **Live Progress Monitoring (`GET /api/dashboard/state`)**:
   - Adaptive polling: 2.5-second interval during active runs, 10-second interval when idle.
   - Stage-by-stage status cards with duration metrics and sanitized operational error output.
4. **Editorial & Publication Boundary**:
   - The dashboard does not bypass human editorial approval. Content approval and Instagram publishing decisions remain strictly confined to authorized editors inside Telegram.
5. **Schedule Verification**:
   - Inspects and displays the registered Cloudflare Worker cron triggers:
     - `30 0 * * *`: News Sync (00:30 UTC / 06:00 AM IST)
     - `0 2 * * *`: Autonomous Pipeline (02:00 UTC / 07:30 AM IST)
     - `*/15 * * * *`: Queue Recovery Sweep (Every 15 minutes)
   - Displays an explicit discrepancy notice regarding the operator-mentioned 10:30 AM schedule vs the registered 07:30 AM IST trigger.


