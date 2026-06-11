-- Migration: Add Standard Work navigation item under Labor Management
-- Date: January 4, 2026
-- Purpose: Add new "Standard Work" sub menu item after "Shift Productivity" in Labor Management

-- ============================================================================
-- STEP 1: Insert Standard Work navigation item as child of Labor Management
-- ============================================================================
-- Result: ID 01bbeba3-6f06-4917-b4ba-0a87b1bc8659

INSERT INTO navigation_items (id, name, title, url, icon, parent_id, position)
VALUES (
  '01bbeba3-6f06-4917-b4ba-0a87b1bc8659',
  'standard_work',
  'Standard Work',
  '/apps/standard-work',
  'IconChecklist',
  'bb51e1ba-b3ff-43b2-b093-f2a179d0ec97',  -- Labor Management parent ID
  2  -- Position after Shift Productivity (which is position 1)
)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- STEP 2: Grant navigation permissions for Standard Work
-- ============================================================================

INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
VALUES 
  ('8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef', '01bbeba3-6f06-4917-b4ba-0a87b1bc8659', true, 'superadmin'),
  ('0db241c1-ee86-4824-81db-e63c7cca1e50', '01bbeba3-6f06-4917-b4ba-0a87b1bc8659', true, 'admin'),
  ('ac9275e9-cf41-4131-8503-7c0e64d99efc', '01bbeba3-6f06-4917-b4ba-0a87b1bc8659', true, 'manager'),
  ('84cf7054-4cbf-4ee1-b677-6d7233cc593c', '01bbeba3-6f06-4917-b4ba-0a87b1bc8659', false, 'cashier'),
  ('4ed31216-1dd8-4134-8341-9aa8c8c39b17', '01bbeba3-6f06-4917-b4ba-0a87b1bc8659', false, 'viewer')
ON CONFLICT (role, navigation_item_id) DO UPDATE SET visible = EXCLUDED.visible;

-- ============================================================================
-- STEP 3: Add the standard_work permission to the permissions table
-- ============================================================================

INSERT INTO permissions (id, name, resource, action, description)
VALUES (
  '696c8da9-44d0-49b8-b52a-702c88ee71d4',
  'view_standard_work',
  'standard_work',
  'view',
  'View Standard Work documentation and procedures'
)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- STEP 4: Grant the standard_work view permission to appropriate roles
-- ============================================================================

INSERT INTO role_permissions (role, permission_id, role_id)
VALUES 
  ('superadmin', '696c8da9-44d0-49b8-b52a-702c88ee71d4', '8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef'),
  ('admin', '696c8da9-44d0-49b8-b52a-702c88ee71d4', '0db241c1-ee86-4824-81db-e63c7cca1e50'),
  ('manager', '696c8da9-44d0-49b8-b52a-702c88ee71d4', 'ac9275e9-cf41-4131-8503-7c0e64d99efc')
ON CONFLICT (role, permission_id) DO NOTHING;
