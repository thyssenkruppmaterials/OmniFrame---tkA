-- ============================================================================
-- Migration 329 — OmniBelt settings RLS scope
--
-- Adds an additive RLS policy on public.settings letting holders of the
-- `omnibelt.manage` permission upsert/select rows whose key matches
-- `system.omnibelt.%` (master kill switch + allow-list). The pre-existing
-- settings RLS (created with the toast-notifications system) covers the
-- shape `(user_id IS NULL AND get_user_role() IN ('admin','superadmin'))`,
-- but doesn't acknowledge the new `omnibelt.manage` resource granted in
-- migration 327. Without this policy, future custom roles that hold
-- `omnibelt.manage` without the legacy `admin` / `superadmin` enum value
-- would fail RLS even though the application logic deems them authorised.
--
-- Today admin/superadmin already pass the existing admin policy, so this
-- migration is defense-in-depth + future-proofing. The deeper bug that
-- caused the production 42501 was that `api/routers/omnibelt.py` was
-- writing through `db.client` (anon-key singleton) rather than a
-- per-request JWT-bound client, so `auth.uid()` resolved to NULL and
-- *every* settings policy failed. That is fixed in the same commit by
-- routing the kill-switch write through `create_authenticated_supabase_client(token)`.
--
-- Scope rules:
--   * `key LIKE 'system.omnibelt.%'`  — only OmniBelt-prefixed rows
--   * `user_id IS NULL`               — global / per-org rows only, never
--                                       per-user
--   * `organization_id IS NULL`       — kill-switch is intentionally global
--     OR `IN (...)`                     (one row per cluster, spec §4.3);
--                                       the allow-list and any future
--                                       org-scoped omnibelt setting must
--                                       still match the caller's org.
--   * `public.has_permission('omnibelt','manage')` — the canonical
--     resource/action gate seeded in migration 327.
--
-- The existing `settings` policies are NOT touched.
-- Idempotent: DROP POLICY IF EXISTS … CREATE POLICY ….
-- ============================================================================

DROP POLICY IF EXISTS "settings_omnibelt_admin_rw" ON public.settings;
CREATE POLICY "settings_omnibelt_admin_rw" ON public.settings
  FOR ALL TO authenticated
  USING (
    key LIKE 'system.omnibelt.%'
    AND user_id IS NULL
    AND (
      organization_id IS NULL
      OR organization_id IN (
        SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      )
    )
    AND public.has_permission('omnibelt', 'manage')
  )
  WITH CHECK (
    key LIKE 'system.omnibelt.%'
    AND user_id IS NULL
    AND (
      organization_id IS NULL
      OR organization_id IN (
        SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      )
    )
    AND public.has_permission('omnibelt', 'manage')
  );

COMMENT ON POLICY "settings_omnibelt_admin_rw" ON public.settings IS
  'Additive RLS for OmniBelt admin keys (system.omnibelt.*). Grants holders '
  'of the omnibelt.manage permission read/write access to global '
  '(organization_id IS NULL) and own-org rows where user_id IS NULL. '
  'Defense-in-depth alongside the existing "Admins can manage system-wide '
  'settings" policy: the latter still covers the legacy admin/superadmin '
  'enum path, this one covers the modern resource/action permission path. '
  'See migration 327 for the omnibelt.manage seed and migration 329 for '
  'the rationale.';

NOTIFY pgrst, 'reload schema';
