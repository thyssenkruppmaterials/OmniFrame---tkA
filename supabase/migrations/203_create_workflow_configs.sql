-- ============================================================================
-- Migration 203: Create Cycle Count Workflow Configs
-- Description: Creates workflow config table, adds workflow columns to cycle
--              count data, extends status enum, RLS policies, tab definition,
--              role permissions, default configs, storage bucket, and updates
--              variance trigger to use per-row thresholds.
-- ============================================================================

BEGIN;

-- =========================================================================
-- PART 1: Create cycle_count_workflow_configs table
-- =========================================================================

CREATE TABLE IF NOT EXISTS cycle_count_workflow_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  count_type count_type_enum NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(organization_id, count_type)
);

CREATE INDEX IF NOT EXISTS idx_workflow_configs_organization_id
  ON cycle_count_workflow_configs(organization_id);

-- (organization_id, count_type) is indexed by UNIQUE constraint
COMMENT ON TABLE cycle_count_workflow_configs IS 'Per-organization workflow configurations for each cycle count type';

-- =========================================================================
-- PART 2: Add workflow columns to rr_cyclecount_data
-- =========================================================================

ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS workflow_config_id UUID REFERENCES cycle_count_workflow_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_config_version INTEGER,
  ADD COLUMN IF NOT EXISTS workflow_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_photo_urls TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_threshold_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS review_threshold_abs NUMERIC(10,3);

COMMENT ON COLUMN rr_cyclecount_data.workflow_config_id IS 'Reference to the workflow config used for this count';
COMMENT ON COLUMN rr_cyclecount_data.workflow_snapshot IS 'Snapshot of workflow steps at time of count';
COMMENT ON COLUMN rr_cyclecount_data.workflow_result IS 'Results captured per workflow step';
COMMENT ON COLUMN rr_cyclecount_data.review_threshold_pct IS 'Override threshold for variance percentage triggering review';

-- =========================================================================
-- PART 3: Add awaiting_supervisor_signoff to cycle_count_status enum
-- =========================================================================

ALTER TYPE cycle_count_status ADD VALUE IF NOT EXISTS 'awaiting_supervisor_signoff';

-- =========================================================================
-- PART 4: Enable RLS and create policies on cycle_count_workflow_configs
-- =========================================================================

ALTER TABLE cycle_count_workflow_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workflow configs from their organization"
ON cycle_count_workflow_configs FOR SELECT
USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Managers can manage workflow configs in their organization"
ON cycle_count_workflow_configs FOR ALL
USING (organization_id IN (
  SELECT organization_id FROM user_profiles
  WHERE id = auth.uid() AND role IN ('superadmin', 'admin', 'manager')
))
WITH CHECK (organization_id IN (
  SELECT organization_id FROM user_profiles
  WHERE id = auth.uid() AND role IN ('superadmin', 'admin', 'manager')
));

-- =========================================================================
-- PART 5: Insert count-settings tab definition
-- =========================================================================

INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order, is_active)
VALUES ('inventory_apps', 'count-settings', 'Count Settings', 'Configure cycle count workflows per count type', 6, true)
ON CONFLICT (page_resource, tab_id) DO NOTHING;

-- =========================================================================
-- PART 6: Seed role_tab_permissions for count-settings tab
-- =========================================================================

INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT DISTINCT rtp.role_id, td.id, true
FROM role_tab_permissions rtp
JOIN tab_definitions td_existing ON rtp.tab_definition_id = td_existing.id
CROSS JOIN tab_definitions td
WHERE td_existing.page_resource = 'inventory_apps'
  AND rtp.granted = true
  AND td.page_resource = 'inventory_apps'
  AND td.tab_id = 'count-settings'
ON CONFLICT (role_id, tab_definition_id) DO NOTHING;

-- =========================================================================
-- PART 7: Seed default workflow configs for all existing organizations
-- =========================================================================

DO $$
DECLARE
  org RECORD;
  steps_quantity_check JSONB;
  steps_cycle_count JSONB;
  steps_physical_count JSONB;
  steps_spot_count JSONB;
  steps_part_verification JSONB;
  steps_re_count JSONB;
  steps_second_count JSONB;
  steps_third_count JSONB;
  steps_999_count JSONB;
  steps_empty_location_check JSONB;
BEGIN
  -- Build default step arrays (schema: id, type, label, required, order, config)
  steps_quantity_check := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"quantity_entry","type":"quantity_entry","label":"Quantity Entry","required":true,"order":3,"config":{}},
    {"id":"review","type":"review","label":"Review","required":true,"order":4,"config":{"variance_threshold_pct":10,"variance_threshold_abs":10}}
  ]'::jsonb;

  steps_cycle_count := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"quantity_entry","type":"quantity_entry","label":"Quantity Entry","required":true,"order":3,"config":{}},
    {"id":"review","type":"review","label":"Review","required":true,"order":4,"config":{"variance_threshold_pct":10,"variance_threshold_abs":10}}
  ]'::jsonb;

  steps_physical_count := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"quantity_entry","type":"quantity_entry","label":"Quantity Entry","required":true,"order":3,"config":{}},
    {"id":"notes","type":"notes","label":"Notes","required":false,"order":4,"config":{}},
    {"id":"review","type":"review","label":"Review","required":true,"order":5,"config":{"variance_threshold_pct":10,"variance_threshold_abs":10}}
  ]'::jsonb;

  steps_spot_count := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"quantity_entry","type":"quantity_entry","label":"Quantity Entry","required":true,"order":3,"config":{}}
  ]'::jsonb;

  steps_part_verification := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"barcode_label_scan","type":"barcode_label_scan","label":"Barcode Label Scan","required":true,"order":3,"config":{}},
    {"id":"quantity_entry","type":"quantity_entry","label":"Quantity Entry","required":true,"order":4,"config":{}},
    {"id":"notes","type":"notes","label":"Notes","required":false,"order":5,"config":{}}
  ]'::jsonb;

  steps_re_count := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"quantity_entry","type":"quantity_entry","label":"Quantity Entry","required":true,"order":3,"config":{}},
    {"id":"notes","type":"notes","label":"Notes","required":false,"order":4,"config":{}},
    {"id":"review","type":"review","label":"Review","required":true,"order":5,"config":{"variance_threshold_pct":10,"variance_threshold_abs":10}}
  ]'::jsonb;

  steps_second_count := steps_re_count;
  steps_third_count := steps_re_count;

  steps_999_count := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"quantity_entry","type":"quantity_entry","label":"Quantity Entry","required":true,"order":3,"config":{}},
    {"id":"photo_capture","type":"photo_capture","label":"Photo Capture","required":false,"order":4,"config":{"max_photos":3}},
    {"id":"notes","type":"notes","label":"Notes","required":false,"order":5,"config":{}},
    {"id":"review","type":"review","label":"Review","required":true,"order":6,"config":{"variance_threshold_pct":10,"variance_threshold_abs":10}}
  ]'::jsonb;

  steps_empty_location_check := '[
    {"id":"confirm","type":"confirm","label":"Confirm","required":true,"order":1,"config":{}},
    {"id":"location_scan","type":"location_scan","label":"Location Scan","required":true,"order":2,"config":{}},
    {"id":"empty_location_verification","type":"empty_location_verification","label":"Empty Location Verification","required":true,"order":3,"config":{}}
  ]'::jsonb;

  FOR org IN SELECT id FROM organizations LOOP
    INSERT INTO cycle_count_workflow_configs (organization_id, count_type, display_name, description, steps)
    VALUES
      (org.id, 'quantity_check', 'Quantity Check', 'Standard quantity verification', steps_quantity_check),
      (org.id, 'cycle_count', 'Cycle Count', 'Standard cycle count workflow', steps_cycle_count),
      (org.id, 'physical_count', 'Physical Count', 'Full physical inventory count', steps_physical_count),
      (org.id, 'spot_count', 'Spot Count', 'Random spot check', steps_spot_count),
      (org.id, 'part_verification', 'Part Verification', 'Verify part numbers match location', steps_part_verification),
      (org.id, 're_count', 'Re-Count', 'General recount', steps_re_count),
      (org.id, 'second_count', 'Second Count', 'Second counter verification', steps_second_count),
      (org.id, 'third_count', 'Third Count', 'Third counter verification (tiebreaker)', steps_third_count),
      (org.id, '999_count', '999 Count', '999 variance investigation count', steps_999_count),
      (org.id, 'empty_location_check', 'Empty Location Check', 'Verify location is empty', steps_empty_location_check)
    ON CONFLICT (organization_id, count_type) DO NOTHING;
  END LOOP;
END $$;

-- =========================================================================
-- PART 8: Create cycle-count-photos storage bucket and policies
-- =========================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cycle-count-photos', 'cycle-count-photos', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can upload to cycle-count-photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view cycle-count-photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update cycle-count-photos" ON storage.objects;

CREATE POLICY "Authenticated users can upload to cycle-count-photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'cycle-count-photos');

CREATE POLICY "Authenticated users can view cycle-count-photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'cycle-count-photos');

CREATE POLICY "Authenticated users can update cycle-count-photos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'cycle-count-photos');

-- =========================================================================
-- PART 9: Update auto_calculate_cycle_count_variance to use per-row thresholds
-- =========================================================================

DROP TRIGGER IF EXISTS trigger_auto_calculate_variance ON rr_cyclecount_data;
DROP TRIGGER IF EXISTS auto_calculate_variance_trigger ON rr_cyclecount_data;

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

    IF NEW.requires_recount = true AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
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

COMMENT ON FUNCTION auto_calculate_cycle_count_variance() IS 'Calculates variance and requires_recount using per-row thresholds when present, defaulting to 10% or 10 units';

COMMIT;
