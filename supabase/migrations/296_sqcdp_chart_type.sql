-- 296_sqcdp_chart_type.sql
--
-- Adds a `chart_type` column to `public.sqcdp_metrics` so each SQCDP card can
-- pick its own historical visualisation (`line` / `area` / `bar`). Defaults
-- to `area` (the premium-dashboard-default look used by the v9 Production
-- Boards SQCDP card refresh).
--
-- Backfill: every existing row receives `'area'` via the column DEFAULT.
-- Forward-compat: the CHECK constraint pins the allowed values so the
-- frontend zod enum and DB stay in lock-step.

ALTER TABLE public.sqcdp_metrics
  ADD COLUMN IF NOT EXISTS chart_type text NOT NULL DEFAULT 'area'
    CHECK (chart_type IN ('line', 'area', 'bar'));

COMMENT ON COLUMN public.sqcdp_metrics.chart_type IS
  'Visualisation type for the per-card historical chart. Defaults to area.';
