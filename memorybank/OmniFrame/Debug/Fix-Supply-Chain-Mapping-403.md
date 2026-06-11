---
tags: [type/debug, status/active, domain/auth, domain/database]
created: 2026-06-11
---
# Fix: Supply Chain Mapping 403 on localhost

## Symptom
Loading the new `/admin/supply-chain-mapping` page redirected to **403** even for superadmin, while the sidebar item rendered fine.

## Root cause
`createProtectedRouteBeforeLoad` Step 3 (`src/lib/auth/route-protection.ts`) runs an INNER-join `.single()` query: `navigation_items` ⋈ `role_navigation_permissions` for `url = routePath`, and **fails closed** (→ `/403`) when zero rows exist. The new route had no `navigation_items` row at all. Same failure class as [[Fix-Production-Boards-403]].

Why the sidebar still showed it: `useNavigationPermissions.hasNavigationAccessByUrl` defaults to **visible** when no row exists (`permission?.visible ?? true`) — the menu check and route guard have opposite defaults for unregistered URLs.

## Remediation
Migration `337_add_supply_chain_mapping_navigation` (on-disk + applied to prod `wncpqxwmbxjgxvrpcake` via MCP `apply_migration`):
1. `navigation_items` row `e4b8c2d6-7a91-4f3e-8b5c-1d2a6f9e0c44` (`admin_supply_chain_mapping`, `/admin/supply-chain-mapping`, `IconTopologyStar3`, parent = Testing `2b4f9800-…`, position 9).
2. `role_navigation_permissions` backfill **derived from `/admin/device-manager`** (the sibling with the identical `manage/system` gate) rather than hardcoding the 5 enum roles — custom roles inherit automatically. `ON CONFLICT (role_id, navigation_item_id)` (the actual PK). Nav id resolved by URL subselect so STEP 1's `ON CONFLICT (name) DO NOTHING` can't desync it.
3. `DO $$` assertion fails the migration if any Device-Manager-visible role lacks visibility.

Verified with the exact frontend query: 10 roles seeded, superadmin + admin `visible = true`.

## Lesson
**Every new protected route needs a `navigation_items` + `role_navigation_permissions` migration** — frontend code alone always 403s. Add this to the definition-of-done for any new sidebar page. Derive role visibility from the closest sibling route, never the canonical enum list.

## Related
- [[Fix-Production-Boards-403]]
- [[Build-Supply-Chain-Mapping-3D]]
- [[RouteProtection - Navigation Security]]
