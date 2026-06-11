-- ============================================================================
-- Migration 223: Fix Found Part Transfer semantics
--
-- The original v1 (migration 222) had the operator *capture* the source
-- location on the RF. That was backwards — admins know BOTH locations when
-- they create the task, and the operator just executes: go to source A,
-- pick the part, deliver to destination B, record the final count at B.
--
-- New semantics:
--   - `location`                    = SOURCE (A) — where the operator
--                                     starts and picks the part
--   - `transfer_destination_location` = DESTINATION (B) — where the
--                                     operator delivers (admin sets this
--                                     at task creation)
--   - `system_quantity`             = expected qty at A to transfer
--   - `transfer_source_quantity`    = actual qty picked by the operator
--   - `counted_quantity`            = final consolidated count at B
--
-- Column rename is safe because v1 hasn't been used in production yet
-- (the `found_part_transfer` count type was seeded but no real counts
-- have been created against it).
-- ============================================================================

BEGIN;

-- =========================================================================
-- PART 1: Rename the column + index + swap comments
-- =========================================================================

ALTER TABLE rr_cyclecount_data
  RENAME COLUMN transfer_source_location TO transfer_destination_location;

COMMENT ON COLUMN rr_cyclecount_data.transfer_destination_location IS
  'Destination (B) the operator delivers the picked part to during a found_part_transfer count. `location` is the source (A) the operator picks from.';

COMMENT ON COLUMN rr_cyclecount_data.transfer_source_quantity IS
  'Actual qty the operator picked from `location` (source A) to deliver to `transfer_destination_location` (B). `counted_quantity` remains the final consolidated count at B after delivery.';

ALTER INDEX IF EXISTS idx_rr_cyclecount_data_transfer_source
  RENAME TO idx_rr_cyclecount_data_transfer_destination;

-- =========================================================================
-- PART 2: Update the seeded `found_part_transfer` workflow config
-- Relabel the location_scan step to "Source Location" to match the new
-- semantic. Idempotent: safe to run on orgs that already customized the
-- workflow because it ONLY rewrites the label on the location_scan step
-- inside a config that still has the default shape (4 steps, confirm +
-- location_scan + found_part_transfer + notes).
-- =========================================================================

UPDATE cycle_count_workflow_configs
SET steps = '[
  {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
  {"id":"location_scan","type":"location_scan","label":"Source Location","required":true,"order":2,"config":{}},
  {"id":"found_part_transfer","type":"found_part_transfer","label":"Record Transfer","required":true,"order":3,"config":{}},
  {"id":"notes","type":"notes","label":"Notes","required":false,"order":4,"config":{}}
]'::jsonb
WHERE count_type = 'found_part_transfer'
  AND jsonb_array_length(steps) = 4
  AND steps @> '[{"type":"location_scan","label":"Destination Location"}]'::jsonb;

COMMIT;
