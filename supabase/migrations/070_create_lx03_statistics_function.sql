-- Create LX03 Statistics RPC Function
-- Migration: 070_create_lx03_statistics_function.sql
-- Description: Creates RPC function to calculate LX03 statistics efficiently for the entire database

CREATE OR REPLACE FUNCTION get_lx03_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  -- Build comprehensive statistics from entire database
  SELECT json_build_object(
    'total', (
      SELECT COUNT(*) 
      FROM rr_lx03_data
    ),
    'todayCount', (
      SELECT COUNT(*) 
      FROM rr_lx03_data 
      WHERE created_at::date = CURRENT_DATE
    ),
    'uniqueMaterials', (
      SELECT COUNT(DISTINCT material) 
      FROM rr_lx03_data
      WHERE material IS NOT NULL 
        AND material != '<<empty>>'
    ),
    'uniqueLocations', (
      SELECT COUNT(DISTINCT storage_bin) 
      FROM rr_lx03_data
      WHERE storage_bin IS NOT NULL
    ),
    'uniquePlants', (
      SELECT COUNT(DISTINCT plant) 
      FROM rr_lx03_data
      WHERE plant IS NOT NULL
    ),
    'totalStock', (
      SELECT COALESCE(SUM(total_stock), 0)
      FROM rr_lx03_data
      WHERE total_stock IS NOT NULL
    ),
    'totalAvailableStock', (
      SELECT COALESCE(SUM(available_stock), 0)
      FROM rr_lx03_data
      WHERE available_stock IS NOT NULL
    ),
    'recordsWithStock', (
      SELECT COUNT(*) 
      FROM rr_lx03_data
      WHERE material != '<<empty>>' 
        AND total_stock > 0
    ),
    'emptyLocations', (
      SELECT COUNT(*) 
      FROM rr_lx03_data
      WHERE material = '<<empty>>'
    )
  ) INTO result;
  
  RETURN result;
END;
$$;

-- Add helpful comments
COMMENT ON FUNCTION get_lx03_statistics() IS 'Returns comprehensive statistics for LX03 inventory data including totals, unique counts, and stock levels';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_lx03_statistics() TO authenticated;

