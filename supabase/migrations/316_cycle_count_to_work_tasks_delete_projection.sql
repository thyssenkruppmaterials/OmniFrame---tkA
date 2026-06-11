-- ============================================================================
-- Migration 316 — rr_cyclecount_data → work_tasks DELETE projection.
--
-- Background
-- ----------
-- Migration 257 introduced the bi-directional projection between
-- `rr_cyclecount_data` and `work_tasks`, but only handled INSERT and
-- UPDATE on the source table. DELETEs were never projected, so any
-- hard `DELETE FROM rr_cyclecount_data …` left behind orphan
-- `work_tasks` rows whose `source_id` no longer resolved.
--
-- On 2026-05-18 we hard-deleted 505 pending cycle counts from
-- `rr_cyclecount_data` (org j.AI OneBox) at the user's request. The
-- corresponding 505 `work_tasks` rows (task numbers
-- `CC-20260519-0001 … 0505`) survived. The next morning, every fresh
-- cycle count attempt collided with one of those orphans via the
-- `work_tasks_org_type_number_uniq (organization_id, task_type,
-- task_number) WHERE deleted_at IS NULL` index, breaking the Inventory
-- Counts bulk import (the projection trigger raised
-- `duplicate key value violates unique constraint
-- "work_tasks_org_type_number_uniq"` and rolled the row back).
--
-- Fix
-- ---
-- Mirror the existing forward-projection trigger, this time for the
-- DELETE branch. The trigger:
--   * No-ops unless the per-org `work_tasks_shadow_write` feature flag
--     is enabled (same gating as the INSERT/UPDATE projection).
--   * Sets `app.skip_sync='true'` for the duration of the DELETE so
--     the reverse trigger (`trg_sync_work_task_to_cycle_count`) doesn't
--     try to write back into the now-deleted source row.
--   * Sets `app.work_zone_lock_bypass='on'` for consistency with the
--     forward trigger — there is no zone lock involved in a DELETE,
--     but the setting is harmless and keeps the GUC manipulation
--     symmetric across the three trigger functions.
--   * Targets `(source_table='rr_cyclecount_data', source_id=OLD.id)`
--     so we never accidentally delete a `work_tasks` row that came
--     from a different source pipeline (SAP agent, etc.).
--
-- This makes the previously-orphaned cleanup automatic for any future
-- delete (admin tools, supervisor purge, ad-hoc SQL).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_cycle_count_delete_to_work_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_skip text := current_setting('app.skip_sync', true);
BEGIN
  IF v_skip = 'true' THEN
    RETURN OLD;
  END IF;
  IF NOT public.work_engine_feature_flag(OLD.organization_id, 'work_tasks_shadow_write') THEN
    RETURN OLD;
  END IF;

  PERFORM set_config('app.skip_sync', 'true', true);
  PERFORM set_config('app.work_zone_lock_bypass', 'on', true);

  DELETE FROM public.work_tasks
   WHERE organization_id = OLD.organization_id
     AND task_type       = 'cycle_count'
     AND source_table    = 'rr_cyclecount_data'
     AND source_id       = OLD.id;

  PERFORM set_config('app.skip_sync', 'false', true);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_sync_cycle_count_delete_to_work_task
  ON public.rr_cyclecount_data;
CREATE TRIGGER trg_sync_cycle_count_delete_to_work_task
  AFTER DELETE ON public.rr_cyclecount_data
  FOR EACH ROW EXECUTE FUNCTION public.sync_cycle_count_delete_to_work_task();

COMMENT ON FUNCTION public.sync_cycle_count_delete_to_work_task() IS
  'Mig 316 (2026-05-19): mirrors sync_cycle_count_to_work_task for the '
  'DELETE branch so hard-deletes from rr_cyclecount_data no longer leave '
  'orphan work_tasks rows that block work_tasks_org_type_number_uniq.';

COMMIT;
