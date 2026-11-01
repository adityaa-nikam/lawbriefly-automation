# LawBriefly Automation — Supabase Database Architecture

This directory contains the database migration scripts and architecture documentation for the LawBriefly Automation backend.

---

## 1. Database Purpose

The database acts as the persistent store for legal news retrieved from the LawBriefly API. It serves to:
- Ingest and store news articles periodically fetched by the Cloudflare Worker.
- Deduplicate incoming news articles based on their canonical source URL.
- Track when an article was first discovered (`first_seen_at`) and when it was most recently confirmed active in the upstream feed (`last_seen_at`).
- Form the foundation for downstream automation phases (e.g., AI topic extraction, summary generation, and social media dispatch).

---

## 2. Table Schema: `public.news_articles`

### Columns

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | `NOT NULL` | `gen_random_uuid()` | Primary key uniquely identifying each stored article record. |
| `title` | `TEXT` | `NOT NULL` | — | The headline or title of the legal news article. Cannot be empty or whitespace-only. |
| `description` | `TEXT` | `NOT NULL` | — | Summary or description snippet provided by the API. Cannot be empty or whitespace-only. |
| `url` | `TEXT` | `NOT NULL` | — | Canonical web URL of the original article. Must be a valid `http://` or `https://` URL and must be unique. |
| `first_seen_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` | Timestamp marking the initial time this article was first ingested. |
| `last_seen_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` | Timestamp marking the most recent polling cycle in which this article was returned by the API. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` | System record creation timestamp. |

### Constraints

- **Primary Key**: `PRIMARY KEY (id)`
- **Unique URL**: `CONSTRAINT news_articles_url_key UNIQUE (url)` — Guarantees no two rows have the same article link.
- **Title Validation**: `CONSTRAINT news_articles_title_not_empty CHECK (title ~ '[^[:space:]]')` — Enforces that titles contain at least one non-whitespace character.
- **Description Validation**: `CONSTRAINT news_articles_description_not_empty CHECK (description ~ '[^[:space:]]')` — Enforces that descriptions contain at least one non-whitespace character.
- **URL Format**: `CONSTRAINT news_articles_url_valid CHECK (url ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')` — Enforces valid HTTP/HTTPS URI protocol, valid authority, and no whitespace characters.

### Indexes

- `news_articles_url_key` (B-tree on `url`): Automatically created by the `UNIQUE` constraint for fast duplicate checking.
- `idx_news_articles_first_seen_at` (B-tree on `first_seen_at DESC`): Optimizes chronological filtering and sorting for newly ingested articles.
- `idx_news_articles_last_seen_at` (B-tree on `last_seen_at DESC`): Optimizes freshness queries and cleanup routines.

---

## 3. URL-Based Duplicate Prevention Design

The LawBriefly API returns articles across overlapping rolling windows (e.g., `days=7`). To prevent storing redundant copies of the same article:

1. **Conflict Target**: The `url` column serves as the unique identifier and natural deduplication key.
2. **Upsert Strategy**: In the future database integration phase, ingestion will use PostgreSQL `UPSERT` semantics:
   ```sql
   INSERT INTO public.news_articles (title, description, url, first_seen_at, last_seen_at, created_at)
   VALUES ($1, $2, $3, NOW(), NOW(), NOW())
   ON CONFLICT (url) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       last_seen_at = NOW();
   ```
3. **Data Integrity Outcomes**:
   - **New article**: Inserted with new `id`, setting both `first_seen_at` and `last_seen_at` to the current timestamp.
   - **Existing article**: Existing row is updated in place:
     - `title` and `description` are updated if modified upstream.
     - `last_seen_at` is bumped to `NOW()`.
     - `first_seen_at` is preserved untouched.
     - `created_at` and `id` are preserved untouched.

---

## 4. Security and Row Level Security (RLS)

### Why RLS is Enabled

Even though client-side access is not used in this project, enabling RLS is a defense-in-depth standard in Supabase. By default, any table with RLS enabled and zero policies blocks all access through standard PostgREST / public API gateways.

### Backend-Only Access via `service_role`

1. **Zero Public/Client Access**:
   - Privileges are explicitly revoked from `PUBLIC`, `anon`, and `authenticated` roles:
     ```sql
     REVOKE ALL ON TABLE public.news_articles FROM PUBLIC, anon, authenticated;
     ```
   - No public RLS policies are created. Any request made using the Supabase publishable/anon key will be denied with HTTP 401/403.
2. **Dedicated Backend Privileges**:
   - The Cloudflare Worker will connect securely using the private Supabase `service_role` secret key.
   - The `service_role` has full `SELECT`, `INSERT`, `UPDATE`, and `DELETE` table privileges:
     ```sql
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.news_articles TO service_role;
     ```
   - In Supabase, the `service_role` key automatically bypasses RLS policies while strictly obeying explicit PostgreSQL table grants.

---

---

## 5. Ingestion RPC: `public.ingest_news_articles(p_articles JSONB)`

To perform atomic batch upserting safely with in-batch URL deduplication, the `public.ingest_news_articles` database function is defined in [`supabase/migrations/20261101000100_create_ingest_news_articles_function.sql`](file:///c:/Users/adiit/Desktop/lawbriefly-automation/supabase/migrations/20261101000100_create_ingest_news_articles_function.sql).

### Function Signature & Behavior
- **Parameter**: `p_articles JSONB` — Array of JSON objects `[ { "title": "...", "description": "...", "url": "..." }, ... ]`.
- **Validation**:
  - Rejects `NULL` or non-array inputs with an exception.
  - Returns `0` immediately for empty arrays (`[]`).
  - Validates that each element is a JSON object with string `title`, `description`, and `url` properties.
  - Rejects null, empty, or whitespace-only titles and descriptions.
  - Validates HTTP/HTTPS URLs against the table check constraint.
  - Applies `WITH ORDINALITY` and `DISTINCT ON (url) ... ORDER BY url, ord DESC` to deterministically retain the last occurrence if duplicate URLs appear in the batch and prevent conflict errors.
- **Upsert Semantics**:
  - If URL is new: Inserts row using table defaults (`id = gen_random_uuid()`, `first_seen_at = NOW()`, `last_seen_at = NOW()`, `created_at = NOW()`).
  - If URL exists: Updates `title = EXCLUDED.title`, `description = EXCLUDED.description`, and `last_seen_at = NOW()`. Preserves `id`, `first_seen_at`, and `created_at`.
- **Returns**: `INTEGER` — Total number of database rows inserted or updated.
- **Security**:
  - `SECURITY INVOKER`
  - Hardened `search_path = ''` (prevents search path injection; built-in functions resolve through `pg_catalog`, table reference is fully qualified as `public.news_articles`).
  - `REVOKE ALL` from `PUBLIC`, `anon`, and `authenticated`.
  - `GRANT EXECUTE` to `service_role` only.

---

## 6. How to Apply Migrations Manually

To execute migrations in your Supabase project:

1. Open your browser and navigate to the [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project.
3. In the left-hand navigation menu, click on the **SQL Editor** icon (`>_`).
4. Click **New query** (or open an empty query tab).

### Initial Table Migration
- File: [`supabase/migrations/20261031000100_create_news_articles.sql`](file:///c:/Users/adiit/Desktop/lawbriefly-automation/supabase/migrations/20261031000100_create_news_articles.sql)
- Copy contents into the SQL Editor, click **Run**, and verify the `public.news_articles` table is created with RLS enabled.

### Ingestion Function Migration
- File: [`supabase/migrations/20261101000100_create_ingest_news_articles_function.sql`](file:///c:/Users/adiit/Desktop/lawbriefly-automation/supabase/migrations/20261101000100_create_ingest_news_articles_function.sql)
- Copy contents into the SQL Editor, click **Run**, and verify the `public.ingest_news_articles` function is created with `service_role` execute permissions.
