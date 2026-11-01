-- ==============================================================================
-- Migration: 20261101000100_create_ingest_news_articles_function.sql
-- Description: Create public.ingest_news_articles function for safe batch news ingestion and upsert.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.ingest_news_articles(p_articles JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_affected_count INTEGER := 0;
BEGIN
    -- 1. Validate that input is a non-null JSON array
    IF p_articles IS NULL OR jsonb_typeof(p_articles) <> 'array' THEN
        RAISE EXCEPTION 'p_articles must be a non-null JSON array';
    END IF;

    -- 2. Return 0 immediately if array is empty
    IF jsonb_array_length(p_articles) = 0 THEN
        RETURN 0;
    END IF;

    -- 3. Perform atomic batch upsert with deterministic in-batch URL deduplication
    WITH raw_elements AS (
        SELECT
            trim(elem->>'title') AS title,
            trim(elem->>'description') AS description,
            trim(elem->>'url') AS url,
            ord
        FROM jsonb_array_elements(p_articles) WITH ORDINALITY AS item(elem, ord)
        WHERE jsonb_typeof(elem) = 'object'
          AND jsonb_typeof(elem->'title') = 'string'
          AND jsonb_typeof(elem->'description') = 'string'
          AND jsonb_typeof(elem->'url') = 'string'
          AND trim(elem->>'title') ~ '[^[:space:]]'
          AND trim(elem->>'description') ~ '[^[:space:]]'
          AND trim(elem->>'url') ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$'
    ),
    deduplicated_articles AS (
        SELECT DISTINCT ON (url)
            title,
            description,
            url
        FROM raw_elements
        ORDER BY url, ord DESC
    ),
    upserted_rows AS (
        INSERT INTO public.news_articles (title, description, url)
        SELECT 
            title, 
            description, 
            url
        FROM deduplicated_articles
        ON CONFLICT (url) DO UPDATE
        SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            last_seen_at = NOW()
        RETURNING 1
    )
    SELECT COUNT(*)::INTEGER INTO v_affected_count FROM upserted_rows;

    RETURN v_affected_count;
END;
$$;

-- Function execution security
-- Revoke all privileges from PUBLIC, anon, and authenticated roles to ensure strict backend isolation
REVOKE ALL ON FUNCTION public.ingest_news_articles(JSONB) FROM PUBLIC, anon, authenticated;

-- Explicitly grant execute privilege to service_role for backend Cloudflare Worker access
GRANT EXECUTE ON FUNCTION public.ingest_news_articles(JSONB) TO service_role;