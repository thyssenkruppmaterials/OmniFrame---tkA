-- =========================================================================
-- Fix: Weekly Productivity Summary Active Associates Count
-- Created: January 28, 2026
-- Purpose: Fix bug where active_associates only counted inbound scan users
-- Impact: Now correctly counts DISTINCT users across ALL activity types
-- =========================================================================

-- The original get_weekly_productivity_summary function had a bug in the
-- daily_associates CTE where active_associates was calculated using only
-- daily_inbound.users_with_activity. This meant users who did picking,
-- packing, shipping, putaway, final_pack, putback, or cycle_count
-- (but no inbound scans) were NOT counted as active.
--
-- This fix creates a new CTE that unions all user activity and counts
-- distinct users per day across ALL activity types.

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
  
  -- NEW: Combined daily user activity across ALL activity types
  -- This fixes the bug where only inbound users were counted as active
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
  
  -- FIXED: Count total and active associates per day using ALL activity types
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

-- Update function comment to reflect the fix
COMMENT ON FUNCTION get_weekly_productivity_summary IS 
'Returns aggregated daily productivity summary for the past 7 days. Fixed in migration 153 to correctly count active_associates across ALL activity types (inbound, putaway, picking, packing, shipping, final_pack, putback, cycle_count) instead of only inbound scans.';
