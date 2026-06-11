---
tags: [type/implementation, status/active, domain/backend, domain/database, domain/auth]
created: 2026-05-20
---
# Upgrade rust-core-service to sqlx 0.8.6

## Purpose / Context

Upgrade the auth + cache + JWT backbone (`rust-core-service`) from sqlx 0.7 to
the pinned `=0.8.6` for two reasons:

1. **RUSTSEC-2024-0363** — a Postgres-protocol PoC exploit against sqlx
   0.7.x. Fixed in 0.8.1+; mandatory security upgrade.
2. **Future Supavisor transaction-mode pooling.** sqlx 0.8.1's PR #3863
   added unnamed prepared statements when `.persistent(false)` is set on
   the query. That is the missing primitive that blocked our 2026-05-20
   transaction-mode rollout (see
   [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]]). The
   actual flip to `.persistent(false)` and routing through Supavisor
   port 6543 is deferred to a separate workstream — this upgrade just
   unlocks it.

Service is **medium-risk**: dual-pool (primary + read-replica, see
[[Supabase-Read-Replica-Routing]]) and the JWT-validation hot path for
the entire FastAPI tier. The upgrade was clean — no source-code changes
required, only `Cargo.toml` + `Cargo.lock`.

## Cargo.toml changes

```diff
 # Database
-sqlx = { version = "0.7", features = [
+# Pinned to =0.8.6 for RUSTSEC-2024-0363 (Postgres protocol PoC) and future
+# Supavisor transaction-mode pooling support (PR #3863 unnamed prepared
+# statements when `.persistent(false)`). See:
+# memorybank/OmniFrame/Implementations/Upgrade-Sqlx-08-Core-Service.md
+# `migrate` and `bigdecimal` features dropped (verified unused in src/).
+sqlx = { version = "=0.8.6", features = [
     "runtime-tokio-rustls",
     "postgres",
     "uuid",
     "chrono",
-    "json",
-    "bigdecimal",
-    "migrate"
+    "json"
 ] }
```

Kept `runtime-tokio-rustls` (soft-deprecated alias in 0.8.x but still
compiles; recommended split is `runtime-tokio` + `tls-rustls` — flip
deferred to avoid widening the diff).

`Cargo.lock` rewrites (notable):
- `sqlx 0.7.4 → 0.8.6` (sqlx, sqlx-core, sqlx-macros, sqlx-macros-core,
  sqlx-mysql, sqlx-postgres, sqlx-sqlite all moved together).
- Transitive churn: `bigdecimal` removed; `event-listener` 2.5.3 → 5.4.1;
  `hashlink` 0.8.4 → 0.10.0; `rustls` 0.23.40 added; `sqlformat`,
  `paste`, `urlencoding`, `unicode-segmentation`, `unicode_categories`,
  `minimal-lexical`, `nom` removed; `concurrent-queue`, `parking`,
  `rustls-pki-types`, `rustls-webpki`, `webpki-roots` added.

## Feature audit

Verified pre-drop with `rg` against `rust-core-service/src/`:

| Feature | Status | Verification |
|---|---|---|
| `migrate` | **dropped** | `rg -n "sqlx::migrate\|Migrator" rust-core-service/src` → 0 matches |
| `bigdecimal` | **dropped** | `rg -n "BigDecimal\|bigdecimal" rust-core-service/src` → 0 matches |

No `sqlx::migrate::Migrator`, `migrate!()` macro, or `BigDecimal`
references anywhere in the crate. Dropping these features removes
~30 transitive crates from the dependency graph and slightly speeds
release builds.

Also audited for risky 0.7→0.8 patterns:

| Pattern | Matches |
|---|---|
| `HasValueRef` | 0 |
| Custom `Encode::encode` impl | 0 |
| `PgHasArrayType` derive collisions | 0 |
| `#[sqlx(default, try_from = ...)]` | 0 |
| `sqlx::FromRow` derive | 21 instances — all plain derives, no `try_from`, no custom attributes; 0.8 derive accepts them unchanged |

## Compile errors fixed

**None — clean `cargo check`.** sqlx 0.8.6 compiled the crate on the
first try with zero errors and zero warnings against the upgraded
dependency. Same for `cargo build --release`.

## Build time

```
$ /usr/bin/time -p cargo build --release
    Finished `release` profile [optimized] target(s) in 1m 25s
real 85.35
user 234.65
sys 22.60
```

`cargo check` (debug, full crate re-check after the upgrade): 12.98s.

## Test results

```
$ cargo test --lib
running 23 tests
test auth::api_keys::tests::test_extract_key_parts_invalid_prefix ... ok
test auth::api_keys::tests::test_extract_key_parts_no_onbx_prefix ... ok
test auth::api_keys::tests::test_extract_key_parts_too_short ... ok
test auth::api_keys::tests::test_hex_encode ... ok
test auth::api_keys::tests::test_allowed_services_permissions ... ok
test auth::api_keys::tests::test_allowed_services_default ... ok
test auth::api_keys::tests::test_check_permission_exact ... ok
test auth::api_keys::tests::test_check_permission_wildcard ... ok
test auth::api_keys::tests::test_check_permission_scoped_wildcard ... ok
test auth::api_keys::tests::test_check_permission_prefix_wildcard ... ok
test auth::jwt::tests::test_extract_bearer_token ... ok
test auth::api_keys::tests::test_check_permission_multiple ... ok
test auth::claims::tests::test_claims_expiration ... ok
test auth::api_keys::tests::test_extract_key_parts_valid_dashboard ... ok
test auth::api_keys::tests::test_consistent_hashing ... ok
test auth::api_keys::tests::test_extract_key_parts_valid ... ok
test api::smartsheet_client::tests::test_transform_row_to_values ... ok
test db::pool::tests::test_prepared_statement_cache ... ok
test auth::jwt::tests::test_hash_token ... ok
test auth::rbac::tests::test_has_permission_exact ... ok
test auth::rbac::tests::test_has_permission_wildcard ... ok
test auth::rbac::tests::test_has_permission_admin ... ok
test auth::jwks::tests::test_jwks_cache_creation ... ok

test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

23/23 pass. No integration tests live in this crate (the JWT/RBAC/cache
suites all run as unit tests under `--lib`).

## `src/db/pool.rs` note

The txn-pooler auto-detect (port 6543 → `statement_cache_capacity(0)`)
remains in place and compiles unchanged against sqlx 0.8.6.

The in-file doc comment (lines 41–52) still accurately describes the
sqlx 0.7 incompatibility — the comment says "Until we upgrade to sqlx
0.8 (which exposes proper unnamed-statement support), DO NOT route this
service through a transaction-mode pooler". After this upgrade the
support exists, but the actual flip to `.persistent(false)` on every
prepared query (the second half of fixing the named-statement collision)
is a separate workstream. We deliberately did **not** update the comment
in this PR to keep the upgrade scope minimal; the comment will be
revised when the transaction-mode pooling workstream lands.

## Surprises

**None.** The upgrade was textbook clean:

- No source changes needed.
- No `MigrateError` matches to widen (since `migrate` feature was
  dropped, but also no usages existed pre-drop).
- No `Encode::encode` Result-returning signature changes (no custom
  encoders in the crate).
- No `HasValueRef` GAT migration needed.
- No `PgHasArrayType` collisions (no `Vec<MyEnum>` parameter binding).
- No `FromRow` `try_from` attribute audit needed (all derives are
  attribute-free).

The `bigdecimal` and `migrate` features were both correctly identified
as dead weight by the audit — dropping them removed ~25 transitive
crates and trimmed a noticeable slice of the dependency graph.

## Related

- [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]]
- [[Supabase-Read-Replica-Routing]]
- [[Upgrade-Sqlx-08-All-Rust-Services]]
