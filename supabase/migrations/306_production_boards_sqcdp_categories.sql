-- ============================================================================
-- Migration 306 — SQCDP Editable Categories
--
-- Authored 2026-05-17. Replaces the hardcoded 9-entry `sqcdp_category` Postgres
-- ENUM (originally seeded by migration 295) with a per-org `production_board_
-- sqcdp_categories` table. Curators can now add custom categories, hide
-- builtins, and reorder either tier (primary / secondary) from the UI.
--
-- Why a per-org table instead of just expanding the enum:
--   * ENUMs cannot be safely tier-reordered or hidden per org.
--   * Different shop floors want different scorecards (some pharma sites care
--     about Compliance + Audits; some logistics sites care about On-Time
--     + Damages). One global enum can't represent that diversity.
--   * Decision log: memorybank/OmniFrame/Decisions/ADR-SQCDP-Category-Schema.md.
--
-- Idempotent. Safe to apply against an already-migrated database (the seed
-- relies on ON CONFLICT DO NOTHING; the enum drop is `IF EXISTS`).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1.  production_board_sqcdp_categories table
--
-- Tier is a string CHECK rather than a dedicated enum to avoid the same
-- migration pain we are escaping with this very migration. Slug is enforced
-- to a lowercase / digits / underscore shape (the runtime slugify helper
-- generates this format) so the FK from `sqcdp_metrics.category` lands on
-- predictable values.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.production_board_sqcdp_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  label             TEXT NOT NULL,
  icon_name         TEXT NOT NULL,
  default_color_hex TEXT NOT NULL,
  tier              TEXT NOT NULL CHECK (tier IN ('primary', 'secondary')),
  display_order     INTEGER NOT NULL DEFAULT 0,
  is_builtin        BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden         BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT production_board_sqcdp_categories_slug_org_unique
    UNIQUE (organization_id, slug),
  CONSTRAINT production_board_sqcdp_categories_slug_format
    CHECK (slug ~ '^[a-z0-9_]+$' AND length(slug) BETWEEN 1 AND 64),
  CONSTRAINT production_board_sqcdp_categories_color_format
    CHECK (default_color_hex ~ '^#[0-9A-F]{6}$')
);

COMMENT ON TABLE public.production_board_sqcdp_categories IS
  'Per-org curator-editable SQCDP category list. Replaces the original sqcdp_category enum (dropped in migration 306). Builtins are seeded with is_builtin=TRUE and cannot be hard-deleted (only hidden); custom categories can be deleted only when no metrics or problems reference them.';

CREATE INDEX IF NOT EXISTS idx_production_board_sqcdp_categories_org_active
  ON public.production_board_sqcdp_categories (organization_id, tier, display_order)
  WHERE is_hidden = FALSE;

CREATE INDEX IF NOT EXISTS idx_production_board_sqcdp_categories_org_all
  ON public.production_board_sqcdp_categories (organization_id, tier, display_order);

-- ----------------------------------------------------------------------------
-- 2.  Row-level security — same shape as sqcdp_metrics (migration 295).
-- ----------------------------------------------------------------------------

ALTER TABLE public.production_board_sqcdp_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "production_board_sqcdp_categories_select"
  ON public.production_board_sqcdp_categories;
CREATE POLICY "production_board_sqcdp_categories_select"
  ON public.production_board_sqcdp_categories
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "production_board_sqcdp_categories_mutate"
  ON public.production_board_sqcdp_categories;
CREATE POLICY "production_board_sqcdp_categories_mutate"
  ON public.production_board_sqcdp_categories
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
-- 3.  Seed the 9 canonical builtins for every org.
--
-- Idempotent via the unique (organization_id, slug) key so repeat applies are
-- safe. The per-row icon_name maps onto `SQCDP_CATEGORY_ICONS` in
-- `boards/sqcdp/lib/category-icons.ts` (frontend) — keep the two in sync.
-- ----------------------------------------------------------------------------

INSERT INTO public.production_board_sqcdp_categories (
  organization_id, slug, label, icon_name, default_color_hex, tier, display_order, is_builtin
)
SELECT o.id, v.slug, v.label, v.icon_name, v.default_color_hex, v.tier, v.display_order, TRUE
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('safety',       'Safety',       'IconShield',           '#DC2626', 'primary',   0),
    ('quality',      'Quality',      'IconCheck',            '#16A34A', 'primary',   1),
    ('cost',         'Cost',         'IconCash',             '#EA580C', 'primary',   2),
    ('delivery',     'Delivery',     'IconTruck',            '#0EA5A9', 'primary',   3),
    ('production',   'Production',   'IconBuildingFactory2', '#CA8A04', 'primary',   4),
    ('maintenance',  'Maintenance',  'IconTool',             '#7C3AED', 'secondary', 0),
    ('shipping',     'Shipping',     'IconPackageExport',    '#9333EA', 'secondary', 1),
    ('big_idea',     'Big Idea',     'IconBulb',             '#1E3A8A', 'secondary', 2),
    ('announcement', 'Announcement', 'IconSpeakerphone',     '#0EA5E9', 'secondary', 3)
) AS v(slug, label, icon_name, default_color_hex, tier, display_order)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4.  Auto-seed builtins for any future organization.
--
-- Trigger fires on INSERT into organizations and seeds the same 9 rows so a
-- newly provisioned tenant can create SQCDP metrics without manual setup.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_production_board_sqcdp_category_builtins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.production_board_sqcdp_categories (
    organization_id, slug, label, icon_name, default_color_hex, tier, display_order, is_builtin
  )
  VALUES
    (NEW.id, 'safety',       'Safety',       'IconShield',           '#DC2626', 'primary',   0, TRUE),
    (NEW.id, 'quality',      'Quality',      'IconCheck',            '#16A34A', 'primary',   1, TRUE),
    (NEW.id, 'cost',         'Cost',         'IconCash',             '#EA580C', 'primary',   2, TRUE),
    (NEW.id, 'delivery',     'Delivery',     'IconTruck',            '#0EA5A9', 'primary',   3, TRUE),
    (NEW.id, 'production',   'Production',   'IconBuildingFactory2', '#CA8A04', 'primary',   4, TRUE),
    (NEW.id, 'maintenance',  'Maintenance',  'IconTool',             '#7C3AED', 'secondary', 0, TRUE),
    (NEW.id, 'shipping',     'Shipping',     'IconPackageExport',    '#9333EA', 'secondary', 1, TRUE),
    (NEW.id, 'big_idea',     'Big Idea',     'IconBulb',             '#1E3A8A', 'secondary', 2, TRUE),
    (NEW.id, 'announcement', 'Announcement', 'IconSpeakerphone',     '#0EA5E9', 'secondary', 3, TRUE)
  ON CONFLICT (organization_id, slug) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_sqcdp_category_builtins_on_org_insert ON public.organizations;
CREATE TRIGGER seed_sqcdp_category_builtins_on_org_insert
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_production_board_sqcdp_category_builtins();

-- The seeder is a `SECURITY DEFINER` so the trigger can populate per-org
-- builtins regardless of the inserting user's RLS context. Revoke direct
-- EXECUTE so the function is only callable by the trigger (not via
-- /rest/v1/rpc) — silences advisor 0028 / 0029.
REVOKE ALL ON FUNCTION public.seed_production_board_sqcdp_category_builtins()
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5.  Loosen sqcdp_metrics.category + sqcdp_problems.category from the
--     `sqcdp_category` enum to TEXT, then add a referential FK onto the
--     new categories table.
--
-- The existing 9 enum values are exact slug matches for the seeded builtins,
-- so casting from `sqcdp_category::text` lands on a valid slug for every
-- existing row. The FKs are DEFERRABLE INITIALLY DEFERRED so a future
-- "rename a category slug" workflow can update the categories row and the
-- referencing rows in the same transaction.
-- ----------------------------------------------------------------------------

ALTER TABLE public.sqcdp_metrics
  ALTER COLUMN category TYPE TEXT USING category::text;

ALTER TABLE public.sqcdp_problems
  ALTER COLUMN category TYPE TEXT USING category::text;

DROP TYPE IF EXISTS public.sqcdp_category;

ALTER TABLE public.sqcdp_metrics
  DROP CONSTRAINT IF EXISTS sqcdp_metrics_category_fk;
ALTER TABLE public.sqcdp_metrics
  ADD CONSTRAINT sqcdp_metrics_category_fk
  FOREIGN KEY (organization_id, category)
  REFERENCES public.production_board_sqcdp_categories (organization_id, slug)
  ON UPDATE CASCADE
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.sqcdp_problems
  DROP CONSTRAINT IF EXISTS sqcdp_problems_category_fk;
ALTER TABLE public.sqcdp_problems
  ADD CONSTRAINT sqcdp_problems_category_fk
  FOREIGN KEY (organization_id, category)
  REFERENCES public.production_board_sqcdp_categories (organization_id, slug)
  ON UPDATE CASCADE
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- ----------------------------------------------------------------------------
-- 6.  updated_at maintenance trigger (mirrors the convention for other
--     editable production-boards tables).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_production_board_sqcdp_categories_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_production_board_sqcdp_categories_updated_at
  ON public.production_board_sqcdp_categories;
CREATE TRIGGER touch_production_board_sqcdp_categories_updated_at
  BEFORE UPDATE ON public.production_board_sqcdp_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_production_board_sqcdp_categories_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
