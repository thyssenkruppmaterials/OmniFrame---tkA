---
tags: [type/debug, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-19
---
# Performance Review — Production Slowness (2026-05-19)

## TL;DR — Smoking Gun

**Postgres connection pool is saturated.** `SELECT count(*) FROM pg_stat_activity` returned **121 connections out of a max of 120**. Every new request beyond that either queues on Supavisor or fails. This alone explains the user-reported slowness — but the deeper causes that produce so many in-flight connections are below.

Confirmed connection breakdown (live):
- `postgrest` — 37 idle
- `rust-work-service-listener` — 25 idle
- (empty / Supavisor pool) — 20 idle
- `Supavisor` — 13 idle
- `realtime_*` — 12 total
- Others — 14
- **Total: 121 / 120 max**

## Top contributors (P0 — fix first)

### 1. Hot PostgREST endpoints averaging 2-3 seconds per call
From `pg_stat_statements` (top by total_exec_time):
| avg ms | calls | total seconds | table |
|---:|---:|---:|---|
| 2,096 | 547,807 | 1,148,378 | `rf_putaway_operations` (full select w/ user joins) |
| 2,417 | 293,870 | 710,395 | `rf_putaway_operations` (variant) |
| 2,984 | 95,127 | 283,827 | `rr_cyclecount_data` (full select w/ joins) |
| 931 | 236,121 | 219,917 | `rr_cyclecount_data` (variant) |
| 2,036 | 59,848 | 121,864 | `rr_cyclecount_data` (third variant) |
| 1,848 | 63,308 | 116,995 | `rr_lx03_data` |

**~2.7 million CPU-seconds (~750 hours) of DB time concentrated in 6 PostgREST queries.** These are PostgREST calls from the frontend with `row_to_json` joins. Root cause is a combination of (a) per-row RLS evaluation (see #2), (b) full payload selects with multi-table user joins, (c) missing FK indexes.

Also seen in `rust-work-service` logs: `get_pending_cycle_counts` slow query warnings logged every ~5s, repeatedly >1 second.

### 2. 499 RLS `auth_rls_initplan` warnings
Every RLS policy that calls `auth.uid()` directly re-evaluates per row. With `audit_logs` at 211k rows, `session_activities` at 296k, `rr_all_deliveries` at 100k, `rf_putaway_operations` at 47k — this multiplies query cost by row count.

**Fix:** wrap every `auth.uid()` in `(SELECT auth.uid())` so Postgres caches it once per query. Same for `auth.jwt()`, `current_user`, etc. See https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

### 3. 413 `multiple_permissive_policies` warnings
Multiple permissive RLS policies on the same table fire on every query (all must be evaluated). Worst offenders: `rr_lx03_data` (8 policies), `time_clock_entries` (8), `grs_unknown_batches` (7), `user_profiles` (6), `overtime_signups` (6).

**Fix:** consolidate into one permissive policy per (role, action) with `OR`-ed conditions.

### 4. Redis is NOT running in production
`onebox-ai-logistics` deploy log on startup:
```
WARNING - ⚠️ Redis initialization failed (rate limiting disabled): attempted relative import beyond top-level package
ERROR - ❌ Redis connection failed: Error 111 connecting to localhost:6379. Connection refused.
```
- Rate limiting **disabled** — no protection against runaway clients/loops
- Two distinct init paths failing (one is an import bug, one is a missing service)
- Means every request goes straight to Supabase with no cache shield
- There is no Redis service in Railway project `fac8472c-…` (services: onebox-ai-logistics, rust-{core,work,ai,mdm,dashboard,streaming}-service). Either add a Redis plugin or set `REDIS_URL` to a managed Redis.

## High impact (P1)

### 5. rust-work-service scheduler failing every cycle
From `rust-work-service` logs (recurring):
```
ERROR Abandonment detection failed: function public.release_stale_heartbeat_assignments(integer, uuid) does not exist
ERROR Reservation escalation failed: function public.escalate_stale_zone_reservations(integer, uuid) does not exist
```
The Rust scheduler expects these functions but they are missing in the live DB. **Consequence:** stale heartbeat assignments + stuck zone reservations are never released, which produces a growing backlog of unclaimable work tasks → frontend retries → more DB pressure.

### 6. `permissions.is_active` column missing — PostgREST throwing ERRORs
Postgres logs:
```
ERROR: column permissions.is_active does not exist
ERROR: column permissions.is_active does not exist
```
Actual `public.permissions` columns: `id, name, resource, action, description, created_at, category_id, is_critical, requires_2fa, risk_level, scope, metadata`. No `is_active`.

The consumer is **not** in `src/**` (grep returned no hits) — likely an edge function, omni_agent, omni_bridge, or a Supabase view. Track down and fix.

### 7. Duplicate-key INSERT storm on `outbound_to_data`
Postgres logs show 15+ `duplicate key value violates unique constraint "idx_outbound_to_data_unique_record"` errors per minute, retried tightly. Whatever ingests TO data needs `ON CONFLICT DO NOTHING/UPDATE`.

### 8. rust-core-service: 100% of requests check `service_api_keys` (2 rows) before JWT
Debug log floods:
```
DEBUG API key validation failed, trying JWT  error=API key not found or inactive
```
Every authenticated user request first checks the API-key table, fails, then falls through to JWT. With ~50+ req/s the doomed lookup is a constant DB hit. Either short-circuit on `Bearer eyJ...` prefix (JWT-shape) before hitting DB, or cache the negative result.

### 9. Session cache poisoning in rust-core-service
Log warnings:
```
WARN Session cache hit but organization_id is missing, treating as cache miss
```
recur for multiple users. The session cache is being populated with incomplete records, forcing repeated cache misses → repeated `validate-with-profile` DB roundtrips. Fix: only cache sessions once `organization_id` is resolved, OR add a `last_resort` fetch that resolves and re-caches in one DB hit.

### 10. 258 unindexed foreign keys
Every FK without an index makes joins and cascade-delete checks slow. Prioritise the high-traffic tables: `rf_putaway_operations`, `rr_cyclecount_data`, `rr_all_deliveries`, `outbound_to_data`, `work_tasks`, `audit_logs`, `session_activities`.

## Medium / cleanup (P2)

- **Auth DB connection allocation is absolute (10 fixed)** — switch to percentage-based so larger instances actually get more Auth headroom.
- **Vulnerable Postgres version** `supabase-postgres-17.4.1.074` has outstanding security patches.
- **6 duplicate indexes** to drop (e.g., `idx_putback_org_created_date` vs `idx_putback_tickets_productivity`, plus role-permission table duplicates).
- **425 unused indexes** — slow writes; review and drop after confirming with `pg_stat_user_indexes`.
- **21 ERROR security advisors**: 4 security-definer views (`role_hierarchy`, `permissions_with_metadata`, `tab_permissions`, `v_latest_inbound_part_transfers`) + 17 RLS policies referencing `user_metadata` (user-controllable claim) on the warehouse map tables (`warehouse_aisle_*`, `warehouse_assets`, `warehouse_asset_positions`, `warehouse_asset_position_latest`).
- **Smartsheet calls with `use_cache=false`** — every PDF fetch bypasses cache.
- **Realtime publication includes 21 tables** — high-volume ones (`rf_putaway_operations`, `rr_cyclecount_data`, `work_tasks`) generate the bulk of 25M `realtime.list_changes` calls. Audit which tables really need Realtime; convert remaining hot ones to `rust-work-service /ws` per [[ADR-Presence-Architecture-Next-Steps]] / [[Roadmap-Rust-WS-Unlocks]].

## Recommended order of operations

1. **Immediate (today):** add a Redis service in Railway (or fix the localhost reference) → restores rate limiting + caching.
2. **Immediate (today):** restore/rename the missing `release_stale_heartbeat_assignments` and `escalate_stale_zone_reservations` Postgres functions — work backlog is silently growing.
3. **Immediate (today):** fix `outbound_to_data` duplicate-key INSERT loop with `ON CONFLICT`.
4. **Within 24h:** open a migration that wraps all `auth.uid()` calls in `(SELECT auth.uid())` across the 499 flagged policies. Single PR, mechanically safe.
5. **Within 24h:** consolidate the multi-permissive policies on `rr_lx03_data`, `time_clock_entries`, `grs_unknown_batches`, `user_profiles`, `overtime_signups` (highest counts).
6. **Within 24h:** patch the `service_api_keys` middleware to skip DB lookup when token has JWT shape.
7. **This week:** add indexes for FKs on `rf_putaway_operations`, `rr_cyclecount_data`, `rr_all_deliveries`, `outbound_to_data`, `work_tasks`, `audit_logs`, `session_activities`.
8. **This week:** fix `permissions.is_active` consumer (likely edge function or agent) — every call produces a Postgres ERROR.
9. **This sprint:** upgrade Postgres, switch Auth to percentage-based connections, drop duplicate indexes, audit Realtime publication.

## Cross-references
- [[Roadmap-Rust-WS-Unlocks]] — Realtime → WS migration plan
- [[ADR-Presence-Architecture-Next-Steps]] — context for why we're moving off Realtime
- [[Pull-Next-Claim-Performance]] — existing claim-engine perf note (orphan; relevant to cycle-count query slowness)
- [[Realtime-Presence-Browser-Hardening]] — current Realtime defence pattern

## Related
- [[_Index/Debug]]
