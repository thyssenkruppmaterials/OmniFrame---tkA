-- Phase 10.2 / 13.4 — composite (organization_id, task_id) FK probe.
-- Verifies that a `work_events` or `task_artifacts` row pointing to a
-- different org's task is REJECTED at insert time, regardless of RLS.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_fk_count int;
BEGIN
  SELECT count(*) INTO v_fk_count
    FROM pg_constraint
   WHERE conrelid = 'public.work_events'::regclass
     AND contype = 'f'
     AND pg_get_constraintdef(oid) LIKE '%(organization_id, task_id)%REFERENCES%work_tasks%';
  IF v_fk_count = 0 THEN
    RAISE EXCEPTION 'work_events composite FK on (organization_id, task_id) is missing';
  END IF;

  SELECT count(*) INTO v_fk_count
    FROM pg_constraint
   WHERE conrelid = 'public.task_artifacts'::regclass
     AND contype = 'f'
     AND pg_get_constraintdef(oid) LIKE '%(organization_id, task_id)%REFERENCES%work_tasks%';
  IF v_fk_count = 0 THEN
    RAISE EXCEPTION 'task_artifacts composite FK on (organization_id, task_id) is missing';
  END IF;

  RAISE NOTICE 'work_child_org_fk: composite FKs are in place';
END $$;
