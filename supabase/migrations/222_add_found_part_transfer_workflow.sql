-- ============================================================================
-- Migration 222: Found Part Transfer workflow
--
-- Adds support for a new count workflow where the operator:
--   1. Arrives at the task's location (destination, B).
--   2. Reports where they found the misplaced parts (source, A).
--   3. Enters how many parts they moved from A → B.
--   4. Enters the FINAL consolidated quantity at B after the transfer.
--
-- The final count at B is stored in the existing `counted_quantity` column
-- so existing variance + reporting logic works unchanged. Two new columns
-- capture the transfer origin:
--   - `transfer_source_location`      TEXT   — where the parts were found (A)
--   - `transfer_source_quantity`      NUMERIC — how many were moved from A
--
-- Also seeds a default `found_part_transfer` workflow config for every
-- organization so the RF app has a usable template out of the box.
-- ============================================================================

BEGIN;

-- =========================================================================
-- PART 1: Transfer columns on rr_cyclecount_data
-- =========================================================================

ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS transfer_source_location TEXT,
  ADD COLUMN IF NOT EXISTS transfer_source_quantity NUMERIC(10,3);

COMMENT ON COLUMN rr_cyclecount_data.transfer_source_location IS
  'Where the operator FOUND the part during a found_part_transfer count (location A). `location` remains the destination (B).';

COMMENT ON COLUMN rr_cyclecount_data.transfer_source_quantity IS
  'How many units were transferred from transfer_source_location to the task''s `location` (destination B). `counted_quantity` remains the final consolidated count at the destination.';

-- Partial index to accelerate "show me all transfer counts" queries.
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_transfer_source
  ON rr_cyclecount_data (organization_id, transfer_source_location)
  WHERE transfer_source_location IS NOT NULL;

-- =========================================================================
-- PART 2: Seed default workflow config for `found_part_transfer`
-- =========================================================================

DO $mig$
DECLARE
  org RECORD;
  transfer_steps JSONB;
BEGIN
  transfer_steps := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Destination Location","required":true,"order":2,"config":{}},
    {"id":"found_part_transfer","type":"found_part_transfer","label":"Record Transfer","required":true,"order":3,"config":{}},
    {"id":"notes","type":"notes","label":"Notes","required":false,"order":4,"config":{}}
  ]'::jsonb;

  FOR org IN SELECT id FROM organizations LOOP
    INSERT INTO cycle_count_workflow_configs
      (organization_id, count_type, display_name, description, steps)
    VALUES
      (
        org.id,
        'found_part_transfer',
        'Found Part Transfer',
        'Operator found a part at another location and is consolidating it into the task''s location; records the source, qty moved, and final count at the destination.',
        transfer_steps
      )
    ON CONFLICT (organization_id, count_type) DO NOTHING;
  END LOOP;
END $mig$;

COMMIT;
