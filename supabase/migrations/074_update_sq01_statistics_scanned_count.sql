-- Migration: Update get_sq01_statistics to count items with GRS Scan Status = 'Scanned'
-- Date: December 6, 2025
-- Description: Enhances SQ01 statistics RPC function to include scannedCount and uniqueLocations,
--              with scannedCount specifically counting items where grs_scan_status = 'Scanned'

-- Drop existing function
DROP FUNCTION IF EXISTS public.get_sq01_statistics();

-- Create enhanced version with GRS scan metrics
CREATE OR REPLACE FUNCTION public.get_sq01_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total', COALESCE(COUNT(*), 0),
        'todayCount', COALESCE(
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE), 0
        ),
        'thisWeekCount', COALESCE(
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'), 0
        ),
        'uniqueMaterials', COALESCE(
            COUNT(DISTINCT material) FILTER (WHERE material IS NOT NULL AND material != ''), 0
        ),
        'uniquePlants', COALESCE(
            COUNT(DISTINCT plant) FILTER (WHERE plant IS NOT NULL AND plant != ''), 0
        ),
        'totalUnrestricted', COALESCE(
            SUM(unrestricted) FILTER (WHERE unrestricted IS NOT NULL), 0
        ),
        'scannedCount', COALESCE(
            COUNT(*) FILTER (WHERE grs_scan_status = 'Scanned'), 0
        ),
        'uniqueLocations', COALESCE(
            COUNT(DISTINCT conf_cert_ref) FILTER (WHERE conf_cert_ref IS NOT NULL AND conf_cert_ref != ''), 0
        ),
        'blockedScanned', COALESCE(
            COUNT(*) FILTER (WHERE grs_scan_status = 'Scanned' AND blocked > 0), 0
        ),
        'qualityHoldScanned', COALESCE(
            COUNT(*) FILTER (WHERE grs_scan_status = 'Scanned' AND in_qual_insp > 0), 0
        ),
        'missingSerialScanned', COALESCE(
            COUNT(*) FILTER (WHERE grs_scan_status = 'Scanned' AND (serial_number IS NULL OR serial_number = '')), 0
        ),
        'locationsScanned', COALESCE(
            COUNT(DISTINCT conf_cert_ref) FILTER (WHERE grs_scan_status = 'Scanned'), 0
        ),
        'locationsRemaining', COALESCE(
            COUNT(DISTINCT conf_cert_ref) FILTER (WHERE grs_scan_status IS NULL OR grs_scan_status != 'Scanned'), 0
        ),
        'locationsWithErrors', COALESCE(
            COUNT(DISTINCT conf_cert_ref) FILTER (
                WHERE grs_scan_status = 'Scanned' 
                AND (blocked > 0 OR in_qual_insp > 0 OR serial_number IS NULL OR serial_number = '')
            ), 0
        ),
        'qtyWithErrors', COALESCE(
            SUM(CASE 
                WHEN grs_scan_status = 'Scanned' 
                AND (blocked > 0 OR in_qual_insp > 0 OR serial_number IS NULL OR serial_number = '')
                THEN COALESCE(unrestricted, 0) + COALESCE(blocked, 0) + COALESCE(in_qual_insp, 0)
                ELSE 0
            END), 0
        ),
        'totalScannedQty', COALESCE(
            SUM(CASE 
                WHEN grs_scan_status = 'Scanned'
                THEN COALESCE(unrestricted, 0) + COALESCE(blocked, 0) + COALESCE(in_qual_insp, 0)
                ELSE 0
            END), 0
        )
    )
    INTO result
    FROM rr_sq01_data;
    
    RETURN result;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_sq01_statistics() TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.get_sq01_statistics() IS 'Returns comprehensive statistics for SQ01 data including GRS scan status counts. scannedCount specifically counts items with grs_scan_status = ''Scanned''';

