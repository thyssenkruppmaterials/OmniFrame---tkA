-- Migration 302 — SQCDP per-metric chart appearance overrides (v13)
--
-- v12.x shipped a fixed chart aesthetic: monotone curve, hidden Y-axis,
-- horizontal-only grid, dashed accent target line, optional point markers.
-- Curators asked for finer-grained control without losing the existing
-- terse defaults — they want goal lines, target-line styling, manual
-- Y-axis bounds, average / extremes annotations, etc.
--
-- This migration adds a single JSONB column. Storing the variant axes in
-- one bag (instead of N booleans + N hex columns + N enum columns) keeps
-- the rate of schema churn down — the v12 work taught us each new chart
-- toggle costs another ALTER TABLE, another pgrst NOTIFY, another
-- migration-vs-frontend deploy ordering window. JSONB is NOT NULL DEFAULT
-- '{}' so existing rows behave exactly as before (every helper falls back
-- to the v12.x default when the bag is empty).
--
-- Shape (validated client-side via Zod, not via a CHECK constraint —
-- a cheap optionality we accept so the schema doesn't fight format
-- iteration):
--
-- {
--   "goal_lines"?: [
--     { "id": "uuid", "value": 80, "label"?: "Stretch goal",
--       "color_hex"?: "#16a34a", "style"?: "solid|dashed|dotted",
--       "width"?: 1|2|3 }
--   ],
--   "target_line"?: { "color_hex"?, "style"?, "width"?, "show_label"? },
--   "y_axis"?:    { "show"?: false, "min"?: 0, "max"?: 100 },
--   "grid"?:      { "show_horizontal"?: true, "show_vertical"?: false },
--   "curve"?:     "monotone" | "linear" | "step",
--   "show_average"?: false,
--   "highlight_extremes"?: false
-- }
--
-- NOTIFY pgrst at the end so PostgREST picks up the new column without
-- a service restart.

ALTER TABLE public.sqcdp_metrics
  ADD COLUMN IF NOT EXISTS chart_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.sqcdp_metrics.chart_config IS
  'Per-metric chart appearance overrides. Shape: { goal_lines?: [{ id, value, label?, color_hex?, style?, width? }], target_line?: { color_hex?, style?, width?, show_label? }, y_axis?: { show?, min?, max? }, grid?: { show_horizontal?, show_vertical? }, curve?: ''monotone''|''linear''|''step'', show_average?: boolean, highlight_extremes?: boolean }. Empty object = preserve v12.x defaults.';

NOTIFY pgrst, 'reload schema';
