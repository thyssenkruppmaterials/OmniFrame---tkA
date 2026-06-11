-- Phase 10.1 / 13.4 — confirms migrations 256-261 are applied before canary
-- cutover. Run with `psql -v ON_ERROR_STOP=1`.
\set ON_ERROR_STOP on

DO $$
DECLARE
  required text[] := ARRAY[
    'work_tasks',
    'work_events',
    'task_artifacts',
    'work_engine_settings',
    'work_type_settings',
    'work_type_warehouse_overrides',
    'work_request_idempotency',
    'supervisor_pins',
    'supervisor_pin_failures',
    'work_engine_backfill_progress',
    'work_engine_backfill_report'
  ];
  required_view text[] := ARRAY[
    'worker_capabilities',
    'work_engine_health',
    'work_engine_drift',
    'work_engine_dispatch_fairness'
  ];
  required_fn text[] := ARRAY[
    'work_engine_feature_flag',
    'work_setting',
    'work_zone_of',
    'reassign_work_zone',
    'priority_text_to_int',
    'priority_int_to_text',
    'verify_supervisor_pin',
    'set_supervisor_pin',
    'complete_task_with_supervisor_pin',
    'array_append_evidence_photo'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE EXCEPTION 'work-engine migration acceptance: required table % missing', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY required_view LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE EXCEPTION 'work-engine migration acceptance: required view % missing', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY required_fn LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = t
    ) THEN
      RAISE EXCEPTION 'work-engine migration acceptance: required function % missing', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'work-engine migration acceptance: all required objects present';
END $$;
