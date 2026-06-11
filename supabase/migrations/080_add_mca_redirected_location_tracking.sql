-- Migration: Add MCA redirected location tracking
-- Description: Add columns for tracking redirected location and processing details during MCA workflow
-- Applied via Supabase MCP on 2026-01-14

-- Column to track where the part was redirected during MCA processing
-- NULL means the part stayed in the original location (to_location)
-- If populated, indicates the part was moved to a different location
ALTER TABLE rf_putaway_operations 
ADD COLUMN IF NOT EXISTS mca_redirected_location VARCHAR(100);

-- Column to track the space assessment result selected during LOCATION_FULL workflow
ALTER TABLE rf_putaway_operations 
ADD COLUMN IF NOT EXISTS mca_space_assessment VARCHAR(100);

-- Column to track when the MCA processing was completed
ALTER TABLE rf_putaway_operations 
ADD COLUMN IF NOT EXISTS mca_processed_at TIMESTAMPTZ;

-- Column to track who processed the MCA
ALTER TABLE rf_putaway_operations 
ADD COLUMN IF NOT EXISTS mca_processed_by UUID REFERENCES auth.users(id);

-- Add comments for documentation
COMMENT ON COLUMN rf_putaway_operations.mca_redirected_location IS 'The location where the part was redirected during MCA processing. NULL means part stayed in original to_location.';
COMMENT ON COLUMN rf_putaway_operations.mca_space_assessment IS 'Space assessment result from LOCATION_FULL workflow (Does Fit In Location, Not Enough Space, Part Needs Larger Homebin, Part Needs go to Overflow)';
COMMENT ON COLUMN rf_putaway_operations.mca_processed_at IS 'Timestamp when MCA processing was completed';
COMMENT ON COLUMN rf_putaway_operations.mca_processed_by IS 'User ID of who processed/confirmed the MCA';

-- Create index for efficient querying of MCA processed records
CREATE INDEX IF NOT EXISTS idx_rf_putaway_mca_processed 
ON rf_putaway_operations(mca_processed_at) 
WHERE mca_processed_at IS NOT NULL;
