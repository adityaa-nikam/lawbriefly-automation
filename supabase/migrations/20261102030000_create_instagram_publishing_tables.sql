-- ==============================================================================
-- Migration: 20261102030000_create_instagram_publishing_tables.sql
-- Description: Creates schema for Instagram publishing foundation:
--              - social_content_publications: tracks individual publication records,
--                container IDs, external Instagram media IDs, permalinks, and statuses.
--              - social_content_publication_events: append-only audit trail of publishing lifecycle events.
--              - Extends social_content_posts with publication convenience columns.
--              - Extends social_content_assets constraints for JPEG publishing assets.
-- Status: PREPARED LOCALLY FOR TASK 17 (DO NOT APPLY REMOTELY UNTIL TASK 17B).
-- ==============================================================================

-- 1. Create table public.social_content_publications
CREATE TABLE IF NOT EXISTS public.social_content_publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.social_content_posts(id) ON DELETE RESTRICT,
    platform TEXT NOT NULL DEFAULT 'instagram',
    publication_status TEXT NOT NULL DEFAULT 'pending',
    instagram_account_id TEXT NOT NULL,
    carousel_container_id TEXT,
    child_container_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    instagram_media_id TEXT,
    instagram_permalink TEXT,
    caption TEXT NOT NULL,
    slide_count SMALLINT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT social_content_publications_platform_check CHECK (
        platform IN ('instagram')
    ),
    CONSTRAINT social_content_publications_status_check CHECK (
        publication_status IN ('pending', 'processing', 'published', 'failed')
    ),
    CONSTRAINT social_content_publications_slide_count_check CHECK (
        slide_count BETWEEN 4 AND 6
    ),
    CONSTRAINT social_content_publications_media_id_unique UNIQUE (instagram_media_id)
);

-- Indexes for social_content_publications
CREATE INDEX IF NOT EXISTS idx_social_content_publications_post_id
    ON public.social_content_publications (post_id);

CREATE INDEX IF NOT EXISTS idx_social_content_publications_status
    ON public.social_content_publications (publication_status);

CREATE INDEX IF NOT EXISTS idx_social_content_publications_media_id
    ON public.social_content_publications (instagram_media_id);

-- 2. Create append-only publication events table
CREATE TABLE IF NOT EXISTS public.social_content_publication_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id UUID REFERENCES public.social_content_publications(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES public.social_content_posts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'instagram',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT social_content_publication_events_type_check CHECK (
        event_type IN (
            'assets_prepared',
            'child_containers_created',
            'parent_container_created',
            'container_processing_finished',
            'container_processing_failed',
            'published_success',
            'publication_failed'
        )
    )
);

-- Index for publication events
CREATE INDEX IF NOT EXISTS idx_social_content_publication_events_post_id
    ON public.social_content_publication_events (post_id);

CREATE INDEX IF NOT EXISTS idx_social_content_publication_events_publication_id
    ON public.social_content_publication_events (publication_id);

-- 3. Add publication metadata columns to social_content_posts for query convenience
ALTER TABLE public.social_content_posts
    ADD COLUMN IF NOT EXISTS instagram_media_id TEXT,
    ADD COLUMN IF NOT EXISTS instagram_permalink TEXT,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- 4. Extend social_content_assets check constraints to allow publishing JPEG slides
ALTER TABLE public.social_content_assets
    DROP CONSTRAINT IF EXISTS social_content_assets_type_check;

ALTER TABLE public.social_content_assets
    ADD CONSTRAINT social_content_assets_type_check CHECK (
        asset_type IN ('slide', 'manifest', 'publishing_slide')
    );

ALTER TABLE public.social_content_assets
    DROP CONSTRAINT IF EXISTS social_content_assets_mime_check;

ALTER TABLE public.social_content_assets
    ADD CONSTRAINT social_content_assets_mime_check CHECK (
        mime_type IN ('image/png', 'image/jpeg', 'application/json')
    );

-- 5. Row Level Security (RLS)
ALTER TABLE public.social_content_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_publication_events ENABLE ROW LEVEL SECURITY;

-- 6. Permissions & Grants
REVOKE ALL ON TABLE public.social_content_publications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.social_content_publication_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_content_publications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_content_publication_events TO service_role;
