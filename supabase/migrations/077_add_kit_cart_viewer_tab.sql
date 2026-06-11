-- Migration: Add Kit Cart Viewer Tab to Kitting Apps
-- Date: December 17, 2025
-- Description: Adds the Kit Cart Viewer tab for Nefab PFC Trace integration

-- Insert the new tab definition
INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order, is_active)
VALUES ('kitting_apps', 'kit-cart-viewer', 'Kit Cart Viewer', 'Real-time kit cart tracking from Nefab PFC Trace', 7, true)
ON CONFLICT (page_resource, tab_id) DO UPDATE SET
  tab_label = EXCLUDED.tab_label,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active;

-- Grant permissions to the same roles that have access to Kitting Data Manager
-- This ensures consistent access across kitting functionality
INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT 
  rtp.role_id,
  (SELECT id FROM tab_definitions WHERE tab_id = 'kit-cart-viewer' AND page_resource = 'kitting_apps'),
  true
FROM role_tab_permissions rtp
JOIN tab_definitions td ON td.id = rtp.tab_definition_id
WHERE td.tab_id = 'kitting-data-manager' 
  AND td.page_resource = 'kitting_apps' 
  AND rtp.granted = true
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = true;

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE 'Kit Cart Viewer tab added to Kitting Apps with permissions copied from Kitting Data Manager';
END $$;

