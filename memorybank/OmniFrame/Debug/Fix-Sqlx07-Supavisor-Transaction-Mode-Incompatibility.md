---
tags: [type/debug, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-20
---
# Fix: sqlx 0.7 + Supavisor Transaction Mode Incompatibility

## Purpose / Context

During the 2026-05-20 connection-scaling work for `rust-core-service`, we
attempted to route the primary write pool and the read-replica pool
through the Supabase Supavisor **transaction-mode** pooler
(`aws-1-us-east-2.pooler.supabase.com:6543`) to get connection
multiplexing — the goal being to fit ~30+ client-side sqlx connections
into a much smaller Postgres backend footprint.

The deploy succeeded technically: the new pool config was active, the
logs confirmed `Supavisor transaction-mode pooler detected (port 6543);
statement cache disabled`, and `pg_stat_activity` showed rust-core's
two replicas collapsing into ~10 Supavisor-managed backend connections
(vs. 20 direct before).

But the auth path immediately began flooding with errors:

```
ERROR ... Failed to fetch user permissions
  error returned from database: prepared statement "sqlx_s_7" already exists
ERROR ... Database error fetching profile
  error returned from database: prepared statement "sqlx_s_3" already exists
WARN  ... Failed to update last_seen
  error returned from database: prepared statement "sqlx_s_5" already exists
```

Every cache-miss path through the database was broken.

## Root Cause

**sqlx 0.7 always names its prepared statements** with a per-connection
monotonically-increasing identifier (`sqlx_s_<counter>`). The
`PgConnectOptions::statement_cache_capacity(0)` knob only disables the
client-side LRU cache — it does **not** switch sqlx to the unnamed-
statement (`""`) protocol.

In Supavisor transaction mode, the Postgres backend behind a given
client is returned to the shared pool at the end of every transaction.
The NEXT client to check out that same backend may send a `Parse(name=
"sqlx_s_4", ...)` for a brand-new query and collide with the prepared
statement that the previous client already created on that backend.
Result: `42P05 prepared statement already exists` for ~every other
query, depending on which backend gets handed out.

This is a **sqlx-0.7-against-transaction-pooling** limitation. The fix
in sqlx 0.8+ is proper unnamed-prepared-statement support; until we
upgrade the workspace, transaction-mode pooling is off the table for
rust-core-service.

## Symptoms

- Logs full of `prepared statement "sqlx_s_<N>" already exists` (or
  occasionally `... does not exist`) on `RbacService::get_user_permissions`,
  `validate_with_profile`, and `update_last_seen`.
- 500s from `/api/v1/auth/validate-with-profile` on cache miss;
  session-cache hits mask the issue but new user logins fail.
- `pg_stat_activity` shows `application_name = 'Supavisor'` with high
  connection churn and short `state_change` ages.
- Railway redeploys that try to revert env vars race each other and
  several end up `FAILED` because Railway treats two near-simultaneous
  env-var changes as racing deploys.

## Fix

Keep Supavisor in **session mode** (port 5432) for any sqlx 0.7 service.

For `rust-core-service` the working baseline is:

- `DATABASE_URL` →
  `postgresql://postgres:<pw>@db.<project_ref>.supabase.co:5432/postgres`
  (direct IPv6 connection, session-equivalent semantics, no Supavisor)
- `DATABASE_READ_POOLER_URL` →
  `postgresql://postgres.<project_ref>-rr-<region>-<replica>:<pw>@aws-1-<region>.pooler.supabase.com:5432/postgres?sslmode=require`
  (Supavisor session mode against the read replica — IPv4-safe, no
  prepared-statement issue)

`rust-core-service/src/db/pool.rs` retains a defensive auto-detect that
disables sqlx's statement cache whenever `opts.get_port() == 6543`.
The code path is dormant under the current URLs but will activate the
day we migrate to sqlx 0.8 and try transaction-mode pooling again. See
the inline doc comment for the full rationale.

## Recovery procedure (if this happens again)

1. Identify the bad env var: `railway variables --service rust-core-service
   --json | jq '.DATABASE_URL, .DATABASE_READ_POOLER_URL'` — anything
   pointing at `:6543` on this service is wrong for sqlx 0.7.
2. Set the env vars back to the session-mode values above. Use one
   `set-variables` call per env var to avoid Railway's concurrent-
   deploy race condition.
3. `railway redeploy --service rust-core-service --yes` (re-uses the
   last good image, just restarts with new env vars — no rebuild).
4. Verify with: 10 GETs against `/api/v1/health`, grep deploy logs for
   `prepared statement`, and confirm `pg_stat_activity` shows the
   familiar two-IP × 10-connection layout.

## Why `railway up --ci` short-circuits

The service's `railway.toml` declares `build.watchPatterns =
["src/**", "Cargo.toml", "Dockerfile"]`. If `railway up` is invoked
twice in a row without any of those files changing on disk, the second
invocation prints `no changes detected in watch paths, build will skip`
and exits without redeploying. Use `railway redeploy` (re-roll the
image with current env vars), or touch a watched file, when you need
to force a redeploy from the CLI.

## Related

- [[ADR-Connection-Pool-Strategy]] (broader decision record on
  session-mode vs transaction-mode pooling — to be created)
- `rust-core-service/src/db/pool.rs` — auto-detect implementation
