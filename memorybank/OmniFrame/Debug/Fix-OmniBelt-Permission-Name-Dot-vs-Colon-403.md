---
tags: [type/debug, status/active, domain/backend, domain/auth]
created: 2026-05-24
---
# Fix: OmniBelt 403 — permission name dot/colon mismatch

## Symptom
After fixing the missing-Bearer 401 (see [[Fix-OmniBelt-Kill-Switch-401-Missing-Bearer]]) the production server log showed:
```
POST /api/v1/auth/validate-with-profile "HTTP/1.1 200 OK"   ← JWT valid
POST /api/admin/omnibelt/kill-switch    "HTTP/1.1 403 Forbidden"
api.main - WARNING - Authentication/authorization failure: /api/admin/omnibelt/kill-switch from 23.112.225.64 - 403
```

User authenticated, JWT validated by rust-core, but the FastAPI permission check returned 403 — even for admins.

## Root cause
**Permission name delimiter inconsistency.**

- DB seed (`supabase/migrations/327_omnibelt_core.sql`):
  ```sql
  INSERT INTO public.permissions (name, ...) VALUES ('omnibelt.manage', ...)
  ```
  Stored as `'omnibelt.manage'` with a **dot**.
- Python guard (`api/routers/omnibelt.py:191`):
  ```py
  return require_permission("omnibelt:manage")  # ← COLON, typo
  ```

`require_permission(req)` does exact-string membership against `current_user.permissions` (a `list[str]` flattened from the role's grants). An admin's list contained `"omnibelt.manage"`; the guard scanned for `"omnibelt:manage"`. No match → 403.

The wildcard fallbacks didn't save it either:
- `"*"` — only superuser shortcut
- `"admin:*"` — admin's permission list doesn't contain this literal token
- Resource-wildcard branch synthesises `f"{resource}:*"` → `"omnibelt:*"`, which is not granted

## Codebase convention
Every other granular permission in this DB uses the **dot** form. Examples:
```
cubiscan.view
inbound_carts.create / .manage / .remove / .stow / .update / .view
omnibelt.manage
production_boards.edit
warehouse_maps.create / .delete / .manage / .update / .view
```

Colons are used for **wildcards** (`admin:*`, `resource:*`) and for the resource-wildcard fallback inside `require_permission`. Mixed convention, but consistent.

## Fix
One-line change in `api/routers/omnibelt.py`:
```py
return require_permission("omnibelt.manage")  # was "omnibelt:manage"
```
Plus cleaned the two doc-string mentions (lines 17, 23) so future readers don't get bitten again. Added a NOTE in the dependency factory's docstring explaining the convention.

Frontend route guard (`src/routes/_authenticated/admin/omnibelt/index.tsx`) uses `{ action: 'manage', resource: 'omnibelt' }` — that goes through the permission store which keys on `resource` + `action` separately, so it was always working. Only the backend was broken.

## Verification
- `python3 -c "import ast; ast.parse(open('api/routers/omnibelt.py').read())"` — syntax OK.
- `pnpm vitest run src/features/omnibelt src/features/admin/omnibelt-dashboard` — 389/389 passing.

## Why nobody caught this sooner
- Frontend admin route guard uses the separate-keys API, so navigating to `/admin/omnibelt` worked.
- The dashboard's read paths (`getKillSwitch`, `getRoleConfigs`, etc.) go through Supabase directly, gated by RLS — RLS uses the DB permission name (dot), so reads worked.
- Only the WRITE endpoints (`setKillSwitch`, `saveRoleConfig`) hit FastAPI's broken guard.
- Locally `ALLOW_INSECURE_JWT_FALLBACK=true` plus a wildcard-permission test user would have hidden it. Production has a real admin user with only the explicit grant.

## Related
- [[Implement-OmniBelt-MVP]]
- [[Fix-OmniBelt-Kill-Switch-401-Missing-Bearer]]
- [[ADR-Auth-Architecture]]
- DB convention: see `supabase/migrations/295_*.sql`, `supabase/migrations/205_create_cubiscan_platform.sql` for prior precedent.
