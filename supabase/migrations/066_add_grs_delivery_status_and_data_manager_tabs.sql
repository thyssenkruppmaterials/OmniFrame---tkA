-- Add GRS Delivery Status and Data Manager tabs
-- Migration: 066_add_grs_delivery_status_and_data_manager_tabs.sql
-- Description: Adds GRS Delivery Status and GRS Data Manager tabs to GRS Apps
-- Date: 2025-11-09
-- Note: These tabs share the same database tables as Outbound Apps but with GRS-specific filtering

-- Insert the new GRS tab definitions
INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order) 
VALUES 
('grs_apps', 'delivery-status', 'GRS Delivery Status', 'Track delivery status and shipment progress for GRS operations (shares rr_all_deliveries table)', 5),
('grs_apps', 'data-manager', 'GRS Data Manager', 'Comprehensive data management tools for GRS operations (shares outbound_to_data table)', 6)
ON CONFLICT (page_resource, tab_id) DO UPDATE
SET tab_label = EXCLUDED.tab_label,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    updated_at = NOW();

-- Update the display order of existing tabs if needed (reports and settings were 5 and 6)
-- We'll renumber them to 7 and 8 if they exist
UPDATE tab_definitions 
SET display_order = 7, updated_at = NOW()
WHERE page_resource = 'grs_apps' 
  AND tab_id = 'reports' 
  AND display_order = 5;

UPDATE tab_definitions 
SET display_order = 8, updated_at = NOW()
WHERE page_resource = 'grs_apps' 
  AND tab_id = 'settings' 
  AND display_order = 6;

-- Grant permissions for the new tabs to all roles that have GRS app access
-- This ensures existing users with GRS access can see the new tabs
INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT DISTINCT rtp.role_id, td.id, true
FROM role_tab_permissions rtp
JOIN tab_definitions td_existing ON rtp.tab_definition_id = td_existing.id
JOIN tab_definitions td ON td.page_resource = 'grs_apps' AND td.tab_id IN ('delivery-status', 'data-manager')
WHERE td_existing.page_resource = 'grs_apps' 
  AND rtp.granted = true
ON CONFLICT (role_id, tab_definition_id) DO NOTHING;

-- Verify the new tabs were added
DO $$
DECLARE
  delivery_status_count INTEGER;
  data_manager_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO delivery_status_count
  FROM tab_definitions
  WHERE page_resource = 'grs_apps' AND tab_id = 'delivery-status';
  
  SELECT COUNT(*) INTO data_manager_count
  FROM tab_definitions
  WHERE page_resource = 'grs_apps' AND tab_id = 'data-manager';
  
  IF delivery_status_count = 1 AND data_manager_count = 1 THEN
    RAISE NOTICE '✅ GRS Delivery Status and Data Manager tabs successfully added to tab_definitions';
  ELSE
    RAISE WARNING '⚠️ Tab insertion may have failed - delivery_status: %, data_manager: %', 
      delivery_status_count, data_manager_count;
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON TABLE tab_definitions IS 'Defines available tabs for each page resource. GRS Delivery Status and Data Manager tabs share database tables with Outbound Apps but use GRS-specific filtering.';

