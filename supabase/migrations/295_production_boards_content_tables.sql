-- ============================================================================
-- Migration 295 — Production Boards Phase 1: content tables, RLS, storage,
-- per-org seed, branches lookup, permission, role grants, and 403 backfill.
--
-- Authored 2026-05-10. Applied via Supabase MCP `apply_migration` the same
-- day. Adds the editable content layer behind the Production Boards
-- multi-board surface (SQCDP, Announcements, HR News, Jobs, Safety Alerts).
-- The Hourly Completion Tracker stays unchanged — it has no editable
-- content, just live computed views.
--
-- A note on the legacy `role` enum columns on `role_permissions` and
-- `role_navigation_permissions`: both are NOT NULL `user_role` enums but
-- the enum does NOT include all custom roles (`tka_supervisors`,
-- `rolls_royce_assembly`, `tka_leaders`, ...). Real lookups use `role_id`
-- (UUID); we cast to the enum where possible and fall back to
-- `'viewer'::user_role` as a placeholder. This mirrors the live data on
-- the production-boards navigation row where `tka_supervisors` is stored
-- as `role='viewer'` but `role_id` points to the right row.
--
-- See:
--   - memorybank/OmniFrame/Components/ProductionBoards - Feature Module.md
--   - memorybank/OmniFrame/Implementations/Implement-Production-Boards-Hourly-Grid.md
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1.1  Enums
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sqcdp_category') THEN
    CREATE TYPE sqcdp_category AS ENUM (
      'safety','quality','cost','delivery','production',
      'maintenance','shipping','big_idea','announcement'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'metric_value_format') THEN
    CREATE TYPE metric_value_format AS ENUM (
      'number','percent','currency','duration','text'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'metric_trend_period') THEN
    CREATE TYPE metric_trend_period AS ENUM (
      'rolling_4_weeks','rolling_30_days','last_6_months','ytd','custom'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_scope') THEN
    CREATE TYPE post_scope AS ENUM ('announcement','hr_news','safety_alert');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_severity') THEN
    CREATE TYPE post_severity AS ENUM ('info','success','warning','danger');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sqcdp_problem_status') THEN
    CREATE TYPE sqcdp_problem_status AS ENUM (
      'open','in_progress','resolved','escalated'
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1.2  Tables
-- ----------------------------------------------------------------------------

-- production_boards: per-org config root (one row per slug per org)
CREATE TABLE IF NOT EXISTS production_boards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL CHECK (slug IN (
                    'hourly','sqcdp','announcements','hr_news','jobs','safety_alerts'
                  )),
  title           TEXT NOT NULL,
  subtitle        TEXT,
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  display_order   INTEGER NOT NULL DEFAULT 0,
  theme           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT production_boards_org_slug_uniq UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_production_boards_org
  ON production_boards (organization_id, display_order);

-- branches: lightweight per-org branch lookup used by HR News / Jobs scoping
CREATE TABLE IF NOT EXISTS branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT branches_org_code_uniq UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_branches_org_active
  ON branches (organization_id, is_active);

-- sqcdp_metrics: editable metric cards per category (5 primary + 4 secondary)
CREATE TABLE IF NOT EXISTS sqcdp_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category          sqcdp_category NOT NULL,
  title             TEXT NOT NULL,
  subtitle          TEXT,
  value_format      metric_value_format NOT NULL DEFAULT 'number',
  current_value     NUMERIC,
  target_value      NUMERIC,
  unit              TEXT,
  trend_period      metric_trend_period NOT NULL DEFAULT 'rolling_4_weeks',
  color_hex         TEXT,
  accent_hex        TEXT,
  is_visible        BOOLEAN NOT NULL DEFAULT TRUE,
  display_order     INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sqcdp_metrics_org_cat
  ON sqcdp_metrics (organization_id, category, display_order);

-- sqcdp_metric_history: time-series sparkline data per metric
CREATE TABLE IF NOT EXISTS sqcdp_metric_history (
  id              BIGSERIAL PRIMARY KEY,
  metric_id       UUID NOT NULL REFERENCES sqcdp_metrics(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  value           NUMERIC NOT NULL,
  note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_sqcdp_history_metric_time
  ON sqcdp_metric_history (metric_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sqcdp_history_org_time
  ON sqcdp_metric_history (organization_id, recorded_at DESC);

-- sqcdp_problems: floor problems table (open/in-progress/resolved/escalated)
CREATE TABLE IF NOT EXISTS sqcdp_problems (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category          sqcdp_category NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  severity          post_severity NOT NULL DEFAULT 'info',
  status            sqcdp_problem_status NOT NULL DEFAULT 'open',
  reported_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at            TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sqcdp_problems_org_status
  ON sqcdp_problems (organization_id, status, reported_at DESC);

-- production_board_posts: shared content table for Announcements, HR News,
-- and Safety Alerts (scoped via post_scope enum). Posts can target a working
-- area, a branch, or be company-wide (both nullable).
CREATE TABLE IF NOT EXISTS production_board_posts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope                    post_scope NOT NULL,
  working_area_id          UUID REFERENCES working_areas(id) ON DELETE SET NULL,
  branch_id                UUID REFERENCES branches(id) ON DELETE SET NULL,
  title                    TEXT NOT NULL,
  body                     TEXT,
  severity                 post_severity NOT NULL DEFAULT 'info',
  color_hex                TEXT,
  image_url                TEXT,
  published_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at               TIMESTAMPTZ,
  is_pinned                BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_required    BOOLEAN NOT NULL DEFAULT FALSE,
  posted_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_board_posts_org_scope
  ON production_board_posts (organization_id, scope, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_board_posts_branch
  ON production_board_posts (organization_id, branch_id, scope);
CREATE INDEX IF NOT EXISTS idx_production_board_posts_area
  ON production_board_posts (organization_id, working_area_id, scope);

-- production_board_post_acks: companion table for acknowledged_required posts
CREATE TABLE IF NOT EXISTS production_board_post_acks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  post_id         UUID NOT NULL REFERENCES production_board_posts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT production_board_post_acks_unique UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_acks_org_post
  ON production_board_post_acks (organization_id, post_id);

-- production_board_job_postings: internal/external job listings shown on the
-- Jobs board, scoped to an org with optional working area / branch.
CREATE TABLE IF NOT EXISTS production_board_job_postings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  department        TEXT,
  working_area_id   UUID REFERENCES working_areas(id) ON DELETE SET NULL,
  branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL,
  description       TEXT,
  requirements      TEXT,
  apply_url         TEXT,
  apply_email       TEXT,
  is_internal       BOOLEAN NOT NULL DEFAULT TRUE,
  color_hex         TEXT,
  posted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at         TIMESTAMPTZ,
  posted_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_board_jobs_org
  ON production_board_job_postings (organization_id, posted_at DESC);

-- ----------------------------------------------------------------------------
-- 1.3  RLS
--
-- SELECT scoped to caller's organization_id (matches the migration-011 idiom).
-- Mutations gated on `public.has_permission('production_boards','edit')` AND
-- the organization_id match. The public.has_permission(resource, action)
-- variant takes auth.uid() implicitly via get_user_role().
-- ----------------------------------------------------------------------------

ALTER TABLE production_boards               ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sqcdp_metrics                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sqcdp_metric_history            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sqcdp_problems                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_board_posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_board_post_acks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_board_job_postings   ENABLE ROW LEVEL SECURITY;

-- Helper: a single org-match expression copy/pasted across policies.
-- Idiom borrowed from migration 011 (and many later migrations).
--   organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())

-- ---- production_boards ----
DROP POLICY IF EXISTS "production_boards_select" ON production_boards;
CREATE POLICY "production_boards_select" ON production_boards
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "production_boards_mutate" ON production_boards;
CREATE POLICY "production_boards_mutate" ON production_boards
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

-- ---- branches ----
DROP POLICY IF EXISTS "branches_select" ON branches;
CREATE POLICY "branches_select" ON branches
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "branches_mutate" ON branches;
CREATE POLICY "branches_mutate" ON branches
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

-- ---- sqcdp_metrics ----
DROP POLICY IF EXISTS "sqcdp_metrics_select" ON sqcdp_metrics;
CREATE POLICY "sqcdp_metrics_select" ON sqcdp_metrics
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "sqcdp_metrics_mutate" ON sqcdp_metrics;
CREATE POLICY "sqcdp_metrics_mutate" ON sqcdp_metrics
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

-- ---- sqcdp_metric_history ----
DROP POLICY IF EXISTS "sqcdp_metric_history_select" ON sqcdp_metric_history;
CREATE POLICY "sqcdp_metric_history_select" ON sqcdp_metric_history
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "sqcdp_metric_history_mutate" ON sqcdp_metric_history;
CREATE POLICY "sqcdp_metric_history_mutate" ON sqcdp_metric_history
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

-- ---- sqcdp_problems ----
DROP POLICY IF EXISTS "sqcdp_problems_select" ON sqcdp_problems;
CREATE POLICY "sqcdp_problems_select" ON sqcdp_problems
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "sqcdp_problems_mutate" ON sqcdp_problems;
CREATE POLICY "sqcdp_problems_mutate" ON sqcdp_problems
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

-- ---- production_board_posts ----
DROP POLICY IF EXISTS "production_board_posts_select" ON production_board_posts;
CREATE POLICY "production_board_posts_select" ON production_board_posts
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "production_board_posts_mutate" ON production_board_posts;
CREATE POLICY "production_board_posts_mutate" ON production_board_posts
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

-- ---- production_board_post_acks ----
-- Selects scoped to the caller's org. Acks are intentionally insertable by
-- the user who owns them (acknowledging a safety alert is *not* a
-- production_boards:edit operation — every authenticated user in the org
-- needs to be able to ack their own posts). Updates / deletes are gated on
-- the edit permission to keep the audit trail clean.
DROP POLICY IF EXISTS "post_acks_select" ON production_board_post_acks;
CREATE POLICY "post_acks_select" ON production_board_post_acks
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "post_acks_insert_self" ON production_board_post_acks;
CREATE POLICY "post_acks_insert_self" ON production_board_post_acks
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "post_acks_update" ON production_board_post_acks;
CREATE POLICY "post_acks_update" ON production_board_post_acks
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

DROP POLICY IF EXISTS "post_acks_delete" ON production_board_post_acks;
CREATE POLICY "post_acks_delete" ON production_board_post_acks
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

-- ---- production_board_job_postings ----
DROP POLICY IF EXISTS "production_board_jobs_select" ON production_board_job_postings;
CREATE POLICY "production_board_jobs_select" ON production_board_job_postings
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "production_board_jobs_mutate" ON production_board_job_postings;
CREATE POLICY "production_board_jobs_mutate" ON production_board_job_postings
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('production_boards', 'edit')
  );

-- ----------------------------------------------------------------------------
-- 1.4  Permission seed + role grants
--
-- `permissions` table uses `name` as a unique key (canonical pattern from
-- migrations 187 / 194) and holds resource + action separately. Insert via
-- `name` since `(resource, action)` has no unique index.
--
-- `role_permissions` is existence-based (no `granted` column) keyed on
-- (role_id, permission_id) — so we use INSERT ... ON CONFLICT DO NOTHING.
-- ----------------------------------------------------------------------------

INSERT INTO permissions (name, resource, action, description)
VALUES (
  'production_boards.edit',
  'production_boards',
  'edit',
  'Edit Production Boards content (SQCDP, announcements, posts, jobs, branches)'
)
ON CONFLICT (name) DO NOTHING;

-- The legacy `role` enum column is NOT NULL but the `user_role` enum does not
-- include custom names like `tka_supervisors`. Cast to the enum where
-- possible; fall back to `'viewer'::user_role` for custom roles. The actual
-- lookup goes through `role_id` (UUID), so the legacy `role` value is just
-- a placeholder kept for backward compat with very old read paths.
INSERT INTO role_permissions (role_id, permission_id, role)
SELECT
  r.id,
  p.id,
  CASE
    WHEN r.name IN (
      'superadmin','admin','manager','cashier','viewer',
      'tka_associate','inventory_specialist','logistics_coordinator','quality_specialist'
    ) THEN r.name::user_role
    ELSE 'viewer'::user_role
  END
FROM roles r
CROSS JOIN permissions p
WHERE p.name = 'production_boards.edit'
  AND r.name IN ('admin', 'superadmin', 'manager', 'tka_supervisors')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.5  Storage bucket + policies
--
-- New public bucket. Public read so TVs can render images with no auth round
-- trip; mutations gated on the production_boards:edit permission, mirroring
-- the policy shape from migration 260. Authenticated users only for
-- INSERT/UPDATE/DELETE so anon visitors can't write objects.
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'production-board-images',
  'production-board-images',
  TRUE,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "production_board_images_select" ON storage.objects;
CREATE POLICY "production_board_images_select" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'production-board-images');

DROP POLICY IF EXISTS "production_board_images_insert" ON storage.objects;
CREATE POLICY "production_board_images_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'production-board-images'
    AND public.has_permission('production_boards', 'edit')
  );

DROP POLICY IF EXISTS "production_board_images_update" ON storage.objects;
CREATE POLICY "production_board_images_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'production-board-images'
    AND public.has_permission('production_boards', 'edit')
  );

DROP POLICY IF EXISTS "production_board_images_delete" ON storage.objects;
CREATE POLICY "production_board_images_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'production-board-images'
    AND public.has_permission('production_boards', 'edit')
  );

-- ----------------------------------------------------------------------------
-- 1.6  Per-org seed of `production_boards`
--
-- Six rows per org, in display order. Idempotent via the
-- (organization_id, slug) unique constraint.
-- ----------------------------------------------------------------------------

INSERT INTO production_boards (organization_id, slug, title, display_order)
SELECT o.id, v.slug, v.title, v.display_order
FROM organizations o
CROSS JOIN (
  VALUES
    ('hourly',         'Hourly Completion Tracker', 0),
    ('sqcdp',          'SQCDP Scorecards',          1),
    ('announcements',  'Announcements',             2),
    ('hr_news',        'HR News',                   3),
    ('jobs',           'Job Postings',              4),
    ('safety_alerts',  'Safety Alerts',             5)
) AS v(slug, title, display_order)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.7  403 backfill for `rolls_royce_assembly` and `tka_leaders`
--
-- These two roles do NOT have a row on the production-boards navigation
-- item. Without a row, the frontend's `.single()` query (RouteProtection +
-- sidebar visibility) returns 406 → user lands on /403 with a confusing
-- error. Backfill `visible = false` so the row exists and any future
-- provisioned user in those roles gets a clean 403.
--
-- PK is (role_id, navigation_item_id) since Jan 6 2026.
-- ----------------------------------------------------------------------------

-- Same enum-fallback as the role_permissions insert above:
-- `rolls_royce_assembly` and `tka_leaders` are NOT in the user_role enum,
-- so cast to 'viewer'::user_role (the system's standard placeholder for
-- custom roles in this legacy enum column — see the existing rows on the
-- production-boards navigation item where `tka_supervisors` is also stored
-- as role='viewer' but role_id points to the right row).
INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
SELECT r.id, ni.id, FALSE, 'viewer'::user_role
FROM roles r
CROSS JOIN navigation_items ni
WHERE r.name IN ('rolls_royce_assembly', 'tka_leaders')
  AND ni.url = '/apps/production-boards'
ON CONFLICT (role_id, navigation_item_id) DO NOTHING;

COMMIT;
