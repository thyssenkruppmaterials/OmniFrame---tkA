---
tags: [type/implementation, status/active, domain/backend, domain/database]
created: 2026-05-20
---
# Upgrade rust-mdm-service to sqlx 0.8.6

## Purpose / Context

- **RUSTSEC-2024-0363**: Postgres protocol PoC exploit against sqlx 0.7.x; fixed in 0.8.1+. Mandatory upgrade across all Rust services.
- Pinned to `=0.8.6` (latest stable as of 2026-05-19). Includes PR #3863 (unnamed prepared statement when `persistent(false)`), which is the foundation for revisiting Supavisor transaction-mode pooling — see [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]].
- `rust-mdm-service` is a low-risk surface: ~26 inline queries, single Postgres pool, no `PgListener`, no nested savepoints. Expected to be a no-touch bump.

## Cargo.toml changes

```diff
-sqlx = { version = "0.7", features = ["postgres", "runtime-tokio", "tls-rustls", "uuid", "chrono", "json"] }
+sqlx = { version = "=0.8.6", features = ["postgres", "runtime-tokio", "tls-rustls", "uuid", "chrono", "json"] }
```

Feature flags preserved verbatim. `runtime-tokio` and `tls-rustls` are soft-deprecated aliases in 0.8.x but still compile cleanly and were left as-is per upgrade brief.

`cargo update -p sqlx -p sqlx-core -p sqlx-postgres -p sqlx-macros` resolved:

- `sqlx` → `0.8.6`
- `sqlx-core` → `0.8.6`
- `sqlx-postgres` → `0.8.6`
- `sqlx-macros` → `0.8.6`
- `sqlx-macros-core` → `0.8.6`

No other transitive bumps were forced by the lockfile rewrite for this service. (`cargo update` reported the usual list of major-version-locked crates as available — `axum 0.8`, `bb8 0.9`, `reqwest 0.13`, `thiserror 2.0`, etc. — but did NOT take them, since they are constrained by `Cargo.toml` minor pins. Out of scope for this PR.)

## Compile errors fixed

None — clean build. `cargo check` produced 0 errors and only the 4 pre-existing dead-code warnings (`group_id` in `DeviceListQuery`, `agent_version` in `HeartbeatRequest`, `AuthConfig::from_env`, six unused fields in `AppConfig`). All warnings are unrelated to sqlx.

None of the documented 0.7 → 0.8 breakage vectors triggered here:

- No custom `Encode` impls.
- No `MigrateError` `match` arms (service does not use `sqlx::migrate!`).
- No `HasValueRef` / GAT usage.
- No `#[derive(Type)]` with array-form `PgHasArrayType` collisions.
- No `#[sqlx(default, try_from = ...)]` on `FromRow` derives.

## Build time

`cargo build --release` (cold sqlx recompile, warm everything else): **79.99s** real (`/usr/bin/time -p`), 199.01s user, 19.92s sys.

## Test results

`cargo test --lib` failed with `no library targets found in package 'rust-mdm-service'` — this crate is `[[bin]]`-only, no `lib.rs`. Re-ran with `cargo test` (which picks up bin-embedded `#[cfg(test)]` modules):

```
running 7 tests
test tests::service_version_is_set ... ok
test config::tests::config_defaults_are_correct ... ok
test tests::service_name_is_correct ... ok
test auth::tests::extract_service_key_works ... ok
test auth::tests::extract_bearer_token_works ... ok
test auth::tests::extract_bearer_token_returns_none_for_missing ... ok
test api::routes::health::tests::health_check_returns_healthy ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

All 7 inline tests pass. No integration tests in this crate.

## Surprises

None. The audit's "low-effort upgrade" prediction held — clean compile on the first `cargo check` after the version bump, no source edits required, all tests green. The only minor wrinkle was that this crate is bin-only so `cargo test --lib` errors out; use `cargo test` (or `cargo test --bins`) instead.

## Related

- [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]]
- [[Upgrade-Sqlx-08-All-Rust-Services]]
