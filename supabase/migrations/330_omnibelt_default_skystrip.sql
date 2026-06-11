-- ============================================================================
-- Migration 330 — OmniBelt: promote Sky Strip to default skin
--
-- Authored 2026-05-24 as part of the OmniBelt v1.1 polish pass.
--
-- Context
-- -------
-- The Sky Strip (bottom-center Dynamic-Island morph) is replacing the
-- horizontal Pill as the new flagship resting chrome. Migration 327
-- created `omnibelt_role_config` with `default_skin TEXT NOT NULL
-- DEFAULT 'pill'`; this migration moves the column DEFAULT to
-- 'skystrip' so any *new* role-config rows (created by admins via
-- /admin/omnibelt or by the bootstrap auto-insert path) land on the
-- new skin.
--
-- Idempotency
-- -----------
-- Wrapped in a single transaction. The ALTER COLUMN ... SET DEFAULT
-- statement is naturally idempotent (PG silently no-ops when the
-- existing default already matches). The CHECK constraint from
-- migration 327 (`default_skin IN ('pill','orb','skystrip')`) already
-- permits 'skystrip', so no constraint changes are needed.
--
-- Existing rows
-- -------------
-- We intentionally do NOT overwrite existing rows that have
-- `default_skin = 'pill'`. There's no clean signal to distinguish
-- "admin chose pill explicitly" from "row was created with the
-- migration-327 default". The safest path is to only move the
-- column-level DEFAULT — new orgs and new role configs pick up
-- 'skystrip', existing admin choices stay untouched. Admins can
-- still set any of the three skins via the admin dashboard.
--
-- Spec:        docs/superpowers/specs/2026-05-24-omnibelt-design.md §7
-- Pattern:     memorybank/OmniFrame/Patterns/Skin-Owned-Morph-States.md
-- ============================================================================

BEGIN;

ALTER TABLE public.omnibelt_role_config
  ALTER COLUMN default_skin SET DEFAULT 'skystrip';

COMMENT ON COLUMN public.omnibelt_role_config.default_skin IS
  'Default OmniBelt skin for this (org, role). Allowed: pill | orb | skystrip. New rows default to ''skystrip'' (the Dynamic-Island bottom-center strip) as of migration 330; existing rows are unchanged.';

-- PostgREST schema reload — picks up the new default for subsequent
-- inserts that omit the column.
NOTIFY pgrst, 'reload schema';

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Migration 330: OmniBelt default skin → skystrip — COMPLETED';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Column DEFAULT changed:';
  RAISE NOTICE '  omnibelt_role_config.default_skin: ''pill'' -> ''skystrip''';
  RAISE NOTICE 'Existing rows: NOT modified (admin-set values preserved)';
  RAISE NOTICE '============================================================';
END $$;
