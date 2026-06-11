---
tags: [type/debug, status/fixed, domain/frontend, domain/dx]
created: 2026-05-24
---

# Fix — OmniBelt Bootstrap Unreachable Backend (DX flood)

## Symptom

Local dev: `pnpm dev` running (Vite frontend on `:5173`), but the
FastAPI backend on `:8000` was NOT running (`python start.py` not
launched). The Vite HTTP proxy at `/api/*` flooded the terminal:

```
9:35:27 AM [vite] http proxy error: /api/omnibelt/bootstrap
AggregateError [ECONNREFUSED]:
    at internalConnectMultiple (node:net:1193:18)
    at afterConnectMultiple (node:net:1783:7)
... (x16 over ~7 minutes)
9:41:33 AM [vite] http proxy error: /api/admin/omnibelt/role-config
AggregateError [ECONNREFUSED]:
    ... (x3)
```

Not a fatal bug — backend just wasn't started — but UX was
"noisy failure cascade": dev console flooded, TanStack Query kept
retrying, and the OmniBelt launcher entered a degraded state where
every HMR cycle re-fired the retry storm.

## Root cause

Three interacting issues in `useOmnibeltBootstrap` + the admin
mutation hooks:

1. **No retry differentiation.** `retry: 1` retried EVERY failure
   class — auth (401/403), validation (422), AND transient network.
   Each retry is a real attempt, and TanStack's default `retryDelay`
   is an exponential `Math.min(30_000, 1000 * 2 ** failureCount)`,
   so each lifecycle = 1 + 1 = 2 wasted hits on a dead backend.
2. **No placeholder.** Without `placeholderData`, downstream
   consumers (`useResolvedTools`, the Pill skin) had `bootstrap.data
   === undefined` for the whole error window and the launcher
   degraded visibly. Combined with HMR + StrictMode double-render +
   `useOmnibeltConfigInvalidator` re-mounts, the bootstrap query
   re-fired on every code save.
3. **No circuit breaker.** No upper bound on per-session retry
   volume. The 16 retries in 7 min came from N consumer re-mounts ×
   2 attempts/mount, with no awareness of "the backend has been down
   for the last 6 attempts; stop trying".

Bonus: admin mutation hooks (`useUpdateKillSwitch`,
`useUpdateAllowList`, `useUpdateRoleConfig`) had no `retry: 0` cap
and no toast on error — clicks against a dead backend silently
spun, then rolled back optimistic state with only a `logger.warn`.

Also exposed a pre-existing bug in `useResolvedTools`: line 90 read
```ts
const allowSet = allowList ? new Set(allowList) : null
```
which treats `[]` as truthy and filters EVERY tool. The Rust
bootstrap returns `allow_list: []` when no setting row exists, with
the documented intent "FE treats `[]` as no restriction"
(`rust-dashboard-service/src/omnibelt.rs` line 292). The FE
semantics drifted out of sync.

## Fix

Six surgical, additive edits:

1. **`src/features/omnibelt/lib/bootstrap-errors.ts` (NEW).** Typed
   errors (`BootstrapNetworkError`, `BootstrapAuthError`,
   `BootstrapValidationError`), `classifyResponse(resp)` helper, and
   duck-type predicates (`isNetworkError`, `isAuthError`,
   `isValidationError`) that also recognise legacy plain `Error`
   messages thrown by `omnibeltAdminService` (avoids a service-layer
   refactor for this DX-scoped fix).

2. **`src/features/omnibelt/hooks/useOmnibeltBootstrap.ts`.**
    - Classify every failure path in `fetchOmnibeltBootstrap` —
      `TypeError('Failed to fetch')` → `BootstrapNetworkError`;
      `!resp.ok` → `classifyResponse(resp)`; JSON parse failures →
      `BootstrapValidationError`.
    - `retry` is now a predicate that returns `false` for auth +
      validation errors and `failureCount < 1` for network errors
      (= max 2 attempts ever).
    - `retryDelay: (attempt) => Math.min(30_000, 1000 * 2 ** attempt)`
      explicit (was inherited from global default).
    - `placeholderData: OMNIBELT_BOOTSTRAP_PLACEHOLDER` (frozen
      singleton) so the launcher renders the v1 tool roster on first
      paint regardless of backend state.
    - Module-level circuit breaker — 3 consecutive
      `BootstrapNetworkError`s trip a 5-min cooldown; while open,
      `enabled: false` (via `useSyncExternalStore` snapshot) so
      every consumer skips its fetch path. Auto-resumes via
      `setTimeout`.
    - Logging dedup: `warnedThisCycle` boolean fires the actionable
      "start FastAPI at :8000" warn ONCE per cooldown, plus one warn
      on the OPEN transition and one `info` on close + half-open.
    - Test-only exits: `__resetBootstrapCircuitBreakerForTests`,
      `__recordBootstrapFailureForTests`,
      `__isBootstrapCircuitOpenForTests`.

3. **`src/features/omnibelt/tools/use-resolved-tools.ts`.** One-line
   fix: `allowList && allowList.length > 0 ? new Set(...) : null`.
   Matches the Rust contract and unblocks the bootstrap placeholder.

4. **`src/features/admin/omnibelt-dashboard/hooks/useUpdateKillSwitch.ts`.**
   `retry: 0` + `toast.error` branching on `isNetworkError` /
   `isAuthError`. Optimistic rollback preserved.

5. **`src/features/admin/omnibelt-dashboard/hooks/useUpdateAllowList.ts`.**
   Same shape. Supabase-side RLS denials surface as 401/403 in the
   error message which `isAuthError` regex catches.

6. **`src/features/admin/omnibelt-dashboard/hooks/useUpdateRoleConfig.ts`.**
   Same shape.

## Retry budget — before vs after

| Surface | Before | After |
|---|---|---|
| Bootstrap (single mount, network error) | 2 attempts (1 + 1 retry) | 2 attempts |
| Bootstrap (auth/validation error) | 2 attempts (1 + 1 retry) | 1 attempt (retry short-circuits) |
| Bootstrap (per-session ceiling) | unbounded — every remount + every invalidation = fresh 2 | hard cap: 2 per mount until breaker trips; after 3 cumulative network failures, ALL fetches paused 5 min |
| Admin mutation (any failure) | 1 attempt (`retry` falls through to global default which is conditional) | 1 attempt (explicit `retry: 0`) |

## Log spam — before vs after

| Scenario | Before | After |
|---|---|---|
| First failure | `console.error` from TanStack default | `logger.warn` once with actionable message |
| 16 retries over 7 min | 16 per-retry `error` lines + 16 `[vite] http proxy error` | 1 actionable warn + 1 "circuit OPEN" warn + 0 additional fetches after trip (proxy logs go quiet because no requests fire) |
| Per-cooldown cycle | n/a | exactly 1 warn — clears + re-warns ONLY when the breaker closes and re-opens |
| Admin click failure | silent (`logger.warn` only) | `toast.error('OmniBelt backend unreachable. Start the FastAPI server on :8000.')` |

Vite's `http proxy error` lines are emitted by Vite itself for every
upstream request that the proxy can't reach; we can't suppress them
without touching the proxy config (out of scope). What the fix DOES
guarantee is that the FE makes far fewer such requests, so the Vite
line count tracks the FE call volume — a tripped circuit produces
zero new requests for the 5-min cooldown.

## Verification

```bash
cd /Users/jaisingh/Documents/Projects/OneBoxFullStack
pnpm tsc -b                          # clean
pnpm vitest run src/features/omnibelt src/features/admin/omnibelt-dashboard
# 29 files, 389 passed (was 380 → +9 new)
pnpm build                           # clean
```

Manual smoke (without starting the backend) — confirmed by
inspecting the changed code:

1. With placeholder + the `allow_list: []` fix in `useResolvedTools`,
   the launcher renders the v1 tool roster on first mount even when
   bootstrap is errored. The Pill skin's `useResolvedTools`
   tolerates `bootstrap.data === undefined` via optional chaining,
   so the host chrome is stable.
2. Three consecutive network failures (verified directly in
   `useOmnibeltBootstrap.test.tsx > circuit-breaker primitive >
   trips OPEN on the 3rd consecutive failure`) flip the breaker;
   subsequent hook mounts skip the queryFn entirely (verified by
   the `disables the bootstrap query while the circuit is OPEN`
   test asserting `fetchMock` is never invoked when
   `__isBootstrapCircuitOpenForTests()` returns `true`).

## Pattern reference

Mirrors [[Realtime-Presence-Browser-Hardening]] §Layer 2 (local
channel-error circuit breaker) but sized for the bootstrap-query
workload:

| Tunable | Presence default | Bootstrap (here) | Why different |
|---|---|---|---|
| Error window | 60 s rolling | "consecutive" (no window) | Bootstrap fires far less frequently than presence; consecutive failures are a better signal of "backend down" than rate. |
| Trip threshold | 3 errors in window | 3 consecutive | Same magnitude; bootstrap is single-shot per mount so the "in window" qualifier doesn't add value. |
| Cooldown | 5 min initial, exponential up to 30 min | 5 min flat | Bootstrap has a WS invalidator pathway; a long cooldown would leave the launcher stale longer than needed for the dev-loop use case. |
| Reset on success | 60 s stable connection | Immediate (first success after half-open) | Bootstrap success is a stronger signal than presence-channel `SUBSCRIBED` (which can flap during reconnect storms). |
| Stable jitter | 250 ms per-tab | none | Bootstrap is HTTP, not Realtime; no shard contention to spread. |

## Recommended follow-up

- **Document local-dev startup in README.** Add a "Required for full
  functionality" callout to the README and / or repository developer guide:
  ```
  - pnpm dev          # Frontend (port 5173)
  - python start.py   # Backend (port 8000) — without this the
                      # OmniBelt launcher renders in degraded mode
                      # but is fully usable; mutations toast a
                      # backend-unreachable message.
  ```
  This is the cheapest way to prevent the next dev from spending
  10 minutes diagnosing the same flood. Not done in this fix to
  keep the diff surgical.

- **Migrate `omnibeltAdminService` thrown errors to typed throws.**
  Currently `setKillSwitch` / `saveRoleConfig` throw
  `new Error('Kill-switch write failed: ${status} ...')`; the
  toast predicates rely on regex matches. A future cleanup pass
  could swap to `throw await classifyResponse(resp)` at the
  service layer and remove the regex fallbacks in
  `bootstrap-errors.ts`. Out of scope for this fix.

## Related

- [[Realtime-Presence-Browser-Hardening]] — the circuit-breaker
  pattern we mirror here.
- [[Implementations/Implement-OmniBelt-MVP]] — root implementation
  log; "Lessons" entry updated.
- [[ADR-Scaling-Roadmap-To-100k-Concurrent]] — bootstrap query
  budget framework.
- `docs/superpowers/specs/2026-05-24-omnibelt-design.md` §13 (kill
  switch layers — fail-closed posture this resilience reinforces)
  + §15 (cache budget).
