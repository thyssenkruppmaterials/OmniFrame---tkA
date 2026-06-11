-- Add Count Type Enum for Cycle Counts
-- Migration: 068_add_count_type_enum.sql
-- Description: Creates count_type enum with specific inventory count types for different workflows

-- Create count_type enum if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'count_type_enum') THEN
        CREATE TYPE count_type_enum AS ENUM (
            'part_verification',  -- Verify part numbers match location
            'quantity_check',     -- Standard quantity verification
            're_count',          -- General recount
            'second_count',      -- Second counter verification
            'third_count',       -- Third counter verification (tiebreaker)
            '999_count',         -- 999 variance investigation count
            'empty_location_check', -- Verify location is empty
            'cycle_count',       -- Standard cycle count (legacy/default)
            'physical_count',    -- Full physical inventory count
            'spot_count'         -- Random spot check
        );
    END IF;
END $$;

-- Add column comments for documentation
COMMENT ON TYPE count_type_enum IS 'Types of inventory counts with different workflows and purposes';

-- Alter the rr_cyclecount_data table to use the new enum
-- First, add a new column with the enum type
ALTER TABLE rr_cyclecount_data 
ADD COLUMN IF NOT EXISTS count_type_new count_type_enum;

-- Migrate existing data to the new column with appropriate mapping
UPDATE rr_cyclecount_data
SET count_type_new = CASE 
    WHEN count_type = 'cycle_count' THEN 'cycle_count'::count_type_enum
    WHEN count_type = 'physical_count' THEN 'physical_count'::count_type_enum
    WHEN count_type = 'spot_count' THEN 'spot_count'::count_type_enum
    WHEN count_type = 'part_verification' THEN 'part_verification'::count_type_enum
    WHEN count_type = 'quantity_check' THEN 'quantity_check'::count_type_enum
    WHEN count_type = 're_count' THEN 're_count'::count_type_enum
    WHEN count_type = 'second_count' THEN 'second_count'::count_type_enum
    WHEN count_type = 'third_count' THEN 'third_count'::count_type_enum
    WHEN count_type = '999_count' THEN '999_count'::count_type_enum
    WHEN count_type = 'empty_location_check' THEN 'empty_location_check'::count_type_enum
    ELSE 'quantity_check'::count_type_enum  -- Default for unmapped values
END
WHERE count_type_new IS NULL;

-- Set default for new column
ALTER TABLE rr_cyclecount_data 
ALTER COLUMN count_type_new SET DEFAULT 'quantity_check'::count_type_enum;

-- Drop the old varchar column
ALTER TABLE rr_cyclecount_data 
DROP COLUMN IF EXISTS count_type;

-- Rename the new column to the original name
ALTER TABLE rr_cyclecount_data 
RENAME COLUMN count_type_new TO count_type;

-- Add index for count_type filtering
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_count_type 
ON rr_cyclecount_data(count_type);

-- Create a helper function to get count type display names
CREATE OR REPLACE FUNCTION get_count_type_display_name(type_enum count_type_enum)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    RETURN CASE type_enum
        WHEN 'part_verification' THEN 'Part Verification'
        WHEN 'quantity_check' THEN 'Quantity Check'
        WHEN 're_count' THEN 'Re-Count'
        WHEN 'second_count' THEN 'Second Count'
        WHEN 'third_count' THEN 'Third Count'
        WHEN '999_count' THEN '999 Count'
        WHEN 'empty_location_check' THEN 'Empty Location Check'
        WHEN 'cycle_count' THEN 'Cycle Count'
        WHEN 'physical_count' THEN 'Physical Count'
        WHEN 'spot_count' THEN 'Spot Count'
        ELSE 'Unknown'
    END;
END;
$$;

-- Add helpful comments
COMMENT ON COLUMN rr_cyclecount_data.count_type IS 'Type of count determining the workflow: part_verification, quantity_check, re_count, second_count, third_count, 999_count, empty_location_check, cycle_count, physical_count, spot_count';
COMMENT ON FUNCTION get_count_type_display_name(count_type_enum) IS 'Returns human-readable display name for count type enum';

-- Grant execute permission on the helper function
GRANT EXECUTE ON FUNCTION get_count_type_display_name(count_type_enum) TO authenticated;

