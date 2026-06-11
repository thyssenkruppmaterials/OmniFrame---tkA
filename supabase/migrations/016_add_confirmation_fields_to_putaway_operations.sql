-- Add confirmation tracking fields to rf_putaway_operations table
-- This migration adds confirmed_by and confirmed_at fields to track who confirmed putaway operations
-- and when they were confirmed, fixing the issue where confirmation data was lost on page refresh

-- Add confirmation tracking fields
ALTER TABLE rf_putaway_operations 
ADD COLUMN confirmed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
ADD COLUMN confirmed_at TIMESTAMPTZ;

-- Add indexes for better query performance
CREATE INDEX idx_rf_putaway_operations_confirmed_by ON rf_putaway_operations(confirmed_by);
CREATE INDEX idx_rf_putaway_operations_confirmed_at ON rf_putaway_operations(confirmed_at);

-- Add comment to document the purpose of these fields
COMMENT ON COLUMN rf_putaway_operations.confirmed_by IS 'User who confirmed the putaway operation';
COMMENT ON COLUMN rf_putaway_operations.confirmed_at IS 'Timestamp when the putaway operation was confirmed';
