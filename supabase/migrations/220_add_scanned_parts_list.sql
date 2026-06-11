-- ============================================================================
-- Migration 220: Multi-part capture for Part Number Verification
-- Description: When the operator finds unexpected material(s) at a location,
--              they can now record *every* part they found (and the quantity
--              of each). `scanned_parts` stores the ordered list; the
--              existing `scanned_material_number` + generated `part_variance`
--              column continue to represent the primary/first scan so
--              downstream dashboards and filters don't need to change shape.
-- ============================================================================

BEGIN;

ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS scanned_parts JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN rr_cyclecount_data.scanned_parts IS
  'Ordered list of parts captured by the part_number_verification step. Each entry shape: {part_number: text, quantity: numeric, method: "scan"|"manual", captured_at: timestamptz}. Empty array when not verified or location reported empty.';

-- Sanity CHECK: scanned_parts must be an array (or empty). Prevents future
-- accidental writes of objects or other JSONB types.
ALTER TABLE rr_cyclecount_data
  DROP CONSTRAINT IF EXISTS chk_scanned_parts_is_array;
ALTER TABLE rr_cyclecount_data
  ADD CONSTRAINT chk_scanned_parts_is_array
  CHECK (jsonb_typeof(scanned_parts) = 'array');

COMMIT;
