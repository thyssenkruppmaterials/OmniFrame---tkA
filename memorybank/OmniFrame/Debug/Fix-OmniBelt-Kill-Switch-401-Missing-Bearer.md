---
tags: [type/debug, status/active, domain/frontend, domain/auth]
created: 2026-05-24
---
# Fix: OmniBelt kill-switch 401 — frontend wasn't sending the Bearer header

## Symptom
Production console:
```
GET  /api/omnibelt/bootstrap          → 401
POST /api/admin/omnibelt/kill-switch  → 401 {"detail":"Authentication required"}
[OmniBeltAdmin] kill-switch mutation failed
```

User couldn't toggle the master kill-switch. Bootstrap also failing, falling back to placeholder.

## Root cause
All three OmniBelt FastAPI callsites used:
```ts
fetch(url, { credentials: 'include', ... })
```

`credentials: 'include'` sends **cookies**, not the Supabase access token. FastAPI's `get_current_user` dependency (the chain behind `require_omnibelt_admin`) reads the JWT from the `Authorization: Bearer <token>` header — there is no cookie path. Locally everything appeared to work because the dev Vite proxy talks to a backend that may have had `ALLOW_INSECURE_JWT_FALLBACK=true`. Production rejects every call.

A stale comment in `omnibelt-admin.service.ts` even claimed:
```
// Bearer token is carried automatically because the proxy uses session
// cookies plus the supabase-js access token; the browser includes credentials.
```
This was never true — Supabase tokens live in localStorage (`sb-<project>-auth-token`), not cookies.

## Fix
Added shared helper `src/lib/api/auth-fetch.ts`:
- `getApiAccessToken()` — reads `supabase.auth.getSession()`, falls back to `refreshSession()` for expired tokens.
- `apiFetch(url, options)` — wraps `fetch` with `Authorization: Bearer <token>` + `Content-Type: application/json`. Preserves caller's headers/body/method.

Migrated all three callsites:
1. `src/features/omnibelt/hooks/useOmnibeltBootstrap.ts` — bootstrap GET
2. `src/features/admin/omnibelt-dashboard/services/omnibelt-admin.service.ts` `setKillSwitch` — POST kill-switch
3. Same file — `saveRoleConfig` POST role-config

Pattern mirrors `src/features/admin/sap-testing/utils/auth-fetch.ts` (which was the canonical example) and the work-service clients (`dispatch.client.ts`, `notifications.client.ts`). Future `/api/*` fetches should pull from `@/lib/api/auth-fetch`.

## Verification
- `pnpm vitest run src/features/omnibelt src/features/admin/omnibelt-dashboard` — **389 / 389 passing**. Test mocks updated to stub `supabase.auth.getSession` (`useUpdateKillSwitch.test.tsx`, `useOmnibeltBootstrap.test.tsx`).
- `pnpm lint:check` — 0 errors, no new omnibelt warnings.
- `pnpm build` — clean. `feature-omnibelt` chunk size unchanged.

## Why "credentials: 'include'" was wrong here
Two unrelated browser-auth paths:
1. **Cookie session** — `credentials: 'include'` causes browsers to attach the `Cookie` header on cross-origin requests. Useful for sites that use server-set HTTP-only session cookies (Rails, Django sessions). OmniFrame backend does NOT use cookie sessions.
2. **Bearer token** — explicit `Authorization` header. This is what Supabase Auth + FastAPI's `get_current_user` use. Must be attached manually because `fetch` does not auto-promote localStorage tokens.

`credentials: 'include'` does NOT magically translate a Supabase localStorage token into the Authorization header.

## Where else this pattern exists (kept intentionally for migration)
Still using local copies of the same auth-fetch helper — migrate opportunistically to the shared `@/lib/api/auth-fetch`:
- `src/features/admin/sap-testing/utils/auth-fetch.ts` (`sapFetch`)
- `src/features/admin/system-settings/services/railway-monitoring.service.ts`
- `src/features/admin/onboarding/services/onboarding.service.ts`
- `src/features/user-management/services/user-management.service.ts`
- `src/lib/work-service/dispatch.client.ts`
- `src/lib/work-service/notifications.client.ts`
- `src/lib/work-service/sap-agents-client.ts`

## Related
- [[Implement-OmniBelt-MVP]]
- [[Fix-OmniBelt-Halo-Wrapper-Blocks-Pill-Drag]]
- [[ADR-OmniBelt-Site-Chrome]]
- [[ADR-Auth-Architecture]]
