-- ============================================================================
-- Migration 265 — projection trigger hardening + found-part-transfer carve-out.
--
-- Rolls four fixes into a single CREATE OR REPLACE of
-- public.sync_cycle_count_to_work_task() (forward) plus a defensive refresh
-- of public.sync_work_task_to_cycle_count() (reverse). Triggers stay bound;
-- the trigger objects themselves are untouched.
--
-- (A) P0 enum→text cast on UPDATE-branch priority. With work_tasks_shadow_write
--     ON, the legacy `COALESCE(NEW.priority, priority)` failed at runtime
--     with `42804: COALESCE types cycle_count_priority and text cannot be
--     matched` because rr_cyclecount_data.priority is the cycle_count_priority
--     enum but work_tasks.priority is text. PG has no implicit enum→text
--     cast in COALESCE. Force `NEW.priority::text` on the value side.
--     Mirrors the same fix migration 261 needed for the drift view.
--
-- (B) UPDATE branch converted to UPSERT. The chunked backfill driver in
--     scripts/backfill/work_tasks_from_cycle_count.mjs bumps `updated_at` on
--     each pre-existing rr_cyclecount_data row to force projection. The
--     legacy trigger's TG_OP='UPDATE' branch did
--     `UPDATE work_tasks WHERE source_id = NEW.id`, which matched zero rows
--     and was a silent no-op for the 8908 historical rows in production
--     because no work_tasks row existed yet. Single UPSERT
--     (INSERT … ON CONFLICT (id) DO UPDATE …) makes both first-time and
--     re-projection paths converge, and removes the TG_OP branching.
--
-- (C) Reverse trigger — defensive `::cycle_count_status` cast on the
--     text→enum status assignment. Implicit assignment cast already worked
--     for in-set labels (insert-style cast invokes the enum's input
--     function), but making it explicit (a) documents intent, (b) fails
--     loudly + early if a malformed status sneaks through (e.g. work_tasks
--     getting `paused` without `legacy_status='awaiting_supervisor_signoff'`,
--     which the CASE ELSE would otherwise pass through unchanged). The
--     reverse trigger does NOT project `priority` today (verified against
--     the existing function body) — no priority cast needed.
--
-- (D) found_part_transfer exemption (Plan §7.9 / mig 224's carve-out). When
--     `NEW.count_type = 'found_part_transfer'` the projected payload
--     forces `requires_recount = false` and any `variance_review` source
--     status is clamped to `(status='completed', legacy_status='approved')`
--     so an FPT row never enters the supervisor variance queue.
--
-- Engine state on entry: all per-org `work_tasks_shadow_write` flags FALSE
-- (project has one org). The flag stays FALSE on exit. The function's
-- early-return on the flag check means this migration is a no-op for live
-- traffic until the flag is intentionally flipped.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- forward projection: rr_cyclecount_data → work_tasks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_cycle_count_to_work_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_skip text := current_setting('app.skip_sync', true);
  v_status text;
  v_legacy_status text;
  v_requires_recount boolean;
BEGIN
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;
  IF NOT public.work_engine_feature_flag(NEW.organization_id, 'work_tasks_shadow_write') THEN
    RETURN NEW;
  END IF;

  -- Status mapping (Phase 1.2 table).
  -- NEW.status is the cycle_count_status enum; literal comparisons resolve
  -- via the implicit "unknown literal → enum" coercion in CASE WHEN. The
  -- output v_status/v_legacy_status are text and feed the text columns on
  -- work_tasks directly.
  CASE NEW.status
    WHEN 'pending'                       THEN v_status := 'pending';        v_legacy_status := NULL;
    WHEN 'in_progress'                   THEN v_status := 'in_progress';    v_legacy_status := NULL;
    WHEN 'recount'                       THEN v_status := 'in_progress';    v_legacy_status := 'recount';
    WHEN 'awaiting_supervisor_signoff'   THEN v_status := 'paused';         v_legacy_status := 'awaiting_supervisor_signoff';
    WHEN 'variance_review'               THEN v_status := 'completed';      v_legacy_status := 'variance_review';
    WHEN 'approved'                      THEN v_status := 'completed';      v_legacy_status := 'approved';
    WHEN 'cancelled'                     THEN v_status := 'cancelled';      v_legacy_status := NULL;
    ELSE                                      v_status := COALESCE(NEW.status::text, 'pending'); v_legacy_status := NULL;
  END CASE;

  -- (D) found_part_transfer exemption. Mig 224 documented this carve-out:
  -- a row with count_type='found_part_transfer' is just an operator-noted
  -- inventory transfer; it must NEVER enter variance_review and must NEVER
  -- require a recount, regardless of source-row state. Apply BEFORE the
  -- upsert so the projected payload + legacy_status both reflect the
  -- carve-out from the first projection.
  IF NEW.count_type = 'found_part_transfer' THEN
    v_requires_recount := false;
    IF v_legacy_status = 'variance_review' THEN
      v_legacy_status := 'approved';
      v_status         := 'completed';
    END IF;
  ELSE
    v_requires_recount := COALESCE(NEW.requires_recount, false);
  END IF;

  PERFORM set_config('app.skip_sync', 'true', true);
  PERFORM set_config('app.work_zone_lock_bypass', 'on', true);

  -- (A) + (B): single UPSERT replacing the legacy INSERT/UPDATE branching.
  --     - NEW.priority::text on every priority reference forces the
  --       enum→text coercion explicitly so COALESCE no longer trips on
  --       mismatched argument types.
  --     - ON CONFLICT (id) DO UPDATE means a benign UPDATE on
  --       rr_cyclecount_data with no pre-existing work_tasks row creates
  --       the projection on first touch.
  INSERT INTO public.work_tasks (
    id, organization_id, task_type, task_subtype, task_number,
    source_table, source_id,
    subject_material, subject_description,
    primary_location, warehouse, unit_of_measure,
    priority, status, legacy_status,
    assigned_to, assigned_at, pushed_by, pushed_at, push_mode,
    push_acknowledged, push_acknowledged_at,
    supervisor_assigned_at, supervisor_assigned_by,
    reservation_started_at,
    workflow_config_id, workflow_config_version, workflow_snapshot,
    payload, result_payload, completed_at, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.organization_id, 'cycle_count', NEW.count_type, NEW.count_number,
    'rr_cyclecount_data', NEW.id,
    NEW.material_number, NEW.material_description,
    NEW.location, NEW.warehouse, NEW.unit_of_measure,
    COALESCE(NEW.priority::text, 'normal'), v_status, v_legacy_status,
    NEW.assigned_to, NEW.assigned_at, NEW.pushed_by, NEW.pushed_at,
    COALESCE(NEW.push_mode, 'pull'),
    COALESCE(NEW.push_acknowledged, false), NEW.push_acknowledged_at,
    NEW.supervisor_assigned_at, NEW.supervisor_assigned_by,
    NEW.reservation_started_at,
    NEW.workflow_config_id, NEW.workflow_config_version, NEW.workflow_snapshot,
    jsonb_build_object(
      'system_quantity', NEW.system_quantity,
      'counted_quantity', NEW.counted_quantity,
      'count_type', NEW.count_type,
      'requires_recount', v_requires_recount,
      'recount_completed', NEW.recount_completed,
      'scanned_material_number', NEW.scanned_material_number,
      'scanned_parts', NEW.scanned_parts,
      'evidence_photo_urls', NEW.evidence_photo_urls,
      'transfer_destination_location', NEW.transfer_destination_location,
      'transfer_source_quantity', NEW.transfer_source_quantity,
      'reassignment_count', NEW.reassignment_count
    ),
    jsonb_build_object(
      'counted_quantity', NEW.counted_quantity,
      'workflow_result', NEW.workflow_result,
      'notes', NEW.notes
    ),
    NEW.completed_at, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET status                 = EXCLUDED.status,
        legacy_status          = EXCLUDED.legacy_status,
        assigned_to            = EXCLUDED.assigned_to,
        assigned_at            = EXCLUDED.assigned_at,
        pushed_by              = EXCLUDED.pushed_by,
        pushed_at              = EXCLUDED.pushed_at,
        push_mode              = EXCLUDED.push_mode,
        push_acknowledged      = EXCLUDED.push_acknowledged,
        push_acknowledged_at   = EXCLUDED.push_acknowledged_at,
        supervisor_assigned_at = EXCLUDED.supervisor_assigned_at,
        supervisor_assigned_by = EXCLUDED.supervisor_assigned_by,
        reservation_started_at = EXCLUDED.reservation_started_at,
        priority               = EXCLUDED.priority,
        primary_location       = EXCLUDED.primary_location,
        workflow_config_id     = EXCLUDED.workflow_config_id,
        workflow_config_version= EXCLUDED.workflow_config_version,
        workflow_snapshot      = EXCLUDED.workflow_snapshot,
        payload                = EXCLUDED.payload,
        result_payload         = EXCLUDED.result_payload,
        completed_at           = EXCLUDED.completed_at,
        updated_at             = now();

  PERFORM set_config('app.skip_sync', 'false', true);
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- (C) reverse projection: work_tasks → rr_cyclecount_data.
--     Defensive `::cycle_count_status` cast on the status assignment makes
--     a malformed status fail at the trigger boundary instead of silently
--     coercing through the enum input function. Body otherwise unchanged
--     from migration 257.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_work_task_to_cycle_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_skip text := current_setting('app.skip_sync', true);
  v_legacy_status text;
BEGIN
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.task_type IS DISTINCT FROM 'cycle_count' THEN
    RETURN NEW;
  END IF;
  IF NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.work_engine_feature_flag(NEW.organization_id, 'work_tasks_shadow_write') THEN
    RETURN NEW;
  END IF;

  v_legacy_status := CASE
    WHEN NEW.status = 'paused'    AND NEW.legacy_status = 'awaiting_supervisor_signoff' THEN 'awaiting_supervisor_signoff'
    WHEN NEW.status = 'completed' AND NEW.legacy_status = 'variance_review'             THEN 'variance_review'
    WHEN NEW.status = 'completed' AND NEW.legacy_status = 'approved'                    THEN 'approved'
    WHEN NEW.status = 'in_progress' AND NEW.legacy_status = 'recount'                   THEN 'recount'
    ELSE NEW.status
  END;

  PERFORM set_config('app.skip_sync', 'true', true);

  UPDATE public.rr_cyclecount_data
     SET status                 = v_legacy_status::cycle_count_status,
         assigned_to            = NEW.assigned_to,
         assigned_at            = NEW.assigned_at,
         pushed_by              = NEW.pushed_by,
         pushed_at              = NEW.pushed_at,
         push_mode              = NEW.push_mode,
         push_acknowledged      = NEW.push_acknowledged,
         push_acknowledged_at   = NEW.push_acknowledged_at,
         supervisor_assigned_at = NEW.supervisor_assigned_at,
         supervisor_assigned_by = NEW.supervisor_assigned_by,
         counted_quantity       = COALESCE((NEW.result_payload ->> 'counted_quantity')::numeric, counted_quantity),
         notes                  = COALESCE(NEW.result_payload ->> 'notes', notes),
         completed_at           = NEW.completed_at,
         updated_at             = now()
   WHERE id = NEW.source_id;

  PERFORM set_config('app.skip_sync', 'false', true);
  RETURN NEW;
END $$;

COMMIT;
