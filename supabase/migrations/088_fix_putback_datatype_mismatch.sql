-- =========================================================================
-- Fix Putback Datatype Mismatch
-- Created: January 4, 2026
-- Purpose: Fix datatype mismatch error in get_team_activity_events
-- Error: "Returned type character varying does not match expected type text in column 4"
-- Root Cause: shelf_location and to_location are VARCHAR, but function expects TEXT
-- Solution: Cast VARCHAR columns to TEXT explicitly
-- =========================================================================

DROP FUNCTION IF EXISTS get_team_activity_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

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
    'Receiving'::TEXT AS area
  FROM rr_inbound_scans ris
  WHERE ris.organization_id = p_organization_id
    AND ris.scanned_at >= p_start_date
    AND ris.scanned_at <= p_end_date
    AND ris.scanned_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Putaways (created_by with confirmed_at or created_at)
  -- FIXED: Cast VARCHAR columns to TEXT explicitly
  SELECT 
    rpo.created_by AS user_id,
    'putaway'::TEXT AS event_type,
    COALESCE(rpo.confirmed_at, rpo.created_at) AS event_timestamp,
    COALESCE(rpo.shelf_location::TEXT, rpo.to_location::TEXT, 'Putaway'::TEXT) AS area
  FROM rf_putaway_operations rpo
  WHERE rpo.organization_id = p_organization_id
    AND rpo.created_at >= p_start_date
    AND rpo.created_at <= p_end_date
    AND rpo.created_by IN (SELECT au.user_id FROM active_users au)
  
  UNION ALL
  
  -- Putaways (confirmed_by - different from creator)
  -- FIXED: Cast VARCHAR columns to TEXT explicitly
  SELECT 
    rpo.confirmed_by AS user_id,
    'putaway'::TEXT AS event_type,
    rpo.confirmed_at AS event_timestamp,
    COALESCE(rpo.shelf_location::TEXT, rpo.to_location::TEXT, 'Putaway'::TEXT) AS area
  FROM rf_putaway_operations rpo
  WHERE rpo.organization_id = p_organization_id
    AND rpo.confirmed_at >= p_start_date
    AND rpo.confirmed_at <= p_end_date
    AND rpo.confirmed_by IS NOT NULL
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
  
  -- Putbacks - FIXED: Use created_at consistently for both event timestamp and filtering
  -- This aligns with get_team_productivity_counts and credits putback work to the creation date
  SELECT 
    pt.created_by AS user_id,
    'putback'::TEXT AS event_type,
    pt.created_at AS event_timestamp,
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_team_activity_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- Update function comment
COMMENT ON FUNCTION get_team_activity_events IS 
'Returns all activity events with timestamps for all active associates. Used for building Gantt timeline visualizations. Eliminates N+1 queries. FIXED (v3): Explicit TEXT casting to fix VARCHAR/TEXT mismatch + putback events use created_at consistently.';
