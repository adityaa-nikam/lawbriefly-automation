-- ==============================================================================
-- Migration: 20261102014932_task15_create_social_content_persistence.sql
-- Description: Creates social_content_posts and social_content_assets tables
--              for persisting generated carousel assets, metadata, and manifests
--              with strict constraints, RLS, and service_role administrative grants.
-- ==============================================================================

-- 1. Create table public.social_content_posts
CREATE TABLE IF NOT EXISTS public.social_content_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_fingerprint TEXT NOT NULL,
    candidate_id TEXT,
    topic_title TEXT NOT NULL,
    legal_domain TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    generation_status TEXT NOT NULL,
    post_status TEXT NOT NULL,
    carousel_slide_count SMALLINT NOT NULL,
    instagram_caption TEXT NOT NULL,
    hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
    content_package JSONB NOT NULL,
    source_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_attributions JSONB NOT NULL DEFAULT '[]'::jsonb,
    render_manifest JSONB,
    renderer_version TEXT NOT NULL DEFAULT 'v2',
    human_review_required BOOLEAN NOT NULL DEFAULT true,
    storage_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT social_content_posts_fingerprint_key UNIQUE (content_fingerprint),
    CONSTRAINT social_content_posts_generation_status_check CHECK (
        generation_status IN ('ready_for_review', 'insufficient_evidence')
    ),
    CONSTRAINT social_content_posts_status_check CHECK (
        post_status IN (
            'storing',
            'storage_failed',
            'stored',
            'pending_approval',
            'approved',
            'rejected',
            'publishing',
            'published',
            'archived'
        )
    ),
    CONSTRAINT social_content_posts_slide_count_check CHECK (
        carousel_slide_count BETWEEN 4 AND 6
    ),
    CONSTRAINT social_content_posts_human_review_required_check CHECK (
        human_review_required = true
    ),
    CONSTRAINT social_content_posts_topic_title_not_empty CHECK (
        topic_title ~ '[^[:space:]]'
    ),
    CONSTRAINT social_content_posts_caption_not_empty CHECK (
        instagram_caption ~ '[^[:space:]]'
    )
);

-- Indexes for social_content_posts
CREATE INDEX IF NOT EXISTS idx_social_content_posts_fingerprint
    ON public.social_content_posts (content_fingerprint);

CREATE INDEX IF NOT EXISTS idx_social_content_posts_status
    ON public.social_content_posts (post_status);

CREATE INDEX IF NOT EXISTS idx_social_content_posts_created_at
    ON public.social_content_posts (created_at DESC);

-- 2. Create table public.social_content_assets
CREATE TABLE IF NOT EXISTS public.social_content_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.social_content_posts(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL,
    asset_key TEXT NOT NULL,
    slide_number SMALLINT,
    storage_bucket TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT social_content_assets_storage_path_key UNIQUE (storage_path),
    CONSTRAINT social_content_assets_post_asset_key UNIQUE (post_id, asset_key),
    CONSTRAINT social_content_assets_post_slide_number UNIQUE (post_id, slide_number),
    CONSTRAINT social_content_assets_type_check CHECK (
        asset_type IN ('slide', 'manifest')
    ),
    CONSTRAINT social_content_assets_mime_check CHECK (
        mime_type IN ('image/png', 'application/json')
    ),
    CONSTRAINT social_content_assets_size_positive CHECK (
        size_bytes > 0
    ),
    CONSTRAINT social_content_assets_sha256_format CHECK (
        sha256 ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT social_content_assets_slide_spec CHECK (
        (asset_type = 'slide' AND slide_number IS NOT NULL AND width = 1080 AND height = 1350 AND mime_type = 'image/png')
        OR
        (asset_type = 'manifest' AND slide_number IS NULL AND width IS NULL AND height IS NULL AND mime_type = 'application/json')
    )
);

-- Indexes for social_content_assets
CREATE INDEX IF NOT EXISTS idx_social_content_assets_post_id
    ON public.social_content_assets (post_id);

CREATE INDEX IF NOT EXISTS idx_social_content_assets_storage_path
    ON public.social_content_assets (storage_path);

-- 3. Row Level Security (RLS)
ALTER TABLE public.social_content_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_assets ENABLE ROW LEVEL SECURITY;

-- 4. Permissions & Grants
-- Ensure public schema usage for service_role
GRANT USAGE ON SCHEMA public TO service_role;

-- Revoke all direct privileges from PUBLIC, anon, and authenticated
REVOKE ALL ON TABLE public.social_content_posts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.social_content_assets FROM PUBLIC, anon, authenticated;

-- Explicitly grant full CRUD permissions to service_role for backend Worker operations
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_content_posts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_content_assets TO service_role;
