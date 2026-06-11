-- Migration: Fix Pending MCA count to exclude confirmed and processed MCAs
-- Date: February 6, 2026
-- Purpose: The Pending MCA stat card count was not decreasing when MCAs were confirmed
--          because the mca_count query was not filtering out 'MCA Confirmed' and 'MCA Processed' statuses.
-- Bug: get_putaway_log_statistics() counted ALL is_mca_workflow=true records from Jan 14, 2026
--      but should only count PENDING ones (excluding 'MCA Confirmed' and 'MCA Processed')

-- ============================================================================
-- Fix: get_putaway_log_statistics() - Exclude confirmed/processed MCAs from pending count
-- ============================================================================
CREATE OR REPLACE FUNCTION get_putaway_log_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  user_org_id UUID;
  today_date_est DATE;
  total_count INTEGER;
  today_count INTEGER;
  mca_count INTEGER;
  completed_count INTEGER;
  pending_confirms_count INTEGER;
  unique_materials_count INTEGER;
  unique_drivers_count INTEGER;
  drivers_today INTEGER;
  avg_per_driver DECIMAL;
  status_breakdown JSON;
  warehouse_distribution JSON;
BEGIN
  -- Get the user's organization ID
  SELECT (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID INTO user_org_id;
  
  -- If organization_id not in JWT, try getting from user_profiles
  IF user_org_id IS NULL THEN
    SELECT organization_id INTO user_org_id
    FROM user_profiles
    WHERE id = auth.uid();
  END IF;

  -- Get today's date in EST timezone
  today_date_est := (timezone('America/New_York', CURRENT_TIMESTAMP))::DATE;

  -- Get total count
  SELECT COUNT(*) INTO total_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id;

  -- Get today's putaways count (EST timezone)
  SELECT COUNT(*) INTO today_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND (timezone('America/New_York', created_at))::DATE = today_date_est;

  -- Get PENDING MCA workflow count (only from Jan 14, 2026 onwards)
  -- FIX: Exclude MCAs that have already been confirmed or processed
  -- Only count MCA operations that are still awaiting processing
  SELECT COUNT(*) INTO mca_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND is_mca_workflow = true
  AND to_status NOT IN ('MCA Confirmed', 'MCA Processed')
  AND created_at >= '2026-01-14T00:00:00.000Z'::timestamptz;

  -- Get completed count
  SELECT COUNT(*) INTO completed_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND to_status = 'Completed';

  -- Get pending confirms count (TOs awaiting confirmation)
  -- "Pending TO Confirm" is computed: NOT confirmed AND NOT MCA workflow
  SELECT COUNT(*) INTO pending_confirms_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND (to_status IS NULL OR to_status NOT IN ('TO Confirmed', 'MCA Confirmed', 'MCA Processed'))
  AND (is_mca_workflow IS NULL OR is_mca_workflow = false);

  -- Get unique materials count
  SELECT COUNT(DISTINCT material_number) INTO unique_materials_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND material_number IS NOT NULL;

  -- Get unique drivers count (all time)
  SELECT COUNT(DISTINCT putaway_driver) INTO unique_drivers_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND putaway_driver IS NOT NULL;

  -- Get drivers who worked today
  SELECT COUNT(DISTINCT putaway_driver) INTO drivers_today
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND (timezone('America/New_York', created_at))::DATE = today_date_est
  AND putaway_driver IS NOT NULL;

  -- Calculate daily average per driver (today's putaways / drivers who worked today)
  IF drivers_today > 0 THEN
    avg_per_driver := today_count::DECIMAL / drivers_today;
  ELSE
    avg_per_driver := 0;
  END IF;

  -- Get status breakdown
  SELECT json_object_agg(COALESCE(to_status, 'Unknown'), count) INTO status_breakdown
  FROM (
    SELECT to_status, COUNT(*) as count
    FROM rf_putaway_operations
    WHERE organization_id = user_org_id
    GROUP BY to_status
  ) t;

  -- Get warehouse distribution
  SELECT json_object_agg(COALESCE(warehouse, 'Unknown'), count) INTO warehouse_distribution
  FROM (
    SELECT warehouse, COUNT(*) as count
    FROM rf_putaway_operations
    WHERE organization_id = user_org_id
    GROUP BY warehouse
  ) t;

  -- Build result JSON
  result := json_build_object(
    'totalPutaways', COALESCE(total_count, 0),
    'todayPutaways', COALESCE(today_count, 0),
    'uniqueMaterials', COALESCE(unique_materials_count, 0),
    'uniqueDrivers', COALESCE(unique_drivers_count, 0),
    'averagePerDriver', ROUND(COALESCE(avg_per_driver, 0)),
    'mcaPutaways', COALESCE(mca_count, 0),
    'completedPutaways', COALESCE(completed_count, 0),
    'pendingConfirms', COALESCE(pending_confirms_count, 0),
    'averageCompletionTime', NULL,
    'statusBreakdown', COALESCE(status_breakdown, '{}'::JSON),
    'warehouseDistribution', COALESCE(warehouse_distribution, '{}'::JSON)
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_putaway_log_statistics() TO authenticated;

COMMENT ON FUNCTION get_putaway_log_statistics() IS 'Returns comprehensive statistics for putaway operations using EST timezone. Updated February 6, 2026: Fixed Pending MCA count to exclude MCA Confirmed and MCA Processed statuses so the count properly decreases as MCAs are confirmed.';
