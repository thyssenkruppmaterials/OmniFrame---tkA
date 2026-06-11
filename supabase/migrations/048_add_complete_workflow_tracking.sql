-- Migration: Add complete workflow tracking fields to outbound_to_data
-- Date: October 19, 2025
-- Description: Adds waved_by, waved_at, picked_by, picked_at fields for complete audit trail

-- Add waved tracking fields
ALTER TABLE outbound_to_data
  ADD COLUMN IF NOT EXISTS waved_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS waved_at TIMESTAMPTZ;

-- Add picked tracking fields  
ALTER TABLE outbound_to_data
  ADD COLUMN IF NOT EXISTS picked_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS picked_at TIMESTAMPTZ;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_outbound_to_data_waved_by ON outbound_to_data(waved_by);
CREATE INDEX IF NOT EXISTS idx_outbound_to_data_waved_at ON outbound_to_data(waved_at);
CREATE INDEX IF NOT EXISTS idx_outbound_to_data_picked_by ON outbound_to_data(picked_by);
CREATE INDEX IF NOT EXISTS idx_outbound_to_data_picked_at ON outbound_to_data(picked_at);

-- Update the audit trigger to log waved and picked changes
-- The existing audit trigger will automatically capture these new fields

-- Add comments for documentation
COMMENT ON COLUMN outbound_to_data.waved_by IS 'User who waved the delivery (changed status from pending to processing)';
COMMENT ON COLUMN outbound_to_data.waved_at IS 'Timestamp when delivery was waved';
COMMENT ON COLUMN outbound_to_data.picked_by IS 'User who picked the delivery from warehouse location';
COMMENT ON COLUMN outbound_to_data.picked_at IS 'Timestamp when delivery was picked';

