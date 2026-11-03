-- ==============================================================================
-- Migration: 20261103000100_remove_legacy_carousel_asset_constraints.sql
-- Description: Replaces legacy carousel asset shape and type constraints on
--              public.social_content_assets with canonical, database-level validation
--              covering all three asset types (slide, publishing_slide, manifest),
--              and safely drops obsolete legacy constraints:
--              1. social_content_assets_asset_type_check (superseded by social_content_assets_type_check)
--              2. social_content_assets_type_shape_check (superseded by social_content_assets_slide_spec)
--
-- Preserved Database Invariants:
-- - slide:
--     asset_type IS NOT NULL AND asset_type = 'slide'
--     slide_number IS NOT NULL AND slide_number BETWEEN 1 AND 6
--     width IS NOT NULL AND width = 1080
--     height IS NOT NULL AND height = 1350
--     mime_type IS NOT NULL AND mime_type = 'image/png'
--     asset_key IS NOT NULL AND asset_key ~ '^slide-[0-9]{2}$'
-- - publishing_slide:
--     asset_type IS NOT NULL AND asset_type = 'publishing_slide'
--     slide_number IS NOT NULL AND slide_number BETWEEN 1 AND 6
--     width IS NOT NULL AND width = 1080
--     height IS NOT NULL AND height = 1350
--     mime_type IS NOT NULL AND mime_type = 'image/jpeg'
--     asset_key IS NOT NULL AND asset_key ~ '^slide-[0-9]{2}-jpeg$'
-- - manifest:
--     asset_type IS NOT NULL AND asset_type = 'manifest'
--     slide_number IS NULL
--     width IS NULL, height IS NULL
--     mime_type IS NOT NULL AND mime_type = 'application/json'
--     asset_key IS NOT NULL AND asset_key = 'manifest'
--
-- Safety & Verification Steps:
-- 1. Table existence verification scoped to public.social_content_assets via conrelid.
-- 2. Exact definition verification of all canonical constraints on target table.
-- 3. Pre-flight check of all existing rows using "WHERE (<expression>) IS NOT TRUE".
-- 4. Establishment of canonical replacement constraint social_content_assets_slide_spec
--    with identical validation expression and explicit IS NOT NULL checks.
-- 5. Verification that replacement constraint is fully validated (convalidated = true).
-- 6. Safe, idempotent removal of ONLY the two obsolete legacy constraints.
-- 7. Preservation of existing data, unique indexes, storage path check, RLS, and permissions.
--
-- Status: PREPARED LOCALLY. DO NOT APPLY REMOTELY UNTIL USER APPROVAL.
-- ==============================================================================

DO $$
DECLARE
    v_table_rel regclass;
    v_def text;
    v_violating_count bigint;
BEGIN
    -- 1. Verify target table existence
    v_table_rel := to_regclass('public.social_content_assets');
    IF v_table_rel IS NULL THEN
        RAISE EXCEPTION 'Table public.social_content_assets does not exist.';
    END IF;

    -- 2. Verify all canonical constraints by their exact definitions
    -- 2a. Canonical asset_type check (must permit slide, manifest, publishing_slide)
    SELECT pg_get_constraintdef(c.oid, true) INTO v_def
    FROM pg_constraint c
    WHERE c.conname = 'social_content_assets_type_check' AND c.conrelid = v_table_rel;

    IF v_def IS NULL OR v_def NOT LIKE '%slide%' OR v_def NOT LIKE '%manifest%' OR v_def NOT LIKE '%publishing_slide%' THEN
        RAISE EXCEPTION 'Canonical constraint social_content_assets_type_check missing or definition invalid: %', v_def;
    END IF;

    -- 2b. Canonical mime_type check (must permit image/png, image/jpeg, application/json)
    SELECT pg_get_constraintdef(c.oid, true) INTO v_def
    FROM pg_constraint c
    WHERE c.conname = 'social_content_assets_mime_check' AND c.conrelid = v_table_rel;

    IF v_def IS NULL OR v_def NOT LIKE '%image/png%' OR v_def NOT LIKE '%image/jpeg%' OR v_def NOT LIKE '%application/json%' THEN
        RAISE EXCEPTION 'Canonical constraint social_content_assets_mime_check missing or definition invalid: %', v_def;
    END IF;

    -- 2c. Canonical dual-format unique constraint: UNIQUE (post_id, asset_type, slide_number)
    SELECT pg_get_constraintdef(c.oid, true) INTO v_def
    FROM pg_constraint c
    WHERE c.conname = 'social_content_assets_post_type_slide_number' AND c.conrelid = v_table_rel;

    IF v_def IS NULL OR v_def <> 'UNIQUE (post_id, asset_type, slide_number)' THEN
        RAISE EXCEPTION 'Canonical constraint social_content_assets_post_type_slide_number missing or definition invalid: %', v_def;
    END IF;

    -- 2d. Canonical post_asset_key unique constraint: UNIQUE (post_id, asset_key)
    SELECT pg_get_constraintdef(c.oid, true) INTO v_def
    FROM pg_constraint c
    WHERE c.conname = 'social_content_assets_post_asset_key_unique' AND c.conrelid = v_table_rel;

    IF v_def IS NULL OR v_def <> 'UNIQUE (post_id, asset_key)' THEN
        RAISE EXCEPTION 'Canonical constraint social_content_assets_post_asset_key_unique missing or definition invalid: %', v_def;
    END IF;

    -- 2e. Canonical storage_path unique constraint: UNIQUE (storage_path)
    SELECT pg_get_constraintdef(c.oid, true) INTO v_def
    FROM pg_constraint c
    WHERE c.conname = 'social_content_assets_storage_path_key' AND c.conrelid = v_table_rel;

    IF v_def IS NULL OR v_def <> 'UNIQUE (storage_path)' THEN
        RAISE EXCEPTION 'Canonical constraint social_content_assets_storage_path_key missing or definition invalid: %', v_def;
    END IF;

    -- 2f. Canonical storage bucket constraint: CHECK (storage_bucket = 'lawbriefly-carousel-assets')
    SELECT pg_get_constraintdef(c.oid, true) INTO v_def
    FROM pg_constraint c
    WHERE c.conname = 'social_content_assets_storage_bucket_check' AND c.conrelid = v_table_rel;

    IF v_def IS NULL OR v_def NOT LIKE '%lawbriefly-carousel-assets%' THEN
        RAISE EXCEPTION 'Canonical constraint social_content_assets_storage_bucket_check missing or definition invalid: %', v_def;
    END IF;

    -- 2g. Canonical post path constraint: CHECK (storage_path LIKE 'posts/' || post_id || '/%')
    SELECT pg_get_constraintdef(c.oid, true) INTO v_def
    FROM pg_constraint c
    WHERE c.conname = 'social_content_assets_post_path_check' AND c.conrelid = v_table_rel;

    IF v_def IS NULL OR v_def NOT LIKE '%posts/%' OR v_def NOT LIKE '%post_id%' THEN
        RAISE EXCEPTION 'Canonical constraint social_content_assets_post_path_check missing or definition invalid: %', v_def;
    END IF;

    -- 2h. Canonical sha256 checksum format constraint
    SELECT pg_get_constraintdef(c.oid, true) INTO v_def
    FROM pg_constraint c
    WHERE c.conname = 'social_content_assets_sha256_check' AND c.conrelid = v_table_rel;

    IF v_def IS NULL OR v_def NOT LIKE '%[0-9a-f]{64}%' THEN
        RAISE EXCEPTION 'Canonical constraint social_content_assets_sha256_check missing or definition invalid: %', v_def;
    END IF;

    -- 2i. Canonical positive size constraint
    SELECT pg_get_constraintdef(c.oid, true) INTO v_def
    FROM pg_constraint c
    WHERE c.conname = 'social_content_assets_size_bytes_check' AND c.conrelid = v_table_rel;

    IF v_def IS NULL OR v_def NOT LIKE '%size_bytes > 0%' THEN
        RAISE EXCEPTION 'Canonical constraint social_content_assets_size_bytes_check missing or definition invalid: %', v_def;
    END IF;

    -- 3. Pre-flight check: verify all existing rows using "(<replacement expression>) IS NOT TRUE"
    SELECT COUNT(*) INTO v_violating_count
    FROM public.social_content_assets
    WHERE (
        (
            asset_type IS NOT NULL
            AND asset_type = 'slide'
            AND slide_number IS NOT NULL
            AND slide_number BETWEEN 1 AND 6
            AND width IS NOT NULL
            AND width = 1080
            AND height IS NOT NULL
            AND height = 1350
            AND mime_type IS NOT NULL
            AND mime_type = 'image/png'
            AND asset_key IS NOT NULL
            AND asset_key ~ '^slide-[0-9]{2}$'
        )
        OR
        (
            asset_type IS NOT NULL
            AND asset_type = 'publishing_slide'
            AND slide_number IS NOT NULL
            AND slide_number BETWEEN 1 AND 6
            AND width IS NOT NULL
            AND width = 1080
            AND height IS NOT NULL
            AND height = 1350
            AND mime_type IS NOT NULL
            AND mime_type = 'image/jpeg'
            AND asset_key IS NOT NULL
            AND asset_key ~ '^slide-[0-9]{2}-jpeg$'
        )
        OR
        (
            asset_type IS NOT NULL
            AND asset_type = 'manifest'
            AND slide_number IS NULL
            AND width IS NULL
            AND height IS NULL
            AND mime_type IS NOT NULL
            AND mime_type = 'application/json'
            AND asset_key IS NOT NULL
            AND asset_key = 'manifest'
        )
    ) IS NOT TRUE;

    IF v_violating_count > 0 THEN
        RAISE EXCEPTION 'Pre-flight check failed: % existing rows violate the replacement specification (evaluated as NOT TRUE).', v_violating_count;
    END IF;

    -- 4. Establish canonical replacement constraint social_content_assets_slide_spec
    -- Drop existing social_content_assets_slide_spec if present to ensure clean idempotent replacement
    IF EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'social_content_assets_slide_spec' 
          AND conrelid = v_table_rel
    ) THEN
        ALTER TABLE public.social_content_assets 
            DROP CONSTRAINT social_content_assets_slide_spec;
    END IF;

    ALTER TABLE public.social_content_assets
        ADD CONSTRAINT social_content_assets_slide_spec CHECK (
            (
                asset_type IS NOT NULL
                AND asset_type = 'slide'
                AND slide_number IS NOT NULL
                AND slide_number BETWEEN 1 AND 6
                AND width IS NOT NULL
                AND width = 1080
                AND height IS NOT NULL
                AND height = 1350
                AND mime_type IS NOT NULL
                AND mime_type = 'image/png'
                AND asset_key IS NOT NULL
                AND asset_key ~ '^slide-[0-9]{2}$'
            )
            OR
            (
                asset_type IS NOT NULL
                AND asset_type = 'publishing_slide'
                AND slide_number IS NOT NULL
                AND slide_number BETWEEN 1 AND 6
                AND width IS NOT NULL
                AND width = 1080
                AND height IS NOT NULL
                AND height = 1350
                AND mime_type IS NOT NULL
                AND mime_type = 'image/jpeg'
                AND asset_key IS NOT NULL
                AND asset_key ~ '^slide-[0-9]{2}-jpeg$'
            )
            OR
            (
                asset_type IS NOT NULL
                AND asset_type = 'manifest'
                AND slide_number IS NULL
                AND width IS NULL
                AND height IS NULL
                AND mime_type IS NOT NULL
                AND mime_type = 'application/json'
                AND asset_key IS NOT NULL
                AND asset_key = 'manifest'
            )
        );

    -- 5. Verify the replacement constraint is fully validated (convalidated = true)
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'social_content_assets_slide_spec' 
          AND conrelid = v_table_rel 
          AND convalidated = true
    ) THEN
        RAISE EXCEPTION 'Constraint social_content_assets_slide_spec was created but is not marked as validated (convalidated = true).';
    END IF;

    RAISE NOTICE 'Added validated canonical replacement constraint "social_content_assets_slide_spec" to public.social_content_assets.';

    -- 6. Drop ONLY the two obsolete legacy constraints
    -- 6a. Drop obsolete social_content_assets_asset_type_check
    IF EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'social_content_assets_asset_type_check' 
          AND conrelid = v_table_rel
    ) THEN
        ALTER TABLE public.social_content_assets 
            DROP CONSTRAINT social_content_assets_asset_type_check;
        RAISE NOTICE 'Dropped obsolete legacy constraint "social_content_assets_asset_type_check".';
    END IF;

    -- 6b. Drop obsolete social_content_assets_type_shape_check
    IF EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'social_content_assets_type_shape_check' 
          AND conrelid = v_table_rel
    ) THEN
        ALTER TABLE public.social_content_assets 
            DROP CONSTRAINT social_content_assets_type_shape_check;
        RAISE NOTICE 'Dropped obsolete legacy constraint "social_content_assets_type_shape_check".';
    END IF;

END $$;
