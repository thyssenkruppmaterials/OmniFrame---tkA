-- Phase 7.11 / 13.4 — bidirectional sync trigger no-loop probe.
--
-- Verifies that the rr_cyclecount_data ↔ work_tasks projection triggers
-- both honor the `app.skip_sync` GUC. Without this guard the round-trip
-- would ping-pong forever; with it, an UPDATE in either direction stamps
-- the GUC on entry and the opposite-direction trigger short-circuits.
--
-- Wire test (operator runs):
--   1. Pick an org with `work_tasks_shadow_write` enabled.
--   2. UPDATE rr_cyclecount_data SET counted_quantity = ... WHERE id = ...;
--   3. Confirm: exactly one row in work_events ('claimed' won't fire here,
--      but the projection trigger should not have looped infinitely).
\set ON_ERROR_STOP on

DO $$
DECLARE
  fwd_proc_src text;
  rev_proc_src text;
BEGIN
  SELECT prosrc INTO fwd_proc_src FROM pg_proc WHERE proname = 'sync_cycle_count_to_work_task';
  IF fwd_proc_src IS NULL THEN
    RAISE EXCEPTION 'sync_cycle_count_to_work_task function not found';
  END IF;
  IF position('app.skip_sync' IN fwd_proc_src) = 0 THEN
    RAISE EXCEPTION 'sync_cycle_count_to_work_task missing app.skip_sync GUC guard';
  END IF;

  SELECT prosrc INTO rev_proc_src FROM pg_proc WHERE proname = 'sync_work_task_to_cycle_count';
  IF rev_proc_src IS NULL THEN
    RAISE EXCEPTION 'sync_work_task_to_cycle_count function not found';
  END IF;
  IF position('app.skip_sync' IN rev_proc_src) = 0 THEN
    RAISE EXCEPTION 'sync_work_task_to_cycle_count missing app.skip_sync GUC guard';
  END IF;

  RAISE NOTICE 'sync_no_loop: both trigger functions guard via app.skip_sync';
END $$;
