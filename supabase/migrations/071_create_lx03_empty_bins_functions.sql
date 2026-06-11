-- Create LX03 Empty Bins Aggregation Functions for Cycle Count Generation
-- Migration: 071_create_lx03_empty_bins_functions.sql
-- Description: Creates RPC functions to get empty bins by warehouse, storage type, and storage area
-- Date: November 15, 2025

-- Function to get unique warehouses (for dropdown selection)
CREATE OR REPLACE FUNCTION get_lx03_warehouses()
RETURNS TABLE (
    warehouse TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT lx.warehouse
    FROM rr_lx03_data lx
    WHERE lx.warehouse IS NOT NULL
    ORDER BY lx.warehouse;
END;
$$;

-- Function to get unique storage types (for dropdown selection)
CREATE OR REPLACE FUNCTION get_lx03_storage_types()
RETURNS TABLE (
    storage_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT lx.storage_type
    FROM rr_lx03_data lx
    WHERE lx.storage_type IS NOT NULL
    ORDER BY lx.storage_type;
END;
$$;

-- Function to categorize storage bin into area (Racks, Shelves, Kardex)
-- Based on user-provided table:
-- Racks: RA-, RB-, RC-, RD-, RE-, RF-, RG-, RH-, RI-, RJ-, RK-, RL-, RM-, RN-, RO-, RP-, RQ-, RR-, RS-, RT-, RU-, RV-, RW-, RX-, RY-, RZ-
-- Shelves: SA-, SB-, SC-, SD-, SE-, SF-, SG-, SH-, SI-, SJ-, SK-, SL-, SM-, SN-, SO-, SP-, SQ-, SR-, SS-, ST-, SU-, SV-, SW-, SX-, SY-, SZ-, TA-, TB-, TC-, TD-, TE-, TF-, TG-
-- Kardex: K1-, K2-, K3-, K4-
CREATE OR REPLACE FUNCTION categorize_storage_area(storage_bin TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF storage_bin IS NULL THEN
        RETURN 'Unknown';
    END IF;
    
    -- Extract first 3 characters (e.g., "RA-", "SA-", "K1-")
    DECLARE
        prefix TEXT;
    BEGIN
        prefix := SUBSTRING(storage_bin FROM 1 FOR 3);
        
        -- Check if it's a Rack location
        IF prefix IN ('RA-', 'RB-', 'RC-', 'RD-', 'RE-', 'RF-', 'RG-', 'RH-', 'RI-', 'RJ-', 
                      'RK-', 'RL-', 'RM-', 'RN-', 'RO-', 'RP-', 'RQ-', 'RR-', 'RS-', 'RT-', 
                      'RU-', 'RV-', 'RW-', 'RX-', 'RY-', 'RZ-') THEN
            RETURN 'Racks';
        
        -- Check if it's a Shelf location
        ELSIF prefix IN ('SA-', 'SB-', 'SC-', 'SD-', 'SE-', 'SF-', 'SG-', 'SH-', 'SI-', 'SJ-', 
                         'SK-', 'SL-', 'SM-', 'SN-', 'SO-', 'SP-', 'SQ-', 'SR-', 'SS-', 'ST-', 
                         'SU-', 'SV-', 'SW-', 'SX-', 'SY-', 'SZ-', 'TA-', 'TB-', 'TC-', 'TD-', 
                         'TE-', 'TF-', 'TG-') THEN
            RETURN 'Shelves';
        
        -- Check if it's a Kardex location
        ELSIF prefix IN ('K1-', 'K2-', 'K3-', 'K4-') THEN
            RETURN 'Kardex';
        
        -- Unknown category
        ELSE
            RETURN 'Other';
        END IF;
    END;
END;
$$;

-- Function to get empty bins by warehouse, storage type, and storage area
CREATE OR REPLACE FUNCTION get_lx03_empty_bins_by_filters(
    filter_warehouse TEXT DEFAULT NULL,
    filter_storage_type TEXT DEFAULT NULL,
    filter_storage_area TEXT DEFAULT NULL -- 'Racks', 'Shelves', 'Kardex', 'Other', or NULL for all
)
RETURNS TABLE (
    storage_bin TEXT,
    material TEXT,
    total_stock NUMERIC,
    storage_location TEXT,
    warehouse TEXT,
    storage_type TEXT,
    storage_area TEXT,
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
        COALESCE(lx.total_stock, 0) as total_stock,
        lx.storage_location,
        lx.warehouse,
        lx.storage_type,
        categorize_storage_area(lx.storage_bin) as storage_area,
        1::BIGINT as record_count
    FROM rr_lx03_data lx
    WHERE 
        -- Empty bins: ONLY material is '<<empty>>' (not based on quantities)
        lx.material = '<<empty>>'
        -- Filter by warehouse if provided
        AND (filter_warehouse IS NULL OR lx.warehouse = filter_warehouse)
        -- Filter by storage type if provided
        AND (filter_storage_type IS NULL OR lx.storage_type = filter_storage_type)
        -- Filter by storage area if provided
        AND (filter_storage_area IS NULL OR categorize_storage_area(lx.storage_bin) = filter_storage_area)
        -- Ensure storage_bin is not null
        AND lx.storage_bin IS NOT NULL
    ORDER BY lx.storage_bin;
END;
$$;

-- Add helpful comments
COMMENT ON FUNCTION get_lx03_warehouses() IS 'Returns list of unique warehouses from LX03 data for dropdown selection';
COMMENT ON FUNCTION get_lx03_storage_types() IS 'Returns list of unique storage types from LX03 data for dropdown selection';
COMMENT ON FUNCTION categorize_storage_area(TEXT) IS 'Categorizes a storage bin into Racks, Shelves, Kardex, or Other based on prefix';
COMMENT ON FUNCTION get_lx03_empty_bins_by_filters(TEXT, TEXT, TEXT) IS 'Returns empty bins filtered by warehouse, storage type, and storage area. Empty bins are ONLY those with material = ''<<empty>>'' (not based on stock quantities)';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_lx03_warehouses() TO authenticated;
GRANT EXECUTE ON FUNCTION get_lx03_storage_types() TO authenticated;
GRANT EXECUTE ON FUNCTION categorize_storage_area(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_lx03_empty_bins_by_filters(TEXT, TEXT, TEXT) TO authenticated;

