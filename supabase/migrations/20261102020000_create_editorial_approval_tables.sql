-- ==============================================================================
-- Migration: 20261102020000_create_editorial_approval_tables.sql
-- Description: Task 16 — Telegram Editorial Notification & Approval Workflow tables
--              and atomic decision processing RPC function.
--              Includes strict RLS and service_role permissions.
-- ==============================================================================

-- 1. Table: public.social_content_approval_requests
CREATE TABLE IF NOT EXISTS public.social_content_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.social_content_posts(id) ON DELETE CASCADE,
    notification_status TEXT NOT NULL DEFAULT 'pending',
    decision_status TEXT NOT NULL DEFAULT 'pending',
    telegram_chat_id TEXT NOT NULL,
    telegram_control_message_id BIGINT,
    telegram_media_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    decided_by_telegram_user_id TEXT,
    decided_by_username TEXT,
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT social_content_approval_requests_post_id_key UNIQUE (post_id),
    CONSTRAINT social_content_approval_requests_notification_status_check CHECK (
        notification_status IN ('pending', 'sending', 'media_sent', 'sent', 'failed', 'delivery_unknown', 'expired')
    ),
    CONSTRAINT social_content_approval_requests_decision_status_check CHECK (
        decision_status IN ('pending', 'approved', 'rejected', 'expired')
    )
);

-- Indexes for social_content_approval_requests
CREATE INDEX IF NOT EXISTS idx_approval_requests_post_id
    ON public.social_content_approval_requests (post_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_decision_status
    ON public.social_content_approval_requests (decision_status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_control_message_id
    ON public.social_content_approval_requests (telegram_control_message_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_expires_at
    ON public.social_content_approval_requests (expires_at);

-- 2. Table: public.social_content_approval_actions
CREATE TABLE IF NOT EXISTS public.social_content_approval_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_request_id UUID NOT NULL REFERENCES public.social_content_approval_requests(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT social_content_approval_actions_token_hash_key UNIQUE (token_hash),
    CONSTRAINT social_content_approval_actions_request_action_key UNIQUE (approval_request_id, action),
    CONSTRAINT social_content_approval_actions_action_check CHECK (
        action IN ('approve', 'reject')
    ),
    CONSTRAINT social_content_approval_actions_token_hash_format CHECK (
        token_hash ~ '^[a-f0-9]{64}$'
    )
);

-- Indexes for social_content_approval_actions
CREATE INDEX IF NOT EXISTS idx_approval_actions_token_hash
    ON public.social_content_approval_actions (token_hash);

CREATE INDEX IF NOT EXISTS idx_approval_actions_request_id
    ON public.social_content_approval_actions (approval_request_id);

-- 3. Table: public.social_content_approval_events
CREATE TABLE IF NOT EXISTS public.social_content_approval_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_request_id UUID REFERENCES public.social_content_approval_requests(id) ON DELETE SET NULL,
    post_id UUID NOT NULL REFERENCES public.social_content_posts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    telegram_update_id BIGINT,
    telegram_callback_query_id TEXT,
    telegram_user_id TEXT,
    telegram_username TEXT,
    telegram_chat_id TEXT,
    telegram_message_id BIGINT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for social_content_approval_events
CREATE INDEX IF NOT EXISTS idx_approval_events_post_id
    ON public.social_content_approval_events (post_id);

CREATE INDEX IF NOT EXISTS idx_approval_events_request_id
    ON public.social_content_approval_events (approval_request_id);

-- Global partial unique constraints for Telegram update and callback query deduplication
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_events_callback_query_id
    ON public.social_content_approval_events (telegram_callback_query_id)
    WHERE telegram_callback_query_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_events_update_id
    ON public.social_content_approval_events (telegram_update_id)
    WHERE telegram_update_id IS NOT NULL;

-- Trigger to guarantee append-only immutability on social_content_approval_events
CREATE OR REPLACE FUNCTION public.prevent_approval_events_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'social_content_approval_events is an immutable audit log; UPDATE and DELETE operations are strictly prohibited.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_approval_events_mutation ON public.social_content_approval_events;
CREATE TRIGGER trg_prevent_approval_events_mutation
    BEFORE UPDATE OR DELETE ON public.social_content_approval_events
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_approval_events_mutation();

-- 4. Atomic Decision Processing Function (RPC)
CREATE OR REPLACE FUNCTION public.process_editorial_approval_decision(
    p_token_hash TEXT,
    p_action TEXT,
    p_telegram_user_id TEXT,
    p_telegram_username TEXT,
    p_telegram_chat_id TEXT,
    p_telegram_message_id BIGINT,
    p_telegram_update_id BIGINT,
    p_telegram_callback_query_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_action_record RECORD;
    v_request_record RECORD;
    v_post_record RECORD;
    v_existing_event RECORD;
    v_now TIMESTAMPTZ := NOW();
    v_target_status TEXT;
BEGIN
    -- 0. Check if this Telegram callback query was already processed (global deduplication)
    IF p_telegram_callback_query_id IS NOT NULL THEN
        SELECT approval_request_id, event_type INTO v_existing_event
        FROM public.social_content_approval_events
        WHERE telegram_callback_query_id = p_telegram_callback_query_id
        LIMIT 1;

        IF FOUND THEN
            SELECT post_id, decision_status INTO v_request_record
            FROM public.social_content_approval_requests
            WHERE id = v_existing_event.approval_request_id;

            RETURN jsonb_build_object(
                'success', true,
                'is_duplicate', true,
                'post_id', v_request_record.post_id,
                'approval_request_id', v_existing_event.approval_request_id,
                'decision_status', v_request_record.decision_status,
                'message', 'Callback query already processed (idempotent duplicate)'
            );
        END IF;
    END IF;

    -- 1. Validate action parameter
    IF p_action NOT IN ('approve', 'reject') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_ACTION', 'message', 'Action must be approve or reject');
    END IF;

    v_target_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END;

    -- 2. Fetch and lock approval action by token hash
    SELECT * INTO v_action_record
    FROM public.social_content_approval_actions
    WHERE token_hash = p_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_NOT_FOUND', 'message', 'Approval action token not found');
    END IF;

    -- 3. Verify action matches token's action
    IF v_action_record.action <> p_action THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ACTION_MISMATCH', 'message', 'Token does not match requested action');
    END IF;

    -- 4. Verify token has not already been consumed
    IF v_action_record.consumed_at IS NOT NULL THEN
        -- If already consumed, fetch current status for idempotent feedback
        SELECT decision_status INTO v_request_record
        FROM public.social_content_approval_requests
        WHERE id = v_action_record.approval_request_id;

        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'TOKEN_ALREADY_CONSUMED',
            'decision_status', v_request_record.decision_status,
            'message', 'Callback token has already been consumed'
        );
    END IF;

    -- 5. Fetch and lock approval request
    SELECT * INTO v_request_record
    FROM public.social_content_approval_requests
    WHERE id = v_action_record.approval_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'REQUEST_NOT_FOUND', 'message', 'Associated approval request not found');
    END IF;

    -- 6. Verify request is still pending
    IF v_request_record.decision_status <> 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_DECIDED', 'message', 'Approval request already decided: ' || v_request_record.decision_status);
    END IF;

    -- 7. Verify request has not expired
    IF v_request_record.expires_at <= v_now THEN
        UPDATE public.social_content_approval_requests
        SET decision_status = 'expired', updated_at = v_now
        WHERE id = v_request_record.id;

        RETURN jsonb_build_object('success', false, 'error_code', 'REQUEST_EXPIRED', 'message', 'Approval request has expired');
    END IF;

    -- 8. Verify control message ID matches if provided
    IF p_telegram_message_id IS NOT NULL AND v_request_record.telegram_control_message_id IS NOT NULL THEN
        IF v_request_record.telegram_control_message_id <> p_telegram_message_id THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'MESSAGE_ID_MISMATCH', 'message', 'Control message ID mismatch');
        END IF;
    END IF;

    -- 9. Verify chat ID matches
    IF v_request_record.telegram_chat_id <> p_telegram_chat_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'CHAT_ID_MISMATCH', 'message', 'Telegram chat ID mismatch');
    END IF;

    -- 10. Fetch and lock post
    SELECT * INTO v_post_record
    FROM public.social_content_posts
    WHERE id = v_request_record.post_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'POST_NOT_FOUND', 'message', 'Associated post record not found');
    END IF;

    -- 11. Verify post status is pending_approval
    IF v_post_record.post_status <> 'pending_approval' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_POST_STATUS', 'message', 'Post status must be pending_approval, currently: ' || v_post_record.post_status);
    END IF;

    -- 12. Atomic updates:
    -- A. Consume action token
    UPDATE public.social_content_approval_actions
    SET consumed_at = v_now
    WHERE id = v_action_record.id;

    -- B. Update approval request
    UPDATE public.social_content_approval_requests
    SET decision_status = v_target_status,
        decided_at = v_now,
        decided_by_telegram_user_id = p_telegram_user_id,
        decided_by_username = p_telegram_username,
        updated_at = v_now
    WHERE id = v_request_record.id;

    -- C. Update post status (human_review_required remains true)
    UPDATE public.social_content_posts
    SET post_status = v_target_status,
        updated_at = v_now
    WHERE id = v_post_record.id;

    -- D. Record audit event
    INSERT INTO public.social_content_approval_events (
        approval_request_id,
        post_id,
        event_type,
        telegram_update_id,
        telegram_callback_query_id,
        telegram_user_id,
        telegram_username,
        telegram_chat_id,
        telegram_message_id,
        details,
        created_at
    ) VALUES (
        v_request_record.id,
        v_post_record.id,
        'decision_' || v_target_status,
        p_telegram_update_id,
        p_telegram_callback_query_id,
        p_telegram_user_id,
        p_telegram_username,
        p_telegram_chat_id,
        p_telegram_message_id,
        jsonb_build_object(
            'action', p_action,
            'previous_status', 'pending_approval',
            'new_status', v_target_status,
            'decided_at', v_now
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_duplicate', false,
        'post_id', v_post_record.id,
        'approval_request_id', v_request_record.id,
        'action', p_action,
        'decision_status', v_target_status,
        'decided_at', v_now
    );
END;
$$;

-- 5. Function: public.claim_editorial_notification
-- Atomically claims a post for editorial notification using row-level locking (FOR UPDATE)
-- to prevent concurrent workers from ever sending duplicate Telegram media albums.
CREATE OR REPLACE FUNCTION public.claim_editorial_notification(
    p_post_id UUID,
    p_telegram_chat_id TEXT,
    p_expires_at TIMESTAMPTZ,
    p_stale_seconds INT DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- Query approval request with row-level lock
    SELECT * INTO v_req
    FROM public.social_content_approval_requests
    WHERE post_id = p_post_id
    FOR UPDATE;

    IF FOUND THEN
        -- If already sent and pending review
        IF v_req.notification_status = 'sent' AND v_req.decision_status = 'pending' THEN
            RETURN jsonb_build_object(
                'success', true,
                'claimed', false,
                'is_already_sent', true,
                'approval_request_id', v_req.id,
                'notification_status', v_req.notification_status,
                'telegram_control_message_id', v_req.telegram_control_message_id,
                'telegram_media_message_ids', v_req.telegram_media_message_ids,
                'expires_at', v_req.expires_at
            );
        END IF;

        -- If delivery_unknown (requires manual reconciliation)
        IF v_req.notification_status = 'delivery_unknown' THEN
            RETURN jsonb_build_object(
                'success', false,
                'claimed', false,
                'error_code', 'DELIVERY_UNKNOWN',
                'message', 'Post notification status is delivery_unknown; manual verification is required before retrying.'
            );
        END IF;

        -- If already decided
        IF v_req.decision_status IN ('approved', 'rejected') THEN
            RETURN jsonb_build_object(
                'success', false,
                'claimed', false,
                'error_code', 'ALREADY_DECIDED',
                'message', 'Post approval request was already decided: ' || v_req.decision_status
            );
        END IF;

        -- If actively sending by another worker (within stale window)
        IF v_req.notification_status = 'sending' AND (v_now - v_req.updated_at) < (p_stale_seconds * INTERVAL '1 second') THEN
            RETURN jsonb_build_object(
                'success', true,
                'claimed', false,
                'in_progress', true,
                'is_already_sent', false,
                'approval_request_id', v_req.id,
                'notification_status', 'sending',
                'error', 'NOTIFICATION_IN_PROGRESS: Another notification worker is currently sending this carousel.'
            );
        END IF;

        -- Atomically claim existing request for retry/resume
        UPDATE public.social_content_approval_requests
        SET notification_status = 'sending',
            telegram_chat_id = p_telegram_chat_id,
            expires_at = p_expires_at,
            updated_at = v_now
        WHERE id = v_req.id;

        RETURN jsonb_build_object(
            'success', true,
            'claimed', true,
            'is_already_sent', false,
            'approval_request_id', v_req.id,
            'notification_status', 'sending',
            'telegram_media_message_ids', v_req.telegram_media_message_ids
        );
    ELSE
        -- Insert new request record atomically
        INSERT INTO public.social_content_approval_requests (
            post_id,
            notification_status,
            decision_status,
            telegram_chat_id,
            expires_at,
            created_at,
            updated_at
        ) VALUES (
            p_post_id,
            'sending',
            'pending',
            p_telegram_chat_id,
            p_expires_at,
            v_now,
            v_now
        )
        RETURNING id INTO v_req.id;

        RETURN jsonb_build_object(
            'success', true,
            'claimed', true,
            'is_already_sent', false,
            'approval_request_id', v_req.id,
            'notification_status', 'sending',
            'telegram_media_message_ids', '[]'::jsonb
        );
    END IF;
END;
$$;

-- 6. Row Level Security (RLS)
ALTER TABLE public.social_content_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_approval_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_approval_events ENABLE ROW LEVEL SECURITY;

-- 7. Permissions & Grants
-- Ensure public schema usage for service_role
GRANT USAGE ON SCHEMA public TO service_role;

-- Revoke all direct privileges from PUBLIC, anon, and authenticated
REVOKE ALL ON TABLE public.social_content_approval_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.social_content_approval_actions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.social_content_approval_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_editorial_approval_decision FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_editorial_notification FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_approval_events_mutation FROM PUBLIC, anon, authenticated;

-- Explicitly grant full CRUD permissions to service_role for mutable entities
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_content_approval_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_content_approval_actions TO service_role;

-- Strictly append-only permissions for audit events:
-- service_role has ONLY SELECT and INSERT permissions.
-- UPDATE, DELETE, and TRUNCATE are strictly REVOKED from all roles including service_role.
GRANT SELECT, INSERT ON TABLE public.social_content_approval_events TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.social_content_approval_events FROM PUBLIC, anon, authenticated, service_role;

-- Grant execution of atomic functions to service_role
GRANT EXECUTE ON FUNCTION public.process_editorial_approval_decision TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_editorial_notification TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_approval_events_mutation TO service_role;

