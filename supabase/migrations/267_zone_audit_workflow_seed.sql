-- ============================================================================
-- Migration 267 — Zone Audit follow-on: workflow seed + canary enablement
--
-- Adds the default `work_workflow_configs` row for the Zoning WorkType and
-- flips the j.AI OneBox canary org's per-type setting + engine
-- `enabled_work_types` array so `enabledWorkTypes(orgId)` resolves
-- ['cycle_count', 'zone_audit'] after this migration ships.
--
-- Note on the legacy unique constraint:
--   `cycle_count_workflow_configs_organization_id_count_type_key`
--   (UNIQUE (organization_id, task_subtype)) was carried forward from
--   migration 203b through 258's rename and is now redundant — the
--   work-kind-aware `work_workflow_configs_org_kind_subtype_key`
--   (organization_id, work_kind, task_subtype) is the right shape. Drop it
--   defensively here so seeding zone_audit rows can never collide with a
--   same-named cycle_count subtype on the same org. Idempotent.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Drop the redundant legacy unique constraint if it still exists.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cycle_count_workflow_configs_organization_id_count_type_key'
       AND conrelid = 'public.work_workflow_configs'::regclass
  ) THEN
    ALTER TABLE public.work_workflow_configs
      DROP CONSTRAINT cycle_count_workflow_configs_organization_id_count_type_key;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Seed the default Zone Audit workflow row per org with at least one user.
--    Mirrors the cycle_count default rows seeded by mig 203f, but keyed off
--    work_kind='zone_audit' so the (org, work_kind, task_subtype) unique
--    index added by mig 258 owns the dedup.
-- ---------------------------------------------------------------------------
INSERT INTO public.work_workflow_configs
  (organization_id, work_kind, task_subtype, display_name, description, is_active, steps, version, updated_by)
SELECT DISTINCT
  o.id,
  'zone_audit',
  'standard_audit',
  'Zone Audit — Standard Sweep',
  'Default 4-step workflow for zone audits seeded from LT22 transfer orders. '
    || 'Operator confirms the zone, scans each location, enters the counted '
    || 'quantity, and reviews variance against the SAP unrestricted total.',
  true,
  jsonb_build_array(
    jsonb_build_object(
      'id', 'confirm', 'type', 'confirm', 'label', 'Confirm Zone',
      'required', true, 'order', 1, 'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'location', 'type', 'location_scan', 'label', 'Scan Location',
      'required', true, 'order', 2, 'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'quantity', 'type', 'quantity_entry', 'label', 'Enter Quantity',
      'required', true, 'order', 3, 'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'review', 'type', 'review', 'label', 'Review',
      'required', true, 'order', 4,
      'config', jsonb_build_object('review_threshold_pct', 10, 'review_threshold_abs', 5)
    )
  ),
  1,
  (SELECT id FROM public.user_profiles WHERE organization_id = o.id LIMIT 1)
FROM public.organizations o
WHERE EXISTS (SELECT 1 FROM public.user_profiles WHERE organization_id = o.id)
ON CONFLICT ON CONSTRAINT work_workflow_configs_org_kind_subtype_key DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Canary flip — enable zone_audit for the j.AI OneBox org.
--    Per the follow-on plan, the actual `work_engine_enabled` feature flag
--    stays gated to `false` so the LT22 dispatch path is a no-op until an
--    operator explicitly turns it on.
-- ---------------------------------------------------------------------------
UPDATE public.work_type_settings
   SET enabled = true,
       updated_at = now()
 WHERE organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'::uuid
   AND task_type = 'zone_audit';

UPDATE public.work_engine_settings
   SET enabled_work_types = array_append(enabled_work_types, 'zone_audit'),
       updated_at = now()
 WHERE organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'::uuid
   AND NOT ('zone_audit' = ANY(enabled_work_types));

COMMIT;
