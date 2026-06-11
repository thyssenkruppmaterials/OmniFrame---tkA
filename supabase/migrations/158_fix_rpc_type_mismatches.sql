-- =========================================================================
-- Bug Fix: RPC Type Mismatches Causing 400 Errors in Shift Productivity
-- Created: January 28, 2026
-- Purpose: Fix three critical issues identified in production:
--   1. get_shift_assignments_with_details - varchar(255) not matching TEXT
--   2. get_team_productivity_counts - ambiguous user_id reference
--   3. get_team_activity_events - varchar not matching TEXT
-- 
-- Root Cause: PostgreSQL RETURNS TABLE columns are strict about types.
--             When table columns are varchar/varchar(255) but function
--             declares TEXT, PostgreSQL throws error 42804.
--             When output column name matches CTE column name in PL/pgSQL,
--             PostgreSQL throws error 42702 (ambiguous reference).
-- =========================================================================

-- =========================================================================
-- PART 1: Fix get_shift_assignments_with_details
-- Cast all potentially varchar columns to TEXT explicitly
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
    up.full_name::TEXT AS user_full_name,
    up.email::TEXT AS user_email,
    up.avatar_url::TEXT AS user_avatar_url,
    up.status::TEXT AS user_status,
    up.phone_number::TEXT AS user_phone_number,
    up.created_at AS user_created_at,
    sp.id AS position_id,
    sp.position_title::TEXT,
    sp.position_type::TEXT,
    sp.position_level,
    sp.is_supervisory,
    sp.department::TEXT,
    wa.id AS working_area_id,
    wa.area_name::TEXT,
    wa.area_code::TEXT,
    wa.area_type::TEXT,
    ss.id AS shift_schedule_id,
    ss.schedule_name::TEXT,
    ss.shift_start_time,
    ss.shift_end_time,
    ss.break_start_time,
    ss.break_duration_minutes,
    ss.breaks,
    sa.direct_supervisor_id AS supervisor_id,
    sup.full_name::TEXT AS supervisor_name,
    sup.avatar_url::TEXT AS supervisor_avatar,
    sa.team_lead_id,
    tl.full_name::TEXT AS team_lead_name,
    tl.avatar_url::TEXT AS team_lead_avatar,
    sa.assignment_type::TEXT,
    sa.shift_pattern::TEXT,
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
'Returns all shift assignments with fully joined user, position, area, schedule, and supervisor details. FIX: Explicit TEXT casts to prevent varchar/text type mismatch errors. Security: Validates caller belongs to the requested organization.';


-- =========================================================================
-- PART 2: Fix get_team_productivity_counts
-- Rename output alias to avoid PL/pgSQL variable name collision
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
  -- Use alias 'uid' instead of 'user_id' to avoid collision with output column
  active_users AS (
    SELECT DISTINCT sa.user_id AS uid
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
      AND scanned_by IN (SELECT au.uid FROM active_users au)
    GROUP BY scanned_by
  ),
  
  -- Count putaways per user (created_by)
  putaway_counts AS (
    SELECT created_by AS uid, COUNT(*) AS cnt
    FROM rf_putaway_operations
    WHERE organization_id = p_organization_id
      AND created_at >= p_start_date
      AND created_at <= p_end_date
      AND created_by IN (SELECT au.uid FROM active_users au)
    GROUP BY created_by
  ),
  
  -- Count picking per user
  picking_counts AS (
    SELECT picked_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND picked_at >= p_start_date
      AND picked_at <= p_end_date
      AND picked_by IN (SELECT au.uid FROM active_users au)
    GROUP BY picked_by
  ),
  
  -- Count packed per user
  packed_counts AS (
    SELECT packed_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND packed_at >= p_start_date
      AND packed_at <= p_end_date
      AND packed_by IN (SELECT au.uid FROM active_users au)
    GROUP BY packed_by
  ),
  
  -- Count shipped per user
  shipped_counts AS (
    SELECT shipped_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND shipped_at >= p_start_date
      AND shipped_at <= p_end_date
      AND shipped_by IN (SELECT au.uid FROM active_users au)
    GROUP BY shipped_by
  ),
  
  -- Count final_packed per user
  final_packed_counts AS (
    SELECT final_packed_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND final_packed_at >= p_start_date
      AND final_packed_at <= p_end_date
      AND final_packed_by IN (SELECT au.uid FROM active_users au)
    GROUP BY final_packed_by
  ),
  
  -- Count putbacks per user
  putback_counts AS (
    SELECT created_by AS uid, COUNT(*) AS cnt
    FROM putback_tickets
    WHERE organization_id = p_organization_id
      AND created_at >= p_start_date
      AND created_at <= p_end_date
      AND created_by IN (SELECT au.uid FROM active_users au)
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
      AND assigned_to IN (SELECT au.uid FROM active_users au)
    GROUP BY assigned_to
  )
  
  -- Combine all counts for each user
  SELECT 
    au.uid AS user_id,
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
  LEFT JOIN inbound_counts ic ON ic.uid = au.uid
  LEFT JOIN putaway_counts pc ON pc.uid = au.uid
  LEFT JOIN picking_counts pkc ON pkc.uid = au.uid
  LEFT JOIN packed_counts pac ON pac.uid = au.uid
  LEFT JOIN shipped_counts sc ON sc.uid = au.uid
  LEFT JOIN final_packed_counts fpc ON fpc.uid = au.uid
  LEFT JOIN putback_counts pbc ON pbc.uid = au.uid
  LEFT JOIN cyclecount_counts cc ON cc.uid = au.uid;
END;
$$;

COMMENT ON FUNCTION get_team_productivity_counts IS 
'Returns aggregated productivity task counts for all active associates. FIX: Renamed internal alias from user_id to uid to prevent PL/pgSQL variable collision with RETURNS TABLE column. Security: Validates caller belongs to the requested organization.';


-- =========================================================================
-- PART 3: Fix get_team_activity_events
-- Cast area columns to TEXT explicitly
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
    SELECT DISTINCT sa.user_id AS uid
    FROM shift_assignments sa
    WHERE sa.organization_id = p_organization_id
      AND sa.status = 'active'
      AND sa.is_primary_position = true
  )
  
  -- Inbound scans
  -- FIX: Cast scan_location to TEXT
  SELECT 
    ris.scanned_by AS user_id,
    'inbound_scan'::TEXT AS event_type,
    ris.scanned_at AS event_timestamp,
    COALESCE(ris.scan_location::TEXT, 'Receiving'::TEXT) AS area
  FROM rr_inbound_scans ris
  WHERE ris.organization_id = p_organization_id
    AND ris.scanned_at >= p_start_date
    AND ris.scanned_at <= p_end_date
    AND ris.scanned_by IN (SELECT au.uid FROM active_users au)
  
  UNION ALL
  
  -- Putaways (created_by - the user who initiated the putaway)
  -- FIX: Cast location columns to TEXT
  SELECT 
    rpo.created_by AS user_id,
    'putaway'::TEXT AS event_type,
    COALESCE(rpo.confirmed_at, rpo.created_at) AS event_timestamp,
    COALESCE(rpo.shelf_location::TEXT, rpo.to_location::TEXT, 'Putaway'::TEXT) AS area
  FROM rf_putaway_operations rpo
  WHERE rpo.organization_id = p_organization_id
    AND rpo.created_at >= p_start_date
    AND rpo.created_at <= p_end_date
    AND rpo.created_by IN (SELECT au.uid FROM active_users au)
  
  UNION ALL
  
  -- Putaway confirmations (confirmed_by - ONLY if different from creator)
  SELECT 
    rpo.confirmed_by AS user_id,
    'putaway_confirm'::TEXT AS event_type,
    rpo.confirmed_at AS event_timestamp,
    COALESCE(rpo.shelf_location::TEXT, rpo.to_location::TEXT, 'Putaway'::TEXT) AS area
  FROM rf_putaway_operations rpo
  WHERE rpo.organization_id = p_organization_id
    AND rpo.confirmed_at >= p_start_date
    AND rpo.confirmed_at <= p_end_date
    AND rpo.confirmed_by IS NOT NULL
    AND rpo.confirmed_by != rpo.created_by
    AND rpo.confirmed_by IN (SELECT au.uid FROM active_users au)
  
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
    AND otd.picked_by IN (SELECT au.uid FROM active_users au)
  
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
    AND otd.packed_by IN (SELECT au.uid FROM active_users au)
  
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
    AND otd.shipped_by IN (SELECT au.uid FROM active_users au)
  
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
    AND otd.final_packed_by IN (SELECT au.uid FROM active_users au)
  
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
    AND pt.created_by IN (SELECT au.uid FROM active_users au)
  
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
    AND rcd.assigned_to IN (SELECT au.uid FROM active_users au)
  
  ORDER BY user_id, event_timestamp;
END;
$$;

COMMENT ON FUNCTION get_team_activity_events IS 
'Returns all activity events with timestamps for Gantt timeline visualizations. FIX: Explicit TEXT casts on all area columns to prevent varchar/text type mismatch. Uses uid alias in CTE to avoid PL/pgSQL variable collision. Security: Validates caller belongs to the requested organization.';
