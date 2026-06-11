-- Migration: Tab Permissions System
-- Date: 2025-01-20 (January 20, 2025)
-- Description: Creates comprehensive tab-level permission system for role management

-- Create tab_definitions table if it doesn't exist
CREATE TABLE IF NOT EXISTS tab_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_resource VARCHAR(100) NOT NULL,
  tab_id VARCHAR(100) NOT NULL,
  tab_label VARCHAR(200) NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(page_resource, tab_id)
);

-- Create role_tab_permissions table if it doesn't exist
CREATE TABLE IF NOT EXISTS role_tab_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE NOT NULL,
  tab_definition_id UUID REFERENCES tab_definitions(id) ON DELETE CASCADE NOT NULL,
  granted BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(role_id, tab_definition_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_tab_definitions_page_resource ON tab_definitions(page_resource);
CREATE INDEX IF NOT EXISTS idx_tab_definitions_display_order ON tab_definitions(display_order);
CREATE INDEX IF NOT EXISTS idx_tab_definitions_is_active ON tab_definitions(is_active);
CREATE INDEX IF NOT EXISTS idx_role_tab_permissions_role_id ON role_tab_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_tab_permissions_tab_definition_id ON role_tab_permissions(tab_definition_id);
CREATE INDEX IF NOT EXISTS idx_role_tab_permissions_granted ON role_tab_permissions(granted);

-- Insert comprehensive tab definitions for all applications
INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order) VALUES
-- Customer Portal tabs
('customer_portal', 'dashboard', 'Dashboard', 'Customer portal overview', 1),
('customer_portal', 'accounts', 'Customer Accounts', 'Manage customer accounts', 2),
('customer_portal', 'orders', 'Order Management', 'Manage customer orders', 3),
('customer_portal', 'support', 'Support Tickets', 'Customer support tickets', 4),
('customer_portal', 'reports', 'Reports', 'Customer reports', 5),

-- Data Manager tabs
('data_manager', 'overview', 'LX03 Data Manager', 'LX03 data management', 1),
('data_manager', 'batch-tracking', 'SQ01 Data Manager', 'SQ01 batch tracking', 2),
('data_manager', 'quality-control', 'Material Master Data Manager', 'Material master management', 3),
('data_manager', 'reports', 'Reports', 'Data reports and analytics', 4),
('data_manager', 'settings', 'Settings', 'Data manager settings', 5),

-- GRS Apps tabs
('grs_apps', 'overview', 'Overview', 'GRS operations overview', 1),
('grs_apps', 'tracking', 'Tracking', 'Track GRS operations', 2),
('grs_apps', 'quality', 'Quality', 'Quality management', 3),
('grs_apps', 'reports', 'Reports', 'GRS reports and analytics', 4),
('grs_apps', 'settings', 'Settings', 'GRS settings', 5),

-- Inbound Apps tabs
('inbound_apps', 'inbound-scan-search', 'Inbound Scan Search', 'Search and manage inbound scans', 1),
('inbound_apps', 'receiving', 'Putaway Log Search', 'Receiving and putaway operations', 2),
('inbound_apps', 'processing', 'Processing', 'Process inbound items', 3),
('inbound_apps', 'quality-check', 'Quality Check', 'Quality inspections', 4),
('inbound_apps', 'reports', 'Reports', 'Inbound reports and analytics', 5),

-- Inventory Apps tabs
('inventory_apps', 'overview', 'Overview', 'Dashboard view with key inventory metrics', 1),
('inventory_apps', 'products', 'Products', 'Manage product catalog and information', 2),
('inventory_apps', 'locations', 'Locations', 'Manage warehouse locations and zones', 3),
('inventory_apps', 'movements', 'Movements', 'Track inventory movements and transfers', 4),
('inventory_apps', 'reports', 'Reports', 'Generate inventory reports and analytics', 5),

-- Kitting Apps tabs
('kitting_apps', 'overview', 'Overview', 'Kitting operations overview', 1),
('kitting_apps', 'kits', 'Kits', 'Manage kits and assembly', 2),
('kitting_apps', 'components', 'Components', 'Kit component management', 3),
('kitting_apps', 'reports', 'Reports', 'Kitting reports and analytics', 4),
('kitting_apps', 'settings', 'Settings', 'Kitting settings', 5),

-- Outbound Apps tabs
('outbound_apps', 'pack-tool', 'Pack Tool', 'Manage packing operations', 1),
('outbound_apps', 'putback-tool', 'Putback Tool', 'Handle putback operations', 2),
('outbound_apps', 'shippers-tool', 'Shippers Tool', 'Manage shipping operations', 3),
('outbound_apps', 'final-pack-tool', 'Final Pack Tool', 'Final packing operations', 4),
('outbound_apps', 'delivery-status', 'Delivery Status', 'Track delivery statuses', 5),
('outbound_apps', 'data-manager', 'Data Manager', 'Manage outbound data', 6),

-- Quality Apps tabs
('quality_apps', 'overview', 'Overview', 'Quality operations overview', 1),
('quality_apps', 'inspections', 'Inspections', 'Quality inspections', 2),
('quality_apps', 'certificates', 'Certificates', 'Quality certificates', 3),
('quality_apps', 'reports', 'Reports', 'Quality reports and analytics', 4),
('quality_apps', 'settings', 'Settings', 'Quality settings', 5),

-- Smartsheet Integrations tabs
('smartsheet_integrations', 'dashboard', 'Dashboard', 'Smartsheet integration overview', 1),
('smartsheet_integrations', 'connections', 'Connections', 'Manage Smartsheet connections', 2),
('smartsheet_integrations', 'data-sync', 'Data Sync', 'Data synchronization jobs', 3),
('smartsheet_integrations', 'automation', 'Automation', 'Automated workflows', 4),
('smartsheet_integrations', 'settings', 'Settings', 'Integration settings', 5),

-- Unit Pack Apps tabs
('unit_pack_apps', 'overview', 'Overview', 'Unit pack operations overview', 1),
('unit_pack_apps', 'packaging', 'Packaging', 'Unit packaging operations', 2),
('unit_pack_apps', 'labels', 'Labels', 'Unit pack labels', 3),
('unit_pack_apps', 'reports', 'Reports', 'Unit pack reports and analytics', 4),
('unit_pack_apps', 'settings', 'Settings', 'Unit pack settings', 5)

ON CONFLICT (page_resource, tab_id) DO NOTHING;

-- Enable RLS on new tables
ALTER TABLE tab_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_tab_permissions ENABLE ROW LEVEL SECURITY;

-- RLS policies for tab_definitions
CREATE POLICY "Tab definitions viewable by authenticated users" 
  ON tab_definitions FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Only admins can manage tab definitions" 
  ON tab_definitions FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- RLS policies for role_tab_permissions
CREATE POLICY "Role tab permissions viewable by authenticated users" 
  ON role_tab_permissions FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Only admins can manage role tab permissions" 
  ON role_tab_permissions FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- Create function to get user tab permissions
CREATE OR REPLACE FUNCTION get_user_tab_permissions(
  user_id UUID,
  page_resource VARCHAR DEFAULT NULL
)
RETURNS TABLE(
  tab_definition_id UUID,
  page_resource VARCHAR,
  tab_id VARCHAR,
  tab_label VARCHAR,
  description TEXT,
  display_order INTEGER,
  granted BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    td.id as tab_definition_id,
    td.page_resource,
    td.tab_id,
    td.tab_label,
    td.description,
    td.display_order,
    COALESCE(rtp.granted, true) as granted
  FROM tab_definitions td
  LEFT JOIN role_tab_permissions rtp ON td.id = rtp.tab_definition_id
  LEFT JOIN user_profiles up ON rtp.role_id = up.role_id
  WHERE td.is_active = true
    AND (page_resource IS NULL OR td.page_resource = $2)
    AND (up.id = user_id OR rtp.role_id IS NULL)
  ORDER BY td.page_resource, td.display_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to assign tab permissions to role
CREATE OR REPLACE FUNCTION assign_tab_permissions_to_role(
  role_id UUID,
  tab_definition_ids UUID[]
)
RETURNS VOID AS $$
BEGIN
  -- Delete existing tab permissions for this role
  DELETE FROM role_tab_permissions WHERE role_tab_permissions.role_id = $1;
  
  -- Insert new tab permissions
  IF array_length(tab_definition_ids, 1) > 0 THEN
    INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted, created_by)
    SELECT $1, unnest(tab_definition_ids), true, auth.uid();
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions on functions
GRANT EXECUTE ON FUNCTION get_user_tab_permissions(UUID, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION assign_tab_permissions_to_role(UUID, UUID[]) TO authenticated, service_role;

-- Add comments for documentation
COMMENT ON TABLE tab_definitions IS 'Defines available tabs for each page resource in the application';
COMMENT ON TABLE role_tab_permissions IS 'Manages tab-level permissions for each role';
COMMENT ON FUNCTION get_user_tab_permissions(UUID, VARCHAR) IS 'Returns tab permissions for a specific user';
COMMENT ON FUNCTION assign_tab_permissions_to_role(UUID, UUID[]) IS 'Assigns tab permissions to a role';

-- Create default tab permissions for system roles
DO $$
DECLARE
  superadmin_role_id UUID;
  admin_role_id UUID;
  manager_role_id UUID;
  cashier_role_id UUID;
  viewer_role_id UUID;
  tka_associate_role_id UUID;
  all_tab_ids UUID[];
BEGIN
  -- Get role IDs
  SELECT id INTO superadmin_role_id FROM roles WHERE name = 'superadmin';
  SELECT id INTO admin_role_id FROM roles WHERE name = 'admin';
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager';
  SELECT id INTO cashier_role_id FROM roles WHERE name = 'cashier';
  SELECT id INTO viewer_role_id FROM roles WHERE name = 'viewer';
  SELECT id INTO tka_associate_role_id FROM roles WHERE name = 'tka_associate';

  -- Get all tab definition IDs
  SELECT ARRAY_AGG(id) INTO all_tab_ids FROM tab_definitions;

  -- Grant all tab permissions to superadmin and admin
  IF superadmin_role_id IS NOT NULL THEN
    PERFORM assign_tab_permissions_to_role(superadmin_role_id, all_tab_ids);
  END IF;
  
  IF admin_role_id IS NOT NULL THEN
    PERFORM assign_tab_permissions_to_role(admin_role_id, all_tab_ids);
  END IF;

  -- Grant basic tab permissions to other roles (overview, reports)
  IF manager_role_id IS NOT NULL THEN
    PERFORM assign_tab_permissions_to_role(
      manager_role_id, 
      ARRAY(SELECT id FROM tab_definitions WHERE tab_id IN ('overview', 'reports', 'tracking', 'quality'))
    );
  END IF;

  IF viewer_role_id IS NOT NULL THEN
    PERFORM assign_tab_permissions_to_role(
      viewer_role_id,
      ARRAY(SELECT id FROM tab_definitions WHERE tab_id IN ('overview', 'reports'))
    );
  END IF;

  IF cashier_role_id IS NOT NULL THEN
    PERFORM assign_tab_permissions_to_role(
      cashier_role_id,
      ARRAY(SELECT id FROM tab_definitions WHERE tab_id IN ('overview', 'reports'))
    );
  END IF;

  IF tka_associate_role_id IS NOT NULL THEN
    PERFORM assign_tab_permissions_to_role(
      tka_associate_role_id,
      ARRAY(SELECT id FROM tab_definitions WHERE tab_id IN ('overview', 'tracking', 'quality-check', 'processing'))
    );
  END IF;
END $$;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 020: Tab permissions system completed successfully';
  RAISE NOTICE 'Created % tab definitions', (SELECT COUNT(*) FROM tab_definitions);
  RAISE NOTICE 'Created % role tab permissions', (SELECT COUNT(*) FROM role_tab_permissions);
END $$;


