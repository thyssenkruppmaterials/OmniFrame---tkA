-- ============================================================================
-- Migration 328 — OmniBelt Admin Dashboard navigation (P8)
--
-- Authored 2026-05-24 as part of Phase P8 of the OmniBelt rollout. Migration
-- 327 created the `omnibelt.manage` permission resource and granted it to
-- `admin` + `superadmin`, but it did NOT add a navigation_items row for the
-- new `/admin/omnibelt` route. The frontend route protection
-- (`src/lib/auth/route-protection.ts`) requires a matching row in
-- `navigation_items` plus a `role_navigation_permissions.visible = true`
-- entry for the user's role — without it, the route 403s for every user
-- including admins.
--
-- This migration adds the dashboard nav entry under the Administration
-- group (parent = the implicit "Administration" item; we attach as a
-- top-level admin sub-link with no parent_id so it shows alongside
-- "Role Management", "Testing", and "System Settings"). Visibility is
-- restricted to `admin` + `superadmin` to mirror the `omnibelt.manage`
-- permission grants from 327.
--
-- Convention mirrors migration 292 (Production Boards navigation):
--   1. INSERT a navigation_items row with a deterministic UUID
--      (`9d3e1b54-d6ce-4b0a-9e1a-bc55a2f3d4e7`) and ON CONFLICT (name) NOP.
--   2. INSERT role_navigation_permissions rows keyed on (role_id) for the
--      five seed roles; UPDATE on conflict so re-runs reconcile visibility.
--   3. NOTIFY pgrst so PostgREST reloads the schema graph.
--
-- Idempotent + re-runnable.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Insert the OmniBelt admin dashboard navigation row.
-- ----------------------------------------------------------------------------
-- We deliberately don't set parent_id so this surfaces as a top-level
-- Administration entry (matching the structure for Work Engine / System
-- Settings which also have no parent_id). The sidebar grouping in
-- `sidebar-data.ts` controls visual placement; navigation_items is the
-- authoritative gate.

INSERT INTO public.navigation_items (id, name, title, url, icon, parent_id, position)
VALUES (
  '9d3e1b54-d6ce-4b0a-9e1a-bc55a2f3d4e7',
  'omnibelt_admin',
  'OmniBelt',
  '/admin/omnibelt',
  'IconCompass',
  NULL,
  99
)
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Grant per-role navigation visibility.
-- ----------------------------------------------------------------------------
-- Mirror the `omnibelt.manage` permission grants from migration 327:
-- admin + superadmin see the dashboard; manager / cashier / viewer
-- do not. The role IDs are pulled dynamically (rather than hard-coded
-- like migration 292) so multi-tenant orgs with custom role IDs still
-- land the grant — migration 292's hard-coded UUIDs are valid only for
-- the canonical seed org and break on fresh installs.

INSERT INTO public.role_navigation_permissions (role_id, navigation_item_id, visible, role)
SELECT
  r.id,
  '9d3e1b54-d6ce-4b0a-9e1a-bc55a2f3d4e7'::uuid,
  CASE WHEN r.name IN ('admin', 'superadmin') THEN TRUE ELSE FALSE END,
  r.name::user_role
FROM public.roles r
WHERE r.name IN ('admin', 'superadmin', 'manager', 'cashier', 'viewer')
ON CONFLICT (role_id, navigation_item_id)
DO UPDATE SET visible = EXCLUDED.visible;

-- ----------------------------------------------------------------------------
-- 3. PostgREST schema reload
-- ----------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Migration 328: OmniBelt Admin Dashboard navigation — COMPLETED';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'navigation_items row added: /admin/omnibelt';
  RAISE NOTICE 'role_navigation_permissions: admin/superadmin = visible';
  RAISE NOTICE '============================================================';
END $$;
