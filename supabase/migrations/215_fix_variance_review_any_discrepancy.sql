-- Migration 215: Fix cycle count status to require variance_review for ANY discrepancy
--
-- Previously, the trigger only set status = 'variance_review' when `requires_recount`
-- was true (variance > 10% OR > 10 units absolute). This allowed small discrepancies
-- on high-quantity items to slip through as 'completed'.
--
-- Fix: ANY non-zero variance → status = 'variance_review'.
-- `requires_recount` remains threshold-based for recount workflow decisions.

BEGIN;

-- =========================================================================
-- PART 1: Update the trigger to flag any non-zero variance
-- =========================================================================

DROP TRIGGER IF EXISTS trigger_auto_calculate_variance ON rr_cyclecount_data;

CREATE OR REPLACE FUNCTION auto_calculate_cycle_count_variance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.counted_quantity IS NOT NULL AND NEW.system_quantity IS NOT NULL THEN
    NEW.variance_quantity := NEW.counted_quantity - NEW.system_quantity;

    IF NEW.system_quantity > 0 THEN
      NEW.variance_percentage := LEAST(
        (ABS(NEW.variance_quantity) / NEW.system_quantity) * 100,
        999.99
      );
    ELSIF NEW.system_quantity = 0 AND NEW.counted_quantity != 0 THEN
      NEW.variance_percentage := 999.99;
    ELSE
      NEW.variance_percentage := 0;
    END IF;

    -- requires_recount stays threshold-based (for recount workflow decisions)
    IF NEW.system_quantity = 0 AND NEW.counted_quantity != 0 THEN
      NEW.requires_recount := true;
    ELSIF NEW.system_quantity > 0 THEN
      NEW.requires_recount := (
        NEW.variance_percentage > COALESCE(NEW.review_threshold_pct, 10) OR
        ABS(NEW.variance_quantity) > COALESCE(NEW.review_threshold_abs, 10)
      );
    ELSE
      NEW.requires_recount := false;
    END IF;

    -- Any non-zero variance on completion → variance_review
    IF NEW.variance_quantity != 0
       AND NEW.status = 'completed'
       AND OLD.status IS DISTINCT FROM 'completed'
    THEN
      NEW.status := 'variance_review';
    END IF;

  ELSE
    IF NEW.counted_quantity IS NULL THEN
      NEW.variance_quantity := NULL;
      NEW.variance_percentage := NULL;
      NEW.requires_recount := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_calculate_variance
  BEFORE INSERT OR UPDATE OF counted_quantity, system_quantity, review_threshold_pct, review_threshold_abs ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_cycle_count_variance();

COMMENT ON FUNCTION auto_calculate_cycle_count_variance() IS
  'Calculates variance fields. Any non-zero variance on completion sets status to variance_review. requires_recount remains threshold-based (per-row or default 10%/10 units).';

-- =========================================================================
-- PART 2: Fix existing data — completed rows with non-zero variance
-- =========================================================================

UPDATE rr_cyclecount_data
SET status = 'variance_review',
    updated_at = NOW()
WHERE status = 'completed'
  AND variance_quantity IS NOT NULL
  AND variance_quantity != 0;

COMMIT;
