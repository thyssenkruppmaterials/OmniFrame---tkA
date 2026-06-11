---
tags: [type/debug, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-07
---

# Fix — sqlx 0.7 + Supavisor txn-pool prepared-statement collision (`sqlx_s_<n> already exists`)

## Symptom

After pointing a sqlx 0.7 pool at Supavisor's transaction-mode pooler (port **6543**, e.g. `aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true`), the application 5xx-es immediately on every DB query with one of three errors:

```
42P05: prepared statement "sqlx_s_17" already exists
26000: prepared statement "sqlx_s_42" does not exist
08P01: bind message supplies 3 parameters, but prepared statement "sqlx_s_36" requires 0
```

First seen in `rust-work-service` v0.1.34 production deploy 2026-05-07 ~22:00 UTC. Triage in [[Sessions/2026-05-07]] under "Pooler regression triage".

## Root cause

sqlx 0.7 hard-codes named prepared statements `sqlx_s_<n>`. The name is generated from a per-CLIENT-connection counter (`PgConnection::next_statement_id`, starts at `Oid(1)`, incremented in `prepare()`). Supavisor transaction-mode multiplexes many client connections onto a smaller upstream pool, swapping upstream backends at COMMIT/ROLLBACK boundaries. Two app connections that share the same upstream backend will both PARSE statements named `sqlx_s_1`, `sqlx_s_2`, … — collision is deterministic.

**`statement-cache-capacity=0` does NOT fix this.** The cache only short-circuits *re-preparing* the same SQL on the same connection; sqlx still allocates a fresh `sqlx_s_<n>` name per prepare regardless. We tested it on prod — went 503 instantly.

Verified against:

- `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sqlx-postgres-0.7.4/src/connection/executor.rs::prepare()`
- `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sqlx-postgres-0.7.4/src/options/parse.rs` (the URL param is `statement-cache-capacity` with hyphens, not underscores; `from_url` silently ignores `statement_cache_capacity`).

## Fix — use port 5432 (Supavisor session mode), not 6543 (transaction mode)

```text
postgresql://postgres.{project_ref}:{PASSWORD}@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require
```

Key deltas from the broken config:

- **Port 5432, not 6543.** Session mode preserves upstream-backend affinity for the lifetime of each client connection — `sqlx_s_<n>` collisions are impossible because each app connection owns its dedicated upstream backend.
- **Drop `pgbouncer=true`.** That flag is only meaningful for the txn-pool protocol-level handshake.
- **Drop `statement-cache-capacity=0`.** Useless for sqlx 0.7 — see root cause above.

Trade-off: session mode does NOT multiplex. Effective upstream slot use ≈ the configured pool size. The txn-pool fanout benefit is forgone.

## Verification protocol

After setting/changing `WORK_SERVICE_DATABASE_POOLER_URL`:

1. Wait ~60s for Railway auto-redeploy.
2. `curl https://rust-work-service-production.up.railway.app/health/detailed` — expect `status=healthy`, `database.status=healthy`. If `database.status=unhealthy` with a `prepared statement` message, the fix didn't take — check the URL.
3. Filter Railway logs: `prepared OR sqlx_s_ OR @level:error` over the last 5 minutes — expect zero matches.
4. `pg_stat_activity` snapshot — listener pool shows up as `application_name = rust-work-service-listener` direct conns; the general pool routes through Supavisor and shows up under empty `application_name` / `postgres` user (Supavisor session-mode strips client-side `application_name`).

## Future unlock

Any one of these would let us move to txn-mode (and recover the multiplexing benefit) safely:

1. **Upgrade to sqlx 0.8+**, which exposes `PgConnectOptions::no_statement_cache()` AND switches to unnamed prepared statements (`Parse { statement: "", ... }`). Unnamed statements are scoped to a single Bind/Execute cycle, so they work fine over txn-pool.
2. Replace Supavisor with **pgcat** (rewrites named-statement IDs per upstream).
3. Replace Supavisor with **`pgbouncer-rs`** — 1.23 has `replace_query_text=true`.

## Related

- [[Implementations/Implement-Rust-Work-Service-PgBouncer-Pooler]] § "2026-05-07 hotfix" — full operator-facing rollout note + Caveat #2.
- [[Sessions/2026-05-07]] § "Pooler regression triage" — 25-min triage timeline.
- [[Implementations/Implement-Resilient-PgListener]] — LISTEN/NOTIFY pool always uses direct DATABASE_URL for a related but different reason (txn-pool eats LISTEN frames).
