---
tags: [type/debug, status/active, domain/database, domain/backend]
created: 2026-05-24
---
# Fix: OmniBelt kill-switch 500 — settings RLS + anon-key client

## Symptom

Production admin clicked the master kill-switch toggle in
`/admin/omnibelt → Overview`. Request failed:

```text
POST /api/admin/omnibelt/kill-switch  HTTP/1.1 500
{"detail":"kill-switch write failed: {'message': 'new row violates
row-level security policy for table \"settings\"', 'code': '42501',
'hint': None, 'details': None}"}
```

FastAPI server logs (Railway terminal 11):

```text
POST https://wncpqxwmbxjgxvrpcake.supabase.co/rest/v1/settings
  → HTTP/2 401 Unauthorized
[OmniBelt] kill-switch write failed: {'message':
  'new row violates row-level security policy for table "settings"',
  'code': '42501', ...}
```

Postgres `42501` (insufficient_privilege) returned by an RLS policy
check. PostgREST surfaced it as HTTP 401 because the request reached
the DB as the `anon` role — see root cause below.

## Root cause (TWO bugs, one symptom)

### Bug 1: `db.client` is the anon-key singleton — not user-scoped

The handler in `api/routers/omnibelt.py::write_kill_switch` was
upserting via `db.client`:

```python
db.client.table("settings").insert(
    {"key": "system.omnibelt.enabled", "value": body}
).execute()
```

`db.client` is a process-wide singleton created in
`api/config/database.py::SupabaseConnection.client` with
`settings.supabase_anon_key`. The user's JWT is **never** propagated
to it. Every write through `db.client` reaches PostgREST as the
`anon` role, which means inside RLS:

- `auth.uid()` → `NULL`
- `get_user_role()` → `NULL`
- `has_permission(NULL, ...)` → `false`
- `has_permission('omnibelt','manage')` (no-uuid form, reads
  `auth.uid()` internally) → `false`

Verified empirically against Supabase:

```sql
BEGIN;
SET LOCAL ROLE anon;
INSERT INTO public.settings (key, value)
VALUES ('system.omnibelt.enabled', '{"enabled":false}'::jsonb);
-- ERROR: 42501: new row violates row-level security policy for table
-- "settings"
ROLLBACK;
```

This is the proximate cause of every kill-switch / role-config write
failure. Same applies to `omnibelt_role_config_mutate` writes through
the role-config admin endpoint, and to the `omnibelt_user_prefs_self`
+ `omnibelt_events_insert_self` writes from the user-router endpoints
(those just hadn't been exercised end-to-end yet — vitest mocks
bypass FastAPI entirely).

### Bug 2: settings RLS doesn't acknowledge `omnibelt.manage`

Even once JWT propagation is fixed, the existing `settings` RLS
relies on the legacy `admin` / `superadmin` enum or the legacy
`settings:manage` / `manage:system` permission strings:

```sql
-- "Admins can manage system-wide settings":
USING/CHECK: user_id IS NULL AND (
    get_user_role() = ANY (ARRAY['superadmin','admin']::user_role[])
    OR has_permission(auth.uid(), 'settings:manage')
    OR has_permission(auth.uid(), 'manage:system')
)
```

It has **no clause for the modern `omnibelt.manage` resource/action
grant** seeded in migration 327. Today the legacy admin enum check
already covers admin/superadmin (the only roles holding
`omnibelt.manage`), so this is technically not the immediate blocker
— but a future custom role with `omnibelt.manage` and no
`admin`/`superadmin` enum value would still 42501. Closing that gap
is the migration-329 part of the fix.

## Fix

### Migration 329 — additive RLS policy

File: `supabase/migrations/329_omnibelt_settings_rls.sql` (applied
via Supabase MCP `apply_migration` → `omnibelt_settings_rls`,
`{"success":true}`).

```sql
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
  WITH CHECK (...same shape);
NOTIFY pgrst, 'reload schema';
```

Deviations from the original sketch the user supplied:

- Added `user_id IS NULL` — settings.user_id can be set for per-user
  rows; we explicitly exclude that branch from this admin policy.
- Added `organization_id IS NULL OR organization_id IN (...)` — the
  kill-switch row is **global** (one row per cluster, both NULL per
  spec §4.3). The original sketch only covered org-scoped rows and
  would not have admitted the kill-switch row. The new shape covers
  both global (kill-switch, allow-list) and any future org-scoped
  omnibelt setting.
- Existing settings policies untouched (per the user's directive).

Verified:

```sql
SELECT polname FROM pg_policy
WHERE polrelid = 'public.settings'::regclass
  AND polname LIKE '%omnibelt%';
-- → settings_omnibelt_admin_rw
```

### Backend — propagate the user's JWT to the writes

File: `api/routers/omnibelt.py`. Added a small helper:

```python
def _jwt_from_request(request: Request) -> Optional[str]:
    bearer = _bearer_from_request(request)
    if not bearer:
        return None
    parts = bearer.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip() or None
    return bearer.strip() or None


def _user_scoped_client(request: Request):
    token = _jwt_from_request(request)
    if not token:
        return db.client
    return create_authenticated_supabase_client(token)
```

`create_authenticated_supabase_client` already lived in
`api/auth/supabase_client_auth.py` (it sets both the
`Authorization: Bearer <jwt>` header and calls
`client.postgrest.auth(jwt)` so PostgREST resolves `auth.uid()` to
the real user). We just hadn't been using it.

Updated handlers to take `request: Request` and route writes through
`_user_scoped_client(request)`:

- `POST /api/admin/omnibelt/kill-switch` — fixes the user-reported
  bug.
- `POST /api/admin/omnibelt/role-config` — fixes the same latent bug
  in the adjacent admin endpoint (was failing for identical reasons,
  just hadn't been exercised in production yet).

Left alone for now (same root cause, lower urgency, not in the
user's task scope):

- `POST /api/omnibelt/prefs` — RLS gate `user_id = auth.uid()` would
  fail under anon. Surfaced as a follow-up.
- `POST /api/omnibelt/events` — same, telemetry insert. Surfaced as a
  follow-up.

The bootstrap proxy (`GET /api/omnibelt/bootstrap`) already forwards
the Bearer header verbatim to `rust-dashboard-service` and the
fallback path uses `db.read_client` against rows visible to anon
(`user_id IS NULL`), so it was unaffected.

## Verification

### Pre-fix repro (anon, what `db.client` runs as)

```sql
BEGIN;
SET LOCAL ROLE anon;
INSERT INTO public.settings (key, value)
  VALUES ('system.omnibelt.enabled', '{"enabled":false}'::jsonb);
-- ERROR:  42501: new row violates row-level security policy for
-- table "settings"
ROLLBACK;
```

Matches the production 500 exactly.

### Post-fix simulation (admin@j.ai, JWT-propagated)

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"8fe94172-0267-4b14-96bd-06f8691bb04c","role":"authenticated"}';
SELECT auth.uid(), public.has_permission('omnibelt','manage');
--   → 8fe94172-0267-4b14-96bd-06f8691bb04c | true
INSERT INTO public.settings (key, value)
  VALUES ('system.omnibelt.enabled', '{"enabled":false}'::jsonb)
RETURNING id, key, organization_id, user_id;
--   → 0372519d-…  | system.omnibelt.enabled | NULL | NULL
ROLLBACK;
```

Kill-switch INSERT succeeds. Same simulation against
`omnibelt_role_config` also succeeds (the `omnibelt_role_config_mutate`
policy from migration 327 was already correctly shaped — it only
needed the JWT to actually arrive).

### Negative test (non-admin user, JWT-propagated)

```sql
-- tka_associate user, has 'settings:manage' but NOT 'omnibelt.manage'
SET LOCAL request.jwt.claims TO
  '{"sub":"7663fb92-8e62-4278-8eb5-a18084f56ab6","role":"authenticated"}';
SELECT public.has_permission('omnibelt','manage');
--   → false
```

The new `settings_omnibelt_admin_rw` policy correctly denies them.

**Side observation (not in scope, surfaced for follow-up):** the
existing `settings:manage` permission appears to be granted to
`tka_associate` (likely seed-data drift), and the legacy
"Admins can manage system-wide settings" policy admits anyone with
that grant — i.e. a non-admin can technically write
`system.toast_notifications` and other system rows today. Our new
policy isn't broader than that (we explicitly require
`has_permission('omnibelt','manage')`), but the pre-existing
over-grant deserves a separate audit.

### End-to-end

Could not exercise the live UI here — `user-Playwright` MCP is not
registered in this environment. The user should retry the kill-switch
toggle once `python start.py` (or the Railway redeploy of
`onebox-ai-logistics`) picks up the new code.

### Post-deploy validation (2026-05-24, 5:32 PM follow-up)

After the second deploy (see "Bug 3" below), the production logs
confirmed both endpoints recovered:

```text
21:30:55  POST /api/admin/omnibelt/kill-switch  HTTP/1.1 200 OK
21:31:48  POST /api/admin/omnibelt/role-config  HTTP/1.1 200 OK
21:31:52  POST /api/admin/omnibelt/role-config  HTTP/1.1 200 OK
PostgREST POST /rest/v1/omnibelt_role_config   HTTP/2 201 Created
```

And the DB row landed (verified via Supabase MCP):

```sql
SELECT id, value, updated_at FROM public.settings
WHERE key='system.omnibelt.enabled' AND user_id IS NULL
ORDER BY updated_at DESC LIMIT 1;
-- → 061e2e5c-…  {"enabled": true}  2026-05-24 21:32:02.550588+00
```

## Bug 3 (follow-up): `ClientOptions` API mismatch in supabase-py 2.x

After deploying the JWT-propagation fix (Bug 1), production STILL
returned 42501. Logs revealed a silent fallback to the anon singleton:

```text
21:18:06  api.auth.supabase_client_auth  ERROR
  Failed to create authenticated Supabase client:
  'ClientOptions' object has no attribute 'storage'
21:18:06  POST https://…/rest/v1/settings  HTTP/2 401 Unauthorized
21:18:06  [OmniBelt] kill-switch write failed: 42501
```

### Cause

`create_authenticated_supabase_client` was building a
`ClientOptions(headers=…, postgrest_client_timeout=10,
storage_client_timeout=10, schema='public')` and passing it to
`create_client(...)`. In supabase-py 2.x the constructor reads
`options.storage` (a `SyncStorageClient` instance), which our
kwargs-only construction does not populate. That `AttributeError` was
caught by the outer `try/except`, which then *returned an
unauthenticated anon client as a fallback*. From PostgREST's
perspective the request was indistinguishable from Bug 1 — same 401 +
42501. So Bug 1's fix looked applied but the user-scoped path was
silently downgrading to anon every time.

### Fix

Rewrote `api/auth/supabase_client_auth.py` to:

1. Drop `ClientOptions` entirely (the SDK provides no stable kwargs-
   only construction path in 2.x).
2. Create the bare client with anon key.
3. Call `client.postgrest.auth(jwt_token)` — the documented, supported
   way to attach a user JWT in v2.x. This adds
   `Authorization: Bearer <jwt>` to every PostgREST request, which is
   what RLS needs for `auth.uid()`.
4. **Re-raise** if `postgrest.auth(...)` fails, instead of silently
   falling back to anon. The whole point of this helper is the JWT
   bind — an anon fallback is worse than a clean 500 because it hides
   the real cause behind an RLS error.
5. Best-effort `client.auth.set_session(access_token=jwt, refresh_token='')`
   for any code that introspects `client.auth`. Not required for
   PostgREST writes.

### Lesson (added)

6. **Don't catch-and-fallback on auth client construction.** A silent
   downgrade from "user-scoped" to "anon" reproduces Bug 1 perfectly
   and is invisible unless you actively read the logs. If JWT binding
   fails, raise — the caller can decide whether to 500 or do something
   smarter. Defensive `except Exception` blocks in security-critical
   code paths are anti-patterns.

### Deployment gotcha (2026-05-24, 5:21 PM follow-up)

This fix required THREE coordinated changes — migration **329**, the
omnibelt router refactor to call `_user_scoped_client`, AND the
`supabase_client_auth.py` rewrite. The Python code changes need a
FastAPI restart/redeploy to take effect — Python doesn't hot-reload
unless you're running via `api/scripts/start_dev.py` (`--reload`) or
have a watcher. After the worktree edits, the user redeployed via
`railway up --service onebox-ai-logistics` from terminal 11 (and
terminal 922094 polled `Application startup complete` to confirm the
new instance was live). If you're debugging this same symptom in
future, the checklist is:

1. Migration 329 applied? (Supabase MCP:
   `SELECT polname FROM pg_policy WHERE polrelid='public.settings'::regclass AND polname='settings_omnibelt_admin_rw';`)
2. Latest `omnibelt.py` deployed? (Look for
   `_user_scoped_client` import line in `railway logs` startup banner
   or via the deployed source.)
3. Latest `supabase_client_auth.py` deployed? (Look for the absence of
   `'ClientOptions' object has no attribute 'storage'` errors during a
   write attempt — that error is the canary for the old binary.)
4. Did Railway actually accept the deploy and the health-check pass?
   (`railway logs --service onebox-ai-logistics | grep 'Application startup complete'`)

## Files touched

- `supabase/migrations/329_omnibelt_settings_rls.sql` (new)
- `api/routers/omnibelt.py` (added `_jwt_from_request` /
  `_user_scoped_client`; updated `write_kill_switch` +
  `write_role_config` to take `request: Request` and call the
  user-scoped client)
- `api/auth/supabase_client_auth.py` (Bug 3 follow-up — removed broken
  `ClientOptions` path, switched to `client.postgrest.auth(jwt)`,
  removed silent anon-fallback)
- `memorybank/OmniFrame/Debug/Fix-OmniBelt-Settings-RLS-Kill-Switch.md`
  (this note)
- `memorybank/OmniFrame/Implementations/Implement-OmniBelt-MVP.md`
  (post-launch fix entry)

Nothing in `src/` was changed — the frontend kill-switch path
(`useUpdateKillSwitch` → `apiFetch('/api/admin/omnibelt/kill-switch')`)
already attaches the Bearer token correctly per
[[Fix-OmniBelt-Kill-Switch-401-Missing-Bearer]]; only the server side
was dropping it.

## Lessons

1. **`db.client` is anon. Always.** No middleware re-binds the
   singleton to a per-request JWT. Any new write path that depends on
   `auth.uid()` for RLS must mint a fresh authed client via
   `create_authenticated_supabase_client(token)` (or
   `db.with_auth(token)`). Add this to the
   [[Patterns/...]] index when next touching auth-related backend.
2. **Vitest mocks ≠ production.** P9 closeout claimed "E2E verified"
   for OmniBelt, but the FastAPI write endpoints were only covered by
   mocked unit tests. The first real production click on the kill-
   switch surfaced this. Recommend adding a thin
   integration test in `api/tests/` (mode `infra`) that issues a real
   JWT against a live admin endpoint before the next big-bang
   feature ships.
3. **PostgREST 401 + body containing 42501** is specifically the
   "RLS denied an anon write" combo. Reading the body is what
   distinguishes it from a JWT signature failure.
4. **Migration 327 should have shipped this `settings` policy.**
   Adding it now (migration 329) is additive + defensive. Any future
   feature that writes its org-wide flags into the shared `settings`
   table needs to remember to extend that table's RLS, not just the
   feature-specific tables.
5. **`organization_id IS NULL` matters.** The kill-switch is global
   (one row per cluster); the user's original sketch policy required
   `org_id IN (...)` and would have silently failed to admit the
   kill-switch row. Always check the actual row shape before writing
   the policy.

## Related

- [[Implement-OmniBelt-MVP]] — post-launch fix entry
- [[Fix-OmniBelt-Kill-Switch-401-Missing-Bearer]] — frontend Bearer
  token fix (necessary precursor; without it the request never
  reached this RLS check)
- [[Fix-OmniBelt-Permission-Name-Dot-vs-Colon-403]] — adjacent
  permission-name fix (also a pre-flight gate before this RLS layer)
- [[Fix-OmniBelt-Bootstrap-Unreachable-Backend]] — same router,
  unrelated path
- [[ADR-OmniBelt-Site-Chrome]] — the spec under which this MVP was
  delivered
- [[ADR-Auth-Architecture]] — anon-vs-user-scoped client semantics
- Migration 327 (`omnibelt_core`) — original OmniBelt RLS bundle that
  should have included a `settings` policy
