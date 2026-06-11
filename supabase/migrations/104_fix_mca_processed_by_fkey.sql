-- Migration: Fix mca_processed_by foreign key to reference user_profiles
-- Date: January 14, 2026
-- Purpose: Update foreign key to reference user_profiles instead of auth.users
--          This allows Supabase PostgREST to properly join for the user data

-- Drop existing constraint that references auth.users
ALTER TABLE rf_putaway_operations 
DROP CONSTRAINT IF EXISTS rf_putaway_operations_mca_processed_by_fkey;

-- Add new constraint that references user_profiles
ALTER TABLE rf_putaway_operations 
ADD CONSTRAINT rf_putaway_operations_mca_processed_by_fkey 
FOREIGN KEY (mca_processed_by) REFERENCES user_profiles(id);

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
