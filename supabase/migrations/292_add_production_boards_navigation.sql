-- Migration: Add Production Boards navigation item under Labor Management
-- Date: May 10, 2026
-- Purpose: Add new "Production Boards" sub menu item after "Standard Work" in Labor Management.
--          Production Boards is a TV-display container for hourly per-associate productivity
--          views (Hourly Completion Tracker is the first board). It reuses the existing
--          shift_productivity permission rather than introducing a new permission key.

-- ============================================================================
-- STEP 1: Insert Production Boards navigation item as child of Labor Management
-- ============================================================================
-- Generated UUID: 7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11

INSERT INTO navigation_items (id, name, title, url, icon, parent_id, position)
VALUES (
  '7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11',
  'production_boards',
  'Production Boards',
  '/apps/production-boards',
  'IconLayoutDashboard',
  'bb51e1ba-b3ff-43b2-b093-f2a179d0ec97',  -- Labor Management parent ID
  3  -- Position after Standard Work (which is position 2)
)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- STEP 2: Grant navigation permissions for Production Boards
-- ============================================================================
-- Mirror the role visibility used by Shift Productivity (migration 067) and
-- Standard Work (migration 090) — superadmin / admin / manager visible,
-- cashier / viewer hidden.

-- NOTE: The unique constraint on role_navigation_permissions is the primary key
-- (role_id, navigation_item_id) — see migration `fix_role_navigation_permissions_primary_key`
-- (Jan 6, 2026). The legacy `(role, navigation_item_id)` shape used by older migrations
-- (067, 090) no longer matches a valid unique constraint. Use `(role_id, navigation_item_id)`.

INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
VALUES
  ('8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef', '7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11', true,  'superadmin'),
  ('0db241c1-ee86-4824-81db-e63c7cca1e50', '7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11', true,  'admin'),
  ('ac9275e9-cf41-4131-8503-7c0e64d99efc', '7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11', true,  'manager'),
  ('84cf7054-4cbf-4ee1-b677-6d7233cc593c', '7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11', false, 'cashier'),
  ('4ed31216-1dd8-4134-8341-9aa8c8c39b17', '7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11', false, 'viewer')
ON CONFLICT (role_id, navigation_item_id) DO UPDATE SET visible = EXCLUDED.visible;

-- NOTE: Production Boards intentionally does NOT add a new row to the
-- `permissions` table. Both navigation_items.permission resolution (via
-- route-protection's resource check) and the sidebar tile reuse the
-- existing `shift_productivity:view` permission so that any role that
-- can see Shift Productivity can also see Production Boards.
