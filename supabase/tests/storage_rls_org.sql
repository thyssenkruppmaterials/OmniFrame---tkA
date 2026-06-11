-- Phase 10.2 — storage policy presence probe for cycle-count-photos,
-- grs-photos, and task-artifacts buckets.
\set ON_ERROR_STOP on

DO $$
DECLARE
  required_policies text[] := ARRAY[
    'cycle_count_photos_select_org',
    'cycle_count_photos_insert_org',
    'cycle_count_photos_update_org',
    'cycle_count_photos_delete_org',
    'grs_photos_select_org',
    'grs_photos_insert_org',
    'grs_photos_update_org',
    'grs_photos_delete_org',
    'task_artifacts_select_org',
    'task_artifacts_insert_org',
    'task_artifacts_update_org',
    'task_artifacts_delete_org'
  ];
  p text;
BEGIN
  FOREACH p IN ARRAY required_policies LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = p
    ) THEN
      RAISE EXCEPTION 'storage policy % missing — migration 260 not applied', p;
    END IF;
  END LOOP;
END $$;
