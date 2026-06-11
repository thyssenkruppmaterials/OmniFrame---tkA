---
tags: [type/debug, status/active, domain/database, domain/auth]
created: 2026-05-10
---
# Fix: Production Boards 403 Access Forbidden

## Symptom

Clicking the new **Production Boards** sidebar leaf (`/apps/production-boards`) returned **403 Access Forbidden**. The browser console logged a Supabase REST 406 (no rows) on:

```
/rest/v1/navigation_items
  ?select=id,name,title,url,role_navigation_permissions!inner(visible,role_id)
  &role_navigation_permissions.role_id=eq.8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef
  &url=eq./apps/production-boards
```

`createStandardProtectedRoute('PRODUCTION_BOARDS')` calls `route-protection.ts`'s navigation-permission check (a `.single()` query), which redirects to `/403` whenever zero rows come back.

## Root cause (two compounding bugs)

1. **Migration on disk but never applied to live Supabase.** A previous worker authored `supabase/migrations/292_add_production_boards_navigation.sql` but did not call `apply_migration` on the live project (`wncpqxwmbxjgxvrpcake`). So no `navigation_items` row, and no `role_navigation_permissions` rows existed for `/apps/production-boards`.
2. **Even if it had been applied, the `ON CONFLICT` clause was wrong.** Migrations 067 and 090 both use `ON CONFLICT (role, navigation_item_id) DO UPDATE …`, but on Jan 6 2026 migration `fix_role_navigation_permissions_primary_key` changed the unique key on `role_navigation_permissions` to its current shape: **PK `(role_id, navigation_item_id)`**. There is no unique constraint on `(role, navigation_item_id)` — so the legacy clause cannot match a constraint and the statement would fail to plan if a conflict actually fired. Migration 292 inherited the same broken pattern.
3. The on-disk migration also only enumerates the legacy `user_role` enum members (`superadmin / admin / manager / cashier / viewer`). The deployed tenant has additional custom roles (`master_trainer`, `tka_branchcoordinator`, `tka_supervisors`, `human_resources`, `tka_associate`, …) with explicit rows for Shift Productivity / Standard Work — those would never gain an explicit row for Production Boards from the canonical-only INSERT.

## Remediation

### Migration `292_add_production_boards_navigation` — applied via Supabase MCP `apply_migration`

- Inserts `navigation_items` row `7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11` (`production_boards`, `/apps/production-boards`, `IconLayoutDashboard`, `parent_id = bb51e1ba-…` Labor Management, `position = 3`).
- Inserts five `role_navigation_permissions` rows for the canonical enum roles, **using `ON CONFLICT (role_id, navigation_item_id)` (the actual PK)** — fixed in the same edit so the on-disk file matches what was applied.

### Migration `293_production_boards_role_backfill` — new file + applied via MCP

`supabase/migrations/293_production_boards_role_backfill.sql` derives the role visibility for Production Boards from the existing Shift Productivity + Standard Work rows:

```sql
INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
SELECT src.role_id,
       '7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11'::uuid,
       bool_or(src.visible),
       COALESCE((SELECT r.name::user_role FROM roles r WHERE r.id = src.role_id
                  AND r.name IN ('superadmin','admin','manager','cashier','viewer',
                                 'tka_associate','inventory_specialist',
                                 'logistics_coordinator','quality_specialist')
                  LIMIT 1),
                'viewer'::user_role) AS role
FROM role_navigation_permissions src
JOIN navigation_items src_ni ON src_ni.id = src.navigation_item_id
WHERE src_ni.url IN ('/apps/shift-productivity','/apps/standard-work')
GROUP BY src.role_id
ON CONFLICT (role_id, navigation_item_id) DO UPDATE SET visible = EXCLUDED.visible;
```

Followed by a `DO $$ … $$` assertion that fails the migration if any role with `visible=true` on Shift Productivity or Standard Work doesn't end up with `visible=true` on Production Boards. Future-proof for any role added later.

### Final visibility map

| role | visible |
| --- | --- |
| superadmin | true |
| admin | true |
| manager | true |
| master_trainer | true |
| tka_branchcoordinator | true |
| tka_supervisors | true |
| cashier | false |
| viewer | false |
| human_resources | false |
| tka_associate | false |

`tka_leaders` and `rolls_royce_assembly` have no rows for any nav items and continue to default to visible (matches existing convention).

## Why no `tab_permissions` rows were added

`tab_permissions` in this DB is a **view** over `tab_definitions`. The Production Boards page (`production-boards-page.tsx`) does not call `useTabPermissions(...)` — it's a single-pane view (TV mode is a `?tv=1` overlay, not a tab). So no rows in `tab_definitions` / `role_tab_permissions` are required.

## Why no new `permissions` row was added

Production Boards reuses `shift_productivity:view` (already exists at `05aaf939-039f-4adb-96ce-f6c0edd10c80`). Route-protection treats `resourcePermission` as supplementary on non-admin routes (see `src/lib/auth/route-protection.ts` lines 248–273) — only navigation visibility blocks access — so no `role_permissions` rows needed to be backfilled either.

## Verification

The exact frontend query now returns one row with `visible = true` for `role_id = 8e28f4a3-…`:

```sql
SELECT ni.id, ni.name, ni.title, ni.url, rnp.visible, rnp.role_id
FROM navigation_items ni
INNER JOIN role_navigation_permissions rnp ON rnp.navigation_item_id = ni.id
WHERE rnp.role_id = '8e28f4a3-6c54-4273-ae2f-ca91c78cb1ef'
  AND ni.url = '/apps/production-boards';
-- → 1 row, visible = true ✅
```

## Advisor impact

`get_advisors` for both `security` (551 lints) and `performance` (1544 lints) returned the same pre-existing population. None of the items mention `production_boards`, the new UUID, `role_navigation_permissions`, or `navigation_items` as a *new* finding — every advisor that touches those tables (`unindexed_foreign_keys`, `auth_rls_initplan`, `unused_index`, `duplicate_index`) is on RLS policies / indexes that pre-date this change.

## Lessons

- **Always apply migrations via Supabase MCP `apply_migration`** so they land in `supabase_migrations.schema_migrations` and fresh-clone devs reproduce the same state.
- **`role_navigation_permissions` PK is `(role_id, navigation_item_id)`.** New migrations must use that as the `ON CONFLICT` target — the legacy `(role, navigation_item_id)` shape cannot match a unique constraint after `fix_role_navigation_permissions_primary_key`.
- When seeding role permissions, **don't hardcode the canonical 5-enum role list**; derive from existing visibility rows so custom roles inherit the correct visibility automatically.

## Related

- [[ProductionBoards - Feature Module]]
- [[Implement-Production-Boards-Hourly-Grid]]
- [[ShiftProductivity - Feature Module]]
- [[2026-05-10]]
