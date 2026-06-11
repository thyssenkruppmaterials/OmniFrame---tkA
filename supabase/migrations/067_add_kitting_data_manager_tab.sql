-- Migration: Add Kitting Data Manager Tab
-- Date: 2025-11-11 (November 11, 2025)
-- Description: Adds the Kitting Data Manager tab to the kitting_apps page resource

-- Insert the new Kitting Data Manager tab definition
INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order) 
VALUES 
  ('kitting_apps', 'kitting-data-manager', 'Kitting Data Manager', 'Manage kitting data and operations', 6)
ON CONFLICT (page_resource, tab_id) DO UPDATE 
SET 
  tab_label = EXCLUDED.tab_label,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- Add comment for documentation
COMMENT ON TABLE tab_definitions IS 'Updated: Added Kitting Data Manager tab for kitting_apps on November 11, 2025';

