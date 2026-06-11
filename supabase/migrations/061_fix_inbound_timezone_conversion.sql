-- Migration: Fix inbound scan statistics timezone conversion
-- Date: October 31, 2025
-- Issue: Scans from Oct 30 evening (8:37 PM EDT) incorrectly counted as Oct 31
-- Root Cause: Incorrect timezone conversion using AT TIME ZONE instead of timezone()
-- Fix: Use timezone() function for proper UTC to EST/EDT conversion

CREATE OR REPLACE FUNCTION get_inbound_scan_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  total_scans INTEGER;
  today_scans INTEGER;
  unique_materials INTEGER;
  unique_locations INTEGER;
  hot_truck_scans INTEGER;
  avg_quantity DECIMAL;
  today_date_est DATE;
  seven_days_ago_est DATE;
  week_count INTEGER;
  weekly_avg INTEGER;
  day_of_week_name TEXT;
  day_of_week_avg INTEGER;
  day_of_week_count INTEGER;
  weeks_of_data INTEGER;
  first_scan_date TIMESTAMPTZ;
  days_since_first INTEGER;
BEGIN
  -- Get today's date in EST timezone (America/New_York)
  -- This correctly handles EDT (UTC-4) and EST (UTC-5) transitions
  today_date_est := (timezone('America/New_York', CURRENT_TIMESTAMP))::DATE;
  seven_days_ago_est := today_date_est - INTERVAL '7 days';
  
  -- Get total scans count
  SELECT COUNT(*)
  INTO total_scans
  FROM rr_inbound_scans;
  
  -- Get today's scans count (EST timezone)
  -- CRITICAL FIX: Use timezone() function instead of AT TIME ZONE for proper conversion
  -- timezone('America/New_York', scanned_at) converts UTC to EST/EDT correctly
  SELECT COUNT(*)
  INTO today_scans
  FROM rr_inbound_scans
  WHERE (timezone('America/New_York', scanned_at))::DATE = today_date_est;
  
  -- Get unique materials count (non-null only)
  SELECT COUNT(DISTINCT material_number)
  INTO unique_materials
  FROM rr_inbound_scans
  WHERE material_number IS NOT NULL AND material_number != '';
  
  -- Get unique locations count (non-null only)
  SELECT COUNT(DISTINCT scan_location)
  INTO unique_locations
  FROM rr_inbound_scans
  WHERE scan_location IS NOT NULL AND scan_location != '';
  
  -- Get hot truck scans count
  SELECT COUNT(*)
  INTO hot_truck_scans
  FROM rr_inbound_scans
  WHERE hot_truck = TRUE;
  
  -- Get average quantity (non-null only)
  SELECT AVG(quantity)
  INTO avg_quantity
  FROM rr_inbound_scans
  WHERE quantity IS NOT NULL;
  
  -- Calculate weekly average (scans in last 7 days)
  -- FIXED: Use timezone() function for accurate date conversion
  SELECT COUNT(*)
  INTO week_count
  FROM rr_inbound_scans
  WHERE (timezone('America/New_York', scanned_at))::DATE >= seven_days_ago_est;
  
  weekly_avg := CASE WHEN week_count > 0 THEN ROUND(week_count / 7.0) ELSE 0 END;
  
  -- Get current day of week name in EST
  day_of_week_name := to_char(timezone('America/New_York', CURRENT_TIMESTAMP), 'Day');
  day_of_week_name := TRIM(day_of_week_name);
  
  -- Calculate day-of-week average
  -- Get count of scans on this day of week across all data
  -- FIXED: Use timezone() function for accurate day-of-week extraction
  SELECT COUNT(*)
  INTO day_of_week_count
  FROM rr_inbound_scans
  WHERE TRIM(to_char(timezone('America/New_York', scanned_at), 'Day')) = day_of_week_name;
  
  -- Get first scan date to calculate weeks of data
  SELECT MIN(scanned_at)
  INTO first_scan_date
  FROM rr_inbound_scans;
  
  -- Calculate weeks of data (minimum 1 week)
  IF first_scan_date IS NOT NULL THEN
    days_since_first := EXTRACT(DAY FROM (CURRENT_TIMESTAMP - first_scan_date));
    weeks_of_data := GREATEST(FLOOR(days_since_first / 7.0), 1);
  ELSE
    weeks_of_data := 1;
  END IF;
  
  -- Calculate average for this day of week
  day_of_week_avg := CASE 
    WHEN day_of_week_count > 0 AND weeks_of_data > 0 
    THEN ROUND(day_of_week_count::DECIMAL / weeks_of_data::DECIMAL) 
    ELSE 0 
  END;
  
  -- Build result JSON object
  result := json_build_object(
    'totalScans', COALESCE(total_scans, 0),
    'todayScans', COALESCE(today_scans, 0),
    'uniqueMaterials', COALESCE(unique_materials, 0),
    'uniqueLocations', COALESCE(unique_locations, 0),
    'hotTruckScans', COALESCE(hot_truck_scans, 0),
    'averageQuantity', avg_quantity,
    'weeklyAverage', COALESCE(weekly_avg, 0),
    'dayOfWeekAverage', COALESCE(day_of_week_avg, 0),
    'dayOfWeekName', COALESCE(day_of_week_name, 'Today'),
    'statusBreakdown', json_build_object(
      'total', COALESCE(total_scans, 0),
      'with_notes', (
        SELECT COUNT(*)
        FROM rr_inbound_scans
        WHERE notes IS NOT NULL AND notes != ''
      ),
      'hot_truck', COALESCE(hot_truck_scans, 0)
    )
  );
  
  RETURN result;
END;
$$;

COMMENT ON FUNCTION get_inbound_scan_statistics() IS 
  'Returns comprehensive statistics for inbound scans using EST timezone with CORRECTED timezone conversion. Fixed October 31, 2025 to use timezone() function instead of AT TIME ZONE.';

GRANT EXECUTE ON FUNCTION get_inbound_scan_statistics() TO authenticated;

