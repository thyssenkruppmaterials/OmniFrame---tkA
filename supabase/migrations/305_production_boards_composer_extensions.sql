-- ============================================================================
-- Migration 305 — Production Boards Composer extensions
--
-- Authored 2026-05-17 as part of the unified Post Composer dialog work that
-- replaces the four per-board editor sheets (Announcements, HR News, Jobs,
-- Safety Alerts) with a single shared `<PostComposerDialog>`.
--
-- Three concerns, all additive — no destructive changes:
--
-- 1. Schedule + lifecycle: every post / job gains `is_published` (draft
--    toggle), and posts gain `reprompt_interval_minutes` (alert-timer for
--    safety alerts that recurringly re-prompt acknowledgement).
-- 2. Attachments + per-kind extras: both tables gain `attachments JSONB`
--    (ordered list of uploaded media) and `kind_data JSONB` (per-kind
--    extras like job's pay range or safety alert's hazard type — anything
--    that doesn't earn a dedicated column today).
-- 3. Priority + active-only views: a four-state `priority` enum-like text
--    column powers the curator-controlled ordering (low / normal / high /
--    pinned, with `pinned` superseding the legacy `is_pinned` boolean for
--    the composer surface while staying backwards-compatible). Two views
--    (`v_active_board_posts`, `v_active_board_jobs`) bake the
--    "live + not-expired + published" filter so the boards' read paths
--    inherit the timer / scheduling semantics for free.
--
-- Storage: the existing `production-board-images` bucket is repurposed for
-- post attachments. Its allowed_mime_types whitelist is extended to include
-- PDF so the composer can attach supporting documents (toolbox talks,
-- safety briefings, job descriptions) alongside images. RLS is unchanged
-- (still gated on `production_boards:edit`).
--
-- See:
--   - memorybank/OmniFrame/Decisions/ADR-Board-Posts-Schema-Extension.md
--   - memorybank/OmniFrame/Implementations/Implement-Production-Boards-Post-Composer.md
--   - memorybank/OmniFrame/Patterns/Production-Boards-Post-Composer.md
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1.  Composer extensions to production_board_posts
-- ----------------------------------------------------------------------------

ALTER TABLE production_board_posts
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS kind_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reprompt_interval_minutes INTEGER;

-- Priority enum-like CHECK. Idempotent: drop-then-add so re-running the
-- migration after a constraint rename is safe.
ALTER TABLE production_board_posts
  DROP CONSTRAINT IF EXISTS production_board_posts_priority_check;

ALTER TABLE production_board_posts
  ADD CONSTRAINT production_board_posts_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'pinned'));

-- Reprompt interval is only meaningful on safety_alert posts where
-- acknowledged_required = true. The check allows NULL (no recurring
-- prompt) and positive intervals; safety alerts can be re-prompted as
-- frequently as every 5 minutes, capped at a week to avoid runaway
-- notifications.
ALTER TABLE production_board_posts
  DROP CONSTRAINT IF EXISTS production_board_posts_reprompt_check;

ALTER TABLE production_board_posts
  ADD CONSTRAINT production_board_posts_reprompt_check
  CHECK (
    reprompt_interval_minutes IS NULL
    OR (reprompt_interval_minutes BETWEEN 5 AND 10080)
  );

-- Backfill priority = 'pinned' for any legacy row with is_pinned = true so
-- the composer's priority dropdown reflects the existing state on first
-- open. is_pinned stays as the source-of-truth column for the board card's
-- pinned badge (PostCard reads it); priority is the editor's higher-level
-- knob that ALSO writes is_pinned on save.
UPDATE production_board_posts
  SET priority = 'pinned'
  WHERE is_pinned = TRUE AND priority = 'normal';

CREATE INDEX IF NOT EXISTS idx_production_board_posts_active
  ON production_board_posts (organization_id, scope, published_at DESC)
  WHERE is_published = TRUE;

-- ----------------------------------------------------------------------------
-- 2.  Composer extensions to production_board_job_postings
--
-- Jobs already have `closes_at` for the deadline, `is_internal`,
-- `apply_url/email`. They gain the same composer-uniform columns so the
-- shared dialog can persist attachments + kind_data + draft / priority
-- toggles. There is no `expires_at` separate from `closes_at` — that field
-- has dual meaning (application deadline = post lifecycle for jobs).
-- ----------------------------------------------------------------------------

ALTER TABLE production_board_job_postings
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS kind_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE production_board_job_postings
  DROP CONSTRAINT IF EXISTS production_board_job_postings_priority_check;

ALTER TABLE production_board_job_postings
  ADD CONSTRAINT production_board_job_postings_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'pinned'));

CREATE INDEX IF NOT EXISTS idx_production_board_jobs_active
  ON production_board_job_postings (organization_id, posted_at DESC)
  WHERE is_published = TRUE;

-- ----------------------------------------------------------------------------
-- 3.  Active-posts / active-jobs views
--
-- The boards query these views so the timer / draft / expiry semantics
-- apply "for free" without every read path duplicating the filter. The
-- admin views ("Show drafts / scheduled / expired") still hit the raw
-- tables.
--
-- IMPORTANT: views inherit RLS from the underlying tables (search_path
-- behaviour from Postgres 15+), so no explicit policies needed.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS v_active_board_posts;
CREATE VIEW v_active_board_posts
  WITH (security_invoker = true) AS
  SELECT *
  FROM production_board_posts
  WHERE is_published = TRUE
    AND published_at <= NOW()
    AND (expires_at IS NULL OR expires_at > NOW());

DROP VIEW IF EXISTS v_active_board_jobs;
CREATE VIEW v_active_board_jobs
  WITH (security_invoker = true) AS
  SELECT *
  FROM production_board_job_postings
  WHERE is_published = TRUE
    AND posted_at <= NOW()
    AND (closes_at IS NULL OR closes_at > NOW());

-- ----------------------------------------------------------------------------
-- 4.  Extend the existing `production-board-images` storage bucket to also
--     accept PDFs for attachments. Image MIME types are unchanged; we
--     UNION in application/pdf so the existing image uploads keep working.
--
--     File size limit also bumped from 5 MiB to 10 MiB so a 10-page PDF
--     toolbox-talk or a full-page safety briefing fits.
-- ----------------------------------------------------------------------------

UPDATE storage.buckets
  SET allowed_mime_types = ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf'
      ]::text[],
      file_size_limit = 10485760
  WHERE id = 'production-board-images';

-- ----------------------------------------------------------------------------
-- 5.  Helpful comments documenting the JSONB shapes for future readers.
-- ----------------------------------------------------------------------------

COMMENT ON COLUMN production_board_posts.attachments IS
  'Ordered array of attachment metadata: '
  '[{id, storage_path, mime_type, file_name, caption?, width?, height?, size_bytes, display_order}]. '
  'storage_path is the path inside the production-board-images bucket. The composer '
  'uploads each file to {organization_id}/{post_id_or_draft_id}/{uuid}.{ext} and '
  'persists the metadata here; the board card renders them via supabase.storage.from(...).getPublicUrl(path).';

COMMENT ON COLUMN production_board_posts.kind_data IS
  'Per-kind extras that do not earn a dedicated column. Shape varies by scope:\n'
  '  announcement: { marquee?: boolean, cta_url?: string, cta_label?: string }\n'
  '  hr_news:      { author_name?: string, author_avatar_url?: string, category?: "benefits"|"culture"|"policy"|"other" }\n'
  '  safety_alert: { hazard_type?: string, affected_area_ids?: string[], corrective_action?: string }';

COMMENT ON COLUMN production_board_posts.priority IS
  'Curator-controlled ordering: low | normal | high | pinned. The pinned '
  'value mirrors is_pinned = true (the legacy column stays as the source of '
  'truth for the PostCard badge; the composer keeps both in sync).';

COMMENT ON COLUMN production_board_posts.reprompt_interval_minutes IS
  'Alert-timer for safety alerts that recurringly re-prompt acknowledgement. '
  'NULL = no recurring prompt (ack once, done). 5..10080 minutes inclusive. '
  'Consumed client-side by the SafetyAlertsBoard polling loop (no new '
  'Supabase Realtime channel — see .cursor/rules/Master Rule.mdc Realtime Policy).';

COMMENT ON COLUMN production_board_job_postings.attachments IS
  'Ordered array of attachment metadata. See production_board_posts.attachments '
  'for shape. Used for job descriptions, application packets, etc.';

COMMENT ON COLUMN production_board_job_postings.kind_data IS
  'Per-job extras: '
  '{ employment_type?: "full_time"|"part_time"|"contract"|"temporary"|"intern", '
  '  pay_min?: number, pay_max?: number, pay_currency?: string, '
  '  pay_period?: "hour"|"week"|"month"|"year", '
  '  hiring_manager_name?: string, hiring_manager_email?: string }';

COMMENT ON VIEW v_active_board_posts IS
  'Posts that are currently visible on the public board surface: '
  'is_published = true AND published_at <= now() AND (expires_at IS NULL OR expires_at > now()). '
  'The four boards (Announcements, HR News, Safety Alerts) query this view; the editor admin path '
  'still hits production_board_posts directly to see drafts + scheduled + expired rows.';

COMMENT ON VIEW v_active_board_jobs IS
  'Jobs that are currently visible on the Jobs board: '
  'is_published = true AND posted_at <= now() AND (closes_at IS NULL OR closes_at > now()). '
  'The jobs board queries this view; the editor admin path still hits '
  'production_board_job_postings directly to see drafts + scheduled + closed rows.';

COMMIT;
