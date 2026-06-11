-- ============================================================================
-- Migration 194: Device Manager Navigation, Tabs, and Permissions
-- Description: Adds navigation item, tab definitions, tab permissions,
--              permission category, and granular RBAC permissions for the
--              Device Manager page. Follows migration 187 pattern.
-- ============================================================================

-- =========================================================================
-- PART 1: Navigation Item + Role Navigation Permissions
-- Pattern: supabase/migrations/079_add_onboarding_navigation.sql
-- =========================================================================

DO $$
DECLARE
  v_testing_id UUID;
  v_device_manager_id UUID;
BEGIN
  SELECT id INTO v_testing_id
  FROM navigation_items
  WHERE name = 'testing' OR title = 'Testing'
  LIMIT 1;

  IF v_testing_id IS NULL THEN
    INSERT INTO navigation_items (name, title, url, icon, parent_id, position)
    VALUES ('testing', 'Testing', NULL, 'IconTestPipe', NULL, 90)
    RETURNING id INTO v_testing_id;
  END IF;

  SELECT id INTO v_device_manager_id
  FROM navigation_items
  WHERE name = 'device_manager'
  LIMIT 1;

  IF v_device_manager_id IS NULL THEN
    INSERT INTO navigation_items (name, title, url, icon, parent_id, position)
    VALUES (
      'device_manager',
      'Device Manager',
      '/admin/device-manager',
      'IconDeviceMobile',
      v_testing_id,
      40
    )
    RETURNING id INTO v_device_manager_id;

    RAISE NOTICE 'Created Device Manager navigation item with ID: %', v_device_manager_id;
  ELSE
    RAISE NOTICE 'Device Manager navigation item already exists with ID: %', v_device_manager_id;
  END IF;

  INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
  SELECT r.id, v_device_manager_id,
    CASE WHEN r.name IN ('superadmin', 'admin') THEN true ELSE false END,
    r.name::user_role
  FROM roles r
  WHERE NOT EXISTS (
    SELECT 1 FROM role_navigation_permissions rnp
    WHERE rnp.role_id = r.id AND rnp.navigation_item_id = v_device_manager_id
  )
  ON CONFLICT DO NOTHING;
END $$;


-- =========================================================================
-- PART 2: Tab Definitions
-- Pattern: supabase/migrations/187_add_inbound_cart_tabs_and_permissions.sql
-- =========================================================================

INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order, is_active)
VALUES
  ('device_manager', 'fleet-overview',        'Fleet Overview',        'Real-time fleet dashboard with KPIs and map',        1, true),
  ('device_manager', 'device-inventory',      'Device Inventory',      'Managed device list, detail drawer, enrollment',      2, true),
  ('device_manager', 'command-center',        'Command Center',        'Execute MDM commands, pipelines, and templates',      3, true),
  ('device_manager', 'location-intelligence', 'Location Intelligence', 'Live map, geofences, location history, and trails',   4, true),
  ('device_manager', 'profiles-policies',     'Profiles & Policies',   'Configuration profiles and policy management',        5, true),
  ('device_manager', 'app-management',        'App Management',        'Managed app catalog, VPP licenses, app policies',     6, true),
  ('device_manager', 'compliance-security',   'Compliance & Security', 'Compliance dashboard, violations, risk scoring',      7, true),
  ('device_manager', 'automation',            'Automation',            'Workflow builder with triggers and actions',           8, true),
  ('device_manager', 'analytics',             'Analytics & Reporting', 'Fleet analytics, trend reports, scheduled exports',   9, true)
ON CONFLICT (page_resource, tab_id) DO UPDATE SET
  tab_label = EXCLUDED.tab_label,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active;


-- =========================================================================
-- PART 3: Role Tab Permissions
-- Grant all device_manager tabs to superadmin and admin roles
-- =========================================================================

INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT r.id, td.id, true
FROM roles r
CROSS JOIN tab_definitions td
WHERE r.name IN ('superadmin', 'admin')
  AND td.page_resource = 'device_manager'
ON CONFLICT (role_id, tab_definition_id) DO NOTHING;


-- =========================================================================
-- PART 4: Permission Category
-- =========================================================================

INSERT INTO permission_categories (name, display_name, description, icon, order_index, is_active)
VALUES ('device_manager', 'Device Manager', 'Manage MDM-enrolled iOS devices, commands, locations, profiles, and compliance', 'DeviceMobile', 20, true)
ON CONFLICT (name) DO NOTHING;


-- =========================================================================
-- PART 5: Granular Permissions (flat resource.action naming)
-- =========================================================================

DO $$
DECLARE
  v_cat_id UUID;
BEGIN
  SELECT id INTO v_cat_id FROM permission_categories WHERE name = 'device_manager';

  INSERT INTO permissions (name, resource, action, description, category_id, scope, risk_level)
  VALUES
    ('device_manager.view',            'device_manager', 'read',    'View MDM devices, fleet dashboard, and inventory',          v_cat_id, 'organization', 'low'),
    ('device_manager.enroll',          'device_manager', 'create',  'Enroll new devices into MDM',                               v_cat_id, 'organization', 'medium'),
    ('device_manager.command',         'device_manager', 'command', 'Execute non-destructive MDM commands',                      v_cat_id, 'organization', 'medium'),
    ('device_manager.wipe',            'device_manager', 'wipe',    'Execute destructive MDM commands (wipe, erase)',             v_cat_id, 'organization', 'critical'),
    ('device_manager.locate',          'device_manager', 'locate',  'View live device locations',                                v_cat_id, 'organization', 'medium'),
    ('device_manager.locate_history',  'device_manager', 'locate_history', 'View historical device location data',               v_cat_id, 'organization', 'medium'),
    ('device_manager.profile',         'device_manager', 'profile', 'Manage configuration profiles and policies',                v_cat_id, 'organization', 'high'),
    ('device_manager.app',             'device_manager', 'app',     'Manage apps, VPP licenses, and app policies',               v_cat_id, 'organization', 'medium'),
    ('device_manager.compliance',      'device_manager', 'compliance', 'Manage compliance policies and view violations',         v_cat_id, 'organization', 'medium'),
    ('device_manager.audit',           'device_manager', 'audit',   'View audit logs and command history',                       v_cat_id, 'organization', 'low'),
    ('device_manager.override',        'device_manager', 'override', 'Perform manual overrides and break-glass actions',         v_cat_id, 'organization', 'critical')
  ON CONFLICT (name) DO NOTHING;
END $$;


-- =========================================================================
-- PART 6: Seed Role Permissions
-- superadmin + admin = all permissions
-- manager = view + command + locate + audit
-- =========================================================================

DO $$
DECLARE
  v_role RECORD;
  v_perm RECORD;
BEGIN
  FOR v_role IN SELECT id FROM roles WHERE name IN ('superadmin', 'admin') LOOP
    FOR v_perm IN SELECT id FROM permissions WHERE resource = 'device_manager' LOOP
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES (v_role.id, v_perm.id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  FOR v_role IN SELECT id FROM roles WHERE name = 'manager' LOOP
    FOR v_perm IN SELECT id FROM permissions WHERE name IN (
      'device_manager.view', 'device_manager.command',
      'device_manager.locate', 'device_manager.audit'
    ) LOOP
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES (v_role.id, v_perm.id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;


DO $$
BEGIN
  RAISE NOTICE 'Device Manager navigation, tabs, and permissions created successfully';
END $$;
