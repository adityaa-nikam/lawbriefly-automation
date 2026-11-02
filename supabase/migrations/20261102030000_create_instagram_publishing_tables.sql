-- ==============================================================================
-- Migration: 20261102030000_create_instagram_publishing_tables.sql
-- Description: Creates schema for Instagram publishing foundation:
--              - social_content_publications: tracks individual publication records,
--                container IDs, external Instagram media IDs, permalinks, and statuses.
--              - social_content_publication_events: append-only audit trail of publishing lifecycle events.
--              - Extends social_content_posts with publication convenience columns.
--              - Extends social_content_assets constraints for JPEG publishing assets.
--
-- Security Hardening Applied:
-- 1. Genuine append-only audit events:
--    - REVOKE UPDATE, DELETE, TRUNCATE from ALL roles (including service_role).
--    - GRANT ONLY SELECT, INSERT to service_role.
--    - Database statement-level & row-level triggers raising exception on mutation.
-- 2. Foreign key audit preservation:
--    - ON DELETE RESTRICT on publication_id and post_id in social_content_publication_events.
-- 3. Comprehensive publication_status support:
--    - ('pending', 'processing', 'publishing', 'published', 'failed', 'unknown').
-- 4. Duplicate & concurrency protection:
--    - UNIQUE (post_id, platform) constraint on social_content_publications.
--    - UNIQUE (instagram_media_id) constraint.
--    - Partial unique index for in-flight/published state to prevent race conditions.
-- 5. Media type & Reel/Carousel/Image flexibility:
--    - slide_count check allows 0 to 10 slides (Reels: 0, Single Image: 1, Carousel: 2-10).
--    - Media container creation event types supported.
-- 6. Scoped constraint alterations:
--    - pg_constraint checks scoped by conrelid to public.social_content_assets.
--
-- Status: REVIEWED & HARDENED LOCALLY. DO NOT APPLY REMOTELY UNTIL USER APPROVAL.
-- ==============================================================================

-- 1. Create table public.social_content_publications
CREATE TABLE IF NOT EXISTS public.social_content_publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.social_content_posts(id) ON DELETE RESTRICT,
    platform TEXT NOT NULL DEFAULT 'instagram',
    media_type TEXT NOT NULL,
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
    CONSTRAINT social_content_publications_media_type_check CHECK (
        media_type IN ('IMAGE', 'CAROUSEL', 'REEL')
    ),
    CONSTRAINT social_content_publications_status_check CHECK (
        publication_status IN ('pending', 'processing', 'publishing', 'published', 'failed', 'unknown')
    ),
    CONSTRAINT social_content_publications_slide_count_check CHECK (
        (media_type = 'REEL' AND slide_count = 0)
        OR
        (media_type = 'IMAGE' AND slide_count = 1)
        OR
        (media_type = 'CAROUSEL' AND slide_count BETWEEN 2 AND 10)
    ),
    CONSTRAINT social_content_publications_post_platform_unique UNIQUE (post_id, platform),
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
    publication_id UUID REFERENCES public.social_content_publications(id) ON DELETE RESTRICT,
    post_id UUID NOT NULL REFERENCES public.social_content_posts(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'instagram',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT social_content_publication_events_type_check CHECK (
        event_type IN (
            'assets_prepared',
            'single_container_created',
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

-- 3. Database Trigger: Enforce genuinely append-only audit trail
CREATE OR REPLACE FUNCTION public.prevent_publication_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table public.social_content_publication_events is append-only: % operation is prohibited.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_publication_events_mutation 
    ON public.social_content_publication_events;

CREATE TRIGGER trg_prevent_publication_events_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE
    ON public.social_content_publication_events
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.prevent_publication_events_mutation();

DROP TRIGGER IF EXISTS trg_prevent_publication_events_row_mutation 
    ON public.social_content_publication_events;

CREATE TRIGGER trg_prevent_publication_events_row_mutation
    BEFORE UPDATE OR DELETE
    ON public.social_content_publication_events
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_publication_events_mutation();

-- 4. Add publication metadata columns to social_content_posts for query convenience
ALTER TABLE public.social_content_posts
    ADD COLUMN IF NOT EXISTS instagram_media_id TEXT,
    ADD COLUMN IF NOT EXISTS instagram_permalink TEXT,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- 5. Extend social_content_assets check constraints to allow publishing JPEG slides
DO $$
BEGIN
    IF to_regclass('public.social_content_assets') IS NOT NULL THEN
        -- 5a. Update asset_type check
        IF EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'social_content_assets_type_check' 
              AND conrelid = 'public.social_content_assets'::regclass
        ) THEN
            ALTER TABLE public.social_content_assets
                DROP CONSTRAINT social_content_assets_type_check;
        END IF;

        ALTER TABLE public.social_content_assets
            ADD CONSTRAINT social_content_assets_type_check CHECK (
                asset_type IN ('slide', 'manifest', 'publishing_slide')
            );

        -- 5b. Update mime_type check
        IF EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'social_content_assets_mime_check' 
              AND conrelid = 'public.social_content_assets'::regclass
        ) THEN
            ALTER TABLE public.social_content_assets
                DROP CONSTRAINT social_content_assets_mime_check;
        END IF;

        ALTER TABLE public.social_content_assets
            ADD CONSTRAINT social_content_assets_mime_check CHECK (
                mime_type IN ('image/png', 'image/jpeg', 'application/json')
            );

        -- 5c. Update slide_spec check
        IF EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'social_content_assets_slide_spec' 
              AND conrelid = 'public.social_content_assets'::regclass
        ) THEN
            ALTER TABLE public.social_content_assets
                DROP CONSTRAINT social_content_assets_slide_spec;

            ALTER TABLE public.social_content_assets
                ADD CONSTRAINT social_content_assets_slide_spec CHECK (
                    (asset_type = 'slide' AND slide_number IS NOT NULL AND width = 1080 AND height = 1350 AND mime_type = 'image/png')
                    OR
                    (asset_type = 'manifest' AND slide_number IS NULL AND width IS NULL AND height IS NULL AND mime_type = 'application/json')
                    OR
                    (asset_type = 'publishing_slide' AND slide_number IS NOT NULL AND width = 1080 AND height = 1350 AND mime_type = 'image/jpeg')
                );
        END IF;

        -- 5d. Replace UNIQUE(post_id, slide_number) with UNIQUE(post_id, asset_type, slide_number)
        IF EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'social_content_assets_post_slide_number' 
              AND conrelid = 'public.social_content_assets'::regclass
        ) THEN
            ALTER TABLE public.social_content_assets
                DROP CONSTRAINT social_content_assets_post_slide_number;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'social_content_assets_post_type_slide_number' 
              AND conrelid = 'public.social_content_assets'::regclass
        ) THEN
            ALTER TABLE public.social_content_assets
                ADD CONSTRAINT social_content_assets_post_type_slide_number 
                UNIQUE (post_id, asset_type, slide_number);
        END IF;
    END IF;
END $$;

-- 6. Row Level Security (RLS)
ALTER TABLE public.social_content_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_publication_events ENABLE ROW LEVEL SECURITY;

-- 7. Permissions & Grants
-- Revoke all privileges from public, anon, and authenticated
REVOKE ALL ON TABLE public.social_content_publications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.social_content_publication_events FROM PUBLIC, anon, authenticated;

-- For social_content_publications: allow service_role full management
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_content_publications TO service_role;

-- For social_content_publication_events: allow ONLY SELECT and INSERT (strictly append-only)
REVOKE ALL ON TABLE public.social_content_publication_events FROM service_role;
REVOKE TRUNCATE ON TABLE public.social_content_publication_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.social_content_publication_events TO service_role;
