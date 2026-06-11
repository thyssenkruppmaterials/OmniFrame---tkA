-- =========================================================================
-- Security Fix: Add Organization Access Validation to SECURITY DEFINER RPCs
-- Created: January 28, 2026
-- Purpose: Fix H4 security vulnerability - validate org access in all team
--          performance RPC functions to prevent cross-organization data access
-- Impact: All 4 team performance RPC functions now verify the caller belongs
--         to the requested organization before returning any data
-- =========================================================================

-- =========================================================================
-- PART 1: SECURITY VALIDATION HELPER FUNCTION
-- Centralized organization access check for all RPC functions
-- =========================================================================

CREATE OR REPLACE FUNCTION validate_organization_access(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if the current user belongs to the requested organization
  -- Uses user_profiles table which links users to their organization
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() 
    AND organization_id = org_id
  ) THEN
    RAISE EXCEPTION 'Access denied: You do not have access to organization %', org_id;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION validate_organization_access(UUID) TO authenticated;

COMMENT ON FUNCTION validate_organization_access IS 
'Security helper function that validates the calling user belongs to the specified organization. Raises an exception if access is denied. Used by all SECURITY DEFINER RPC functions to prevent cross-organization data access.';


-- =========================================================================
-- PART 2: UPDATED get_team_productivity_counts WITH SECURITY VALIDATION
-- =========================================================================

CREATE OR REPLACE FUNCTION get_team_productivity_counts(
  p_organization_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  inbound_scans BIGINT,
  put_aways BIGINT,
  picking BIGINT,
  packed BIGINT,
  shipped BIGINT,
  final_packed BIGINT,
  putbacks BIGINT,
  cycle_counts BIGINT,
  total_tasks BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- SECURITY VALIDATION: Verify caller has access to this organization
  PERFORM validate_organization_access(p_organization_id);
  
  RETURN QUERY
  WITH 
  -- Get all active shift assignments for the organization
  active_users AS (
    SELECT DISTINCT sa.user_id
    FROM shift_assignments sa
    WHERE sa.organization_id = p_organization_id
      AND sa.status = 'active'
      AND sa.is_primary_position = true
  ),
  
  -- Count inbound scans per user
  inbound_counts AS (
    SELECT scanned_by AS uid, COUNT(*) AS cnt
    FROM rr_inbound_scans
    WHERE organization_id = p_organization_id
      AND scanned_at >= p_start_date
      AND scanned_at <= p_end_date
      AND scanned_by IN (SELECT user_id FROM active_users)
    GROUP BY scanned_by
  ),
  
  -- Count putaways per user (created_by)
  putaway_counts AS (
    SELECT created_by AS uid, COUNT(*) AS cnt
    FROM rf_putaway_operations
    WHERE organization_id = p_organization_id
      AND created_at >= p_start_date
      AND created_at <= p_end_date
      AND created_by IN (SELECT user_id FROM active_users)
    GROUP BY created_by
  ),
  
  -- Count picking per user
  picking_counts AS (
    SELECT picked_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND picked_at >= p_start_date
      AND picked_at <= p_end_date
      AND picked_by IN (SELECT user_id FROM active_users)
    GROUP BY picked_by
  ),
  
  -- Count packed per user
  packed_counts AS (
    SELECT packed_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND packed_at >= p_start_date
      AND packed_at <= p_end_date
      AND packed_by IN (SELECT user_id FROM active_users)
    GROUP BY packed_by
  ),
  
  -- Count shipped per user
  shipped_counts AS (
    SELECT shipped_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND shipped_at >= p_start_date
      AND shipped_at <= p_end_date
      AND shipped_by IN (SELECT user_id FROM active_users)
    GROUP BY shipped_by
  ),
  
  -- Count final_packed per user
  final_packed_counts AS (
    SELECT final_packed_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND final_packed_at >= p_start_date
      AND final_packed_at <= p_end_date
      AND final_packed_by IN (SELECT user_id FROM active_users)
    GROUP BY final_packed_by
  ),
  
  -- Count putbacks per user
  putback_counts AS (
    SELECT created_by AS uid, COUNT(*) AS cnt
    FROM putback_tickets
    WHERE organization_id = p_organization_id
      AND created_at >= p_start_date
      AND created_at <= p_end_date
      AND created_by IN (SELECT user_id FROM active_users)
    GROUP BY created_by
  ),
  
  -- Count cycle counts per user
  cyclecount_counts AS (
    SELECT assigned_to AS uid, COUNT(*) AS cnt
    FROM rr_cyclecount_data
    WHERE organization_id = p_organization_id
      AND status IN ('completed', 'approved')
      AND completed_at >= p_start_date
      AND completed_at <= p_end_date
      AND assigned_to IN (SELECT user_id FROM active_users)
    GROUP BY assigned_to
  )
  
  -- Combine all counts for each user
  SELECT 
    au.user_id,
    COALESCE(ic.cnt, 0) AS inbound_scans,
    COALESCE(pc.cnt, 0) AS put_aways,
    COALESCE(pkc.cnt, 0) AS picking,
    COALESCE(pac.cnt, 0) AS packed,
    COALESCE(sc.cnt, 0) AS shipped,
    COALESCE(fpc.cnt, 0) AS final_packed,
    COALESCE(pbc.cnt, 0) AS putbacks,
    COALESCE(cc.cnt, 0) AS cycle_counts,
    (
      COALESCE(ic.cnt, 0) + COALESCE(pc.cnt, 0) + COALESCE(pkc.cnt, 0) +
      COALESCE(pac.cnt, 0) + COALESCE(sc.cnt, 0) + COALESCE(fpc.cnt, 0) +
      COALESCE(pbc.cnt, 0) + COALESCE(cc.cnt, 0)
    ) AS total_tasks
  FROM active_users au
  LEFT JOIN inbound_counts ic ON ic.uid = au.user_id
  LEFT JOIN putaway_counts pc ON pc.uid = au.user_id
  LEFT JOIN picking_counts pkc ON pkc.uid = au.user_id
  LEFT JOIN packed_counts pac ON pac.uid = au.user_id
  LEFT JOIN shipped_counts sc ON sc.uid = au.user_id
  LEFT JOIN final_packed_counts fpc ON fpc.uid = au.user_id
  LEFT JOIN putback_counts pbc ON pbc.uid = au.user_id
  LEFT JOIN cyclecount_counts cc ON cc.uid = au.user_id;
END;
$$;

COMMENT ON FUNCTION get_team_productivity_counts IS 
'Returns aggregated productivity task counts for all active associates in an organization for a date range. Eliminates N+1 queries by fetching all counts in a single query. Security: Validates caller belongs to the requested organization.';


-- =========================================================================
-- PART 3: UPDATED get_team_activity_events WITH SECURITY VALIDATION
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
  
  -- Putaways (created_by with confirmed_at or created_at)
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
  
  -- Putaways (confirmed_by - different from creator)
  SELECT 
    rpo.confirmed_by AS user_id,
    'putaway'::TEXT AS event_type,
    rpo.confirmed_at AS event_timestamp,
    COALESCE(rpo.shelf_location, rpo.to_location, 'Putaway') AS area
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
'Returns all activity events with timestamps for all active associates. Used for building Gantt timeline visualizations. Eliminates N+1 queries. Security: Validates caller belongs to the requested organization.';


-- =========================================================================
-- PART 4: UPDATED get_weekly_productivity_summary WITH SECURITY VALIDATION
-- NOTE: This includes the fix from migration 153 for active_associates
-- =========================================================================

CREATE OR REPLACE FUNCTION get_weekly_productivity_summary(
  p_organization_id UUID,
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  day_date DATE,
  day_name TEXT,
  total_tasks BIGINT,
  total_associates BIGINT,
  active_associates BIGINT,
  inbound_scans BIGINT,
  put_aways BIGINT,
  picking BIGINT,
  packed BIGINT,
  shipped BIGINT,
  final_packed BIGINT,
  putbacks BIGINT,
  cycle_counts BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_start_date DATE;
BEGIN
  -- SECURITY VALIDATION: Verify caller has access to this organization
  PERFORM validate_organization_access(p_organization_id);
  
  -- Calculate 7 days back from end date
  v_start_date := p_end_date - INTERVAL '6 days';
  
  RETURN QUERY
  WITH 
  -- Generate date series for the 7 days
  date_series AS (
    SELECT 
      d::DATE AS day_date,
      TO_CHAR(d, 'Dy') AS day_name,
      d::DATE AS start_ts,
      (d + INTERVAL '1 day' - INTERVAL '1 second')::TIMESTAMPTZ AS end_ts
    FROM generate_series(
      v_start_date::TIMESTAMPTZ,
      p_end_date::TIMESTAMPTZ,
      '1 day'::INTERVAL
    ) AS d
  ),
  
  -- Get all active shift assignments
  active_users AS (
    SELECT DISTINCT user_id
    FROM shift_assignments
    WHERE organization_id = p_organization_id
      AND status = 'active'
      AND is_primary_position = true
  ),
  
  -- Daily inbound scans
  daily_inbound AS (
    SELECT 
      (ris.scanned_at AT TIME ZONE 'America/New_York')::DATE AS scan_date,
      COUNT(*) AS cnt
    FROM rr_inbound_scans ris
    WHERE ris.organization_id = p_organization_id
      AND ris.scanned_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND ris.scanned_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND ris.scanned_by IN (SELECT user_id FROM active_users)
    GROUP BY (ris.scanned_at AT TIME ZONE 'America/New_York')::DATE
  ),
  
  -- Daily putaways
  daily_putaway AS (
    SELECT 
      (rpo.created_at AT TIME ZONE 'America/New_York')::DATE AS scan_date,
      COUNT(*) AS cnt
    FROM rf_putaway_operations rpo
    WHERE rpo.organization_id = p_organization_id
      AND rpo.created_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND rpo.created_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND rpo.created_by IN (SELECT user_id FROM active_users)
    GROUP BY (rpo.created_at AT TIME ZONE 'America/New_York')::DATE
  ),
  
  -- Daily picking
  daily_picking AS (
    SELECT 
      (otd.picked_at AT TIME ZONE 'America/New_York')::DATE AS scan_date,
      COUNT(*) AS cnt
    FROM outbound_to_data otd
    WHERE otd.organization_id = p_organization_id
      AND otd.picked_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND otd.picked_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND otd.picked_by IS NOT NULL
      AND otd.picked_by IN (SELECT user_id FROM active_users)
    GROUP BY (otd.picked_at AT TIME ZONE 'America/New_York')::DATE
  ),
  
  -- Daily packed
  daily_packed AS (
    SELECT 
      (otd.packed_at AT TIME ZONE 'America/New_York')::DATE AS scan_date,
      COUNT(*) AS cnt
    FROM outbound_to_data otd
    WHERE otd.organization_id = p_organization_id
      AND otd.packed_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND otd.packed_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND otd.packed_by IS NOT NULL
      AND otd.packed_by IN (SELECT user_id FROM active_users)
    GROUP BY (otd.packed_at AT TIME ZONE 'America/New_York')::DATE
  ),
  
  -- Daily shipped
  daily_shipped AS (
    SELECT 
      (otd.shipped_at AT TIME ZONE 'America/New_York')::DATE AS scan_date,
      COUNT(*) AS cnt
    FROM outbound_to_data otd
    WHERE otd.organization_id = p_organization_id
      AND otd.shipped_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND otd.shipped_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND otd.shipped_by IS NOT NULL
      AND otd.shipped_by IN (SELECT user_id FROM active_users)
    GROUP BY (otd.shipped_at AT TIME ZONE 'America/New_York')::DATE
  ),
  
  -- Daily final packed
  daily_final_packed AS (
    SELECT 
      (otd.final_packed_at AT TIME ZONE 'America/New_York')::DATE AS scan_date,
      COUNT(*) AS cnt
    FROM outbound_to_data otd
    WHERE otd.organization_id = p_organization_id
      AND otd.final_packed_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND otd.final_packed_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND otd.final_packed_by IS NOT NULL
      AND otd.final_packed_by IN (SELECT user_id FROM active_users)
    GROUP BY (otd.final_packed_at AT TIME ZONE 'America/New_York')::DATE
  ),
  
  -- Daily putbacks
  daily_putback AS (
    SELECT 
      (pt.created_at AT TIME ZONE 'America/New_York')::DATE AS scan_date,
      COUNT(*) AS cnt
    FROM putback_tickets pt
    WHERE pt.organization_id = p_organization_id
      AND pt.created_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND pt.created_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND pt.created_by IN (SELECT user_id FROM active_users)
    GROUP BY (pt.created_at AT TIME ZONE 'America/New_York')::DATE
  ),
  
  -- Daily cycle counts
  daily_cyclecount AS (
    SELECT 
      (rcd.completed_at AT TIME ZONE 'America/New_York')::DATE AS scan_date,
      COUNT(*) AS cnt
    FROM rr_cyclecount_data rcd
    WHERE rcd.organization_id = p_organization_id
      AND rcd.status IN ('completed', 'approved')
      AND rcd.completed_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND rcd.completed_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND rcd.assigned_to IN (SELECT user_id FROM active_users)
    GROUP BY (rcd.completed_at AT TIME ZONE 'America/New_York')::DATE
  ),
  
  -- Combined daily user activity across ALL activity types (fix from migration 153)
  all_daily_activity AS (
    -- Inbound scans
    SELECT 
      (ris.scanned_at AT TIME ZONE 'America/New_York')::DATE AS activity_date,
      ris.scanned_by AS user_id
    FROM rr_inbound_scans ris
    WHERE ris.organization_id = p_organization_id
      AND ris.scanned_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND ris.scanned_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND ris.scanned_by IN (SELECT user_id FROM active_users)
    
    UNION ALL
    
    -- Putaway
    SELECT 
      (rpo.created_at AT TIME ZONE 'America/New_York')::DATE AS activity_date,
      rpo.created_by AS user_id
    FROM rf_putaway_operations rpo
    WHERE rpo.organization_id = p_organization_id
      AND rpo.created_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND rpo.created_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND rpo.created_by IN (SELECT user_id FROM active_users)
    
    UNION ALL
    
    -- Picking
    SELECT 
      (otd.picked_at AT TIME ZONE 'America/New_York')::DATE AS activity_date,
      otd.picked_by AS user_id
    FROM outbound_to_data otd
    WHERE otd.organization_id = p_organization_id
      AND otd.picked_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND otd.picked_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND otd.picked_by IS NOT NULL
      AND otd.picked_by IN (SELECT user_id FROM active_users)
    
    UNION ALL
    
    -- Packing
    SELECT 
      (otd.packed_at AT TIME ZONE 'America/New_York')::DATE AS activity_date,
      otd.packed_by AS user_id
    FROM outbound_to_data otd
    WHERE otd.organization_id = p_organization_id
      AND otd.packed_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND otd.packed_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND otd.packed_by IS NOT NULL
      AND otd.packed_by IN (SELECT user_id FROM active_users)
    
    UNION ALL
    
    -- Shipping
    SELECT 
      (otd.shipped_at AT TIME ZONE 'America/New_York')::DATE AS activity_date,
      otd.shipped_by AS user_id
    FROM outbound_to_data otd
    WHERE otd.organization_id = p_organization_id
      AND otd.shipped_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND otd.shipped_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND otd.shipped_by IS NOT NULL
      AND otd.shipped_by IN (SELECT user_id FROM active_users)
    
    UNION ALL
    
    -- Final pack
    SELECT 
      (otd.final_packed_at AT TIME ZONE 'America/New_York')::DATE AS activity_date,
      otd.final_packed_by AS user_id
    FROM outbound_to_data otd
    WHERE otd.organization_id = p_organization_id
      AND otd.final_packed_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND otd.final_packed_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND otd.final_packed_by IS NOT NULL
      AND otd.final_packed_by IN (SELECT user_id FROM active_users)
    
    UNION ALL
    
    -- Putback
    SELECT 
      (pt.created_at AT TIME ZONE 'America/New_York')::DATE AS activity_date,
      pt.created_by AS user_id
    FROM putback_tickets pt
    WHERE pt.organization_id = p_organization_id
      AND pt.created_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND pt.created_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND pt.created_by IN (SELECT user_id FROM active_users)
    
    UNION ALL
    
    -- Cycle count
    SELECT 
      (rcd.completed_at AT TIME ZONE 'America/New_York')::DATE AS activity_date,
      rcd.assigned_to AS user_id
    FROM rr_cyclecount_data rcd
    WHERE rcd.organization_id = p_organization_id
      AND rcd.status IN ('completed', 'approved')
      AND rcd.completed_at >= (v_start_date AT TIME ZONE 'America/New_York')
      AND rcd.completed_at < ((p_end_date + 1) AT TIME ZONE 'America/New_York')
      AND rcd.assigned_to IN (SELECT user_id FROM active_users)
  ),
  
  -- Aggregate distinct active users per day across ALL activity types
  daily_active_users AS (
    SELECT 
      activity_date,
      COUNT(DISTINCT user_id) AS active_user_count
    FROM all_daily_activity
    GROUP BY activity_date
  ),
  
  -- Count total and active associates per day using ALL activity types
  daily_associates AS (
    SELECT 
      ds.day_date,
      (SELECT COUNT(*) FROM active_users) AS total_associates,
      COALESCE(dau.active_user_count, 0) AS active_associates
    FROM date_series ds
    LEFT JOIN daily_active_users dau ON dau.activity_date = ds.day_date
  )
  
  SELECT 
    ds.day_date,
    ds.day_name,
    (
      COALESCE(di.cnt, 0) + COALESCE(dp.cnt, 0) + COALESCE(dpk.cnt, 0) +
      COALESCE(dpa.cnt, 0) + COALESCE(dsh.cnt, 0) + COALESCE(dfp.cnt, 0) +
      COALESCE(dpb.cnt, 0) + COALESCE(dc.cnt, 0)
    )::BIGINT AS total_tasks,
    da.total_associates,
    da.active_associates,
    COALESCE(di.cnt, 0)::BIGINT AS inbound_scans,
    COALESCE(dp.cnt, 0)::BIGINT AS put_aways,
    COALESCE(dpk.cnt, 0)::BIGINT AS picking,
    COALESCE(dpa.cnt, 0)::BIGINT AS packed,
    COALESCE(dsh.cnt, 0)::BIGINT AS shipped,
    COALESCE(dfp.cnt, 0)::BIGINT AS final_packed,
    COALESCE(dpb.cnt, 0)::BIGINT AS putbacks,
    COALESCE(dc.cnt, 0)::BIGINT AS cycle_counts
  FROM date_series ds
  LEFT JOIN daily_inbound di ON di.scan_date = ds.day_date
  LEFT JOIN daily_putaway dp ON dp.scan_date = ds.day_date
  LEFT JOIN daily_picking dpk ON dpk.scan_date = ds.day_date
  LEFT JOIN daily_packed dpa ON dpa.scan_date = ds.day_date
  LEFT JOIN daily_shipped dsh ON dsh.scan_date = ds.day_date
  LEFT JOIN daily_final_packed dfp ON dfp.scan_date = ds.day_date
  LEFT JOIN daily_putback dpb ON dpb.scan_date = ds.day_date
  LEFT JOIN daily_cyclecount dc ON dc.scan_date = ds.day_date
  LEFT JOIN daily_associates da ON da.day_date = ds.day_date
  ORDER BY ds.day_date;
END;
$$;

COMMENT ON FUNCTION get_weekly_productivity_summary IS 
'Returns aggregated daily productivity summary for the past 7 days. Correctly counts active_associates across ALL activity types (inbound, putaway, picking, packing, shipping, final_pack, putback, cycle_count). Security: Validates caller belongs to the requested organization.';


-- =========================================================================
-- PART 5: UPDATED get_shift_assignments_with_details WITH SECURITY VALIDATION
-- =========================================================================

CREATE OR REPLACE FUNCTION get_shift_assignments_with_details(
  p_organization_id UUID
)
RETURNS TABLE (
  assignment_id UUID,
  user_id UUID,
  user_full_name TEXT,
  user_email TEXT,
  user_avatar_url TEXT,
  user_status TEXT,
  user_phone_number TEXT,
  user_created_at TIMESTAMPTZ,
  position_id UUID,
  position_title TEXT,
  position_type TEXT,
  position_level INTEGER,
  is_supervisory BOOLEAN,
  department TEXT,
  working_area_id UUID,
  area_name TEXT,
  area_code TEXT,
  area_type TEXT,
  shift_schedule_id UUID,
  schedule_name TEXT,
  shift_start_time TIME,
  shift_end_time TIME,
  break_start_time TIME,
  break_duration_minutes INTEGER,
  breaks JSONB,
  supervisor_id UUID,
  supervisor_name TEXT,
  supervisor_avatar TEXT,
  team_lead_id UUID,
  team_lead_name TEXT,
  team_lead_avatar TEXT,
  assignment_type TEXT,
  shift_pattern TEXT,
  productivity_target NUMERIC,
  inline_shift_schedule JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- SECURITY VALIDATION: Verify caller has access to this organization
  PERFORM validate_organization_access(p_organization_id);
  
  RETURN QUERY
  SELECT 
    sa.id AS assignment_id,
    sa.user_id,
    up.full_name AS user_full_name,
    up.email AS user_email,
    up.avatar_url AS user_avatar_url,
    up.status AS user_status,
    up.phone_number AS user_phone_number,
    up.created_at AS user_created_at,
    sp.id AS position_id,
    sp.position_title,
    sp.position_type,
    sp.position_level,
    sp.is_supervisory,
    sp.department,
    wa.id AS working_area_id,
    wa.area_name,
    wa.area_code,
    wa.area_type,
    ss.id AS shift_schedule_id,
    ss.schedule_name,
    ss.shift_start_time,
    ss.shift_end_time,
    ss.break_start_time,
    ss.break_duration_minutes,
    ss.breaks,
    sa.direct_supervisor_id AS supervisor_id,
    sup.full_name AS supervisor_name,
    sup.avatar_url AS supervisor_avatar,
    sa.team_lead_id,
    tl.full_name AS team_lead_name,
    tl.avatar_url AS team_lead_avatar,
    sa.assignment_type,
    sa.shift_pattern,
    sa.productivity_target,
    sa.shift_schedule::JSONB AS inline_shift_schedule
  FROM shift_assignments sa
  LEFT JOIN user_profiles up ON up.id = sa.user_id
  LEFT JOIN shift_positions sp ON sp.id = sa.position_id
  LEFT JOIN working_areas wa ON wa.id = sa.working_area_id
  LEFT JOIN shift_schedules ss ON ss.id = sa.shift_schedule_id
  LEFT JOIN user_profiles sup ON sup.id = sa.direct_supervisor_id
  LEFT JOIN user_profiles tl ON tl.id = sa.team_lead_id
  WHERE sa.organization_id = p_organization_id
    AND sa.status = 'active'
    AND sa.is_primary_position = true
  ORDER BY up.full_name;
END;
$$;

COMMENT ON FUNCTION get_shift_assignments_with_details IS 
'Returns all shift assignments with fully joined user, position, area, schedule, and supervisor details in a single query. Security: Validates caller belongs to the requested organization.';
