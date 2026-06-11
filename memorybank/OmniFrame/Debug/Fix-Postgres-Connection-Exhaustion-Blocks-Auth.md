---
tags: [type/debug, status/active, domain/auth, domain/database, domain/infra, domain/backend]
created: 2026-05-11
---

# Fix — Postgres connection exhaustion blocks Supabase Auth (login + admin password reset)

## Symptom

User reports: "I can't login to admin@j.ai. Tried password reset, it shows `Error: [object Object]` in the console."

Frontend stack from the report:

```
installHook.js:1 Error resetting password: Error: [object Object]
    at l.resetPassword (use-user-management-dlBuO7WP.js:9:5041)
```

Observed in production 2026-05-11 ~20:13–20:21 UTC. The visible "`[object Object]`" string is a frontend bug masking the real error: at the same wall-clock time the Supabase Auth service was returning `500 Internal Server Error` on every auth path (`/token`, `/logout`, `/user`, `PUT /admin/users/{id}`).

## Root cause

**Supabase Postgres ran out of non-superuser connection slots.** When a non-superuser (`supabase_auth_admin`) tries to connect after the cap fills, Postgres responds:

```
FATAL: remaining connection slots are reserved for roles with the SUPERUSER attribute
(SQLSTATE 53300)
```

The Supabase Auth service is NOT a Postgres superuser, so it cannot reach into the 3 reserved superuser slots. Once the 117 non-superuser slots fill, **the Auth service is unable to query its own database** — it can't look up users, refresh tokens, validate sessions, or apply admin updates. Every auth path 500s.

### Connection budget on this Supabase project

| Setting | Value |
|---|---|
| `max_connections` | 120 |
| `superuser_reserved_connections` | 3 |
| Slots available to non-superusers (incl. `supabase_auth_admin`) | 117 |

### Top consumers observed at the time of the incident

| Consumer | Idle conns | Notes |
|---|---|---|
| `rust-core-service` (postgres user, no app_name, IP `34.12.19.157`) | 33–39 | Pool default `max_connections = 100` per replica, no env override (see `rust-core-service/src/db/pool.rs:26`). |
| `rust-work-service-listener` (IP `208.77.244.108`) | 24 | Long-lived `LISTEN` connections, 29h+ uptime — by design (one per resilient `PgListener`). Eats slots even though it's not a leak. See [[Implementations/Implement-Resilient-PgListener]]. |
| PostgREST (`authenticator`, `::1`) | 19 | Built-in. |
| Supavisor pool (port 5432 session mode) | 14 | Used by `rust-work-service`'s general pool. See [[Implementations/Implement-Rust-Work-Service-PgBouncer-Pooler]]. |
| Supabase realtime / pg_cron / pg_net / postgres_exporter | ~14 | Built-in services. |

Total at peak: **~121 connections — over the cap**. Once that happens, every new `supabase_auth_admin` connect attempt 500s with SQLSTATE 53300.

### Auth log evidence (last 30 min before triage)

- 49 of 100 most-recent `supabase_auth_admin` log rows were 500 errors with `connection slots` in the error message.
- Affected paths: `POST /token` (login + refresh_token), `POST /logout`, `GET /user`, **`PUT /admin/users/8fe94172-0267-4b14-96bd-06f8691bb04c`** — that last one is the admin@j.ai password-reset write that triggered the user-visible "[object Object]".

## Frontend display bug (secondary)

The "[object Object]" message is unrelated to the auth outage but it hid the real error. Two pieces have to line up:

```45:51:api/utils/error_responses.py
    return HTTPException(
        status_code=status_code,
        detail={
            "error": public_message,
            "correlation_id": correlation_id,
        },
    )
```

```506:513:src/features/user-management/services/user-management.service.ts
      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: 'Failed to reset password' }))
        throw new Error(
          errorData.detail || `HTTP ${response.status}: ${response.statusText}`
        )
      }
```

`sanitized_error()` always returns `detail` as an **object** (`{error, correlation_id}`). The frontend assumes `errorData.detail` is a string and feeds it to `new Error(...)`, which stringifies the object to the literal text `"[object Object]"`. The real backend message + correlation ID never reach the toast.

Not fixed in this incident (user opted for triage-only). Tracked as a follow-up below.

## Triage actually applied (2026-05-11 ~20:27 UTC)

Killed stale idle connections from `rust-core-service` to free non-superuser slots so Supabase Auth can connect again:

```sql
WITH terminated AS (
  SELECT pid, pg_terminate_backend(pid) AS killed
  FROM pg_stat_activity
  WHERE usename = 'postgres'
    AND application_name = ''
    AND client_addr = '34.12.19.157'
    AND state = 'idle'
    AND state_change < now() - interval '5 seconds'
)
SELECT count(*) FILTER (WHERE killed) AS confirmed_killed FROM terminated;
```

- Filter on `state = 'idle' AND state_change < now() - interval '5 seconds'` is the safety guard — never terminate a connection mid-query, never pull the rug out from under a connection that just went idle.
- `pg_stat_activity` filter `application_name = ''` is what isolates `rust-core-service` direct connections from Supavisor / PostgREST / listener pools, all of which have non-empty `application_name`.
- Running this terminates only sqlx-pool-cached idle connections; `rust-core-service` will lazily re-open them on the next request via `PgPoolOptions::min_connections(10)` + lazy growth up to its current 100 cap.

Result: 14 connections terminated. Total `pg_stat_activity` rows dropped from 118 → 81. `supabase_auth_admin` resumed normal operation; latest auth log entries (T+1m) all 200 OK.

## Permanent mitigation (NOT applied — owner deferred to Railway env change)

The trigger is `rust-core-service` advertising `max_connections = 100` per replica. Two replicas alone (one warm, one rolling) can fully saturate the cap without any other service running.

Options, ranked by blast radius:

1. **Set `DB_MAX_CONNECTIONS` on `rust-core-service` in Railway.** The crate already reads it (`rust-core-service/src/config/database.rs:67`). Recommended target: **30** for a 1-replica deployment (gives 3-4× headroom for spikes), **20** if running 2+ replicas. This is the lowest-effort fix and is what should ship next.
2. Route `rust-core-service`'s general pool through Supavisor session mode (port 5432) the same way `rust-work-service` does (see [[Implementations/Implement-Rust-Work-Service-PgBouncer-Pooler]]). Caveat: still consumes upstream slots in session mode; only useful if combined with smaller per-replica pools.
3. Ask Supabase support to raise `max_connections` on the project — paid tiers permit 200/400/etc. Long-term scaling answer but doesn't fix the underlying "one service can monopolise the entire instance" risk.

## Detection / monitoring

Add to the existing infra-health checklist (NOT yet wired up):

```sql
SELECT count(*) AS total,
       117 - count(*) FILTER (WHERE usename != 'supabase_admin') AS auth_headroom
FROM pg_stat_activity;
```

Alert when `auth_headroom < 20`. (`supabase_auth_admin` itself runs as a regular role, NOT `supabase_admin`, so it competes for the same pool as PostgREST + the Rust services.)

## Why this looks like the 2026-05-06 realtime incident but isn't

The 2026-05-06 incident (see [[Decisions/ADR-Presence-Architecture-Next-Steps]] and the [[Master Rule]] realtime policy) was: realtime workers wedged → tenant `c9d89a74` couldn't sign in → org-wide auth break. Same **shape** (auth blocked by infra resource exhaustion), different **cause** (realtime worker saturation vs Postgres connection saturation). The migration template defined in that ADR (browser → `rust-work-service /ws` → Postgres LISTEN/NOTIFY) is still the right architectural answer for *that* class of failure. This incident is a separate, additive risk that the realtime migration doesn't address.

## Open follow-ups

**All four landed in the 2026-05-11 evening pass (~19:15 UTC).** Cross-cuts logged in [[Sessions/2026-05-11]] § "Connection-exhaustion follow-up pass".

- [x] **Set `DB_MAX_CONNECTIONS=30` on `rust-core-service` in Railway.** Set via Railway MCP at 19:16 UTC. Auto-triggered redeploy (`5721ed49-efbb-478a-ae44-c7cb725e8178`). Once it lands, the per-replica cap drops from 100 → 30 and a single warm-replica pool can no longer monopolise the DB.
- [x] **Fix the `[object Object]` frontend bug.** All four call sites (`createUser`, `inviteUser`, `resetPassword`, `resendInvitation`) in `src/features/user-management/services/user-management.service.ts` now go through a new `extractApiErrorMessage(response, fallback)` helper at module scope. The helper handles all three FastAPI `detail` shapes — string (legacy `HTTPException`), object (`sanitized_error` → `{error, correlation_id}`), and array (Pydantic 422) — and appends `(id: <correlation_id>)` to the message when present, so support can grep server logs by ID.
- [x] **`auth_headroom` health probe.** Added `GET /health/db-connections` to `api/main.py`. Uses the existing asyncpg pool (`api/config/connection_pool.py`) so it doesn't open new slots when working. Returns `{status, max_connections, total_connections, non_superuser_connections, auth_headroom, thresholds}`. Status is `healthy` (>=30 free), `degraded` (10–29), or `critical` (<10). Returns 200 with the JSON payload (alert on `status != healthy` from monitoring), or 503 only if the probe itself can't run.
- [x] **Audit other Rust services for default-100 pool size.** No additional risk — see findings table:

| Service | DB pool max | Configurable? | Notes |
|---|---|---|---|
| `rust-core-service` | 100 → **30** (env-set) | yes (`DB_MAX_CONNECTIONS`) | The one this whole incident was about. Now capped. |
| `rust-mdm-service` | 20 | hardcoded (`rust-mdm-service/src/state.rs:29`) | Low risk. |
| `rust-ai-service` | 10 | hardcoded (`rust-ai-service/src/main.rs:64`) | Low risk. |
| `rust-dashboard-service` | 5 | hardcoded (`rust-dashboard-service/src/main.rs:82`) | Very low risk. |
| `rust-streaming-service` | n/a | n/a | No DB access at all (no `PgPool` / `max_connections` / `DATABASE_URL` references). |
| `rust-work-service` | 20 (general) + 30 (listener pool) | env-aware via `WORK_ENGINE_FLAG_OVERRIDES` | Already documented in [[Components/Rust-Work-Service]]. The 24 long-lived listener connections from this service are by design — see [[Implementations/Implement-Resilient-PgListener]]. |

## Related

- [[RustService - Core Service]] — service whose pool default triggered this.
- [[Components/Rust-Work-Service]] — owns the listener pool that takes 24 long-lived slots.
- [[Implementations/Implement-Resilient-PgListener]] — explains why those 24 slots are by design.
- [[Implementations/Implement-Rust-Work-Service-PgBouncer-Pooler]] — Supavisor session-mode template that `rust-core-service` should follow.
- [[Debug/Fix-Sqlx-Supavisor-Txn-Pool-Prepared-Statement-Collision]] — the OTHER pool-related foot-gun on this stack (sqlx 0.7 + txn-pool).
- [[Decisions/ADR-Presence-Architecture-Next-Steps]] — 2026-05-06 realtime incident (similar shape, different cause).
- [[Sessions/2026-05-11]] — session log for this triage.
