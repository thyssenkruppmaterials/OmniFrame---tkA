-- ============================================================================
-- Migration 308 — Fix has_permission(text, text) to resolve via role_id.
--
-- Authored 2026-05-18 as a follow-up to migration 295 (Production Boards
-- content tables + permission seed) and migration 306 (SQCDP Editable
-- Categories). Both rely on `public.has_permission('production_boards',
-- 'edit')` in their RLS policies to gate mutations.
--
-- Symptom: a non-superadmin curator (e.g. tka_supervisors) hitting Save in
-- the SQCDP metric editor sees:
--
--     Failed to update metric: Cannot coerce the result to a single JSON object
--
-- Root cause: the previous body of `public.has_permission(text, text)`
-- joined `role_permissions` on the legacy `rp.role` enum column via
-- `public.get_user_role()` (which returns `user_profiles.role`, a
-- `user_role` enum). The `user_role` enum does NOT include custom roles
-- like `tka_supervisors`, so migration 295 inserted the permission row
-- with `rp.role = 'viewer'::user_role` as a placeholder (the real lookup
-- key is `rp.role_id`). For a `tka_supervisors` user whose
-- `user_profiles.role` happens to be `'tka_associate'` (rather than the
-- placeholder `'viewer'`), the legacy-enum JOIN finds no matching row →
-- `has_permission` returns FALSE → the RLS USING clause filters every row
-- out → the UPDATE affects zero rows → PostgREST's `.select(...).single()`
-- emits PGRST116 ("Cannot coerce the result to a single JSON object").
--
-- Meanwhile `authService.checkPermission` (used by `useCanEditBoards`) goes
-- via `role_id` and reports the permission as granted, so the editor's
-- Save button is shown — only to fail on the actual save. The fix here
-- realigns RLS with that frontend check.
--
-- Approach: rewrite the function to resolve permissions via `role_id`
-- (canonical, modern path) and keep the existing per-user override branch
-- (`user_permissions`). This matches `authService.checkPermission`
-- (`src/lib/auth/auth-service.ts`) exactly, decouples the check from the
-- legacy `user_role` enum, and benefits every RLS policy that already
-- calls `has_permission(text, text)` — including the production-boards
-- tables, `sqcdp_metrics`, `sqcdp_metric_history`,
-- `production_board_sqcdp_categories`, `production_board_card_layouts`,
-- and the storage objects bucket from migration 295. No RLS policy bodies
-- need to change.
--
-- Side effect (intentional): removes an accidental over-grant where any
-- `user_profiles.role = 'viewer'` user previously got
-- `production_boards.edit` via the placeholder row inserted for
-- `tka_supervisors`. None of those users were able to mutate via the UI
-- anyway (the `<BoardEditToggle>` / per-card pencil gates depend on
-- `useCanEditBoards`, which uses `authService.checkPermission` and
-- correctly returned `false` for them). Net behavioural change: zero
-- regression for users with edit access; the bug is fixed for the
-- mismatched-role subset described above.
--
-- Idempotent: `CREATE OR REPLACE FUNCTION` on the single overload. The
-- two-argument signature is preserved verbatim so every RLS callsite keeps
-- resolving to this function.
--
-- See:
--   - memorybank/OmniFrame/Debug/Fix-SQCDP-Metric-Update-RLS-Coerce-Error.md
--   - memorybank/OmniFrame/Implementations/Implement-SQCDP-Editable-Categories.md
--   - memorybank/OmniFrame/Decisions/ADR-SQCDP-Category-Schema.md
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.has_permission(
  resource_name text,
  action_name   text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.role_permissions rp ON rp.role_id = up.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE up.id = auth.uid()
      AND p.resource = resource_name
      AND p.action   = action_name
  ) OR EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = auth.uid()
      AND up.granted = TRUE
      AND (up.expires_at IS NULL OR up.expires_at > NOW())
      AND p.resource = resource_name
      AND p.action   = action_name
  );
$function$;

COMMENT ON FUNCTION public.has_permission(text, text) IS
  'Returns TRUE when the caller (auth.uid()) has the requested permission, '
  'either via role-based permissions (role_permissions joined on role_id, '
  'NOT the legacy `role` enum) or via a per-user override in '
  'user_permissions. Mirrors `authService.checkPermission` in '
  'src/lib/auth/auth-service.ts so RLS and the frontend gate stay aligned. '
  'See migration 308 for the rationale.';

NOTIFY pgrst, 'reload schema';

COMMIT;
