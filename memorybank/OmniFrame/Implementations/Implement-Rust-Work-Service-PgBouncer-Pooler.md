---
tags: [type/implementation, status/active, domain/backend, domain/infra, domain/database]
created: 2026-05-07
---

# Implement Rust Work Service — PgBouncer / Supavisor Pooler (Items 4 + 5)

## Purpose / Context

Part of the post-audit cleanup pass (Workstream B, items 4 + 5 of the
final-audit deliverable). The 2026-05-07 audit observed the production
Supabase Postgres at **113 / 120 connections (94 % utilization)** with
`pg_cron` failing ~1.5 % of runs because direct-port connection slots
weren't available. `rust-work-service` v0.1.33 used 20 connections (13
`PgListener` sockets + 7 sqlx pool) directly to `db.{ref}.supabase.co:5432`.

Goal: free direct-port slots back to `pg_cron` and other non-pooled clients
by routing the rust-work-service general-purpose sqlx pool through
Supavisor's transaction-mode pooler (`aws-0-{region}.pooler.supabase.com:6543`)
while keeping every `LISTEN/NOTIFY` consumer on the direct port (LISTEN is
incompatible with transaction-mode pooling — see [Caveat](#caveat)).

Shipped in `rust-work-service` v0.1.34 (deploy 2026-05-07).

## Caveat — why LISTEN must stay direct

Transaction-mode poolers (PgBouncer transaction mode, Supavisor transaction
mode) MULTIPLEX many client connections onto a smaller upstream pool by
handing the upstream connection back to the pool at COMMIT/ROLLBACK
boundaries. `LISTEN` registers interest on a SPECIFIC backend; if the next
NOTIFY is processed by a different backend (because the pooler swapped
upstreams between transactions), the listener never sees it.

sqlx `PgListener::recv()` against a transaction-pooled URL appears to
succeed (the connection establishes, `LISTEN` succeeds because the SQL
statement itself is valid) but receives nothing. This is the same failure
mode the [[Debug/Fix-Auto-Confirm-Putaways-Trigger-Missing-And-Listener-Wedge]]
ticket called out at the protocol level — the wrapper [[Implementations/Implement-Resilient-PgListener]]
defends against the silent socket death case, but cannot defend against
"the URL itself is incompatible with LISTEN".

Session-mode pooling (PgBouncer session mode) preserves the backend across
the whole client connection lifetime and is LISTEN-safe — but session-mode
doesn't multiplex, so it doesn't solve the connection-pressure problem
that motivated this work. Direct-port for listeners is the only correct
shape.

## Design — dual sqlx pool

Two sqlx `PgPool` instances are constructed at boot:

| Pool | URL source | Sized | `application_name` | Used by |
|---|---|---:|---|---|
| `db_pool` (general-purpose) | `WORK_SERVICE_DATABASE_POOLER_URL` if set, else `DATABASE_URL` | 20 | `rust-work-service` | HTTP routes, scheduler, WS handler, `AppState` |
| `listener_db_pool` (LISTEN/NOTIFY-safe) | `DATABASE_URL` (always direct) | 30 | `rust-work-service-listener` | Every `*_listener.rs` consumer + `settings::listener` + `triggers::loader` + `triggers::evaluator` |

The split lives in `rust-work-service/src/main.rs` immediately after
config load. `db::pool_setup::build_pool_with_flag_overrides_named()` is
the shared constructor — it sets the `application_name` on the
`PgConnectOptions` and applies the existing `WORK_ENGINE_FLAG_OVERRIDES`
GUC `after_connect` hook to both pools (Item 17 from the cutover-invariants
plan).

Specifically — every `tokio::spawn` block that runs a LISTEN consumer was
rewritten to clone `listener_db_pool` instead of `db_pool`:

- `settings::listener::run`
- `sap_agents_listener::run` (`sap_agent_changed`)
- `sap_jobs_listener::run` (`sap_agent_job_changed`)
- `sap_import_runs_listener::run` (`sap_import_run_changed`)
- `cycle_count_listener::run` (`cycle_count_data_changed`)
- `lx03_listener::run` (`lx03_data_changed`)
- `rf_putaway_listener::run` (`rf_putaway_operation_changed`)
- `notifications_listener::run` (`notification_created`)
- `triggers::loader::run` (`agent_triggers_changed`)
- `triggers::evaluator::run` (per-table NOTIFY listeners + `sap_agent_jobs` INSERTs)

The trigger evaluator's `INSERT INTO sap_agent_jobs` is also routed through
`listener_db_pool` even though it doesn't strictly need direct access. The
INSERT volume is bounded (rate-limited by the DSL filter + loop-detection
counter) and the dual-routing keeps the pool/route boundary clean: anything
that needs a long-lived socket runs against `listener_db_pool`; everything
else can ride the pooler.

## Item 5 — `application_name` for `pg_stat_activity` audits

Every sqlx connection now carries an `application_name` that shows up in
`pg_stat_activity`. Operators can audit which connections belong to
rust-work-service (and which sub-pool — general vs listener) WITHOUT
IP-address detective work.

```sql
SELECT application_name, COUNT(*)
  FROM pg_stat_activity
 WHERE application_name LIKE 'rust-work-service%'
 GROUP BY 1;
```

Expected output post-deploy:

| application_name | count |
|---|---:|
| rust-work-service | 0–20 (steady state ~3–5 idle, peaks during HTTP / scheduler bursts) |
| rust-work-service-listener | 13–18 (one per LISTEN channel + occasional keepalive pg_notify) |

Wiring is in `rust-work-service/src/db/pool_setup.rs` —
`build_pool_with_flag_overrides_named(database_url, max_connections, acquire_timeout, application_name)`.
The original `build_pool_with_flag_overrides()` is preserved as a thin
backwards-compatible wrapper that omits the application name.

## Env-var rollout plan

The code change is **fully backwards compatible** — no env-var update is
required for v0.1.34 to deploy and run. Operator's rollout when ready:

1. Deploy v0.1.34 (this PR). With `WORK_SERVICE_DATABASE_POOLER_URL`
   unset, behaviour is unchanged from v0.1.33 — both pools point at
   `DATABASE_URL` and the only on-the-wire change is the `application_name`
   labels.
2. Verify `/metrics` shows `work_pglistener_status{channel="..."} = 1` for
   every channel after ~30 s.
3. Run the audit query above and confirm both pool labels appear.
4. **Then** in Railway, set `WORK_SERVICE_DATABASE_POOLER_URL` to the
   Supavisor transaction-pooler URL for the project. Format:

```text
postgresql://postgres.{project_ref}:{password}@aws-0-{region}.pooler.supabase.com:6543/postgres?pgbouncer=true
```

For OmniFrame's `wncpqxwmbxjgxvrpcake` Supabase project, this is:

```text
postgresql://postgres.wncpqxwmbxjgxvrpcake:{PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

5. Trigger a Railway redeploy of rust-work-service so it re-reads env.
6. Re-run the audit query — `application_name = rust-work-service`
   connection count drops to roughly the count of in-flight HTTP requests
   (typically 1–3 in steady state) because Supavisor multiplexes the
   short-lived sqlx checkouts onto a tiny upstream pool.
   `application_name = rust-work-service-listener` count is unchanged
   (~13).

## Expected DB-connection-count delta

Before (v0.1.33, all pool traffic on direct port 5432):

- 13 LISTEN sockets (long-lived, 1 per resilient PgListener)
- 0–7 sqlx HTTP/scheduler pool (20-cap, idle ~3, peaks during dispatch bursts)
- **Steady-state ~16, peak ~20**

After (v0.1.34, listener pool direct + general pool through pooler):

- 13 LISTEN sockets (unchanged — `listener_db_pool`)
- 0–3 sqlx HTTP/scheduler upstream connections via Supavisor (Supavisor
  multiplexes; the actual upstream socket count tracks in-flight queries,
  not pool checkouts)
- **Steady-state ~14, peak ~17 direct + ~1–3 multiplexed**

Net gain at the database: **~3–6 direct slots freed**, with the
short-lived HTTP path running against an effectively-unbounded Supavisor
upstream that the 113/120 pressure was being driven by.

## Files modified

- `rust-work-service/src/config/mod.rs` — added `database_pooler_url: Option<String>`, reads `WORK_SERVICE_DATABASE_POOLER_URL` (falls back to `DATABASE_POOLER_URL`).
- `rust-work-service/src/db/pool_setup.rs` — added `build_pool_with_flag_overrides_named()` that accepts an `application_name` and sets it on `PgConnectOptions`. Preserved `build_pool_with_flag_overrides()` as a thin wrapper.
- `rust-work-service/src/main.rs` — split single `db_pool` into `db_pool` (general-purpose, may use pooler) + `listener_db_pool` (always direct). Updated all 10 listener `tokio::spawn` blocks to use `listener_db_pool`. `state.db_pool` (HTTP routes) + `scheduler_pool` continue to use `db_pool`.
- `rust-work-service/.env.example` — documented the new env var.
- `rust-work-service/Cargo.toml` — bumped to v0.1.34.

## Quality gates

- `cargo build --quiet` — clean (no new warnings; pre-existing `observability/middleware.rs` dead-code warnings unchanged).
- `cargo test --lib` — 160 passing (was 154; +6 new tests for items 7a/7b shipped in the same PR).
- `cargo clippy --lib --all-targets` — no new warnings.

## Related

- [[Implementations/Implement-Rust-Work-Service-Per-Variant-Metrics]] — companion PR (items 7a + 7b shipped same release).
- [[Implementations/Implement-Resilient-PgListener]] — explains why listener pools need long-lived sockets.
- [[Components/Rust-Work-Service]] — component overview, updated with the dual-pool topology.
- [[Sessions/2026-05-07]] — EOD cleanup (Workstream B) section.
- [[Decisions/Roadmap-Rust-WS-Unlocks]] — broader context for the rust-work-service Phase 11 bet.



## 2026-05-07 hotfix — use SESSION mode (port 5432), not transaction mode (6543)

### What broke

When the operator first set `WORK_SERVICE_DATABASE_POOLER_URL` per the rollout plan above using port **6543** (Supavisor transaction-pool), production immediately went red. Every endpoint that hit the general-purpose pool returned 5xx for ~25 min:

- `/api/v1/sap-testing/dashboard` → 500
- `/api/v1/agent-identity/list` → 500 ("Database error" red text on Agent Identity v2 list card)
- `/api/v1/sap-agents/fleet` → 500
- `scheduler::*` background tasks (Worker cleanup / Queue stats broadcast / Reservation escalation / Abandonment detection) all logging ERROR every 30s

All three error classes:

```
Database(PgDatabaseError { code: "42P05", message: "prepared statement \"sqlx_s_17\" already exists" })
Database(PgDatabaseError { code: "26000", message: "prepared statement \"sqlx_s_42\" does not exist" })
Database(PgDatabaseError { code: "08P01", message: "bind message supplies 3 parameters, but prepared statement \"sqlx_s_36\" requires 0" })
```

### Root cause — Caveat #2: sqlx 0.7 + Supavisor txn-pool is fundamentally incompatible

sqlx 0.7 ALWAYS uses named prepared statements `sqlx_s_<n>`. Verified in `sqlx-postgres-0.7.4/src/connection/executor.rs::prepare()`:

```rust
async fn prepare(conn: &mut PgConnection, sql: &str, ...) -> Result<...> {
    let id = conn.next_statement_id;
    conn.next_statement_id.incr_one();
    // ...
    conn.stream.write(Parse {
        param_types: &*param_types,
        query: sql,
        statement: id, // <- ALWAYS named
    });
    ...
}
```

The statement name is generated from a per-CLIENT-CONNECTION counter starting at `Oid(1)`. Supavisor transaction-mode multiplexes many client connections onto a smaller upstream pool by handing the upstream connection back at COMMIT/ROLLBACK boundaries. Two app connections that share the same upstream backend will both try to PARSE `sqlx_s_1`, `sqlx_s_2`, … — collision is deterministic, not accidental.

**`statement-cache-capacity=0` does NOT fix this.** That URL parameter (verified against `sqlx-postgres-0.7.4/src/options/parse.rs`, hyphen-form only — `statement_cache_capacity` with underscores is silently ignored by `from_url`) only short-circuits *re-preparing* the same SQL on the same connection. Each prepare still allocates a fresh `sqlx_s_<n>` name regardless of cache capacity. We tested it; the deploy went 503 instantly.

### Fix — use port 5432 (session mode)

```text
postgresql://postgres.{project_ref}:{PASSWORD}@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require
```

Key deltas vs. the env-var rollout plan §4 above:

- **Port 6543 → 5432**. Session mode preserves backend affinity for the lifetime of each client connection — `sqlx_s_<n>` never collides across the pool because each app connection owns its dedicated upstream backend.
- **Drop `pgbouncer=true`**. That flag is only meaningful for Supavisor txn-pool's protocol-level handshake. Session-mode is plain Postgres.
- **Drop `statement-cache-capacity=0`**. Useless for sqlx 0.7 — see Caveat #2 above.

### Trade-off accepted

Session-mode does NOT multiplex. We give up the txn-pool's fanout benefit. Effective upstream connection use ≈ the configured `db_pool` size (20). Net realized savings vs. v0.1.33's all-direct profile is the listener pool split (~13 LISTEN sockets stayed direct, the 7-slot HTTP/scheduler general pool moved to Supavisor session mode — those 7 "slots" don't count against the direct port's 60-slot allocation any more). The full ~6 additional slots that txn-pool was supposed to free are forgone for now.

### Verified post-fix env-var rollout plan (replaces §4 above)

```text
WORK_SERVICE_DATABASE_POOLER_URL=postgresql://postgres.wncpqxwmbxjgxvrpcake:{PASSWORD}@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require
```

Notes for the next operator:

- **Always use port 5432 with sqlx 0.7.** Port 6543 will wedge production within seconds via prepared-statement-name collisions. Do not be misled by the `statement-cache-capacity` URL parameter — it doesn't help. There is no in-config workaround for sqlx 0.7 + Supavisor txn-pool short of a code change.
- The `?pgbouncer=true` parameter is only meaningful at port 6543. Drop it for port 5432.
- After setting the env var, watch `/health/detailed` and the deployment logs for `prepared statement` errors for at least 60 seconds before declaring success.

### Future unlock — reclaim the lost slots

Any ONE of these would let us move to txn-mode safely:

1. **Upgrade to sqlx 0.8+** which exposes `PgConnectOptions::no_statement_cache()` AND switches to unnamed prepared statements when the cache is disabled. The unnamed-statement protocol path works correctly with Supavisor txn-pool because unnamed statements are scoped to a single Bind/Execute cycle and cleared at end-of-transaction.
2. **Replace Supavisor with pgcat** which understands sqlx's named-statement pattern and transparently rewrites statement names per-upstream-connection.
3. **Replace Supavisor with `pgbouncer-rs`** which has `replace_query_text=true` support landing in 1.23.

Not urgent. The current shape (listener pool direct + general pool session-mode) is stable and the original 94 % connection-pressure problem is sufficiently relieved by the listener-split half of the change.

### Cross-references

- [[Sessions/2026-05-07]] § "Pooler regression triage" — the 25-min triage timeline.
- Validated against `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sqlx-postgres-0.7.4/src/{options/parse.rs,connection/executor.rs}` while debugging.
