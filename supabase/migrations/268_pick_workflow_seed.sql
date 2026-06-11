-- ============================================================================
-- Migration 268 — Picking follow-on: workflow seed + canary enablement
--
-- Adds the default `work_workflow_configs` row for the Pick WorkType and
-- flips the j.AI OneBox canary org's per-type setting + engine
-- `enabled_work_types` array so `enabledWorkTypes(orgId)` resolves
-- ['cycle_count', 'zone_audit', 'pick'] after this migration ships.
--
-- Column mapping note (differs from the plan draft):
--   The plan's SQL sketch references `name / is_default / created_by` on
--   `work_workflow_configs`, but the actual post-258 schema uses
--   `display_name / is_active / updated_by` (plus a `version int`). We
--   mirror migration 267's (zone_audit seed) adapted shape so both
--   follow-ons share the same DDL idioms.
--
-- Unique-constraint note:
--   `work_workflow_configs_org_kind_subtype_key` (organization_id,
--   work_kind, task_subtype) was added in mig 258. We ON CONFLICT onto
--   that constraint by name so a re-run is a no-op even if the plan's
--   sketched shape happens to also target the same tuple via a
--   different index name.
--
-- Related:
--   * [[Patterns/Work-Engine-Registry]] — WorkTypeConfig contract.
--   * `docs/work-engine/follow-on-picking.md` — operator + agent runbook.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Seed the default Pick workflow row per org with at least one user.
--    5-step flow: confirm → location_scan → quantity_entry →
--    barcode_label_scan → review. Matches
--    `src/lib/work-engine/work-types/pick.tsx::DEFAULT_PICK_STEPS`.
-- ---------------------------------------------------------------------------
INSERT INTO public.work_workflow_configs
  (organization_id, work_kind, task_subtype, display_name, description, is_active, steps, version, updated_by)
SELECT DISTINCT
  o.id,
  'pick',
  'standard_pick',
  'Pick — Standard',
  'Default 5-step workflow for picking one line item of a SAP transfer order. '
    || 'Operator confirms the pick, scans the source location, enters the picked '
    || 'quantity, scans the pick label, and reviews. On completion OmniAgent '
    || 'fires LT12 to confirm the TO line in SAP via the '
    || '`builtin-pick-completed` agent-side trigger.',
  true,
  jsonb_build_array(
    jsonb_build_object(
      'id', 'confirm', 'type', 'confirm', 'label', 'Confirm Pick',
      'required', true, 'order', 1, 'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'location', 'type', 'location_scan', 'label', 'Scan Source Location',
      'required', true, 'order', 2, 'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'quantity', 'type', 'quantity_entry', 'label', 'Enter Pick Quantity',
      'required', true, 'order', 3, 'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'barcode', 'type', 'barcode_label_scan', 'label', 'Scan Pick Label',
      'required', true, 'order', 4, 'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'review', 'type', 'review', 'label', 'Review',
      'required', true, 'order', 5, 'config', '{}'::jsonb
    )
  ),
  1,
  (SELECT id FROM public.user_profiles WHERE organization_id = o.id LIMIT 1)
FROM public.organizations o
WHERE EXISTS (SELECT 1 FROM public.user_profiles WHERE organization_id = o.id)
ON CONFLICT ON CONSTRAINT work_workflow_configs_org_kind_subtype_key DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Canary flip — enable pick for the j.AI OneBox org. Per the follow-on
--    plan, the master `work_engine_enabled` feature flag stays gated to
--    `false` so the LT12 dispatch path is a no-op until an operator
--    explicitly turns it on. Capacity of 5 matches the pre-seeded default
--    for non-count work types (mig 256).
-- ---------------------------------------------------------------------------
UPDATE public.work_type_settings
   SET enabled = true,
       capacity_per_worker = 5,
       updated_at = now()
 WHERE organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'::uuid
   AND task_type = 'pick';

UPDATE public.work_engine_settings
   SET enabled_work_types = array_append(enabled_work_types, 'pick'),
       updated_at = now()
 WHERE organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'::uuid
   AND NOT ('pick' = ANY(enabled_work_types));

COMMIT;
