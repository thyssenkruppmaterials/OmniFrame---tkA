-- ============================================================================
-- Migration 219: Add part number verification columns
-- Description: Supports the new Part Number Verification workflow step —
--              operator scans (or manually enters) the material number found
--              at a location and the system flags a part variance when the
--              scan doesn't match the expected `material_number`.
--
--              Also adds `location_reported_empty` so the Part Number step
--              can record "location empty" distinctly from a zero-quantity
--              count (different operational semantic: "no barcode to scan"
--              vs. "counted zero units").
-- ============================================================================

BEGIN;

ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS scanned_material_number TEXT,
  ADD COLUMN IF NOT EXISTS location_reported_empty BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN rr_cyclecount_data.scanned_material_number IS
  'Material number the operator scanned or manually entered during the part_number_verification workflow step. NULL = not verified.';

COMMENT ON COLUMN rr_cyclecount_data.location_reported_empty IS
  'Set to TRUE when the operator reports that the target location has no barcode / is empty during the part_number_verification step.';

-- Generated column: part_variance is TRUE when the operator scanned a
-- non-empty value that differs from the expected material number.
-- STORED so the warehouse dashboard can filter / index on it without having
-- to recompute per query.
ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS part_variance BOOLEAN
  GENERATED ALWAYS AS (
    scanned_material_number IS NOT NULL
    AND scanned_material_number <> ''
    AND scanned_material_number <> material_number
  ) STORED;

COMMENT ON COLUMN rr_cyclecount_data.part_variance IS
  'Auto-derived from scanned_material_number vs material_number. TRUE = mismatch (part variance). FALSE = match or not verified.';

-- Partial index to accelerate the common dashboard query
-- "show me counts with a part variance".
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_part_variance
  ON rr_cyclecount_data (organization_id, part_variance)
  WHERE part_variance = TRUE;

COMMIT;
