-- ============================================================================
-- Migration 260 — Org-folder storage RLS for cycle-count-photos AND grs-photos
-- (Phase 7.3 + 7.8; renumbered from plan's 258).
--
-- Replaces over-permissive policies (originally added in migration 203) with
-- strict `(storage.foldername(name))[1] = caller_org_id` checks. Bucket layout
-- contract:
--   cycle-count-photos / {organization_id}/{task_id}/{filename}
--   grs-photos         / {organization_id}/{batch_number}/{filename}
--   task-artifacts     / {organization_id}/{task_id}/{filename}    (new bucket)
-- ============================================================================

BEGIN;

-- Ensure buckets exist (idempotent — INSERT ... ON CONFLICT DO NOTHING).
INSERT INTO storage.buckets (id, name, public)
VALUES ('cycle-count-photos', 'cycle-count-photos', false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public)
VALUES ('grs-photos', 'grs-photos', false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-artifacts', 'task-artifacts', false)
ON CONFLICT (id) DO NOTHING;

-- Drop legacy permissive policies if present.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
        'cycle-count-photos all-authenticated',
        'cycle-count-photos public read',
        'grs-photos all-authenticated',
        'grs-photos public read',
        'cycle-count-photos auth select',
        'cycle-count-photos auth insert',
        'cycle-count-photos auth update',
        'cycle-count-photos auth delete'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- cycle-count-photos: org-folder-scoped CRUD for authenticated users in that org
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cycle_count_photos_select_org" ON storage.objects;
CREATE POLICY "cycle_count_photos_select_org" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cycle-count-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "cycle_count_photos_insert_org" ON storage.objects;
CREATE POLICY "cycle_count_photos_insert_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cycle-count-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "cycle_count_photos_update_org" ON storage.objects;
CREATE POLICY "cycle_count_photos_update_org" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cycle-count-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "cycle_count_photos_delete_org" ON storage.objects;
CREATE POLICY "cycle_count_photos_delete_org" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cycle-count-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- grs-photos: same shape
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "grs_photos_select_org" ON storage.objects;
CREATE POLICY "grs_photos_select_org" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'grs-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "grs_photos_insert_org" ON storage.objects;
CREATE POLICY "grs_photos_insert_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'grs-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "grs_photos_update_org" ON storage.objects;
CREATE POLICY "grs_photos_update_org" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'grs-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "grs_photos_delete_org" ON storage.objects;
CREATE POLICY "grs_photos_delete_org" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'grs-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- task-artifacts: same shape (new bucket for Phase 1.1 task_artifacts table)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "task_artifacts_select_org" ON storage.objects;
CREATE POLICY "task_artifacts_select_org" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'task-artifacts'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "task_artifacts_insert_org" ON storage.objects;
CREATE POLICY "task_artifacts_insert_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-artifacts'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "task_artifacts_update_org" ON storage.objects;
CREATE POLICY "task_artifacts_update_org" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'task-artifacts'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "task_artifacts_delete_org" ON storage.objects;
CREATE POLICY "task_artifacts_delete_org" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'task-artifacts'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

COMMIT;
