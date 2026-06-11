-- Migration 300 — SQCDP metrics editor v12
--
-- Adds the columns the v12 editor / card renderer reads:
--   * style_config       — per-input font / size / weight / transform overrides
--                          for the title, subtitle, and primary value text
--                          on the card. Empty object = use density defaults.
--   * sub_metrics        — stacked sub-metric array. When non-empty, the card
--                          renders each entry as a labeled value pair with a
--                          divider between, instead of the single big-number
--                          layout. Lets one card show multiple paired values
--                          (e.g. Maintenance: Open Work Orders + Machine Down).
--   * value_prefix       — small prefix (e.g. "$" or "~") prepended to the
--                          formatted primary value.
--   * value_suffix       — small suffix (e.g. " ppm") appended after the
--                          formatted primary value + optional unit.
--   * decimal_places     — explicit override for the formatter's max/min
--                          fraction digits when the value is numeric.
--                          Range 0–4. Null = use the format's default
--                          behavior (1 fraction digit for number / percent,
--                          0 for currency ≥ 1000, etc.).
--   * lower_is_better    — polarity flag for the trend indicator. When true,
--                          ↑ paints red and ↓ paints green (defects, cost,
--                          incidents).
--
-- NOTIFY pgrst at the end so PostgREST picks up the new columns without a
-- service restart.

ALTER TABLE public.sqcdp_metrics
  ADD COLUMN IF NOT EXISTS style_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sub_metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS value_prefix text,
  ADD COLUMN IF NOT EXISTS value_suffix text,
  ADD COLUMN IF NOT EXISTS decimal_places int CHECK (decimal_places IS NULL OR (decimal_places >= 0 AND decimal_places <= 4)),
  ADD COLUMN IF NOT EXISTS lower_is_better boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sqcdp_metrics.style_config IS
  'Per-field font / size / weight overrides. Shape: { title?: { font, size, weight, transform }, subtitle?: { ... }, primary?: { ... } }. Empty object = use defaults.';
COMMENT ON COLUMN public.sqcdp_metrics.sub_metrics IS
  'Optional stacked sub-metrics. When non-empty, the card renders each entry as a labeled value pair with a divider between, instead of just the single primary number. Shape: [{ id, title, value, value_format, unit?, subtitle?, decimal_places? }].';

NOTIFY pgrst, 'reload schema';
