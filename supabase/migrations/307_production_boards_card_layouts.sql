-- ============================================================================
-- Migration 307 — Production Boards Bento Card Layouts
--
-- Authored 2026-05-17 as part of the bento-grid layout pass on the four
-- secondary Production Boards (Announcements, HR News, Jobs, Safety Alerts).
-- The user request: "I would like to make this resizable, be allowed to show
-- banners, have a canvas, rotating images, all kinds of things, and have a
-- grid layout where I can rearrange as needed and however I want to."
--
-- This migration adds a single per-org table that stores the bento-grid
-- placement (x, y, w, h) + chosen variant (classic / banner / gallery /
-- spotlight / quote) + per-variant configuration bag for each post / job
-- rendered on those four boards. Posts without a layout row default to an
-- auto-placed classic card via the frontend's `<BentoGrid>` placement helper.
--
-- One layout row per (org, board, scope, post_kind, post_id). `post_id` is
-- intentionally NOT a foreign key — it can reference either
-- `production_board_posts` or `production_board_job_postings`. A pair of
-- AFTER DELETE triggers on those tables keeps orphan layout rows from
-- accumulating.
--
-- Decision log: memorybank/OmniFrame/Decisions/ADR-Production-Boards-Bento-Layout-Persistence.md
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. production_board_card_layouts
--
-- One row per (organization, board, scope, post_kind, post_id).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.production_board_card_layouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  board_kind      TEXT NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'all',
  post_id         UUID NOT NULL,
  post_kind       TEXT NOT NULL,
  grid_x          INTEGER NOT NULL DEFAULT 0,
  grid_y          INTEGER NOT NULL DEFAULT 0,
  grid_w          INTEGER NOT NULL DEFAULT 3,
  grid_h          INTEGER NOT NULL DEFAULT 2,
  card_variant    TEXT NOT NULL DEFAULT 'classic',
  variant_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT production_board_card_layouts_board_kind_check
    CHECK (board_kind IN ('announcement', 'hr_news', 'job', 'safety_alert')),
  CONSTRAINT production_board_card_layouts_post_kind_check
    CHECK (post_kind IN ('post', 'job')),
  CONSTRAINT production_board_card_layouts_card_variant_check
    CHECK (card_variant IN (
      'classic', 'banner', 'gallery', 'spotlight', 'quote'
    )),
  CONSTRAINT production_board_card_layouts_grid_pos_check
    CHECK (grid_x >= 0 AND grid_y >= 0 AND grid_w >= 1 AND grid_h >= 1
           AND grid_w <= 12 AND grid_h <= 12),
  CONSTRAINT production_board_card_layouts_scope_format
    CHECK (length(scope) BETWEEN 1 AND 64),
  CONSTRAINT production_board_card_layouts_unique
    UNIQUE (organization_id, board_kind, scope, post_kind, post_id)
);

COMMENT ON TABLE public.production_board_card_layouts IS
  'Per-org bento-grid placement + variant + per-variant config for each post / job rendered on the four secondary Production Boards (Announcements, HR News, Jobs, Safety Alerts). post_id deliberately has no FK because it can reference either production_board_posts or production_board_job_postings; orphan cleanup is handled by triggers on those tables.';

COMMENT ON COLUMN public.production_board_card_layouts.variant_config IS
  'Per-variant configuration bag. Shape varies by card_variant:'
  ' banner: { cover_position?: "top"|"center"|"bottom" }.'
  ' gallery: { rotate_interval_seconds?: 3..30 }.'
  ' Other variants currently have no config.';

CREATE INDEX IF NOT EXISTS idx_production_board_card_layouts_board
  ON public.production_board_card_layouts (organization_id, board_kind, scope);

CREATE INDEX IF NOT EXISTS idx_production_board_card_layouts_post
  ON public.production_board_card_layouts (post_kind, post_id);

-- ----------------------------------------------------------------------------
-- 2. updated_at touch trigger
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_production_board_card_layouts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_production_board_card_layouts_updated_at
  ON public.production_board_card_layouts;
CREATE TRIGGER trg_touch_production_board_card_layouts_updated_at
  BEFORE UPDATE ON public.production_board_card_layouts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_production_board_card_layouts_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Row-level security — mirror production_board_posts (migration 295)
--
-- Reads are org-scoped (every authenticated user in the org can see them so
-- the board renders correctly). Writes require production_boards:edit.
-- ----------------------------------------------------------------------------

ALTER TABLE public.production_board_card_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "production_board_card_layouts_select"
  ON public.production_board_card_layouts;
CREATE POLICY "production_board_card_layouts_select"
  ON public.production_board_card_layouts
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "production_board_card_layouts_mutate"
  ON public.production_board_card_layouts;
CREATE POLICY "production_board_card_layouts_mutate"
  ON public.production_board_card_layouts
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

-- ----------------------------------------------------------------------------
-- 4. Orphan cleanup triggers on the two underlying posts tables.
--
-- post_id has no FK to either table because it can reference both. We keep
-- the layouts table clean of orphans with a pair of AFTER DELETE triggers
-- that match on (organization_id, post_kind = 'post' / 'job', post_id).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_orphan_post_card_layouts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.production_board_card_layouts
   WHERE organization_id = OLD.organization_id
     AND post_kind = 'post'
     AND post_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_orphan_post_card_layouts()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_orphan_job_card_layouts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.production_board_card_layouts
   WHERE organization_id = OLD.organization_id
     AND post_kind = 'job'
     AND post_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_orphan_job_card_layouts()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cleanup_orphan_post_card_layouts
  ON public.production_board_posts;
CREATE TRIGGER trg_cleanup_orphan_post_card_layouts
  AFTER DELETE ON public.production_board_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_orphan_post_card_layouts();

DROP TRIGGER IF EXISTS trg_cleanup_orphan_job_card_layouts
  ON public.production_board_job_postings;
CREATE TRIGGER trg_cleanup_orphan_job_card_layouts
  AFTER DELETE ON public.production_board_job_postings
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_orphan_job_card_layouts();

COMMIT;
