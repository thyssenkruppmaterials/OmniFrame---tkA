-- Fix Variance Percentage Overflow Issue
-- Migration: 048_fix_variance_percentage_overflow.sql  
-- Description: Caps variance_percentage to 999.99 to prevent numeric field overflow errors
-- Issue: NUMERIC(5,2) field can only hold values up to 999.99, but large variances can exceed this

-- Drop existing trigger
DROP TRIGGER IF EXISTS trigger_auto_calculate_variance ON rr_cyclecount_data;

-- Update trigger function to cap variance_percentage at 999.99
CREATE OR REPLACE FUNCTION auto_calculate_cycle_count_variance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only calculate if both quantities are provided
  IF NEW.counted_quantity IS NOT NULL AND NEW.system_quantity IS NOT NULL THEN
    -- Calculate variance_quantity (counted - system)
    NEW.variance_quantity := NEW.counted_quantity - NEW.system_quantity;
    
    -- Calculate variance_percentage with overflow protection
    IF NEW.system_quantity > 0 THEN
      -- Normal percentage calculation for non-zero system quantity
      -- Cap at 999.99 to prevent NUMERIC(5,2) field overflow
      NEW.variance_percentage := LEAST(
        (ABS(NEW.variance_quantity) / NEW.system_quantity) * 100,
        999.99
      );
    ELSIF NEW.system_quantity = 0 AND NEW.counted_quantity != 0 THEN
      -- Special case: zero system quantity but non-zero count
      -- Set to max value 999.99 to indicate extreme variance
      NEW.variance_percentage := 999.99;
    ELSE
      -- Both zero - perfect match
      NEW.variance_percentage := 0;
    END IF;
    
    -- Determine if recount is required based on variance thresholds
    -- Recount required if:
    -- 1. Variance percentage > 10% (for non-zero system qty)
    -- 2. Absolute variance > 10 units
    -- 3. System quantity is zero but counted quantity is not (always requires review)
    IF NEW.system_quantity = 0 AND NEW.counted_quantity != 0 THEN
      -- Zero system but non-zero count - always requires recount
      NEW.requires_recount := true;
    ELSIF NEW.system_quantity > 0 THEN
      -- Check percentage and absolute thresholds
      NEW.requires_recount := (
        NEW.variance_percentage > 10 OR 
        ABS(NEW.variance_quantity) > 10
      );
    ELSE
      -- Both zero or counted is null - no recount needed
      NEW.requires_recount := false;
    END IF;
    
    -- Auto-set status to variance_review if variance requires recount and count is completed
    IF NEW.requires_recount = true AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      NEW.status := 'variance_review';
    END IF;
    
  ELSE
    -- If quantities not provided, clear variance fields
    IF NEW.counted_quantity IS NULL THEN
      NEW.variance_quantity := NULL;
      NEW.variance_percentage := NULL;
      NEW.requires_recount := false;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate trigger that fires BEFORE INSERT OR UPDATE
CREATE TRIGGER trigger_auto_calculate_variance
  BEFORE INSERT OR UPDATE OF counted_quantity, system_quantity ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_cycle_count_variance();

-- Add comments for documentation
COMMENT ON FUNCTION auto_calculate_cycle_count_variance() IS 'Automatically calculates variance_quantity, variance_percentage (capped at 999.99), and requires_recount fields to maintain data integrity and prevent numeric overflow';
COMMENT ON TRIGGER trigger_auto_calculate_variance ON rr_cyclecount_data IS 'Triggers automatic variance calculation before insert or update operations with overflow protection';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Variance percentage overflow fix applied successfully';
  RAISE NOTICE 'Variance percentage will now be capped at 999.99 to prevent NUMERIC(5,2) overflow';
  RAISE NOTICE 'Zero system quantity cases will set variance_percentage to 999.99 instead of NULL';
END $$;

