-- Migration: Update Kitting Apps Tabs
-- Date: 2026-01-10
-- Description: Hide Overview tab and rename Kits tab to Kit Assembly Board in Kitting Apps

-- 1. Deactivate the Overview tab for kitting_apps
UPDATE tab_definitions 
SET 
  is_active = false,
  updated_at = NOW()
WHERE page_resource = 'kitting_apps' 
  AND tab_id = 'overview';

-- 2. Rename the Kits tab to Kit Assembly Board and update display order to 1
UPDATE tab_definitions 
SET 
  tab_label = 'Kit Assembly Board',
  description = 'Kit assembly board with kanban workflow',
  display_order = 1,
  updated_at = NOW()
WHERE page_resource = 'kitting_apps' 
  AND tab_id = 'kits';

-- 3. Update display order for remaining tabs (shift up since overview is removed)
UPDATE tab_definitions 
SET 
  display_order = 2,
  updated_at = NOW()
WHERE page_resource = 'kitting_apps' 
  AND tab_id = 'components';

UPDATE tab_definitions 
SET 
  display_order = 3,
  updated_at = NOW()
WHERE page_resource = 'kitting_apps' 
  AND tab_id = 'reports';

UPDATE tab_definitions 
SET 
  display_order = 4,
  updated_at = NOW()
WHERE page_resource = 'kitting_apps' 
  AND tab_id = 'settings';

UPDATE tab_definitions 
SET 
  display_order = 5,
  updated_at = NOW()
WHERE page_resource = 'kitting_apps' 
  AND tab_id = 'kitting-data-manager';

UPDATE tab_definitions 
SET 
  display_order = 6,
  updated_at = NOW()
WHERE page_resource = 'kitting_apps' 
  AND tab_id = 'kit-cart-viewer';

-- 4. Update role permissions that only had 'overview' access to also include 'kits' tab
-- This ensures users who had access to the overview tab now have access to the kit assembly board
INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT 
  rtp.role_id,
  (SELECT id FROM tab_definitions WHERE page_resource = 'kitting_apps' AND tab_id = 'kits'),
  true
FROM role_tab_permissions rtp
JOIN tab_definitions td ON rtp.tab_definition_id = td.id
WHERE td.page_resource = 'kitting_apps' 
  AND td.tab_id = 'overview'
  AND rtp.granted = true
  AND NOT EXISTS (
    SELECT 1 FROM role_tab_permissions rtp2
    JOIN tab_definitions td2 ON rtp2.tab_definition_id = td2.id
    WHERE rtp2.role_id = rtp.role_id
      AND td2.page_resource = 'kitting_apps'
      AND td2.tab_id = 'kits'
  )
ON CONFLICT (role_id, tab_definition_id) DO NOTHING;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 099: Kitting Apps tabs updated successfully';
  RAISE NOTICE '- Overview tab deactivated (hidden)';
  RAISE NOTICE '- Kits tab renamed to Kit Assembly Board';
  RAISE NOTICE '- Tab display order updated';
END $$;
