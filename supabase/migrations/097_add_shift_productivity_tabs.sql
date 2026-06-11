-- Migration: Add Shift Productivity Tab Definitions
-- Date: January 6, 2026
-- Purpose: Add tab definitions for Shift Productivity page so tabs can be assigned to roles

-- ============================================================================
-- STEP 1: Insert tab definitions for Shift Productivity
-- ============================================================================

INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order, is_active)
VALUES 
  ('shift_productivity', 'team-performance', 'Team Performance', 'View team performance metrics and dashboards', 1, true),
  ('shift_productivity', 'associate-performance', 'Associate Performance', 'View individual associate performance data', 2, true),
  ('shift_productivity', 'settings', 'Settings', 'Configure shift productivity settings', 3, true)
ON CONFLICT (page_resource, tab_id) DO UPDATE SET
  tab_label = EXCLUDED.tab_label,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- ============================================================================
-- STEP 2: Grant default tab permissions to system roles
-- ============================================================================

-- Grant all shift productivity tabs to superadmin
INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT 
  r.id,
  td.id,
  true
FROM roles r
CROSS JOIN tab_definitions td
WHERE r.name = 'superadmin'
  AND td.page_resource = 'shift_productivity'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = true;

-- Grant all shift productivity tabs to admin
INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT 
  r.id,
  td.id,
  true
FROM roles r
CROSS JOIN tab_definitions td
WHERE r.name = 'admin'
  AND td.page_resource = 'shift_productivity'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = true;

-- Grant all shift productivity tabs to manager
INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT 
  r.id,
  td.id,
  true
FROM roles r
CROSS JOIN tab_definitions td
WHERE r.name = 'manager'
  AND td.page_resource = 'shift_productivity'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = true;

-- ============================================================================
-- STEP 3: Grant tab permissions to roles that have shift_productivity navigation access
-- This ensures any custom role with navigation access also gets tab access
-- ============================================================================

INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT DISTINCT
  rnp.role_id,
  td.id,
  true
FROM role_navigation_permissions rnp
JOIN navigation_items ni ON ni.id = rnp.navigation_item_id
CROSS JOIN tab_definitions td
WHERE ni.url = '/apps/shift-productivity'
  AND rnp.visible = true
  AND td.page_resource = 'shift_productivity'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = true;

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE 'Shift Productivity tabs added: team-performance, associate-performance, settings';
  RAISE NOTICE 'Tab permissions granted to superadmin, admin, manager, and roles with navigation access';
END $$;
