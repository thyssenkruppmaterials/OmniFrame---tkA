-- ============================================================================
-- Migration 257 — rr_cyclecount_data ↔ work_tasks bi-directional projection
-- (Phase 1.2 + 1.3 of Work Engine Foundation; renumbered from plan's 255).
--
-- Triggers no-op unless the per-org `work_tasks_shadow_write` feature flag is
-- enabled. Both directions guard against ping-pong via `app.skip_sync`.
-- Realtime publication membership for rr_cyclecount_data, work_tasks, and
-- work_events is added idempotently.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. forward projection: rr_cyclecount_data → work_tasks
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
BEGIN
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;
  IF NOT public.work_engine_feature_flag(NEW.organization_id, 'work_tasks_shadow_write') THEN
    RETURN NEW;
  END IF;

  -- Status mapping (Phase 1.2 table).
  CASE NEW.status
    WHEN 'pending'                       THEN v_status := 'pending';        v_legacy_status := NULL;
    WHEN 'in_progress'                   THEN v_status := 'in_progress';    v_legacy_status := NULL;
    WHEN 'recount'                       THEN v_status := 'in_progress';    v_legacy_status := 'recount';
    WHEN 'awaiting_supervisor_signoff'   THEN v_status := 'paused';         v_legacy_status := 'awaiting_supervisor_signoff';
    WHEN 'variance_review'               THEN v_status := 'completed';      v_legacy_status := 'variance_review';
    WHEN 'approved'                      THEN v_status := 'completed';      v_legacy_status := 'approved';
    WHEN 'cancelled'                     THEN v_status := 'cancelled';      v_legacy_status := NULL;
    ELSE                                      v_status := COALESCE(NEW.status, 'pending'); v_legacy_status := NULL;
  END CASE;

  PERFORM set_config('app.skip_sync', 'true', true);
  PERFORM set_config('app.work_zone_lock_bypass', 'on', true);

  IF TG_OP = 'INSERT' THEN
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
      payload, completed_at, created_at, updated_at
    ) VALUES (
      NEW.id, NEW.organization_id, 'cycle_count', NEW.count_type, NEW.count_number,
      'rr_cyclecount_data', NEW.id,
      NEW.material_number, NEW.material_description,
      NEW.location, NEW.warehouse, NEW.unit_of_measure,
      COALESCE(NEW.priority, 'normal'), v_status, v_legacy_status,
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
        'requires_recount', NEW.requires_recount,
        'recount_completed', NEW.recount_completed,
        'scanned_material_number', NEW.scanned_material_number,
        'scanned_parts', NEW.scanned_parts,
        'evidence_photo_urls', NEW.evidence_photo_urls,
        'transfer_destination_location', NEW.transfer_destination_location,
        'transfer_source_quantity', NEW.transfer_source_quantity,
        'reassignment_count', NEW.reassignment_count
      ),
      NEW.completed_at, NEW.created_at, NEW.updated_at
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    UPDATE public.work_tasks
       SET status                 = v_status,
           legacy_status          = v_legacy_status,
           assigned_to            = NEW.assigned_to,
           assigned_at            = NEW.assigned_at,
           pushed_by              = NEW.pushed_by,
           pushed_at              = NEW.pushed_at,
           push_mode              = COALESCE(NEW.push_mode, 'pull'),
           push_acknowledged      = COALESCE(NEW.push_acknowledged, false),
           push_acknowledged_at   = NEW.push_acknowledged_at,
           supervisor_assigned_at = NEW.supervisor_assigned_at,
           supervisor_assigned_by = NEW.supervisor_assigned_by,
           reservation_started_at = NEW.reservation_started_at,
           priority               = COALESCE(NEW.priority, priority),
           primary_location       = NEW.location,
           workflow_config_id     = NEW.workflow_config_id,
           workflow_config_version= NEW.workflow_config_version,
           workflow_snapshot      = NEW.workflow_snapshot,
           payload                = jsonb_build_object(
             'system_quantity', NEW.system_quantity,
             'counted_quantity', NEW.counted_quantity,
             'count_type', NEW.count_type,
             'requires_recount', NEW.requires_recount,
             'recount_completed', NEW.recount_completed,
             'scanned_material_number', NEW.scanned_material_number,
             'scanned_parts', NEW.scanned_parts,
             'evidence_photo_urls', NEW.evidence_photo_urls,
             'transfer_destination_location', NEW.transfer_destination_location,
             'transfer_source_quantity', NEW.transfer_source_quantity,
             'reassignment_count', NEW.reassignment_count
           ),
           result_payload = jsonb_build_object(
             'counted_quantity', NEW.counted_quantity,
             'workflow_result', NEW.workflow_result,
             'notes', NEW.notes
           ),
           completed_at = NEW.completed_at,
           updated_at   = now()
     WHERE organization_id = NEW.organization_id
       AND task_type = 'cycle_count'
       AND source_id = NEW.id;
  END IF;

  PERFORM set_config('app.skip_sync', 'false', true);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_cycle_count_to_work_task ON public.rr_cyclecount_data;
CREATE TRIGGER trg_sync_cycle_count_to_work_task
  AFTER INSERT OR UPDATE ON public.rr_cyclecount_data
  FOR EACH ROW EXECUTE FUNCTION public.sync_cycle_count_to_work_task();

-- ---------------------------------------------------------------------------
-- 2. reverse projection: work_tasks → rr_cyclecount_data
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
     SET status                 = v_legacy_status,
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

DROP TRIGGER IF EXISTS trg_sync_work_task_to_cycle_count ON public.work_tasks;
CREATE TRIGGER trg_sync_work_task_to_cycle_count
  AFTER UPDATE ON public.work_tasks
  FOR EACH ROW
  WHEN (NEW.task_type = 'cycle_count')
  EXECUTE FUNCTION public.sync_work_task_to_cycle_count();

-- ---------------------------------------------------------------------------
-- 3. Backfill progress + report tables (Phase 1.2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_engine_backfill_progress (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_cursor_ts timestamptz,
  last_cursor_id uuid,
  rows_inserted bigint NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  notes text
);

CREATE TABLE IF NOT EXISTS public.work_engine_backfill_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ran_at timestamptz NOT NULL DEFAULT now(),
  legacy_count bigint,
  work_count bigint,
  drift_count bigint,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.work_engine_backfill_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_engine_backfill_report   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backfill_progress org read" ON public.work_engine_backfill_progress;
DROP POLICY IF EXISTS "backfill_report org read"   ON public.work_engine_backfill_report;
CREATE POLICY "backfill_progress org read" ON public.work_engine_backfill_progress
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "backfill_report org read" ON public.work_engine_backfill_report
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

REVOKE ALL ON public.work_engine_backfill_progress FROM PUBLIC, anon;
REVOKE ALL ON public.work_engine_backfill_report   FROM PUBLIC, anon;
GRANT SELECT ON public.work_engine_backfill_progress TO authenticated;
GRANT SELECT ON public.work_engine_backfill_report   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_engine_backfill_progress TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_engine_backfill_report   TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Realtime publication: rr_cyclecount_data, work_tasks, work_events.
--    Phase 1.3.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_cyclecount_data REPLICA IDENTITY FULL;
ALTER TABLE public.work_tasks         REPLICA IDENTITY FULL;
ALTER TABLE public.work_events        REPLICA IDENTITY FULL;
ALTER TABLE public.task_artifacts     REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rr_cyclecount_data'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rr_cyclecount_data;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'work_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_tasks;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'work_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_events;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_artifacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_artifacts;
  END IF;
END $$;

COMMIT;
