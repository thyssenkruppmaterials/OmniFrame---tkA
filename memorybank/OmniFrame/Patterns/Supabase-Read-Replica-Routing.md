---
tags: [type/pattern, status/active, domain/database, domain/backend, domain/frontend]
created: 2026-05-19
---
# Pattern — Supabase Read-Replica Routing

## Context

After provisioning a Supabase read replica (us-east-2 Ohio, `t4g.medium`, $63.91/mo, deployed 2026-05-19) we need an explicit, gradual way to migrate heavy reads off the primary without risking read-after-write consistency on flows that depend on it.

Supabase exposes two URLs:

| URL | Behavior |
|---|---|
| **Load Balancer** `https://<ref>-all.supabase.co` | PostgREST sends writes (POST/PATCH/DELETE/RPC) to primary, reads (GET) to replicas. Writes via this URL still succeed. |
| **Direct Replica** `https://<ref>-rr-<region>-<id>.supabase.co` | Read-only; writes fail. |

We use the **Load Balancer URL** in the `supabaseRead` client so writes that accidentally go through it still work, but we discipline ourselves to only route reads.

## Pattern — dual client, opt-in migration

### Frontend (`src/lib/supabase/client.ts`)

```ts
export const supabase = getSupabaseClient()          // primary (writes, auth, realtime, read-your-own-writes)
export const supabaseRead = getSupabaseReadClient()  // load-balanced (heavy SELECTs, stats, lists, reports)
```

Key implementation details:

- `supabaseRead` has `persistSession: false`, `autoRefreshToken: false`, and a **distinct `storageKey`** (`'onebox-auth-token-read'`) so it doesn't double-init GoTrueClient.
- Auth state lives on the primary client. The read client forwards the primary's current access token on every request via a custom `fetch` so RLS evaluates `auth.uid()` correctly on the replica.
- When `VITE_SUPABASE_READ_URL` is unset (or equal to the primary URL), `supabaseRead` transparently returns the primary client. Dev environments without a replica keep working.
- Realtime is intentionally not used on the read client. The primary owns Realtime.

### Backend (`api/config/database.py`)

```python
from api.config.database import db

# Heavy SELECT — route to replica:
result = db.read_client.table("outbound_to_data").select("*").execute()

# Write — must go to primary:
result = db.client.table("outbound_to_data").insert(data).execute()
```

When no replica is configured, `db.read_client` returns the primary singleton.

Services that take a Supabase client in their constructor accept an optional `read_client`:

```python
class AnalyticsService:
    def __init__(self, supabase_client: Client, read_client: Optional[Client] = None):
        self.client = supabase_client
        self.read_client = read_client or supabase_client
```

Call sites that have a read replica wired:

```python
from api.config.database import db as _db
analytics_service = AnalyticsService(current_user.supabase_client, read_client=_db.read_client)
```

## When to route to `supabaseRead` / `db.read_client`

**✅ Safe — do route to replica:**
- Bulk fetch / list / grid / pagination (`fetchOutboundData`, `fetchLX03Data`, `fetchByStatuses`)
- Statistics & dashboards (`getStatistics`, `getPackToolStats`, `_get_throughput_metrics`)
- Autocomplete / typeahead reads (`searchStorageBins`, `searchPartNumbers`)
- Reports + export endpoints (CSV / Excel / JSON exports)
- Aggregation RPCs that are pure functions (`get_lx03_statistics`, `get_lx03_inventory_by_locations`)

**❌ Do NOT route to replica:**
- Mutations (`insert`, `update`, `delete`, `upsert`)
- RPCs with side effects
- Read-your-own-writes flows ("save row → immediately fetch it back")
- RF scan workflows that immediately verify against a row the operator just touched
- Auth / session flows (`supabase.auth.*`)
- Realtime channels (`supabase.channel(...)`)

When in doubt: leave it on the primary `supabase` client. Replication lag is typically <50 ms but can spike to 1–2 s under load; that's tolerable for a dashboard refresh, not for "did my pack confirmation save?"

## Migration playbook (per service)

1. Import `supabaseRead` alongside `supabase`:
   ```ts
   import { supabase, supabaseRead } from './client'
   ```
2. Audit every `supabase.from(...)` / `supabase.rpc(...)` call in the file.
3. For each one ask: **"If this returns stale data from <2 s ago, will the user see something wrong?"**
   - No → swap `supabase` → `supabaseRead`.
   - Yes → leave on `supabase`, add a comment noting why.
4. Leave `supabase.from(...).insert()` / `.update()` / `.delete()` / `.upsert()` untouched. Mutations stay on primary.
5. Leave `supabase.channel(...)` untouched. Realtime stays on primary.
6. Run `pnpm tsc -b` to verify.

## Verifying load actually shifted

After a deploy, run this on the **primary** Supabase project:

```sql
SELECT application_name, count(*)
FROM pg_stat_activity
WHERE application_name LIKE 'postgrest%'
GROUP BY 1;
```

Expect: two `postgrest%` rows show up over time (one per database). Primary's connection count holds roughly steady; replica picks up new connections proportional to your read traffic.

Also watch `pg_stat_statements` over a 24h window: the heavy joined-select queries on `rf_putaway_operations` / `rr_cyclecount_data` / `rr_lx03_data` should see their `calls` count grow faster on the replica than on the primary.

## Initial migration (2026-05-19)

Files touched:

| File | What changed |
|---|---|
| `src/lib/supabase/client.ts` | Added `supabaseRead` singleton + `getSupabaseReadClient()` |
| `src/lib/supabase/lx03-data.service.ts` | All 12 read methods routed to `supabaseRead` |
| `src/lib/supabase/outbound-to-data.service.ts` | `fetchOutboundData`, statistics, `fetchByStatuses`, `fetchCriticalDeliveries`, `searchOutboundData` routed to `supabaseRead` |
| `src/lib/rust-core/outbound-to-data.service.ts` | Parallel-fetch path + all 12 statistics counts + pack/final-pack/shipper stats routed to `supabaseRead` |
| `api/config/settings.py` | Added `supabase_read_url` (falls back to `supabase_url`) |
| `api/config/database.py` | Added `db.read_client` property + `get_supabase_read_client()` dependency |
| `api/services/analytics.py` | `AnalyticsService` accepts optional `read_client`; all 5 SELECTs/RPCs routed through it |
| `api/routers/analytics.py` | 5 `AnalyticsService(...)` constructions wired with `read_client=_db.read_client` |
| `api/routers/reports.py` | 2 `AnalyticsService(...)` constructions wired; 3 direct `current_user.supabase_client.table(...)` reads in export endpoints routed to `_db.read_client` |

Railway env vars set on `onebox-ai-logistics` (with `skipDeploys: true`):
- `VITE_SUPABASE_READ_URL=https://wncpqxwmbxjgxvrpcake-all.supabase.co`
- `API_SUPABASE_READ_URL=https://wncpqxwmbxjgxvrpcake-all.supabase.co`
- `SUPABASE_READ_URL=https://wncpqxwmbxjgxvrpcake-all.supabase.co`

## Related
- [[ADR-Scaling-Roadmap-To-100k-Concurrent]] — Tier C step that this is the foundation for
- [[Performance-Review-2026-05-19-Production-Slowness]] — the perf review that identified the heavy-read queries
- [[Apply-Performance-Review-Fixes-2026-05-19]] — today's perf-pass that this builds on
- [[_Index/Patterns]]


## Rust services migration (2026-05-19 evening)

Follow-on to the Phase 1+2 frontend/FastAPI migration. The Rust services connect to Postgres directly via `sqlx` (not PostgREST), so they need a separate `read_pool` configured against the replica's Supavisor pooler URL.

### Pattern — mirror the existing `db_pool` / `listener_db_pool` split

`rust-work-service` already runs two pools (general + listener) because LISTEN/NOTIFY can't multiplex through a transaction-mode pooler. Adding a third pool (`read_pool`) keeps that same shape: each pool has a distinct purpose and a distinct `application_name` tag in `pg_stat_activity` for forensic clarity.

```text
│ db_pool                       │ mutations, claim/push, read-after-write, scheduler reapers
│ read_pool                     │ pure SELECTs / aggregations (queue stats, candidate scans, RBAC, profile)
│ listener_db_pool (WS only)    │ LISTEN/NOTIFY — must be direct, never replica
```

### Files touched

**rust-work-service:**
- `src/config/mod.rs` — added `database_read_pooler_url: Option<String>` (reads `WORK_SERVICE_DATABASE_READ_POOLER_URL` or `DATABASE_READ_POOLER_URL`)
- `src/lib.rs` + `src/main.rs` — added `read_pool: PgPool` field to both `AppState` structs (duplicated lib+bin), built via `build_pool_with_flag_overrides_named_lazy` with `application_name = "rust-work-service-read"`. Falls back to `db_pool.clone()` when env unset.
- `src/scheduler/mod.rs` — `start_scheduler` now takes `read_pool` as a second arg. The `broadcast_queue_stats` job (every 30s) routes through it. The 3 reaper jobs (`detect_and_release_abandoned`, `cleanup_stale_workers`, `escalate_stale_reservations`) stay on `pool` (writes).
- `src/api/routes/work.rs` — `get_pending_cycle_counts` candidate-scan + `get_queue_stats` aggregator both routed to `state.read_pool`. The claim path that follows still hits primary via row-locked UPDATE, so the worst case of a stale candidate is a benign "already-claimed" rejection.

**rust-core-service:**
- `src/config/database.rs` — added `read_url: Option<String>` (reads `DATABASE_READ_POOLER_URL`).
- `src/lib.rs` + `src/main.rs` — added `read_pool: PgPool` to `AppState`, built lazily in main with graceful fallback to primary on error. `RbacService::new(read_pool.clone())` because RBAC is 100% read-only.
- `src/api/routes/auth.rs` — the slow path of `validate_with_profile` (when cache misses) now calls `AuthQueries::new(state.read_pool.clone()).get_user_profile(...)`. The follow-up `update_last_seen` background task stays on `state.db_pool` (write).
- `src/api/middleware/auth.rs` — incidentally cleaned up unused `CachedSession` import (left over from earlier middleware rewrite).

### Validation

- `cargo check` on both crates: clean (only pre-existing dead-code warnings on unused observability middleware).
- `RbacService` was the most invasive change because it's a singleton in `AppState`. Passing `read_pool` to its constructor means EVERY RBAC permission lookup across the rust-core service (`auth_middleware`, `require_auth`, `get_permissions` endpoint, etc.) now queries the replica.

### Env vars to set on Railway (when ready to roll out)

The replica's Supavisor pooler URL must be fetched from the Supabase Dashboard → Project Settings → Database → Connection Pooling → select "Read Replica - East US (Ohio)" in the database dropdown. Looks like:

```text
postgresql://postgres.wncpqxwmbxjgxvrpcake:<password>@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require
```

or for the dedicated replica:

```text
postgresql://postgres.wncpqxwmbxjgxvrpcake-rr-us-east-2-duppb:<password>@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require
```

Set on Railway with `skipDeploys: true` so they activate on the next manual `railway up`:
- `rust-core-service`: `DATABASE_READ_POOLER_URL=<replica pooler url>`
- `rust-work-service`: `WORK_SERVICE_DATABASE_READ_POOLER_URL=<replica pooler url>`

### Verification after deploy

Query `pg_stat_activity` for the new `application_name` tags:

```sql
SELECT application_name, count(*) FROM pg_stat_activity
WHERE application_name LIKE 'rust-%'
GROUP BY 1 ORDER BY 1;
```

Expect to see (after some traffic):
- `rust-core-service` — unchanged (~30 idle, primary)
- `rust-work-service` — unchanged (~20, primary)
- `rust-work-service-listener` — unchanged (~24-26, primary, by design)
- `rust-work-service-read` — NEW (handful, replica)

And on `pg_stat_statements`, the cumulative rate-of-growth for:
- `SELECT … FROM rr_cyclecount_data WHERE organization_id = $1 AND status IN ('pending','recount')` (the heavy candidate-scan)
- `SELECT (SELECT COUNT(*) FROM rr_cyclecount_data …)` (the queue-stats aggregation)

should drop sharply on the primary as those calls move to the replica.

### Cross-references

- [[Apply-Performance-Review-Fixes-2026-05-19]] — the perf pass that motivated this work
- [[ADR-Scaling-Roadmap-To-100k-Concurrent]] — the scaling roadmap this advances on (Tier C step 2)

## Rust-dashboard-service migration (2026-05-24)

Closes the third (and final, as of OmniBelt v1) Rust-service gap in the read-replica pattern. Motivated by [[Implement-OmniBelt-MVP]] P0 — OmniBelt's `GET /omnibelt/bootstrap` endpoint runs against `state.read_pool` exclusively, so the service that hosts the endpoint must have a `read_pool` to route to.

### Pattern deviation — single-binary crate (no `config/mod.rs`)

Unlike `rust-work-service` and `rust-core-service` (both multi-binary crates with a top-level `lib.rs` + `config/mod.rs` module), `rust-dashboard-service` is a single-binary crate. All read-pool wiring landed **inline in `src/main.rs`** rather than introducing a one-file `config/mod.rs` module. Same env-var contract (`DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL` or `DATABASE_READ_POOLER_URL`); same `application_name = "rust-dashboard-service-read"`; same graceful fallback to `db_pool.clone()` on env unset / blank / connection failure.

### Files touched

**rust-dashboard-service:**
- `src/main.rs` (single file edit, ~80 LOC added across multiple hunks):
  - Imports: added `sqlx::postgres::PgConnectOptions` + `std::str::FromStr`.
  - `AppState`: added `read_pool: sqlx::PgPool` field with doc comment.
  - `HealthResponse`: added `read_database: String` field reporting `"connected"` | `"disconnected"`.
  - Boot: built `read_pool` with the standard env-fallback chain (`DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL` → `DATABASE_READ_POOLER_URL` → primary clone), `application_name("rust-dashboard-service-read")`, `max_connections(5)`.
  - `health_check`: now also `SELECT 1` against `read_pool` and reports both `database` + `read_database` status.

No changes to `rust-work-service` or `rust-core-service` — both already migrated 2026-05-19 evening.

### Verification approach

- `cd rust-dashboard-service && cargo check` — clean.
- `cd rust-dashboard-service && cargo build --release` — clean (35.5 s).
- Post-deploy on Railway: `SELECT application_name, count(*) FROM pg_stat_activity WHERE application_name LIKE 'rust-%' GROUP BY 1` should show `rust-dashboard-service-read` showing up as connections light up.
- `/health` endpoint response shape extended to include `read_database`; existing health checks unaffected.

### Env var to set on Railway

- **Service**: `rust-dashboard-service` (Railway project `fac8472c-199b-41ec-8806-a869ee96e783`)
- **Name**: `DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL`
- **Value**: same Supavisor replica pooler URL set on `rust-core-service` / `rust-work-service` (see "Env vars to set on Railway" above).
- **Flag**: `skipDeploys: true` so the binary swap happens on the next manual `railway up`, not on the env-var write itself.

### Status

Code landed but **not yet deployed** as of 2026-05-24. The 2026-05-24 OmniBelt MVP rollout closeout ([[Implement-OmniBelt-MVP]] P9) gates production traffic on a future Railway `railway up` once the env var is set with `skipDeploys: true`.
