-- Migration 301 — SQCDP "show trend" per-metric toggle
--
-- v12 (migration 300) auto-painted a trend arrow (↑/↓/→) plus a "vs N
-- {previous}" comparison subtext beneath the primary number whenever a
-- card had ≥ 2 recorded history points. Curators asked for explicit
-- control — some metrics read better as just the headline number, and
-- the comparison subtext can be noisy on cards whose previous point is
-- structurally identical (e.g. a binary status flipping on/off).
--
-- This adds a single boolean: when `show_trend = false` the card hides
-- BOTH the arrow and the comparison subtext, even if 2+ history points
-- exist. Default `true` preserves v12 behaviour for every existing row.
--
-- NOTIFY pgrst at the end so PostgREST picks up the new column without
-- a service restart.

ALTER TABLE public.sqcdp_metrics
  ADD COLUMN IF NOT EXISTS show_trend boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.sqcdp_metrics.show_trend IS
  'When true, the card renders the auto-computed trend arrow (↑/↓/→) and the "vs {previous}" comparison subtext beneath the primary number. When false, both are suppressed even if history points exist. Default true preserves the v12 behaviour for existing rows.';

NOTIFY pgrst, 'reload schema';
