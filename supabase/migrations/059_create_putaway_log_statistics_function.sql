-- Migration: Create get_putaway_log_statistics() RPC function with EST timezone support
-- Date: October 31, 2025
-- Purpose: Provide optimized statistics calculation for rf_putaway_operations using EST timezone

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
  today_date_est := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;

  -- Get total count
  SELECT COUNT(*) INTO total_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id;

  -- Get today's putaways count (EST timezone)
  SELECT COUNT(*) INTO today_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::DATE = today_date_est;

  -- Get MCA workflow count
  SELECT COUNT(*) INTO mca_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND is_mca_workflow = true;

  -- Get completed count
  SELECT COUNT(*) INTO completed_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND to_status = 'Completed';

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
  AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::DATE = today_date_est
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
    'averageCompletionTime', NULL,
    'statusBreakdown', COALESCE(status_breakdown, '{}'::JSON),
    'warehouseDistribution', COALESCE(warehouse_distribution, '{}'::JSON)
  );

  RETURN result;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_putaway_log_statistics() TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION get_putaway_log_statistics() IS 'Returns comprehensive statistics for putaway operations using EST timezone. Created October 31, 2025 to use America/New_York timezone for accurate daily counts.';


