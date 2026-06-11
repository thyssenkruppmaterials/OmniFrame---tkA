-- Migration: Add Labor Management navigation item with Shift Productivity as child
-- Date: December 21, 2025
-- Purpose: Add new "Labor Management" collapsible menu with "Shift Productivity" as child
-- 
-- IMPORTANT: This migration was applied manually via Supabase MCP on Dec 21, 2025
-- The following operations were performed:

-- ============================================================================
-- STEP 1: Insert Labor Management parent navigation item
-- ============================================================================
-- Result: ID bb51e1ba-b3ff-43b2-b093-f2a179d0ec97

INSERT INTO navigation_items (id, name, title, url, icon, parent_id, position)
VALUES (
  'bb51e1ba-b3ff-43b2-b093-f2a179d0ec97',
  'labor_management',
  'Labor Management',
  NULL,  -- Parent items don't have URLs (they're collapsible)
  'IconUsers',
  NULL,  -- Top-level item (no parent)
  35     -- Position after Customer Portal
);

-- ============================================================================
-- STEP 2: Insert Shift Productivity as child of Labor Management
-- ============================================================================
-- Result: ID 302ac352-ff5c-4912-860a-e0bbe06e263e

INSERT INTO navigation_items (id, name, title, url, icon, parent_id, position)
VALUES (
  '302ac352-ff5c-4912-860a-e0bbe06e263e',
  'shift_productivity',
  'Shift Productivity',
  '/apps/shift-productivity',
  'IconTrendingUp',
  'bb51e1ba-b3ff-43b2-b093-f2a179d0ec97',
  1
);

-- ============================================================================
-- STEP 3: Remove old duplicate apps_shift_productivity entry
-- ============================================================================
-- There was an existing entry with the same URL causing route-protection to fail
-- (route-protection uses .single() which fails with multiple matching rows)

DELETE FROM navigation_items WHERE name = 'apps_shift_productivity';

-- ============================================================================
-- STEP 4: Grant permissions for Labor Management
-- ============================================================================

INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
VALUES 
  ('8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef', 'bb51e1ba-b3ff-43b2-b093-f2a179d0ec97', true, 'superadmin'),
  ('0db241c1-ee86-4824-81db-e63c7cca1e50', 'bb51e1ba-b3ff-43b2-b093-f2a179d0ec97', true, 'admin'),
  ('ac9275e9-cf41-4131-8503-7c0e64d99efc', 'bb51e1ba-b3ff-43b2-b093-f2a179d0ec97', true, 'manager'),
  ('84cf7054-4cbf-4ee1-b677-6d7233cc593c', 'bb51e1ba-b3ff-43b2-b093-f2a179d0ec97', false, 'cashier'),
  ('4ed31216-1dd8-4134-8341-9aa8c8c39b17', 'bb51e1ba-b3ff-43b2-b093-f2a179d0ec97', false, 'viewer')
ON CONFLICT (role, navigation_item_id) DO UPDATE SET visible = EXCLUDED.visible;

-- ============================================================================
-- STEP 5: Grant permissions for Shift Productivity
-- ============================================================================

INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
VALUES 
  ('8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef', '302ac352-ff5c-4912-860a-e0bbe06e263e', true, 'superadmin'),
  ('0db241c1-ee86-4824-81db-e63c7cca1e50', '302ac352-ff5c-4912-860a-e0bbe06e263e', true, 'admin'),
  ('ac9275e9-cf41-4131-8503-7c0e64d99efc', '302ac352-ff5c-4912-860a-e0bbe06e263e', true, 'manager'),
  ('84cf7054-4cbf-4ee1-b677-6d7233cc593c', '302ac352-ff5c-4912-860a-e0bbe06e263e', false, 'cashier'),
  ('4ed31216-1dd8-4134-8341-9aa8c8c39b17', '302ac352-ff5c-4912-860a-e0bbe06e263e', false, 'viewer')
ON CONFLICT (role, navigation_item_id) DO UPDATE SET visible = EXCLUDED.visible;

-- Add helpful comment
COMMENT ON TABLE navigation_items IS 'Stores sidebar navigation menu structure. When adding new menu items to sidebar-data.ts, a corresponding entry must be added here for role-based visibility control.';

