-- Add 'recount' status to cycle_count_status enum (Part 1)
-- Migration: 041_add_recount_status_part1.sql
-- Description: Adds 'recount' enum value (must be separate from usage)

-- Add 'recount' to the cycle_count_status enum
ALTER TYPE cycle_count_status ADD VALUE IF NOT EXISTS 'recount';

-- Update the status color mapping comment to include recount status
COMMENT ON TYPE cycle_count_status IS 'Cycle count status: pending, in_progress, completed, variance_review, approved, cancelled, recount';
