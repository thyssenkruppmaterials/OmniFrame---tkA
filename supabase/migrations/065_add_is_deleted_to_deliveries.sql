-- Migration: Add is_deleted field to rr_all_deliveries
-- Created: November 9, 2025
-- Description: Adds is_deleted boolean field to track deliveries that have been removed from source system

-- Add is_deleted column to rr_all_deliveries
ALTER TABLE rr_all_deliveries 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- Create index for better query performance when filtering out deleted deliveries
CREATE INDEX IF NOT EXISTS idx_rr_all_deliveries_is_deleted
  ON rr_all_deliveries(is_deleted) WHERE is_deleted = false;

-- Add comment to document the field
COMMENT ON COLUMN rr_all_deliveries.is_deleted IS 
'Indicates if the delivery has been removed from the source system (detected during import). Deleted deliveries are excluded from statistics and display.';

