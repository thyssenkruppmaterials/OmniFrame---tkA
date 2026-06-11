-- Update inventory app tab from 'movements' to 'manual-counts'
-- Migration: 034_update_inventory_movements_to_manual_counts.sql
-- Description: Updates the tab permissions system to change 'movements' to 'manual-counts' for inventory_apps

UPDATE tab_permissions 
SET 
  tab_id = 'manual-counts',
  tab_name = 'Manual Counts', 
  description = 'Perform cycle counts and inventory adjustments with manual count tracking'
WHERE app_id = 'inventory_apps' AND tab_id = 'movements';



