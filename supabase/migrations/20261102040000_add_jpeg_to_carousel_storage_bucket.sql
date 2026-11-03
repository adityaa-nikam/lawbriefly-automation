-- ==============================================================================
-- Migration: 20261102040000_add_jpeg_to_carousel_storage_bucket.sql
-- Description: Adds 'image/jpeg' to the allowed MIME types for the private storage
--              bucket 'lawbriefly-carousel-assets', while strictly preserving
--              existing allowed types ('image/png', 'application/json') and
--              all existing bucket security properties (public = false, 5MB limit).
--              Updates database constraints scoped by conrelid to public.social_content_assets.
--
-- Status: REVIEWED. DO NOT APPLY REMOTELY UNTIL USER APPROVAL.
-- ==============================================================================

-- 1. Safely update allowed MIME types on target storage bucket
DO $$
DECLARE
    v_bucket_id text := 'lawbriefly-carousel-assets';
    v_updated_rows integer;
BEGIN
    -- Fail clearly if target storage bucket does not exist
    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = v_bucket_id
    ) THEN
        RAISE EXCEPTION 'Target storage bucket "%" does not exist in storage.buckets.', v_bucket_id;
    END IF;

    -- Update allowed MIME types while preserving public=false and existing limits
    UPDATE storage.buckets
    SET 
        allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'application/json'],
        updated_at = NOW()
    WHERE id = v_bucket_id;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
        RAISE EXCEPTION 'Failed to update storage bucket "%": 0 rows affected.', v_bucket_id;
    END IF;
END $$;

-- 2. Update social_content_assets constraints scoped by conrelid
DO $$
BEGIN
    -- Only alter constraints if public.social_content_assets table exists
    IF to_regclass('public.social_content_assets') IS NOT NULL THEN

        -- 2a. Update social_content_assets_type_check (preserve 'slide', 'manifest'; add 'publishing_slide')
        IF EXISTS (
            SELECT 1 
            FROM pg_constraint 
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

        -- 2b. Update social_content_assets_mime_check (preserve 'image/png', 'application/json'; add 'image/jpeg')
        IF EXISTS (
            SELECT 1 
            FROM pg_constraint 
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

        -- 2c. Update social_content_assets_slide_spec if present to permit publishing_slide / JPEG
        IF EXISTS (
            SELECT 1 
            FROM pg_constraint 
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

        -- 2d. Replace UNIQUE(post_id, slide_number) with UNIQUE(post_id, asset_type, slide_number)
        IF EXISTS (
            SELECT 1 
            FROM pg_constraint 
            WHERE conname = 'social_content_assets_post_slide_number'
              AND conrelid = 'public.social_content_assets'::regclass
        ) THEN
            ALTER TABLE public.social_content_assets 
                DROP CONSTRAINT social_content_assets_post_slide_number;
        END IF;

        IF NOT EXISTS (
            SELECT 1 
            FROM pg_constraint 
            WHERE conname = 'social_content_assets_post_type_slide_number'
              AND conrelid = 'public.social_content_assets'::regclass
        ) THEN
            ALTER TABLE public.social_content_assets 
                ADD CONSTRAINT social_content_assets_post_type_slide_number 
                UNIQUE (post_id, asset_type, slide_number);
        END IF;

    END IF;
END $$;
