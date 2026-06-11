-- Migration: Add reviewer_name column to time_adjustment_requests
-- Date: March 5, 2026
-- Purpose: Store the reviewer's display name alongside reviewer_user_id
--          for direct display without requiring a join to user_profiles.

ALTER TABLE time_adjustment_requests
  ADD COLUMN IF NOT EXISTS reviewer_name text;

DO $$
BEGIN
  RAISE NOTICE 'Added reviewer_name column to time_adjustment_requests';
END $$;
