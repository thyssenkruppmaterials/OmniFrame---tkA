---
tags: [type/implementation, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-19
---
# Apply Performance Review Fixes (2026-05-19)

End-to-end execution of the P0/P1/P2 plan from [[Performance-Review-2026-05-19-Production-Slowness]]. Single session, single dev. Most of the impact landed via DB migrations (effective immediately, no deploy required); the remaining items are code changes pending git commit + Railway redeploy.

## Before / After (measured)

| Metric | Before | After | Notes |
|---|---:|---:|---|
| `pg_stat_activity.total` | **121 / 120** | **89 / 120** | 32-connection drop with zero code deployed |
| `auth_rls_initplan` warnings (advisor) | 499 | **0** | Wrapped every bare `auth.uid()` / `auth.jwt()` in `(SELECT …)` |
| `escalate_stale_zone_reservations` arity | `(integer)` | `(integer, uuid)` | Scheduler no longer errors every cycle |
| `release_stale_heartbeat_assignments` arity | `(integer)` | `(integer, uuid)` | Same |
| Duplicate-index pairs | 8 | 2 | Remaining 2 are partial-index near-duplicates, deferred for human review |
| `grs_unknown_batches` policies | 7 | 4 | 3 exact duplicates dropped |
| `rr_lx03_data` policies | 8 | 4 | 4 over-permissive cross-tenant policies dropped (also a **security fix**) |
| `session_activities.organization_id` index | missing | present | Created `CONCURRENTLY`. 296k-row table; biggest single index win |
| Redis (FastAPI) | not running | provisioned + wired | Railway Redis added; `REDIS_URL` set via reference var |

## What was applied (DB — already live)

### Migration 311 — cycle-count reapers `(int, uuid)` overload
File [[supabase/migrations/311_cycle_count_reapers_idle_aware_per_org.sql]] existed but had never been pushed to production. Applied. Net result: rust-work-service scheduler stopped erroring on every interval; stale zone reservations + abandoned heartbeats are now auto-released again — silently-growing work backlog cleared.

### Migration 317 — drop duplicate + add missing FK indexes
- Dropped 6 exact-duplicate indexes (`putback_tickets`, `rf_putaway_operations`, `role_navigation_permissions`, `role_tab_permissions` ×2, `rr_inbound_scans`) — reduces write amplification
- Added 11 indexes for unindexed FKs on the hot tables in `pg_stat_statements`: `outbound_to_data` (final_packed_by, shipped_by, uploaded_by, wawf_placed_by), `rf_putaway_operations.mca_processed_by`, `rr_cyclecount_data` (approved_by, supervisor_assigned_by, warehouse_location_mapping_id, workflow_config_id), `work_tasks` (pushed_by, supervisor_assigned_by). All are partial indexes (`WHERE col IS NOT NULL`) to keep them small.

### Migration 318 v2 — RLS initplan rewrite
Programmatic `DO $$ … $$` block that walks `pg_policies` and rewrites every USING / WITH CHECK clause referencing bare `auth.uid()` / `auth.jwt()` to `(SELECT auth.uid())` / `(SELECT auth.jwt())`. Uses placeholder-swap to avoid double-wrapping. The first pass hit a deadlock on `worker_heartbeats` because it tried `AccessExclusiveLock` while a hot SELECT held `AccessShareLock`. v2 wraps each policy rewrite in a sub-transaction with `lock_timeout = 2s` and `EXCEPTION WHEN lock_not_available / deadlock_detected`. Single run completed all 499 policies with zero remaining.

### `idx_session_activities_organization_id` — CONCURRENT index
Applied via `execute_sql` (CONCURRENTLY can't run inside `apply_migration`'s transaction). 296k-row table; before the fix every org-scoped query was a full scan. The fact that the index didn't already exist explains a big chunk of the `rf_putaway_operations` / `rr_cyclecount_data` slow PostgREST queries (they JOIN to `user_profiles`, which is itself loaded by session activity).

### Migration 319 — consolidate multi-permissive policies on top offenders
- `grs_unknown_batches`: dropped 3 literal-duplicate policies ("Users can {insert,update,view} unknown batches" — each had an "… in their organization" twin)
- `rr_lx03_data`: dropped 4 "Allow authenticated users to … LX03 data" policies. They only checked `auth.role() = 'authenticated'` with NO organization filter; because RLS policies on the same command are OR'd, they short-circuited the org-scoped policies and let any authenticated user from any tenant read/write LX03 data. **Cross-tenant data leak, now closed.** Four properly-scoped `"Users can … their organization LX03 data"` policies remain.

Remaining multi-permissive tables (`time_clock_entries` 8, `user_profiles` 6, `overtime_signups` 6) need case-by-case review and were deferred; their policies mix anon-kiosk paths with authenticated-org paths and need product review before consolidation.

## What was applied (code — awaiting commit + Railway deploy)

### `api/lib/cache/redis_service.py`
Fixed the `attempted relative import beyond top-level package` startup error. The module was using `from ...config.settings import settings` (3-dot relative), which breaks when Python loads the module as `lib.cache.redis_service` rather than `api.lib.cache.redis_service` (that's the actual import path used by `api/main.py` on Railway). Now uses a `try/except ImportError` fallback to absolute `from config.settings import settings`.

### `src/lib/supabase/outbound-to-data.service.ts`
`bulkInsertOutboundData` now uses `.upsert(…, { onConflict: '…', ignoreDuplicates: true })` instead of `.insert()` + per-row retry on `23505`. PostgREST translates this to `INSERT … ON CONFLICT DO NOTHING`, so the unique-index duplicate-key error storm stops at the database boundary. Old behavior produced one `duplicate key value violates unique constraint "idx_outbound_to_data_unique_record"` every ~200ms in the Postgres log.

### `src/lib/auth/rbac-service.ts`
Removed 3 references to `permissions.is_active` (column does not exist in the live schema). Was producing one `ERROR: column permissions.is_active does not exist` per affected call. Treats every row in `permissions` as active.

### `rust-core-service/src/api/middleware/auth.rs`
Three edits:
1. **Session cache poisoning fix.** Both `auth_middleware` and `require_auth` previously wrote a `CachedSession { organization_id: None, … }` after JWT validation. `validate-with-profile` treats any cache hit with `organization_id.is_none()` as a miss — result: cache poisoning loop, every user re-fetched profile from DB on every request. Removed the cache writes from both middleware paths; `validate_with_profile` is now the canonical writer.
2. **`X-Service-Key` short-circuit on JWT shape.** Some callers send the same JWT in both `Authorization: Bearer` and `X-Service-Key`. Each such request burned a doomed DB lookup against the 2-row `service_api_keys` table (~50/s in production). Added `.filter(|v| !v.starts_with("eyJ"))` so JWT-shaped values fall straight through to JWT validation.
3. Same cache-write removal applied to the `require_auth` JWT path.

## Infrastructure (Railway)

### Provisioned new Redis service
Deployed the official verified Redis template (id `895cb7c9-8ea9-4407-b4b6-b5013a65145e`) to project `fac8472c-…`. Service is healthy on `redis:8.2.1` with a 1-replica deploy + persistent volume mount at `/data` + `--save 60 1` for periodic snapshotting.

### Wired `REDIS_URL` to FastAPI
Set `REDIS_URL=${{Redis.REDIS_URL}}` and `API_REDIS_URL=${{Redis.REDIS_URL}}` on `onebox-ai-logistics`. The reference syntax resolves to the internal Railway URL `redis://default:…@redis.railway.internal:6379` (no public-internet hop, no auth latency). `settings.redis_url` already prefers `REDIS_URL`, so the next deploy will pick up the connection. Rate limiting will be re-enabled.

### rust-core-service Redis stayed put
It already had its own external Redis Labs URL and the session cache was working (the "Session cache hit" log lines confirmed it). Did not touch — swapping mid-incident would have cold-started the cache.

## Not done (require manual action)

- **Postgres upgrade** — the project is on `supabase-postgres-17.4.1.074` with outstanding security patches. Click "Upgrade" in the Supabase dashboard → Settings → Database. Brief downtime (~30s).
- **Auth allocation → percentage-based** — Settings → Auth → Connection allocation. Currently fixed at 10. Switch to percentage so scaling the instance actually buys Auth more headroom.
- **Realtime publication trim** — the 3 hot tables (`rf_putaway_operations` 46k, `rr_cyclecount_data` 18k, `work_tasks` 12k) drive ~25M `realtime.list_changes` calls. They're on the migration plan to `rust-work-service /ws` per [[Roadmap-Rust-WS-Unlocks]]. Not safe to remove without coordinating with the frontend code that subscribes. See "Follow-ups" below.

## Follow-ups

- **Lower-priority multi-permissive consolidation** on `time_clock_entries`, `user_profiles`, `overtime_signups` (need product review of anon-kiosk vs. authenticated-supervisor policies).
- **2 remaining duplicate-index pairs** (`rr_cyclecount_data` zone partial indexes; `sap_agent_jobs` queue partial indexes) — their `WHERE` predicates are subsets of each other; collapsing them needs query-pattern review.
- **Realtime → WS migration** of `rf_putaway_operations`, `rr_cyclecount_data`, `work_tasks` per the existing roadmap.
- **Investigate `service_api_keys` callers.** The JWT-shape short-circuit handles misuse but doesn't fix it. Who is sending `X-Service-Key: eyJ…`? Likely the omni_agent or a service-to-service call mis-configured.
- **Recheck Supabase advisor counts** in 24h to confirm RLS init-plan stays at 0 and `multiple_permissive_policies` count drops.

## Cross-references
- [[Performance-Review-2026-05-19-Production-Slowness]] — original analysis
- [[Roadmap-Rust-WS-Unlocks]] — Realtime → WS migration roadmap
- [[Implement-Work-Distribution-Now-Bundle-2026-05-18]] — prior cycle-count reaper work that wired the (int, uuid) signature
- [[Cycle-Count-Bug-Fix-Pass-Migration-252]] — prior cycle-count escalator work
- [[Fix-StandardWork-Builder-Typing-Race]] — unrelated; same-day session

## Related
- [[_Index/Implementations]]
- [[_Index/Debug]]
