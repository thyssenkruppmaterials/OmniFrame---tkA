-- Migration 293: seed the Work Queue Management tab on the
-- Inventory Management page.
--
-- Adds a new entry to `tab_definitions` for the dispatcher view
-- (multi-operator kanban-style supervisor canvas) and grants it to
-- the same supervisor-leaning roles that already see Operation
-- Control (admin / manager / superadmin / logistics_coordinator).
--
-- The frontend tab id is `work-queue-management`; it sits between
-- `manual-counts` (Inventory Counts) and `operation-control`
-- (Operation Control). `display_order = 42` puts it between
-- Inventory Counts (assumed ~40) and Operation Control (45 — see
-- migration 256 line 822).
--
-- Idempotent: ON CONFLICT clauses make this safe to re-apply.
-- Mirrors the structure of migration 256's "Operation Control tab
-- seed" (lines 814–831) so the audit trail for these RBAC seeds
-- stays uniform.

INSERT INTO public.tab_definitions
  (page_resource, tab_id, tab_label, description, display_order)
VALUES
  ('inventory_apps', 'work-queue-management', 'Work Queue Management',
   'Live multi-operator dispatcher: NOW + NEXT pipeline per operator with cross-lane drag-to-reassign',
   42)
ON CONFLICT (page_resource, tab_id) DO UPDATE
  SET tab_label = EXCLUDED.tab_label,
      description = EXCLUDED.description,
      display_order = EXCLUDED.display_order;

-- Grant the new tab to the same supervisor-leaning roles that get
-- Operation Control. Admins and superadmins get every tab via the
-- frontend's role bypass (`useTabPermissions` hook), but we still
-- seed them here so the explicit role_tab_permissions row exists
-- for auditing.
INSERT INTO public.role_tab_permissions (role_id, tab_definition_id, granted)
SELECT r.id, td.id, true
FROM public.tab_definitions td
JOIN public.roles r ON r.name IN (
  'admin',
  'manager',
  'superadmin',
  'logistics_coordinator'
)
WHERE td.page_resource = 'inventory_apps'
  AND td.tab_id = 'work-queue-management'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE
  SET granted = EXCLUDED.granted;
