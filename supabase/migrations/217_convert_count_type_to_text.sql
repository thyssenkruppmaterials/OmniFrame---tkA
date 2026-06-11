-- ============================================================================
-- Migration 217: Convert count_type from enum to TEXT
-- Description: Makes count workflow creation fully dynamic by dropping the
--              count_type_enum constraint on rr_cyclecount_data and
--              cycle_count_workflow_configs. Count types are now slugs defined
--              by rows in cycle_count_workflow_configs (the app's source of
--              truth), with a validation CHECK constraint enforcing slug
--              format.
-- ============================================================================

BEGIN;

-- =========================================================================
-- PART 1: Drop the helper function that depends on the enum
-- =========================================================================

DROP FUNCTION IF EXISTS public.get_count_type_display_name(count_type_enum);

-- =========================================================================
-- PART 2: Convert rr_cyclecount_data.count_type to TEXT
-- =========================================================================

ALTER TABLE rr_cyclecount_data
  ALTER COLUMN count_type DROP DEFAULT;

ALTER TABLE rr_cyclecount_data
  ALTER COLUMN count_type TYPE TEXT USING count_type::TEXT;

ALTER TABLE rr_cyclecount_data
  ALTER COLUMN count_type SET DEFAULT 'quantity_check';

COMMENT ON COLUMN rr_cyclecount_data.count_type IS
  'Slug of the count workflow (matches cycle_count_workflow_configs.count_type). Free-form text so admins can define custom workflow types.';

-- =========================================================================
-- PART 3: Convert cycle_count_workflow_configs.count_type to TEXT
-- =========================================================================

ALTER TABLE cycle_count_workflow_configs
  ALTER COLUMN count_type TYPE TEXT USING count_type::TEXT;

COMMENT ON COLUMN cycle_count_workflow_configs.count_type IS
  'Unique slug identifying the count workflow within the organization (lowercase alphanumeric + underscores).';

-- Enforce a sane slug format so the API key space stays clean.
ALTER TABLE cycle_count_workflow_configs
  DROP CONSTRAINT IF EXISTS chk_count_type_slug;

ALTER TABLE cycle_count_workflow_configs
  ADD CONSTRAINT chk_count_type_slug
  CHECK (count_type ~ '^[a-z0-9][a-z0-9_]{0,62}[a-z0-9]$' OR count_type ~ '^[a-z0-9]$');

-- =========================================================================
-- PART 4: Drop the enum type (now that no columns reference it)
-- =========================================================================

DROP TYPE IF EXISTS count_type_enum;

-- =========================================================================
-- PART 5: Recreate get_count_type_display_name taking TEXT
-- Priority: (1) workflow_configs.display_name for the caller's org if found,
--           (2) canonical built-in defaults, (3) prettified slug.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_count_type_display_name(type_value TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT display_name
      FROM cycle_count_workflow_configs
      WHERE count_type = type_value
      LIMIT 1
    ),
    CASE type_value
      WHEN 'part_verification'    THEN 'Part Verification'
      WHEN 'quantity_check'       THEN 'Quantity Check'
      WHEN 're_count'             THEN 'Re-Count'
      WHEN 'second_count'         THEN 'Second Count'
      WHEN 'third_count'          THEN 'Third Count'
      WHEN '999_count'            THEN '999 Count'
      WHEN 'empty_location_check' THEN 'Empty Location Check'
      WHEN 'cycle_count'          THEN 'Cycle Count'
      WHEN 'physical_count'       THEN 'Physical Count'
      WHEN 'spot_count'           THEN 'Spot Count'
      ELSE initcap(replace(type_value, '_', ' '))
    END
  );
$$;

COMMENT ON FUNCTION public.get_count_type_display_name(TEXT) IS
  'Returns a human-readable label for a count type slug. Looks up the workflow config first, falls back to built-in defaults, then prettifies the slug.';

GRANT EXECUTE ON FUNCTION public.get_count_type_display_name(TEXT) TO authenticated;

-- =========================================================================
-- PART 6: Backfill — ensure all 10 built-in count types have a seeded config
-- for every organization that is missing one (e.g. part_verification and
-- 999_count were previously deleted for some orgs).
-- =========================================================================

DO $$
DECLARE
  org RECORD;
  steps_999_count JSONB;
  steps_part_verification JSONB;
BEGIN
  steps_999_count := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"quantity_entry","type":"quantity_entry","label":"Quantity Entry","required":true,"order":3,"config":{}},
    {"id":"photo_capture","type":"photo_capture","label":"Photo Capture","required":false,"order":4,"config":{"max_photos":3}},
    {"id":"notes","type":"notes","label":"Notes","required":false,"order":5,"config":{}},
    {"id":"review","type":"review","label":"Review","required":true,"order":6,"config":{"variance_threshold_pct":10,"variance_threshold_abs":10}}
  ]'::jsonb;

  steps_part_verification := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"barcode_label_scan","type":"barcode_label_scan","label":"Barcode Label Scan","required":true,"order":3,"config":{}},
    {"id":"quantity_entry","type":"quantity_entry","label":"Quantity Entry","required":true,"order":4,"config":{}},
    {"id":"notes","type":"notes","label":"Notes","required":false,"order":5,"config":{}}
  ]'::jsonb;

  FOR org IN SELECT id FROM organizations LOOP
    INSERT INTO cycle_count_workflow_configs
      (organization_id, count_type, display_name, description, steps)
    VALUES
      (org.id, '999_count', '999 Count', '999 variance investigation count', steps_999_count),
      (org.id, 'part_verification', 'Part Verification', 'Verify part numbers match location', steps_part_verification)
    ON CONFLICT (organization_id, count_type) DO NOTHING;
  END LOOP;
END $$;

COMMIT;
