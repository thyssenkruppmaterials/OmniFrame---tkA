---
tags: [type/implementation, status/active, domain/backend, domain/database]
created: 2026-05-20
---
# Upgrade rust-dashboard-service to sqlx 0.8.6

## Purpose / Context
Patch **RUSTSEC-2024-0363** (Postgres protocol PoC against sqlx 0.7.x; fixed in
0.8.1+) and pin to `=0.8.6`, the latest stable as of 2026-05-19. 0.8.6 ships
PR #3863 (unnamed prepared statement when `persistent(false)`), which is the
foundation we need to revisit Supavisor transaction-mode pooling — the
previous attempt on sqlx 0.7 failed and is documented in
[[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]].

`rust-dashboard-service` is the lowest-risk service in the fleet:
~4 sqlx callsites in `src/main.rs`, single `PgPool`, no `PgListener`, no
explicit transactions, no custom `Encode`/`Decode` impls, no `FromRow`
derives with `try_from`. Used as the canary for the broader rollout
tracked in [[Upgrade-Sqlx-08-All-Rust-Services]].

## Cargo.toml changes

```diff
-sqlx = { version = "0.7", features = ["postgres", "runtime-tokio", "tls-rustls", "uuid", "chrono", "json"] }
+sqlx = { version = "=0.8.6", features = ["postgres", "runtime-tokio", "tls-rustls", "uuid", "chrono", "json"] }
```

All features preserved verbatim. `runtime-tokio` and `tls-rustls` are
soft-deprecated aliases in 0.8.x but still resolve correctly — left as-is
to keep the diff minimal.

`cargo update -p sqlx -p sqlx-core -p sqlx-postgres -p sqlx-macros`
rewrote `Cargo.lock` with the following notable transitive bumps:

- `sqlx 0.7.4 → 0.8.6` (and all `sqlx-*` siblings)
- `rustls 0.21.12 → 0.23.40`
- `rustls-webpki 0.101.7 → 0.103.13`
- `event-listener 2.5.3 → 5.4.1`
- `hashlink 0.8.4 → 0.10.0`
- `libsqlite3-sys 0.27.0 → 0.30.1`
- `webpki-roots 0.25.4 → 0.26.11` (+1.0.7 added)
- Added `thiserror 2.0.18` (alongside existing 1.0.69)
- Removed: `ahash 0.8.12`, `sqlformat`, `sct`, `unicode-segmentation`,
  `unicode_categories`, `urlencoding`, `paste`, `heck 0.4.1`,
  `getrandom 0.3.4`, `hashbrown 0.14.5`

## Compile errors fixed
None — clean build on the first `cargo check`.

The audited risk surface (per task brief) was not triggered:
- No `MigrateError` matches in service code.
- No custom `Encode::encode` impls.
- No `<DB as HasValueRef<'r>>::ValueRef` usages.
- No `#[derive(sqlx::Type)]` enums needing `#[sqlx(no_pg_array)]`.
- No `FromRow` derives with `try_from`.

The four sqlx callsites in `src/main.rs` (`PgPoolOptions`, two
`sqlx::query_as::<_, tuple>(...)`, one `sqlx::query("SELECT 1")`,
plus `sqlx::PgPool` in `AppState`) are all on the unchanged subset of
the 0.8 API.

## Build time
`cargo build --release` (cold target dir for sqlx-* recompile,
warm for unrelated crates): **65 s** wall.

## Test results
No `[lib]` target, so `cargo test --lib` errors with
`no library targets found in package`. Ran `cargo test` (binary
+ inline `#[cfg(test)]` modules) instead:

```
running 7 tests
test auth::tests::extract_bearer_token_returns_none_when_missing ... ok
test auth::tests::extract_service_key_returns_key_when_present ... ok
test auth::tests::extract_bearer_token_returns_token_for_valid_header ... ok
test auth::tests::extract_bearer_token_returns_none_for_non_bearer_scheme ... ok
test auth::tests::authenticated_user_deserializes_with_empty_permissions ... ok
test auth::tests::authenticated_user_serializes_all_fields_correctly ... ok
test auth::tests::validate_service_key_accepts_exact_match_and_rejects_others ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

All 7 auth-module tests pass. There are no sqlx-touching tests in
this crate; the upgrade exercises sqlx only at runtime via
`run_aggregation` and `/healthz`.

## Surprises
- None functionally. The only mild surprise is how heavy the
  transitive churn was for what is officially a "minor" release —
  `rustls` and `event-listener` got major-version bumps, and
  ~10 crates were dropped from the dep graph entirely. Worth
  watching when the heavier services (`rust-core-service`,
  `rust-work-service`) get the same treatment, since those have
  their own pins on `rustls` and `webpki-roots` for JWKS / TLS code.
- `cargo test --lib` does not work for this crate (binary-only).
  Future automation should use `cargo test` (no `--lib`) or
  `cargo test --bins` here.

## Related
- [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]]
- [[Upgrade-Sqlx-08-All-Rust-Services]]
