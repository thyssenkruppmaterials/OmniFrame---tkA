-- ============================================================================
-- Migration 224: Exempt Found Part Transfer from variance-review promotion
--
-- For a `found_part_transfer` count, `counted_quantity` (final count at the
-- DESTINATION B) and `system_quantity` (expected qty at the SOURCE A) live
-- at DIFFERENT locations. `counted_quantity - system_quantity` is therefore
-- not a meaningful "variance" — the row shouldn't flip to
-- `variance_review` just because B ended up with more units than A had.
--
-- This migration rewrites `auto_calculate_cycle_count_variance` so:
--   - For transfer rows it computes `variance_quantity` purely for
--     record-keeping but DOES NOT set `requires_recount` and does NOT
--     promote status to `variance_review`.
--   - For every other count type the existing behavior (migration 215)
--     is preserved verbatim.
--
-- Also backfills any existing transfer rows that were incorrectly sitting
-- in `variance_review` — flips them back to `completed` and clears
-- `requires_recount`.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION auto_calculate_cycle_count_variance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
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

    -- Found Part Transfer: counted (at B) and system (at A) are different
    -- locations, so variance is informational only. Skip recount flags and
    -- the variance_review promotion.
    IF NEW.count_type = 'found_part_transfer' THEN
      NEW.requires_recount := false;
      RETURN NEW;
    END IF;

    -- requires_recount stays threshold-based for every other count type.
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

    -- Any non-zero variance on completion → variance_review.
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

COMMENT ON FUNCTION auto_calculate_cycle_count_variance() IS
  'Calculates variance and requires_recount using per-row thresholds (defaults 10% / 10 units). Found Part Transfer rows are exempted from recount flags and variance_review promotion because counted_quantity and system_quantity refer to different locations.';

-- =========================================================================
-- Backfill: fix transfer rows that were incorrectly flipped to
-- variance_review (status + requires_recount).
-- =========================================================================

UPDATE rr_cyclecount_data
SET status = 'completed',
    requires_recount = false
WHERE count_type = 'found_part_transfer'
  AND (status = 'variance_review' OR requires_recount = true);

COMMIT;
