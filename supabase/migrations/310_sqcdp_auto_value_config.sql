-- Migration 310 — SQCDP per-metric auto-counter config (v16)
--
-- Lets curators turn any metric's headline number into an auto-incrementing
-- counter measured from an anchor timestamp. The canonical case is
-- Safety / TBIR — "861 Days since last incident" ticks to 862 when the
-- clock crosses midnight, drops to 0 when an incident is recorded.
--
-- The shape generalises to any "X since Y" surface: days since last
-- quality escape, hours since last unplanned downtime, weeks since last
-- 5S audit, months since last process update, etc. The mode enum is
-- carried in the JSONB bag so a future `count_down` variant (deadline
-- countdown) lands without another ALTER TABLE — same pattern as the
-- v13 `chart_config` bag (migration 302).
--
-- Shape (validated client-side via Zod + a defensive
-- `parseAutoValueConfig` parser; no CHECK constraint so the format can
-- iterate freely):
--
-- {
--   "mode": "count_up_days" | "count_up_hours"
--         | "count_up_weeks" | "count_up_months",
--   "anchor_at": "2024-01-13T00:00:00Z",
--   "floor_to_midnight": true
-- }
--
-- Empty {} = no auto-counter (renderer keeps reading
-- `sqcdp_metrics.current_value`). NOT NULL DEFAULT '{}' so existing
-- rows continue to render exactly as before.
--
-- NOTIFY pgrst at the end so PostgREST picks up the new column without
-- a service restart.

ALTER TABLE public.sqcdp_metrics
  ADD COLUMN IF NOT EXISTS auto_value_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.sqcdp_metrics.auto_value_config IS
  'Auto-counter config. Shape: { mode?: ''count_up_days''|''count_up_hours''|''count_up_weeks''|''count_up_months'', anchor_at?: ISO string, floor_to_midnight?: boolean }. Empty {} = static value (current_value). See src/features/shift-productivity/production-boards/boards/sqcdp/lib/auto-value.ts for the canonical shape + compute helper.';

NOTIFY pgrst, 'reload schema';
