-- Migration: Fix Outbound TO Data Duplicates
-- Date: 2025-10-18
-- Description: Clean up existing duplicates and add unique constraint to prevent future duplicates

-- Step 1: Clean up existing duplicates
-- Keep only the most recent record for each unique combination
WITH duplicate_groups AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY 
        COALESCE(delivery, ''), 
        COALESCE(transfer_order_number, ''), 
        COALESCE(material, ''), 
        COALESCE(batch, ''), 
        COALESCE(source_storage_bin, '')
      ORDER BY created_at DESC, id DESC
    ) as row_num
  FROM outbound_to_data
)
DELETE FROM outbound_to_data
WHERE id IN (
  SELECT id FROM duplicate_groups WHERE row_num > 1
);

-- Step 2: Create a unique index to prevent future duplicates
-- We use a partial index with COALESCE to handle NULL values properly
-- This ensures that NULL values are treated as distinct empty strings for uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_to_data_unique_record
ON outbound_to_data (
  organization_id,
  COALESCE(delivery, ''),
  COALESCE(transfer_order_number, ''),
  COALESCE(material, ''),
  COALESCE(batch, ''),
  COALESCE(source_storage_bin, '')
);

-- Step 3: Add a comment explaining the constraint
COMMENT ON INDEX idx_outbound_to_data_unique_record IS 
'Ensures no duplicate outbound records can be created. A duplicate is defined as having the same organization_id, delivery, transfer_order_number, material, batch, and source_storage_bin.';

-- Step 4: Create a function to get duplicate statistics (for verification)
CREATE OR REPLACE FUNCTION get_outbound_duplicate_stats()
RETURNS TABLE (
  total_records BIGINT,
  unique_combinations BIGINT,
  potential_duplicates BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_records,
    COUNT(DISTINCT (
      organization_id,
      COALESCE(delivery, ''),
      COALESCE(transfer_order_number, ''),
      COALESCE(material, ''),
      COALESCE(batch, ''),
      COALESCE(source_storage_bin, '')
    ))::BIGINT as unique_combinations,
    (COUNT(*) - COUNT(DISTINCT (
      organization_id,
      COALESCE(delivery, ''),
      COALESCE(transfer_order_number, ''),
      COALESCE(material, ''),
      COALESCE(batch, ''),
      COALESCE(source_storage_bin, '')
    )))::BIGINT as potential_duplicates
  FROM outbound_to_data;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_outbound_duplicate_stats() TO authenticated;

-- Step 5: Log the cleanup operation
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Get count of records that were deleted
  SELECT COUNT(*) INTO deleted_count
  FROM (
    SELECT id
    FROM (
      SELECT 
        id,
        ROW_NUMBER() OVER (
          PARTITION BY 
            COALESCE(delivery, ''), 
            COALESCE(transfer_order_number, ''), 
            COALESCE(material, ''), 
            COALESCE(batch, ''), 
            COALESCE(source_storage_bin, '')
          ORDER BY created_at DESC, id DESC
        ) as row_num
      FROM outbound_to_data
    ) sub
    WHERE row_num > 1
  ) duplicates;
  
  RAISE NOTICE 'Outbound duplicates cleanup completed. Records removed: %', COALESCE(deleted_count, 0);
END $$;

