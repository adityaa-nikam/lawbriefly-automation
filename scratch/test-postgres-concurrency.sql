-- scratch/test-postgres-concurrency.sql
-- Comprehensive PostgreSQL Concurrency Verification Suite
-- Covers:
-- Part 1: Operational Alert Lifecycle & Deduplication (Task 20.2)
-- Part 2: Distributed Pipeline Run Lock & Cross-Isolate Concurrency (Task 19.2)

--------------------------------------------------------------------------------
-- PART 1: Operational Alert Concurrency & Lifecycle
--------------------------------------------------------------------------------

-- Connection 1 (Session A):
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM reserve_operational_alert('concurrency_test_incident', 900, 60, 30, '{"session": "A"}'::jsonb);
    RAISE NOTICE 'Session A reservation result: reserved=%, status=%, reason=%', r.reserved, r.delivery_status, r.reason;
END $$;

-- Connection 2 (Session B - executed concurrently):
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM reserve_operational_alert('concurrency_test_incident', 900, 60, 30, '{"session": "B"}'::jsonb);
    RAISE NOTICE 'Session B reservation result: reserved=%, status=%, reason=%', r.reserved, r.delivery_status, r.reason;
END $$;

-- Verification 1: Exactly one session reserved=true, other reserved=false
SELECT dedup_key, delivery_status, reserved_at, last_alerted_at, alert_count, failure_count
FROM operational_alert_dedup
WHERE dedup_key = 'concurrency_test_incident';

-- Test confirmation of delivery:
SELECT confirm_operational_alert_sent('concurrency_test_incident', '{"status": "delivered"}'::jsonb);

-- Cleanup Part 1:
DELETE FROM operational_alert_dedup WHERE dedup_key = 'concurrency_test_incident';


--------------------------------------------------------------------------------
-- PART 2: Distributed Pipeline Run Lock (Task 19.2)
--------------------------------------------------------------------------------

-- SCENARIO 1: Two independent sessions attempting acquisition simultaneously
-- Session 1 acquires lock
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM acquire_pipeline_run_lock('test_pipeline_lock', 'run-uuid-001', 'token-session-1', 10);
    RAISE NOTICE 'Session 1 acquisition: acquired=%, owner_run_id=%, fencing_token=%, reason=%',
        r.acquired, r.owner_run_id, r.fencing_token, r.reason;
END $$;

-- Session 2 attempts acquisition while Session 1 holds active lease
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM acquire_pipeline_run_lock('test_pipeline_lock', 'run-uuid-002', 'token-session-2', 10);
    RAISE NOTICE 'Session 2 acquisition (should be rejected): acquired=%, owner_run_id=%, fencing_token=%, reason=%',
        r.acquired, r.owner_run_id, r.fencing_token, r.reason;
END $$;

-- Verification Scenario 1: Session 1 must be active owner with fencing_token = 1
SELECT lock_name, owner_run_id, owner_token, fencing_token, lease_expires_at > clock_timestamp() AS is_active
FROM pipeline_run_locks
WHERE lock_name = 'test_pipeline_lock';


-- SCENARIO 2: Valid owner renews while competing session attempts acquisition
-- Session 1 renews lease
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM renew_pipeline_run_lock('test_pipeline_lock', 'token-session-1', 1, 15);
    RAISE NOTICE 'Session 1 renewal: renewed=%, fencing_token=%, reason=%',
        r.renewed, r.fencing_token, r.reason;
END $$;

-- Competing Session 2 attempts acquisition during renewed lease
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM acquire_pipeline_run_lock('test_pipeline_lock', 'run-uuid-002', 'token-session-2', 10);
    RAISE NOTICE 'Session 2 acquisition after renewal (must be rejected): acquired=%, reason=%',
        r.acquired, r.reason;
END $$;


-- SCENARIO 3: Lease expiration, takeover by Session 2, and fencing token monotonicity
-- Simulate lease expiration by updating lease_expires_at into the past
UPDATE pipeline_run_locks
SET lease_expires_at = clock_timestamp() - interval '1 second'
WHERE lock_name = 'test_pipeline_lock';

-- Session 2 reclaims expired lock (takeover)
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM acquire_pipeline_run_lock('test_pipeline_lock', 'run-uuid-002', 'token-session-2', 20);
    RAISE NOTICE 'Session 2 reclamation (should succeed with fencing_token=2): acquired=%, fencing_token=%, reason=%',
        r.acquired, r.fencing_token, r.reason;
END $$;

-- Verification Scenario 3: fencing_token must now be 2, owner must be Session 2
SELECT lock_name, owner_run_id, owner_token, fencing_token
FROM pipeline_run_locks
WHERE lock_name = 'test_pipeline_lock';


-- SCENARIO 4: Stale owner (Session 1) attempts release of newer owner's lock
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Session 1 uses old owner token and old fencing token (1)
    SELECT * INTO r FROM release_pipeline_run_lock('test_pipeline_lock', 'token-session-1', 1);
    RAISE NOTICE 'Stale Session 1 release attempt (must fail): released=%, reason=%',
        r.released, r.reason;
END $$;

-- Verify Session 2 STILL owns the active lock (Session 1 release had zero effect)
SELECT lock_name, owner_run_id, owner_token, fencing_token, lease_expires_at > clock_timestamp() AS is_active
FROM pipeline_run_locks
WHERE lock_name = 'test_pipeline_lock';


-- SCENARIO 5: Stale owner (Session 1) attempts renewal of newer owner's lock
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM renew_pipeline_run_lock('test_pipeline_lock', 'token-session-1', 1, 30);
    RAISE NOTICE 'Stale Session 1 renewal attempt (must fail): renewed=%, reason=%',
        r.renewed, r.reason;
END $$;


-- SCENARIO 6: Legitimate owner (Session 2) releases its own lock
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM release_pipeline_run_lock('test_pipeline_lock', 'token-session-2', 2);
    RAISE NOTICE 'Session 2 legitimate release: released=%, reason=%',
        r.released, r.reason;
END $$;

-- Verification Scenario 6: Lock is now expired/released
SELECT lock_name, lease_expires_at <= clock_timestamp() AS is_released
FROM pipeline_run_locks
WHERE lock_name = 'test_pipeline_lock';


-- Cleanup Part 2:
DELETE FROM pipeline_run_locks WHERE lock_name = 'test_pipeline_lock';
