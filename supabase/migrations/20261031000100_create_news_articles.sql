-- ==============================================================================
-- Migration: 20261031000100_create_news_articles.sql
-- Description: Create news_articles table with constraints, indexes, RLS, and service_role permissions.
-- ==============================================================================

-- 1. Create table public.news_articles
CREATE TABLE IF NOT EXISTS public.news_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    url TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT news_articles_url_key UNIQUE (url),
    CONSTRAINT news_articles_title_not_empty CHECK (title ~ '[^[:space:]]'),
    CONSTRAINT news_articles_description_not_empty CHECK (description ~ '[^[:space:]]'),
    CONSTRAINT news_articles_url_valid CHECK (url ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')
);

-- 2. Performance indexes
-- Speeds up queries sorting/filtering by ingestion date
CREATE INDEX IF NOT EXISTS idx_news_articles_first_seen_at
    ON public.news_articles (first_seen_at DESC);

-- Speeds up queries sorting/filtering by latest update date
CREATE INDEX IF NOT EXISTS idx_news_articles_last_seen_at
    ON public.news_articles (last_seen_at DESC);

-- 3. Row Level Security (RLS)
-- Enable RLS to enforce zero public/client-side access
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;

-- 4. Schema and Table Permissions
-- Grant schema usage to service_role
GRANT USAGE ON SCHEMA public TO service_role;

-- Revoke all privileges from PUBLIC, anon, and authenticated roles to ensure strict backend isolation
REVOKE ALL ON TABLE public.news_articles FROM PUBLIC, anon, authenticated;

-- Explicitly grant CRUD privileges to service_role for backend Cloudflare Worker access
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.news_articles TO service_role;
