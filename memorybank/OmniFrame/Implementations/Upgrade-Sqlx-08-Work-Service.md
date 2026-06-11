---
tags: [type/implementation, status/active, domain/backend, domain/database, domain/realtime]
created: 2026-05-20
---
# Upgrade rust-work-service to sqlx 0.8.6

## Purpose / Context

Three motivating drivers, in order of severity:

1. **RUSTSEC-2024-0363** — Postgres protocol PoC exploit shipped against
   sqlx 0.7.x in 2024. Fixed in 0.8.1+. Pin =0.8.6 (latest stable on
   2026-05-19) so we close the advisory and lock the minor so future
   `cargo update` runs can't quietly slide us forward across breaking
   changes inside the 0.8.x line. See
   [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]] for the
   companion driver on the pooler side.

2. **Listener cancellation safety** — `pglistener.rs` wraps
   `PgListener::recv` in a `tokio::select!` arm (Phase 2 of the
   resilient-listener work — [[Implement-Resilient-PgListener]]). Pre-0.8
   `recv` was not cancellation-safe; the keepalive-tick branch of the
   select! could drop a partial recv state and leave the channel
   subscriber wedged. sqlx PR #3467 (in 0.8.x) makes `recv` cancel-safe.
   This was the silent-correctness item that justified prioritising
   `rust-work-service` ahead of the other Rust services.

3. **Future Supavisor txn-mode pooling foundation** — sqlx PR #3863 adds
   unnamed prepared statements when the query carries `persistent(false)`.
   That unlocks `db_pool` routing through Supavisor's transaction-mode
   pooler (`*.pooler.supabase.com:6543`) for HTTP routes without
   triggering `prepared statement "sqlx_s_*" already exists` failures.
   `listener_db_pool` will continue to use the direct `:5432` URL
   regardless — `LISTEN/NOTIFY` is incompatible with txn pooling. See
   [[Components/Rust-Work-Service]] §"sqlx pool routing".

## Cargo.toml changes

```diff
 # Database
-sqlx = { version = "0.7", features = ["postgres", "runtime-tokio", "tls-rustls", "uuid", "chrono", "json"] }
+# Pinned to =0.8.6 (2026-05-20) to close RUSTSEC-2024-0363 + listener
+# cancellation safety + Supavisor txn-pool foundation. Aliases
+# `runtime-tokio` + `tls-rustls` are soft-deprecated in 0.8.x but
+# still compile — kept to minimise diff churn.
+sqlx = { version = "=0.8.6", features = ["postgres", "runtime-tokio", "tls-rustls", "uuid", "chrono", "json"] }
```

`cargo update -p sqlx -p sqlx-core -p sqlx-postgres -p sqlx-macros`
rewrote `Cargo.lock` and pulled the following notable transitive bumps:

- `sqlx{,-core,-macros,-macros-core,-mysql,-postgres,-sqlite}` 0.7.4 → 0.8.6
- `rustls` 0.21.12 → 0.23.40
- `rustls-webpki` 0.101.7 → 0.103.13
- `hashbrown` 0.14.5 → 0.15.5
- `hashlink` 0.8.4 → 0.10.0
- `webpki-roots` 0.25.4 → 0.26.11 + 1.0.7 (dual-version due to bb8/sqlx
  branch resolution differences)
- `event-listener` 2.5.3 → 5.4.1 (sqlx-core sync primitives moved off
  `ahash`/`sct`/`sqlformat` → onto `concurrent-queue` + `parking` +
  `foldhash`; the lockfile churn is mostly that swap, not API-relevant)

`base64` was NOT bumped by this update — relevant because of the
flaky-test note below.

## Compile errors fixed

**None — clean build.** All six candidate breakage classes from the
0.7→0.8 audit checklist were verified absent in this service before
running `cargo check`:

- `MigrateError` non-exhaustive add `_ => ...` arms — n/a; service does
  not use `sqlx::migrate!` (`rg 'sqlx::migrate' rust-work-service/src`
  is empty).
- Custom `Encode::encode` impls needing `Ok(...)` wrapper — n/a;
  `rg 'impl.*Encode.*for' rust-work-service/src` is empty.
- `HasValueRef<'r>` GAT refactor → `<DB as Database>::ValueRef<'r>` —
  n/a; `rg HasValueRef rust-work-service/src` is empty.
- `PgHasArrayType` collisions on `#[derive(sqlx::Type)]` enums — n/a;
  `rg '#\[derive.*sqlx.*Type' rust-work-service/src` is empty.
- `FromRow` `try_from` patterns — n/a; only `try_from` hit is
  `tracing_subscriber::EnvFilter::try_from_default_env()` in `main.rs`,
  which is unrelated to sqlx.
- `after_connect` closure signature shift — see dedicated section
  below; UNCHANGED.

`cargo check` emitted only the seven pre-existing `dead_code` warnings
in `src/observability/middleware.rs` (idempotency middleware scaffolding
not yet wired into a route).

## PgListener::try_recv eager_reconnect decision

**Decision: KEEP DEFAULT (eager-reconnect, the 0.8.3+ behaviour).**

Rationale:

- `rg 'try_recv|eager_reconnect' rust-work-service/src/pglistener.rs`
  is empty. The wrapper only calls `PgListener::recv` (see
  `PgListenerSource::next` at `src/pglistener.rs:359`), never
  `try_recv`. So the `try_recv` semantics change in PR #3585 is
  irrelevant to the production code path.
- The only `try_recv` callsite anywhere in the service is on a tokio
  channel in `src/api/routes/sap_console.rs:621`, NOT on a
  `PgListener` — not affected.
- The watchdog/keepalive design (`drive_inner` at
  `src/pglistener.rs:226`) ALREADY assumes hard reconnect on socket
  failure (90s deadline → drop + reconnect with 1s→30s exponential
  backoff). Eager reconnect is therefore aligned with our existing
  semantics — opting out (`.eager_reconnect(false)`) would only matter
  if we depended on the delayed-reconnect path inside `recv()` to
  buffer notifications, which we explicitly do NOT (we observe socket
  death via the keepalive timeout and reconnect outside sqlx).

No code changes required to the wrapper.

## after_connect hook

**UNCHANGED.** `src/db/pool_setup.rs:219` already uses the
`|conn, _meta|` closure signature that 0.8 expects:

```rust
.after_connect(move |conn, _meta| {
    let payload = payload.clone();
    Box::pin(async move {
        if let Some(payload) = payload {
            sqlx::query("SELECT set_config('work_engine.flag_overrides', $1, false)")
                .bind(payload)
                .execute(&mut *conn)
                .await?;
        }
        Ok(())
    })
})
```

The `(&mut PgConnection, &PoolConnectionMetadata)` callback shape was
introduced in 0.7 and has not shifted in 0.8.x. `cargo check` compiled
this hook with zero diagnostics. The `&mut *conn` deref pattern still
works because `PgConnection` implements `DerefMut<Target = PgConnection>`
via the `Connection` trait blanket.

## Build time

`cargo build --release` (full from-scratch): **99.66 seconds** (real).
User CPU 154.83s / sys 6.26s on the dev workstation.

## Test results

- `cargo test --lib`: **167 passed; 0 failed; 0 ignored**.
  - One pre-existing FLAKY test surfaced under `ws_token::tests::tampered_signature_rejected`.
    The test flips the last byte of a random-UUID-issued token's
    base64-no-pad signature to `'A'`/`'B'` and asserts `BadSignature`.
    A 256-bit HMAC encoded as `URL_SAFE_NO_PAD` is 43 chars, and the
    last char only carries 4 effective bits — the trailing 2 bits MUST
    be zero, so only 16 of the 64 base64 chars (`A E I M Q U Y c g k o s w 0 4 8`)
    are valid in that position. Flipping the last byte to `'B'`
    (value 1, trailing bits = `01`) makes the strict-mode b64 decoder
    return `InvalidLastSymbol`, which the verify path maps to
    `Malformed` rather than `BadSignature`. The test passed 20/20 in
    a manual re-run loop after the upgrade — not a regression. Filed
    mentally for a future cleanup (the right fix is to flip a byte
    INSIDE the signature, not the last byte; out of scope for this
    upgrade per the "don't change behaviour beyond what compile errors
    force" constraint).
- `cargo check --tests` (integration tests under `tests/`, compile-only):
  **clean**. Only `dead_code` warnings on the idempotency middleware
  scaffolding (`src/observability/middleware.rs`) and two unused public
  helpers in `src/pglistener.rs` (`run_multi`, `run_multi_with_config`).
  All warnings pre-date this upgrade.

## Surprises / behavior changes to verify before deploy

1. **TLS stack swap** — `rustls` 0.21 → 0.23 (and `rustls-webpki` 0.101
   → 0.103). The TLS unclean-shutdown fix (sqlx #3191) we wanted is
   inside this swap. Should not change application behaviour, but
   long-lived Supabase TLS sessions on the `listener_db_pool` are
   exactly the population most likely to expose any new TLS edge case.
   Monitor `work_pglistener_reconnects_total{channel}` for the first
   30–60 min after deploy — a sudden spike across all 13 channels
   would point at TLS handshake regressions.

2. **`fetch_optional` connection-leak fix (#3194)** — applies to 95+
   queries in this service. The fix means steady-state pool checkout
   count under load may DROP (fewer leaked connections sitting
   unused). Monitor `pg_stat_activity application_name LIKE
   'rust-work-service%'` over a 1h cooldown window post-deploy — a
   sudden drop of 3–5 backends from each pool's steady state is the
   GOOD case (the leak was real); a sudden RISE would be unexpected.

3. **Eager reconnect default (#3585)** — although the wrapper doesn't
   call `try_recv`, sqlx now eagerly reconnects on `recv()` failure
   too in 0.8.3+. The wrapper's existing reconnect loop (which catches
   `RecvError(sqlx::Error)` and rebuilds the `PgListener` from scratch)
   may now race a sqlx-internal reconnect that fires a fraction of a
   second earlier. Net effect should be unchanged or slightly faster
   reconnect; metric to watch is `work_pglistener_reconnects_total`
   for unexpected churn (single-digit spike on the first NOTIFY storm
   would be normal; sustained churn would not).

4. **Lockfile dual-version of `webpki-roots`** — `bb8-redis 0.16` and
   `sqlx-core 0.8.6` pulled in different majors of `webpki-roots`
   (0.26.11 + 1.0.7). Cargo allows this. Increases the dep graph but
   not the runtime image significantly. Not actionable.

5. **`runtime-tokio` + `tls-rustls` feature aliases** — soft-deprecated
   in 0.8.x in favour of the discrete `runtime-tokio` (kept) +
   `tls-rustls-ring` / `tls-rustls-aws-lc-rs` split. We kept the old
   `tls-rustls` alias to minimise diff churn; sqlx silently routes
   `tls-rustls` to `tls-rustls-ring`. If a future 0.9 upgrade removes
   the alias entirely, swap to `tls-rustls-ring` explicitly at that
   time.

## Related

- [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]]
- [[Components/Rust-Work-Service]]
- [[Implement-Resilient-PgListener]]
- [[Upgrade-Sqlx-08-All-Rust-Services]]
