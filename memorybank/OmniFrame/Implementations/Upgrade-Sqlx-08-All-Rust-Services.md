---
tags: [type/implementation, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-20
---
# Upgrade All Rust Services to sqlx 0.8.6

## Purpose / Context

Coordinated upgrade of every sqlx-using Rust service in the OmniFrame
monorepo from `sqlx = "0.7"` to a pinned `sqlx = "=0.8.6"`. Five
services in scope; `rust-streaming-service` does not use sqlx and was
skipped.

Drivers:

- **RUSTSEC-2024-0363** — proof-of-concept Postgres-protocol exploit
  against sqlx 0.7.x. Fixed in 0.8.1+. The upgrade is effectively
  mandatory.
- **Latent bug fixes** in 0.8.x that benefit the workspace:
  - `fetch_optional` connection leak (#3194)
  - `PgListener::recv` cancellation safety (#3467)
  - TLS unclean-shutdown (#3191)
  - `PgListener::try_recv` eager reconnect (#3585)
  - **PR #3863** — unnamed prepared statement when
    `.persistent(false)`. This is the foundation that lets us
    revisit Supavisor transaction-mode pooling. The 0.7 attempt
    failed with `prepared statement "sqlx_s_<N>" already exists`
    floods because sqlx 0.7 always names statements per-connection
    — see [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]].
    The actual `.persistent(false)` flip on hot queries is a
    SEPARATE workstream; this upgrade just makes it possible.
- We pinned `=0.8.6` (latest stable as of 2026-05-19) to avoid
  silent minor-version drift across services and to keep the
  Cargo.lock decision auditable.

## Per-service status

| Service | Risk | sqlx 0.7→0.8.6 | Cargo.lock | Compile errors | Lib tests | Build (release) | Note |
|---|---|---|---|---:|---|---:|---|
| `rust-dashboard-service` | LOW | ✅ | regen | 0 | 7/7 (bin tests) | 65 s | [[Upgrade-Sqlx-08-Dashboard-Service]] |
| `rust-ai-service` | LOW | ✅ | regen | 0 | 3/3 (bin tests) | 80 s | [[Upgrade-Sqlx-08-Ai-Service]] |
| `rust-mdm-service` | LOW | ✅ | NEW (was untracked) | 0 | 7/7 (bin tests) | 80 s | [[Upgrade-Sqlx-08-Mdm-Service]] |
| `rust-core-service` | MEDIUM | ✅ | regen | 0 | 23/23 | 85 s | [[Upgrade-Sqlx-08-Core-Service]] — also dropped unused `migrate` + `bigdecimal` features |
| `rust-work-service` | HIGH | ✅ | regen | 0 | 167/167 | 100 s | [[Upgrade-Sqlx-08-Work-Service]] |

Aggregate: **5/5 services SUCCESS. Zero compile errors. Zero source
changes were required to fix sqlx breakage.** The only `Cargo.toml`
edit beyond the version bump was the rust-core-service feature trim
(`migrate` and `bigdecimal`, both verified unused via `rg` before the
drop).

## Files changed (grouped by service)

### rust-dashboard-service
- `rust-dashboard-service/Cargo.toml`
- `rust-dashboard-service/Cargo.lock`

### rust-ai-service
- `rust-ai-service/Cargo.toml`
- `rust-ai-service/Cargo.lock`

### rust-mdm-service
- `rust-mdm-service/Cargo.toml`
- `rust-mdm-service/Cargo.lock` (new file — was untracked before this pass)

### rust-core-service
- `rust-core-service/Cargo.toml` (sqlx version + dropped `migrate`, `bigdecimal`)
- `rust-core-service/Cargo.lock`

### rust-work-service
- `rust-work-service/Cargo.toml`
- `rust-work-service/Cargo.lock`

### Memory Bank
- `memorybank/OmniFrame/Implementations/Upgrade-Sqlx-08-Dashboard-Service.md`
- `memorybank/OmniFrame/Implementations/Upgrade-Sqlx-08-Ai-Service.md`
- `memorybank/OmniFrame/Implementations/Upgrade-Sqlx-08-Mdm-Service.md`
- `memorybank/OmniFrame/Implementations/Upgrade-Sqlx-08-Core-Service.md`
- `memorybank/OmniFrame/Implementations/Upgrade-Sqlx-08-Work-Service.md`
- `memorybank/OmniFrame/Implementations/Upgrade-Sqlx-08-All-Rust-Services.md` (this note)

Source files in `rust-work-service/src/*` and `rust-core-service/src/*`
that show as modified in `git status` are **NOT part of this upgrade**
— they predate the session (per the conversation-start git snapshot)
or come from a parallel workstream's work on listener-pool compression
(`Compress-Rust-Work-Listener-Pool-2026-05-20`). The sqlx upgrade
itself made zero source-file changes.

## Surprises / behaviour changes to verify before deploy

These are the things that did NOT break the build but COULD shift
runtime behaviour. Each warrants a quick post-deploy sanity check.

1. **Transitive TLS bump (rustls 0.21 → 0.23, rustls-webpki 0.101 →
   0.103, webpki-roots 0.25 → 0.26)** is in scope for every service,
   most consequentially for `rust-work-service`'s long-lived
   `listener_db_pool` TCP sockets. PR #3191 in 0.8.x specifically
   targets TLS unclean-shutdown handling. Watch
   `work_pglistener_reconnects_total{channel}` for the first 30–60
   minutes after the work-service deploy. A small uptick is expected
   (the connection upgrades during the rolling deploy itself); a
   sustained climb is a regression.
2. **`fetch_optional` connection-leak fix (#3194)** can drop steady-
   state pool occupancy on services with high `fetch_optional` traffic
   (rust-work-service, rust-core-service). A 3–5 backend drop in
   `pg_stat_activity.application_name LIKE 'rust-work-service%'` is
   the GOOD case and should not be misread as connection trouble.
3. **`PgListener::try_recv` eager-reconnect default (#3585)** —
   `rust-work-service` does NOT call `try_recv` (the wrapper only
   uses `recv()`). The eager-reconnect-by-default semantics still
   apply to internal sqlx behaviour around listener reconnects, but
   no explicit code change is required. Documented decision: keep
   the new default.
4. **`PgListener::recv` cancellation safety (#3467)** — the wrapper
   in `rust-work-service/src/pglistener.rs` already wraps `recv()`
   in a `select!` arm against the keepalive ticker. The 0.8.x fix
   makes that select-arm fully cancel-safe; in 0.7.x it had a known
   window where a notification could be silently dropped on
   cancellation. Net win, no action required.
5. **`runtime-tokio-rustls` and `tls-rustls` are soft-deprecated
   aliases in 0.8.x** but still compile. Kept as-is across all
   services to minimise diff size; rename to `runtime-tokio` +
   `tls-rustls-aws-lc-rs` in a future pass when the deprecation
   warnings escalate.
6. **`rust-mdm-service/Cargo.lock`** was previously untracked and is
   now a new file on disk. Decision before deploy: either commit the
   lockfile (recommended for reproducibility — every other Rust
   service in the repo commits its lockfile) or add it to
   `.gitignore` for symmetry with whatever pre-session policy was in
   effect. The upgrade made the file regardless; the policy choice
   is independent.
7. **`rust-core-service` feature trim** — `migrate` and `bigdecimal`
   were dropped because both are unused in `src/`. Verified with
   `rg "sqlx::migrate|Migrator" rust-core-service/src` (zero
   matches) and `rg "BigDecimal|bigdecimal" rust-core-service/src`
   (zero matches). The next time the service genuinely needs either
   feature, re-enable explicitly.

## src/db/pool.rs (rust-core-service) — txn-pooler auto-detect

The defensive `opts.get_port() == 6543 → statement_cache_capacity(0)`
hook in `rust-core-service/src/db/pool.rs` remains in place,
unchanged. The 0.8.6 upgrade unlocks the actual fix (switch hot
queries to `.persistent(false)` so sqlx uses unnamed prepared
statements over the Supavisor transaction-mode pooler), but that
flip is an explicit follow-up workstream — not part of this upgrade.
The doc comment in the file still references "until we upgrade to
sqlx 0.8" and was deliberately left as-is; revising that comment is
the first sub-task of the follow-up workstream when it lands.

## Recommended deploy order (lowest risk first)

Each service deploys independently to Railway; there is no shared
artifact between them. Suggested order, lowest-risk first, so any
ambient operational impact (TLS swap, connection-count delta) is
caught on a service whose blast radius is smallest:

1. **`rust-dashboard-service`** — 4 queries, single binary, no
   listeners, no transactions. If the TLS bump or any transitive
   surprise breaks, blast radius is "background dashboard
   aggregation" only.
2. **`rust-ai-service`** — 5 queries, optional DB usage. Same
   reasoning; Inference pathway is degradeable.
3. **`rust-mdm-service`** — 26 inline queries, single pool. Apple
   MDM critical-path BUT no listener/transaction complexity. Watch
   the new Cargo.lock decision (commit vs gitignore) before
   pushing.
4. **`rust-core-service`** — auth + JWT validation backbone for
   FastAPI. Higher blast radius (logins). Verify the `/api/v1/auth/
   validate-with-profile` 99p latency does not regress, and that the
   TLS bump on the read-replica connection doesn't change
   `application_name = 'rust-core-service-replica'` connection
   counts. **Bake at least 30 minutes** before the work-service
   deploy.
5. **`rust-work-service`** — by far the highest-risk surface. 95+
   queries, 13-channel resilient `PgListener` fleet, dual sqlx pools,
   `after_connect` hook, `bb8` Redis pool, `tokio-cron-scheduler`.
   Watch `work_pglistener_reconnects_total{channel}`,
   `work_pglistener_last_message_age_seconds{channel}`, and
   `pg_stat_activity` for the application-name buckets after deploy.
   The internal `pglistener.rs` keepalive watchdog will catch any
   regression in the cancellation-safety / eager-reconnect arms,
   but sustained reconnect counters > 1/hour per channel are a
   regression signal.

## Memory Bank notes created

- [[Upgrade-Sqlx-08-Dashboard-Service]]
- [[Upgrade-Sqlx-08-Ai-Service]]
- [[Upgrade-Sqlx-08-Mdm-Service]]
- [[Upgrade-Sqlx-08-Core-Service]]
- [[Upgrade-Sqlx-08-Work-Service]]
- [[Upgrade-Sqlx-08-All-Rust-Services]] (this note)

## What was explicitly NOT done

- **No `git commit`** anywhere. All changes sit uncommitted on disk
  for the parent agent to review and stage.
- **No Railway deploy.** The parent agent owns the deploy decision
  and order.
- **No `.persistent(false)` flip** on any query. That is the next
  workstream and is intentionally separate from the upgrade itself.
- **No source-file changes** for sqlx-related compile errors. The
  audit prediction held: zero `MigrateError` matches, zero custom
  `Encode`/`Decode` impls, zero `HasValueRef` usages, zero
  `PgHasArrayType` collisions, zero `FromRow try_from` patterns
  across all five services.

## Related

- [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]] — the
  motivating constraint that pinned us to `=0.8.6` specifically.
- [[Supabase-Read-Replica-Routing]] — relevant to the
  `rust-core-service` dual-pool routing that this upgrade preserves.
- [[Components/Rust-Work-Service]] — the highest-risk service's
  topology + listener structure.
- [[Apply-Performance-Review-2026-05-19]] — the prior performance
  review whose connection-budget findings are independently improved
  by the `fetch_optional` leak fix.
- [[ADR-Scaling-Roadmap-To-100k-Concurrent]] — the scaling roadmap
  whose Supavisor-transaction-mode milestone this upgrade unblocks.
