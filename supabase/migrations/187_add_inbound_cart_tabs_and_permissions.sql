-- ============================================================================
-- Migration 187: Add Inbound Cart Tabs and Component-Level Permissions
-- Description: Adds Stow To Cart and Cart Management tabs to inbound_apps,
--              seeds role tab permissions, creates inbound_carts RBAC resource.
-- ============================================================================

-- =========================================================================
-- PART 1: Tab Definitions
-- =========================================================================

INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order, is_active)
VALUES
  ('inbound_apps', 'stow-to-cart', 'Stow To Cart', 'Scan and stow T.O.s to carts', 2, true),
  ('inbound_apps', 'cart-management', 'Cart Management', 'Manage physical inbound carts', 3, true)
ON CONFLICT (page_resource, tab_id) DO UPDATE SET
  tab_label = EXCLUDED.tab_label,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active;

-- Shift existing tab display orders
UPDATE tab_definitions SET display_order = 4 WHERE page_resource = 'inbound_apps' AND tab_id = 'receiving';
UPDATE tab_definitions SET display_order = 5 WHERE page_resource = 'inbound_apps' AND tab_id = 'processing';
UPDATE tab_definitions SET display_order = 6 WHERE page_resource = 'inbound_apps' AND tab_id = 'quality-check';
UPDATE tab_definitions SET display_order = 7 WHERE page_resource = 'inbound_apps' AND tab_id = 'reports';


-- =========================================================================
-- PART 2: Role Tab Permissions
-- Grant new tabs to all roles that already have any inbound_apps tab granted
-- =========================================================================

INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT DISTINCT rtp.role_id, td.id, true
FROM role_tab_permissions rtp
JOIN tab_definitions td_existing ON rtp.tab_definition_id = td_existing.id
CROSS JOIN tab_definitions td
WHERE td_existing.page_resource = 'inbound_apps'
  AND rtp.granted = true
  AND td.page_resource = 'inbound_apps'
  AND td.tab_id IN ('stow-to-cart', 'cart-management')
ON CONFLICT (role_id, tab_definition_id) DO NOTHING;


-- =========================================================================
-- PART 3: Permission Category for Inbound Cart Management
-- =========================================================================

INSERT INTO permission_categories (name, display_name, description, icon, order_index, is_active)
VALUES ('inbound_cart_management', 'Inbound Cart Management', 'Manage inbound stow carts and T.O. assignments', 'ShoppingCart', 15, true)
ON CONFLICT (name) DO NOTHING;


-- =========================================================================
-- PART 4: Component-Level Permissions (inbound_carts resource)
-- =========================================================================

DO $$
DECLARE
  v_cat_id UUID;
BEGIN
  SELECT id INTO v_cat_id FROM permission_categories WHERE name = 'inbound_cart_management';

  INSERT INTO permissions (name, resource, action, description, category_id, scope, risk_level)
  VALUES
    ('inbound_carts.view',   'inbound_carts', 'read',   'View inbound carts and assignments',           v_cat_id, 'organization', 'low'),
    ('inbound_carts.create', 'inbound_carts', 'create', 'Create new inbound carts',                     v_cat_id, 'organization', 'medium'),
    ('inbound_carts.update', 'inbound_carts', 'update', 'Edit cart properties and mark full',            v_cat_id, 'organization', 'medium'),
    ('inbound_carts.stow',   'inbound_carts', 'stow',   'Stow T.O.s to carts',                         v_cat_id, 'organization', 'low'),
    ('inbound_carts.remove', 'inbound_carts', 'delete', 'Remove T.O.s from carts and deactivate carts', v_cat_id, 'organization', 'high'),
    ('inbound_carts.manage', 'inbound_carts', 'manage', 'Full cart management access',                   v_cat_id, 'organization', 'high')
  ON CONFLICT (name) DO NOTHING;
END $$;


-- =========================================================================
-- PART 5: Seed Role Permissions
-- superadmin + admin = full manage
-- manager = view + create + update + stow
-- all other inbound-accessible roles = view + stow
-- =========================================================================

DO $$
DECLARE
  v_perm_view UUID;
  v_perm_create UUID;
  v_perm_update UUID;
  v_perm_stow UUID;
  v_perm_remove UUID;
  v_perm_manage UUID;
  v_role RECORD;
BEGIN
  SELECT id INTO v_perm_view FROM permissions WHERE name = 'inbound_carts.view';
  SELECT id INTO v_perm_create FROM permissions WHERE name = 'inbound_carts.create';
  SELECT id INTO v_perm_update FROM permissions WHERE name = 'inbound_carts.update';
  SELECT id INTO v_perm_stow FROM permissions WHERE name = 'inbound_carts.stow';
  SELECT id INTO v_perm_remove FROM permissions WHERE name = 'inbound_carts.remove';
  SELECT id INTO v_perm_manage FROM permissions WHERE name = 'inbound_carts.manage';

  -- superadmin and admin: full manage
  FOR v_role IN SELECT id FROM roles WHERE name IN ('superadmin', 'admin') LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES
      (v_role.id, v_perm_view),
      (v_role.id, v_perm_create),
      (v_role.id, v_perm_update),
      (v_role.id, v_perm_stow),
      (v_role.id, v_perm_remove),
      (v_role.id, v_perm_manage)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- manager: view + create + update + stow
  FOR v_role IN SELECT id FROM roles WHERE name = 'manager' LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES
      (v_role.id, v_perm_view),
      (v_role.id, v_perm_create),
      (v_role.id, v_perm_update),
      (v_role.id, v_perm_stow)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Other roles with inbound navigation: view + stow
  FOR v_role IN
    SELECT DISTINCT rnp.role_id AS id
    FROM role_navigation_permissions rnp
    JOIN navigation_items ni ON ni.id = rnp.navigation_item_id
    WHERE ni.url = '/apps/inbound'
      AND rnp.visible = true
      AND rnp.role_id NOT IN (SELECT id FROM roles WHERE name IN ('superadmin', 'admin', 'manager'))
  LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES
      (v_role.id, v_perm_view),
      (v_role.id, v_perm_stow)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;


DO $$
BEGIN
  RAISE NOTICE 'Inbound cart tabs and permissions created successfully';
END $$;
