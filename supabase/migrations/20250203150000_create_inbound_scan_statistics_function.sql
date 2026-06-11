-- Create RPC function for inbound scan statistics
-- This function calculates various statistics for the rr_inbound_scans table
-- Returns JSON object with key metrics for dashboard display

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
  today_date TEXT;
BEGIN
  -- Get today's date in ISO format
  today_date := CURRENT_DATE::TEXT;
  
  -- Get total scans count
  SELECT COUNT(*)
  INTO total_scans
  FROM rr_inbound_scans;
  
  -- Get today's scans count
  SELECT COUNT(*)
  INTO today_scans
  FROM rr_inbound_scans
  WHERE created_at::DATE = CURRENT_DATE;
  
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
  
  -- Build result JSON object
  result := json_build_object(
    'totalScans', COALESCE(total_scans, 0),
    'todayScans', COALESCE(today_scans, 0),
    'uniqueMaterials', COALESCE(unique_materials, 0),
    'uniqueLocations', COALESCE(unique_locations, 0),
    'hotTruckScans', COALESCE(hot_truck_scans, 0),
    'averageQuantity', avg_quantity,
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_inbound_scan_statistics() TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION get_inbound_scan_statistics() IS 'Returns comprehensive statistics for inbound scans including totals, daily counts, unique materials, locations, and status breakdowns';

