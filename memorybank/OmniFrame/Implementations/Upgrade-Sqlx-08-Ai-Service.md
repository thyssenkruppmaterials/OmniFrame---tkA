---
tags: [type/implementation, status/active, domain/backend, domain/database]
created: 2026-05-20
---
# Upgrade rust-ai-service to sqlx 0.8.6

## Purpose / Context
Bump `rust-ai-service` from `sqlx = "0.7"` to a pinned `sqlx = "=0.8.6"` to:

- Clear **RUSTSEC-2024-0363** (Postgres protocol PoC against sqlx 0.7.x; fixed in 0.8.1+).
- Pick up PR #3863 (`persistent(false)` → unnamed prepared statement), which is the
  prerequisite for revisiting Supavisor transaction-mode pooling later. The prior
  attempt on sqlx 0.7 is documented in
  [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]].

This is a low-risk service — small surface (~5 ad-hoc queries, optional DB usage,
single pool, no `PgListener`).

## Cargo.toml changes

```diff
-sqlx = { version = "0.7", features = ["postgres", "runtime-tokio", "tls-rustls", "uuid", "chrono", "json"] }
+sqlx = { version = "=0.8.6", features = ["postgres", "runtime-tokio", "tls-rustls", "uuid", "chrono", "json"] }
```

Features unchanged. `runtime-tokio` / `tls-rustls` remain (soft-deprecated aliases in
0.8.x but still compile — left alone per upgrade plan).

`cargo update -p sqlx -p sqlx-core -p sqlx-postgres -p sqlx-macros` rewrote
`Cargo.lock`:

- `sqlx 0.7.4 → 0.8.6` (also `sqlx-core`, `sqlx-macros`, `sqlx-macros-core`,
  `sqlx-mysql`, `sqlx-postgres`, `sqlx-sqlite`).
- Transitive bumps: `rustls 0.21 → 0.23`, `rustls-webpki 0.101 → 0.103`,
  `hashbrown 0.14 → 0.15`, `hashlink 0.8 → 0.10`, `heck 0.4 → 0.5`,
  `event-listener 2.5 → 5.4`, `libsqlite3-sys 0.27 → 0.30`, `webpki-roots 0.25 → 0.26/1.0`,
  plus `thiserror 2.0` added alongside the existing 1.x.
- Dropped: `ahash`, `sct`, `sqlformat`, `nom`/`minimal-lexical`, `syn 1.x`, `paste`,
  `unicode-segmentation`, `unicode_categories`, `urlencoding`.
- Added: `base64 0.22`, `concurrent-queue`, `foldhash`, `parking`, `rustls-pki-types`,
  `thiserror 2.0`.

## Compile errors fixed
None — clean build. `cargo check` finished in 23.71s with zero warnings or errors.
None of the usual 0.7→0.8 hazards applied here:

- No `MigrateError` matches in this service.
- No custom `Encode` impls.
- No custom `Decode`/GAT usage referencing `HasValueRef`.
- No derive macros that would collide with the new `PgHasArrayType` rules.
- No `#[sqlx(default, try_from = ...)]` on `FromRow`.

## Build time
`cargo build --release` (cold-ish target dir, post-`cargo check`): **80.02s** real
(`/usr/bin/time -p` → real 80.02, user 194.34, sys 18.79). Profile from `Cargo.toml`
is `opt-level = 3`, `lto = true`, `codegen-units = 1`.

## Test results
No `lib` target exists (`cargo test --lib` → "no library targets found in package
`drone-ai-service`"). Ran `cargo test` against the binary's unit tests instead:

```
running 3 tests
test ai::fallback::tests::test_extract_json_direct ... ok
test ai::huggingface::tests::test_client_creation ... ok
test ai::fallback::tests::test_extract_json_from_code_block ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

All three pre-existing tests pass.

## Surprises
- Package name in `Cargo.toml` is `drone-ai-service` (not `rust-ai-service`); the
  service directory is `rust-ai-service/`. Worth remembering for future scripted
  upgrades that key off package name.
- `cargo test --lib` fails hard with exit 101 because this crate is a pure binary.
  Use plain `cargo test` here, or skip the lib-test step for binary-only services.

## Related
- [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]]
- [[Upgrade-Sqlx-08-All-Rust-Services]]
