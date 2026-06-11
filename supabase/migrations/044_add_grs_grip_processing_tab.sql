-- Add GRS GRIP Processing tab definition
-- Migration: 044_add_grs_grip_processing_tab.sql
-- Description: Adds GRS GRIP Processing tab to tab_definitions and replaces Disposition tab
-- Date: 2025-09-24

-- First, delete the old disposition tab if it exists
DELETE FROM tab_definitions 
WHERE page_resource = 'grs_apps' AND tab_id = 'disposition';

-- Insert the new GRS GRIP Processing tab definition
INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order) 
VALUES ('grs_apps', 'grs-grip-processing', 'GRS GRIP Processing', 'Process GRS GRIP operations', 4)
ON CONFLICT (page_resource, tab_id) DO UPDATE
SET tab_label = 'GRS GRIP Processing',
    description = 'Process GRS GRIP operations',
    display_order = 4,
    updated_at = NOW();

-- Update the display order of subsequent tabs
UPDATE tab_definitions 
SET display_order = 5, updated_at = NOW()
WHERE page_resource = 'grs_apps' AND tab_id = 'reports';

UPDATE tab_definitions 
SET display_order = 6, updated_at = NOW()
WHERE page_resource = 'grs_apps' AND tab_id = 'settings';

-- Grant permissions for the new tab to all roles that previously had GRS app permissions
INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT DISTINCT rtp.role_id, td.id, true
FROM role_tab_permissions rtp
JOIN tab_definitions td_existing ON rtp.tab_definition_id = td_existing.id
JOIN tab_definitions td ON td.page_resource = 'grs_apps' AND td.tab_id = 'grs-grip-processing'
WHERE td_existing.page_resource = 'grs_apps' 
  AND td_existing.tab_id IN ('overview', 'tracking', 'quality')
  AND rtp.granted = true
ON CONFLICT (role_id, tab_definition_id) DO NOTHING;
