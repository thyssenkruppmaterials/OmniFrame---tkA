-- =========================================================================
-- Bug Fix: M4 - Double-counting putaway events in get_team_activity_events
-- Created: January 28, 2026
-- Purpose: Fix double-counting when the same user creates AND confirms a putaway
-- Problem: The get_team_activity_events function has two UNION queries for putaway:
--          1. One for created_by with COALESCE(confirmed_at, created_at) as timestamp
--          2. One for confirmed_by with confirmed_at as timestamp
--          If the same user creates AND confirms (common scenario), they get counted twice
-- Solution: Add condition to exclude confirmed_by records where confirmed_by = created_by
--           Also use distinct event_type 'putaway_confirm' for confirmation events
-- =========================================================================

CREATE OR REPLACE FUNCTION get_team_activity_events(
  p_organization_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  event_type TEXT,
  event_timestamp TIMESTAMPTZ,
  area TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- SECURITY VALIDATION: Verify caller has access to this organization
  PERFORM validate_organization_access(p_organization_id);
  
  RETURN QUERY
  WITH active_users AS (
    SELECT DISTINCT sa.user_id
    FROM shift_assignments sa
    WHERE sa.organization_id = p_organization_id
      AND sa.status = 'active'
      AND sa.is_primary_position = true
  )
  
  -- Inbound scans
  SELECT 
    ris.scanned_by AS user_id,
    'inbound_scan'::TEXT AS event_type,
    ris.scanned_at AS event_timestamp,
    COALESCE(ris.area, 'Receiving') AS area
  FROM rr_inbound_scans ris
  WHERE ris.organization_id = p_organization_id
    AND ris.scanned_at >= p_start_date
    AND ris.scanned_at <= p_end_date
    AND ris.scanned_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Putaways (created_by - the user who initiated the putaway)
  -- Uses confirmed_at if available, otherwise created_at
  SELECT 
    rpo.created_by AS user_id,
    'putaway'::TEXT AS event_type,
    COALESCE(rpo.confirmed_at, rpo.created_at) AS event_timestamp,
    COALESCE(rpo.shelf_location, rpo.to_location, 'Putaway') AS area
  FROM rf_putaway_operations rpo
  WHERE rpo.organization_id = p_organization_id
    AND rpo.created_at >= p_start_date
    AND rpo.created_at <= p_end_date
    AND rpo.created_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Putaway confirmations (confirmed_by - ONLY if different from creator)
  -- This prevents double-counting when the same user creates AND confirms
  -- Uses distinct event_type 'putaway_confirm' to differentiate from creation
  SELECT 
    rpo.confirmed_by AS user_id,
    'putaway_confirm'::TEXT AS event_type,
    rpo.confirmed_at AS event_timestamp,
    COALESCE(rpo.shelf_location, rpo.to_location, 'Putaway') AS area
  FROM rf_putaway_operations rpo
  WHERE rpo.organization_id = p_organization_id
    AND rpo.confirmed_at >= p_start_date
    AND rpo.confirmed_at <= p_end_date
    AND rpo.confirmed_by IS NOT NULL
    AND rpo.confirmed_by != rpo.created_by  -- FIX: Only count if confirmer is different from creator
    AND rpo.confirmed_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Picking
  SELECT 
    otd.picked_by AS user_id,
    'picking'::TEXT AS event_type,
    otd.picked_at AS event_timestamp,
    'Picking'::TEXT AS area
  FROM outbound_to_data otd
  WHERE otd.organization_id = p_organization_id
    AND otd.picked_at >= p_start_date
    AND otd.picked_at <= p_end_date
    AND otd.picked_by IS NOT NULL
    AND otd.picked_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Packed
  SELECT 
    otd.packed_by AS user_id,
    'pack'::TEXT AS event_type,
    otd.packed_at AS event_timestamp,
    'Packing'::TEXT AS area
  FROM outbound_to_data otd
  WHERE otd.organization_id = p_organization_id
    AND otd.packed_at >= p_start_date
    AND otd.packed_at <= p_end_date
    AND otd.packed_by IS NOT NULL
    AND otd.packed_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Shipped
  SELECT 
    otd.shipped_by AS user_id,
    'ship'::TEXT AS event_type,
    otd.shipped_at AS event_timestamp,
    'Shipping'::TEXT AS area
  FROM outbound_to_data otd
  WHERE otd.organization_id = p_organization_id
    AND otd.shipped_at >= p_start_date
    AND otd.shipped_at <= p_end_date
    AND otd.shipped_by IS NOT NULL
    AND otd.shipped_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Final packed
  SELECT 
    otd.final_packed_by AS user_id,
    'final_pack'::TEXT AS event_type,
    otd.final_packed_at AS event_timestamp,
    'Final Pack'::TEXT AS area
  FROM outbound_to_data otd
  WHERE otd.organization_id = p_organization_id
    AND otd.final_packed_at >= p_start_date
    AND otd.final_packed_at <= p_end_date
    AND otd.final_packed_by IS NOT NULL
    AND otd.final_packed_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Putbacks
  SELECT 
    pt.created_by AS user_id,
    'putback'::TEXT AS event_type,
    COALESCE(pt.processed_at, pt.created_at) AS event_timestamp,
    'Putback'::TEXT AS area
  FROM putback_tickets pt
  WHERE pt.organization_id = p_organization_id
    AND pt.created_at >= p_start_date
    AND pt.created_at <= p_end_date
    AND pt.created_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Cycle counts
  SELECT 
    rcd.assigned_to AS user_id,
    'cycle_count'::TEXT AS event_type,
    COALESCE(rcd.completed_at, rcd.created_at) AS event_timestamp,
    'Inventory'::TEXT AS area
  FROM rr_cyclecount_data rcd
  WHERE rcd.organization_id = p_organization_id
    AND rcd.status IN ('completed', 'approved')
    AND rcd.created_at >= p_start_date
    AND rcd.created_at <= p_end_date
    AND rcd.assigned_to IN (SELECT au.user_id FROM active_users au)
  
  ORDER BY user_id, event_timestamp;
END;
$$;

COMMENT ON FUNCTION get_team_activity_events IS 
'Returns all activity events with timestamps for all active associates. Used for building Gantt timeline visualizations. Eliminates N+1 queries. FIX: Putaway confirmations now only counted when confirmer differs from creator to prevent double-counting. Security: Validates caller belongs to the requested organization.';
