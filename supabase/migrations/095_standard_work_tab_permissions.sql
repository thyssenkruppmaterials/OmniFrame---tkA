-- Migration: Add Standard Work App Tab Permissions
-- Date: January 4, 2026
-- Purpose: Configure tab-level permissions for standard_work_apps page resource

-- ============================================================================
-- STEP 1: Insert tab permissions for standard_work_apps page resource
-- ============================================================================

-- Checklist tab - accessible to managers and above
INSERT INTO tab_permissions (page_resource, tab_id, tab_label, required_permissions, visible_by_default, display_order)
VALUES 
  ('standard_work_apps', 'checklist', 'Standard Work Checklist', '["view_standard_work"]', true, 1),
  ('standard_work_apps', 'settings', 'Standard Work Settings', '["manage_standard_work"]', false, 2)
ON CONFLICT (page_resource, tab_id) DO UPDATE SET
  tab_label = EXCLUDED.tab_label,
  required_permissions = EXCLUDED.required_permissions,
  visible_by_default = EXCLUDED.visible_by_default,
  display_order = EXCLUDED.display_order;

-- ============================================================================
-- STEP 2: Add manage_standard_work permission
-- ============================================================================

INSERT INTO permissions (id, name, resource, action, description)
VALUES (
  'a7d82f3b-5c91-4e6a-b8d4-9f1e3c7a2b56',
  'manage_standard_work',
  'standard_work',
  'manage',
  'Manage standard work templates and settings'
)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- STEP 3: Grant manage_standard_work permission to appropriate roles
-- ============================================================================

INSERT INTO role_permissions (role, permission_id, role_id)
VALUES 
  ('superadmin', 'a7d82f3b-5c91-4e6a-b8d4-9f1e3c7a2b56', '8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef'),
  ('admin', 'a7d82f3b-5c91-4e6a-b8d4-9f1e3c7a2b56', '0db241c1-ee86-4824-81db-e63c7cca1e50'),
  ('manager', 'a7d82f3b-5c91-4e6a-b8d4-9f1e3c7a2b56', 'ac9275e9-cf41-4131-8503-7c0e64d99efc')
ON CONFLICT (role, permission_id) DO NOTHING;

-- ============================================================================
-- STEP 4: Grant role-specific tab access
-- ============================================================================

-- Superadmin has access to all tabs
INSERT INTO role_tab_permissions (role_id, page_resource, tab_id, has_access, role)
VALUES 
  ('8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef', 'standard_work_apps', 'checklist', true, 'superadmin'),
  ('8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef', 'standard_work_apps', 'settings', true, 'superadmin')
ON CONFLICT (role, page_resource, tab_id) DO UPDATE SET has_access = EXCLUDED.has_access;

-- Admin has access to all tabs
INSERT INTO role_tab_permissions (role_id, page_resource, tab_id, has_access, role)
VALUES 
  ('0db241c1-ee86-4824-81db-e63c7cca1e50', 'standard_work_apps', 'checklist', true, 'admin'),
  ('0db241c1-ee86-4824-81db-e63c7cca1e50', 'standard_work_apps', 'settings', true, 'admin')
ON CONFLICT (role, page_resource, tab_id) DO UPDATE SET has_access = EXCLUDED.has_access;

-- Manager has access to all tabs
INSERT INTO role_tab_permissions (role_id, page_resource, tab_id, has_access, role)
VALUES 
  ('ac9275e9-cf41-4131-8503-7c0e64d99efc', 'standard_work_apps', 'checklist', true, 'manager'),
  ('ac9275e9-cf41-4131-8503-7c0e64d99efc', 'standard_work_apps', 'settings', true, 'manager')
ON CONFLICT (role, page_resource, tab_id) DO UPDATE SET has_access = EXCLUDED.has_access;

-- Team Lead has access to checklist only
INSERT INTO role_tab_permissions (role_id, page_resource, tab_id, has_access, role)
VALUES 
  ('f6d93e8a-4b21-4c5f-9d7e-2a8b6c9f3e12', 'standard_work_apps', 'checklist', true, 'team_lead'),
  ('f6d93e8a-4b21-4c5f-9d7e-2a8b6c9f3e12', 'standard_work_apps', 'settings', false, 'team_lead')
ON CONFLICT (role, page_resource, tab_id) DO UPDATE SET has_access = EXCLUDED.has_access;

-- Associate has access to checklist only (if they have standard work permission)
INSERT INTO role_tab_permissions (role_id, page_resource, tab_id, has_access, role)
VALUES 
  ('d5e42f7c-3a18-4b9e-8c6d-1f9a5b8e4c27', 'standard_work_apps', 'checklist', true, 'associate'),
  ('d5e42f7c-3a18-4b9e-8c6d-1f9a5b8e4c27', 'standard_work_apps', 'settings', false, 'associate')
ON CONFLICT (role, page_resource, tab_id) DO UPDATE SET has_access = EXCLUDED.has_access;

-- Cashier and Viewer have limited or no access by default
INSERT INTO role_tab_permissions (role_id, page_resource, tab_id, has_access, role)
VALUES 
  ('84cf7054-4cbf-4ee1-b677-6d7233cc593c', 'standard_work_apps', 'checklist', false, 'cashier'),
  ('84cf7054-4cbf-4ee1-b677-6d7233cc593c', 'standard_work_apps', 'settings', false, 'cashier'),
  ('4ed31216-1dd8-4134-8341-9aa8c8c39b17', 'standard_work_apps', 'checklist', false, 'viewer'),
  ('4ed31216-1dd8-4134-8341-9aa8c8c39b17', 'standard_work_apps', 'settings', false, 'viewer')
ON CONFLICT (role, page_resource, tab_id) DO UPDATE SET has_access = EXCLUDED.has_access;

-- ============================================================================
-- STEP 5: Add comments for documentation
-- ============================================================================

COMMENT ON TABLE tab_permissions IS 'Tab-level permissions for page resources including standard_work_apps';
