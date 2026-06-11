-- Create LX03 Data Aggregation Functions for Cycle Count Generation
-- Migration: 069_create_lx03_aggregation_functions.sql
-- Description: Creates RPC functions to aggregate LX03 inventory data for cycle count creation

-- Function to get aggregated inventory by specific locations
CREATE OR REPLACE FUNCTION get_lx03_inventory_by_locations(location_bins TEXT[])
RETURNS TABLE (
    storage_bin TEXT,
    material TEXT,
    total_stock NUMERIC,
    storage_location TEXT,
    warehouse TEXT,
    record_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        lx.storage_bin,
        lx.material,
        SUM(lx.total_stock) as total_stock,
        MAX(lx.storage_location) as storage_location,
        MAX(lx.storage_location) as warehouse, -- Using storage_location as warehouse
        COUNT(*) as record_count
    FROM rr_lx03_data lx
    WHERE lx.storage_bin = ANY(location_bins)
      AND lx.material IS NOT NULL 
      AND lx.material != '<<empty>>'
      AND lx.total_stock > 0
    GROUP BY lx.storage_bin, lx.material
    ORDER BY lx.storage_bin, lx.material;
END;
$$;

-- Function to get aggregated inventory by storage bin range
CREATE OR REPLACE FUNCTION get_lx03_inventory_by_range(start_bin TEXT, end_bin TEXT)
RETURNS TABLE (
    storage_bin TEXT,
    material TEXT,
    total_stock NUMERIC,
    storage_location TEXT,
    warehouse TEXT,
    record_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        lx.storage_bin,
        lx.material,
        SUM(lx.total_stock) as total_stock,
        MAX(lx.storage_location) as storage_location,
        MAX(lx.storage_location) as warehouse,
        COUNT(*) as record_count
    FROM rr_lx03_data lx
    WHERE lx.storage_bin >= start_bin
      AND lx.storage_bin <= end_bin
      AND lx.material IS NOT NULL 
      AND lx.material != '<<empty>>'
      AND lx.total_stock > 0
    GROUP BY lx.storage_bin, lx.material
    ORDER BY lx.storage_bin, lx.material;
END;
$$;

-- Function to get aggregated inventory by part numbers
CREATE OR REPLACE FUNCTION get_lx03_inventory_by_parts(part_numbers TEXT[])
RETURNS TABLE (
    storage_bin TEXT,
    material TEXT,
    total_stock NUMERIC,
    storage_location TEXT,
    warehouse TEXT,
    record_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        lx.storage_bin,
        lx.material,
        SUM(lx.total_stock) as total_stock,
        MAX(lx.storage_location) as storage_location,
        MAX(lx.storage_location) as warehouse,
        COUNT(*) as record_count
    FROM rr_lx03_data lx
    WHERE lx.material = ANY(part_numbers)
      AND lx.material IS NOT NULL 
      AND lx.material != '<<empty>>'
      AND lx.total_stock > 0
    GROUP BY lx.storage_bin, lx.material
    ORDER BY lx.storage_bin, lx.material;
END;
$$;

-- Add helpful comments
COMMENT ON FUNCTION get_lx03_inventory_by_locations(TEXT[]) IS 'Aggregates LX03 inventory data for specific storage bins, grouped by location and material';
COMMENT ON FUNCTION get_lx03_inventory_by_range(TEXT, TEXT) IS 'Aggregates LX03 inventory data for a range of storage bins, grouped by location and material';
COMMENT ON FUNCTION get_lx03_inventory_by_parts(TEXT[]) IS 'Aggregates LX03 inventory data for specific part numbers, grouped by location and material';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_lx03_inventory_by_locations(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_lx03_inventory_by_range(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_lx03_inventory_by_parts(TEXT[]) TO authenticated;

