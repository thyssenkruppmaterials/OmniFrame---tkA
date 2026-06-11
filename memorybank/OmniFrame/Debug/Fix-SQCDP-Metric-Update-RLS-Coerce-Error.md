---
tags: [type/debug, status/active, domain/database, domain/auth, domain/frontend]
created: 2026-05-18
---
# Fix — SQCDP metric update fails with `Cannot coerce the result to a single JSON object`

## Symptom

A non-superadmin curator hitting **Save** in the SQCDP metric editor sees a sonner toast:

> Failed to update metric: Cannot coerce the result to a single JSON object

The superadmin (`admin@j.ai` / Jai Singh) can save successfully against the same metric, same payload, same network. The `<BoardEditToggle>` and per-card pencil are visible to the affected user, so the JS gate ([[Components/ProductionBoards - Feature Module]] § v6) believes they have `production_boards:edit`.

First surfaced on 2026-05-18 against dev project `wncpqxwmbxjgxvrpcake`. The bug was latent prior to [[Implement-SQCDP-Editable-Categories]] (migration 306) — the editor only became hittable for the affected role tier on 2026-05-10 (migration 295's permission grant); migration 306 just made it easier to notice because curators routinely edit metrics now.

## Diagnosis

### Phase 1 — pin the PostgREST error shape

`PGRST116 / "Cannot coerce the result to a single JSON object"` is what supabase-js's `.single()` returns when the result set has zero (or more than one) rows. The `updateMetric` mutation in `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/use-sqcdp-metrics.ts` was:

```ts
await supabase
  .from('sqcdp_metrics')
  .update(update)
  .eq('id', id)
  .select('…')
  .single()
```

For superadmin: 1 row returned → success. For the affected user: 0 rows returned → PGRST116. Three classic causes:

1. RLS SELECT policy filters the returned row (UPDATE succeeded, SELECT-side blocked).
2. RLS UPDATE policy filters the WHERE target (UPDATE affected 0 rows).
3. A `WITH CHECK` failure surfaced as 0 rows (rare for this exact error shape).

### Phase 2 — read every relevant RLS policy (Supabase MCP `execute_sql`)

```
sqcdp_metrics_select                       (FOR SELECT) → org_id IN (…)
sqcdp_metrics_mutate                       (FOR ALL)    → org_id IN (…) AND has_permission('production_boards','edit')
sqcdp_metric_history_select / _mutate      … same shape
production_board_sqcdp_categories_select   (FOR SELECT) → org_id IN (…)
production_board_sqcdp_categories_mutate   (FOR ALL)    → org_id IN (…) AND has_permission('production_boards','edit')
```

The SELECT clause on `production_board_sqcdp_categories` (the new migration-306 table) is org-scoped only, so the FK-evaluation hypothesis suggested in the brief was eliminated. The single common dependency for every mutate path is `public.has_permission('production_boards','edit')`.

### Phase 3 — read `has_permission(text, text)` itself

The pre-fix body (still the source of truth for the parallel `has_permission(uuid, text)` overload, which we DID NOT touch):

```sql
SELECT EXISTS (
  SELECT 1 FROM permissions p
  JOIN role_permissions rp ON p.id = rp.permission_id
  WHERE rp.role = public.get_user_role()
  AND p.resource = resource_name
  AND p.action   = action_name
) OR EXISTS (
  SELECT 1 FROM user_permissions up …
);
```

`get_user_role()` returns `user_profiles.role`, the **legacy `user_role` enum** column. The `user_role` enum does NOT include custom roles like `tka_supervisors`, `tka_branchcoordinator`, `rolls_royce_assembly`, `master_trainer`, etc. Migration 295 worked around that by storing the placeholder `'viewer'::user_role` in `rp.role` for the `tka_supervisors` row (the real lookup is `rp.role_id`).

Querying the live data for `production_boards.edit`:

| rp.role enum | rp role_name (via role_id) | permission |
|---|---|---|
| `admin` | admin | production_boards.edit |
| `manager` | manager | production_boards.edit |
| `superadmin` | superadmin | production_boards.edit |
| **`viewer`** | **tka_supervisors** | production_boards.edit |

The last row is the booby-trap. There are two cohorts of `tka_supervisors` users in `user_profiles`:

- legacy_role = `'viewer'` (e.g. Brian Brumbaugh, Craig Stilley, Curtis Ballard) — `has_permission` finds the rp.role='viewer' row → returns TRUE → save works.
- legacy_role = `'tka_associate'` (Charlene Galvez, Ian Cokain, Janeen Ortiz, Melissa Dugger, Monique Jelks, Reece Rhea, Salma Darkid, Trevor Nielsen, Teddy Jorgenson, Jai2 ASd) — no `rp.role='tka_associate' AND p.name='production_boards.edit'` row exists → `has_permission` returns FALSE → mutate USING clause filters every row → UPDATE affects 0 rows → `.select(...).single()` throws PGRST116.

Meanwhile `authService.checkPermission` (`src/lib/auth/auth-service.ts`) — used by `useCanEditBoards` — joins `role_permissions` on **`role_id`** (modern UUID), so it correctly returns TRUE for both cohorts. The JS gate opens the editor; the SQL gate slams the door at save time.

### Phase 4 — confirm by reproduction

Under `SET LOCAL ROLE authenticated` + `SET request.jwt.claims` for each persona:

| Persona | role_name (via role_id) | legacy_role | sql_has_perm (before) | affected_rows (before) |
|---|---|---|---|---|
| Jai Singh | superadmin | superadmin | true | 1 |
| Brian Brumbaugh | tka_supervisors | viewer | true | 1 |
| **Charlene Galvez** | **tka_supervisors** | **tka_associate** | **false** | **0** |
| Anayeli Jimenez | viewer | viewer | true | 1 (over-grant smell) |

The `Charlene Galvez` row is the smoking gun. The `Anayeli Jimenez` row is the same legacy-enum collision viewed from the other side — any pure-viewer user was accidentally getting `production_boards.edit` from the misaligned `rp.role='viewer'` placeholder row, but only at the RLS layer; the JS gate correctly hid the editor for them, so it never surfaced as a bug, just as latent over-grant.

## Root cause

`public.has_permission(text, text)` resolved role-based permissions via the legacy `user_role` enum (`rp.role = get_user_role()`) instead of `rp.role_id`. Migration 295 used `'viewer'::user_role` as a placeholder for the custom `tka_supervisors` role's `rp.role` value (the canonical lookup is `rp.role_id`). For `tka_supervisors` users whose `user_profiles.role` happened to be `'tka_associate'` rather than the placeholder `'viewer'`, the enum-keyed lookup missed the permission row, RLS denied the mutate, the UPDATE returned no rows, and PostgREST's `.single()` raised PGRST116.

The frontend gate (`authService.checkPermission`) and the SQL gate (`has_permission`) were resolving the same permission through different keys (`role_id` vs the legacy enum), and the data shape made them disagree for a specific subset of users.

## Fix

### DB — `supabase/migrations/308_fix_has_permission_role_id.sql`

Rewrite the `public.has_permission(text, text)` body to JOIN through `role_id` (canonical, modern path), mirroring `authService.checkPermission`. The single-function patch automatically benefits every RLS policy that already references `has_permission(text, text)` — `production_boards`, `branches`, `sqcdp_metrics`, `sqcdp_metric_history`, `sqcdp_problems`, `production_board_posts`, `production_board_post_acks`, `production_board_job_postings`, `production_board_sqcdp_categories`, `production_board_card_layouts`, plus the `production-board-images` storage bucket policies.

```sql
CREATE OR REPLACE FUNCTION public.has_permission(
  resource_name text,
  action_name   text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' AS $function$
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
```

The parallel `has_permission(uuid, text)` overload was intentionally NOT touched — it's called from server-side code with an explicit user_uuid argument and already uses `role_id`-adjacent logic. The two-arg overload is the one RLS calls (no arguments to derive the caller other than `auth.uid()`); fixing it is the minimum-correct change.

Applied to dev project `wncpqxwmbxjgxvrpcake` via Supabase MCP `apply_migration`. `NOTIFY pgrst, 'reload schema'` at the end so PostgREST picks up the new function body without a service restart.

### Client — `src/features/.../sqcdp/hooks/use-sqcdp-metrics.ts`

Defensive change paired with the migration so future permission misalignments surface as friendly errors rather than `Cannot coerce the result to a single JSON object`:

- Both `updateMetric` and `createMetric` mutation paths now `.maybeSingle()` instead of `.single()`.
- When `data === null` and there's no Supabase error, the hook throws a permission-flavoured message: `Update didn't return a row. Your role might be missing the production_boards:edit permission for this org — contact an administrator.` The `toast.error` wrapper in `onError` surfaces it verbatim.

## Verification

Re-ran the four-persona reproduction post-fix via Supabase MCP `execute_sql` + `SET LOCAL ROLE authenticated` + `request.jwt.claims`:

| Persona | sql_has_perm (after) | affected_rows (after) |
|---|---|---|
| Jai Singh (superadmin) | true | 1 |
| Brian Brumbaugh (tka_supervisors, legacy=viewer) | true | 1 |
| **Charlene Galvez (tka_supervisors, legacy=tka_associate)** | **true** | **1** ✅ |
| Anayeli Jimenez (pure viewer) | **false** | **0** ✅ over-grant closed |

- `pnpm vitest run src/features/shift-productivity/production-boards/boards/sqcdp/` — 14 files / 166 tests all green (was 164; +2 from the new `use-sqcdp-metrics.test.tsx`).
- `pnpm exec eslint <touched files>` — clean.
- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm build` — clean. `feature-shift-productivity` chunk 477.75 KB (unchanged); `sqcdp-board` lazy chunk 133.03 KB (negligible growth from the new error string copy).
- `get_advisors security` — no NEW findings introduced by migration 308. The two pre-existing `(anon|authenticated)_security_definer_function_executable` warnings on `has_permission(text, text)` are unchanged in count; the SECURITY DEFINER attribute is required so the function can read `user_profiles` inside RLS.

## Regression test

New file `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/use-sqcdp-metrics.test.tsx`:

1. **`update returns null → friendly error`** — mocks the supabase chain so `maybeSingle()` resolves `{ data: null, error: null }`. Asserts the thrown message does NOT contain `"cannot coerce"`, DOES contain `production_boards:edit`, and DOES contain `administrator`. Pins the friendly-error contract.
2. **`Supabase error pass-through`** — mocks `maybeSingle()` to return `{ data: null, error: { message: 'check constraint violation: foo_bar' } }`. Asserts the original Supabase error message is surfaced verbatim, not swallowed by the friendly-null branch.

## Repro instructions (for the user, after deploy)

1. Sign in as a `tka_supervisors` user whose `user_profiles.role` is NOT `'viewer'` (e.g. Charlene Galvez `a5e82ef0…`). The repro is sensitive to the legacy enum value; superadmin and `viewer`-legacy supervisors didn't see the bug.
2. Navigate to `/apps/production-boards?board=sqcdp&edit=1`.
3. Click a primary card pencil → tweak any field → Save.
4. Pre-fix: toast `Failed to update metric: Cannot coerce the result to a single JSON object` and the dialog stays open. Post-fix: toast `Metric updated` and the dialog closes.
5. Reload to confirm the value persisted.

Verify the editor still hides for a `viewer` user (e.g. Anayeli Jimenez `1858a649…`): the `<BoardEditToggle>` button doesn't render, per-card pencils don't render, the manager dialog can't be opened.

## Related

- [[Implementations/Implement-SQCDP-Editable-Categories]] — migration 306; the schema change that surfaced this latent bug (every save now has to clear the same RLS gate).
- [[Decisions/ADR-SQCDP-Category-Schema]] — the per-org categories ADR; not the root cause but the implementation that brought the bug to the fore.
- [[Components/ProductionBoards - Feature Module]] — the feature module the editor lives in.
- [[Sessions/2026-05-18]] — today's session log.
- `supabase/migrations/295_production_boards_content_tables.sql` — where `has_permission` first started being called in earnest from production-boards policies.
- `supabase/migrations/306_production_boards_sqcdp_categories.sql` — where the editor's mutate surface expanded.
- `supabase/migrations/308_fix_has_permission_role_id.sql` — the fix.
