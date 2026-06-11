-- Migration: Extend kitting_workflow_settings with configurable non-warehouse bin patterns
-- Date: 2026-05-18
-- Description: Adds `non_warehouse_bin_patterns` TEXT[] to `kitting_workflow_settings`. The Kitting
--   apps use this list to flag Transfer Order rows whose `sourceStorageBin` matches one of the
--   substrings (case-insensitive) at import time. The classic example called out by the user is
--   `112NEEDBIN` — a placeholder bin that lives at the plant rather than inside our physical
--   warehouse. When TOs like this land on a kit, the operator owns running them down on the plant
--   side, and the UI now demands an explicit acknowledgement before the kit build plan can be
--   created (or appended to).
--
--   Stored as TEXT[] (Postgres array of substrings) rather than a JSON list so:
--     - Settings UI editing is trivial (Postgres array push/pull).
--     - `... ILIKE ANY` would be a possible future server-side filter without JSON parsing.
--     - The shape mirrors the existing `kitting_workflow_settings` sibling columns (308 / 312):
--       one row per org, UPSERT keyed on `organization_id`, scalar / array primitives only.
--
--   Default `ARRAY['NEEDBIN']` mirrors the user-supplied example (`112NEEDBIN` etc.) — substring
--   match so `NEEDBIN` triggers on `112NEEDBIN`, `R0NEEDBIN`, anything containing the marker.
--   Orgs add/remove patterns via the new "Non-Warehouse Bin Patterns" section in Settings →
--   Workflow Settings.

ALTER TABLE "public"."kitting_workflow_settings"
  ADD COLUMN IF NOT EXISTS "non_warehouse_bin_patterns" TEXT[] NOT NULL DEFAULT ARRAY['NEEDBIN']::TEXT[];

COMMENT ON COLUMN "public"."kitting_workflow_settings"."non_warehouse_bin_patterns"
  IS 'Case-insensitive substrings used by the Add Kit Build Plan dialog and the Append TOs to Kit flow to flag Transfer Order rows whose sourceStorageBin lives at the plant (not inside our warehouse) so the operator must explicitly acknowledge before the kit is saved. Default {NEEDBIN}.';
