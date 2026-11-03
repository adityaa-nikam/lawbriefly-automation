-- ==============================================================================
-- Migration: 20261104000100_create_publishing_queue_dispatch.sql
-- Description: Task 18.2 — Cloudflare Queues Durable Dispatch & Atomic Claim RPC
--
-- Adds:
-- 1. claim_publication_job(p_post_id, p_stale_seconds):
--    Atomically claims a post for Instagram carousel publication using row-level
--    locks (FOR UPDATE) across social_content_posts and social_content_publications.
--    Prevents concurrent Queue consumer executions and detects already-published
--    or ambiguous (unknown) outcomes safely.
--
-- Status: PREPARED LOCALLY FOR REVIEW. DO NOT APPLY REMOTELY UNTIL USER APPROVAL.
-- ==============================================================================

-- 1. Function: public.claim_publication_job
CREATE OR REPLACE FUNCTION public.claim_publication_job(
    p_post_id UUID,
    p_stale_seconds INT DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_post RECORD;
    v_pub RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- 1. Fetch post and verify approved status with row-level lock
    SELECT * INTO v_post
    FROM public.social_content_posts
    WHERE id = p_post_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'claimed', false,
            'error_code', 'POST_NOT_FOUND',
            'message', 'Post not found: ' || p_post_id::text
        );
    END IF;

    IF v_post.post_status <> 'approved' THEN
        RETURN jsonb_build_object(
            'success', false,
            'claimed', false,
            'error_code', 'POST_NOT_APPROVED',
            'post_status', v_post.post_status,
            'message', 'Post status is ' || v_post.post_status || '; only approved posts can be claimed for publishing'
        );
    END IF;

    IF v_post.human_review_required <> true THEN
        RETURN jsonb_build_object(
            'success', false,
            'claimed', false,
            'error_code', 'HUMAN_REVIEW_NOT_REQUIRED',
            'message', 'human_review_required is not true'
        );
    END IF;

    -- 2. Fetch existing publication record for this post
    SELECT * INTO v_pub
    FROM public.social_content_publications
    WHERE post_id = p_post_id AND platform = 'instagram'
    FOR UPDATE;

    IF FOUND THEN
        -- Case A: Already published
        IF v_pub.publication_status = 'published' OR v_pub.instagram_media_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'claimed', false,
                'is_already_published', true,
                'publication_id', v_pub.id,
                'instagram_media_id', v_pub.instagram_media_id,
                'message', 'Post has already been published to Instagram'
            );
        END IF;

        -- Case B: Unknown outcome from ambiguous network timeout (manual review required)
        IF v_pub.publication_status = 'unknown' THEN
            RETURN jsonb_build_object(
                'success', false,
                'claimed', false,
                'is_unknown', true,
                'error_code', 'STATUS_UNKNOWN',
                'message', 'Publication status is unknown; manual verification is required before retrying'
            );
        END IF;

        -- Case C: Actively publishing by another worker (within stale window)
        IF v_pub.publication_status = 'publishing' AND (v_now - v_pub.updated_at) < (p_stale_seconds * INTERVAL '1 second') THEN
            RETURN jsonb_build_object(
                'success', false,
                'claimed', false,
                'in_progress', true,
                'error_code', 'PUBLISHING_IN_PROGRESS',
                'message', 'Another worker is currently publishing this post'
            );
        END IF;

        -- Case D: Safe to claim (pending, processing, failed, or stale publishing lock)
        UPDATE public.social_content_publications
        SET publication_status = 'publishing',
            retry_count = v_pub.retry_count + 1,
            updated_at = v_now
        WHERE id = v_pub.id;

        RETURN jsonb_build_object(
            'success', true,
            'claimed', true,
            'is_already_published', false,
            'publication_id', v_pub.id,
            'retry_count', v_pub.retry_count + 1
        );
    ELSE
        -- Case E: No publication record exists yet - insert initial record with status 'publishing'
        INSERT INTO public.social_content_publications (
            post_id,
            platform,
            media_type,
            publication_status,
            instagram_account_id,
            caption,
            slide_count,
            retry_count,
            created_at,
            updated_at
        ) VALUES (
            p_post_id,
            'instagram',
            'CAROUSEL',
            'publishing',
            'pending_config',
            COALESCE(v_post.instagram_caption, 'LawBriefly Carousel'),
            COALESCE(v_post.carousel_slide_count, 5),
            1,
            v_now,
            v_now
        )
        RETURNING id INTO v_pub;

        RETURN jsonb_build_object(
            'success', true,
            'claimed', true,
            'is_already_published', false,
            'publication_id', v_pub.id,
            'retry_count', 1
        );
    END IF;
END;
$$;

