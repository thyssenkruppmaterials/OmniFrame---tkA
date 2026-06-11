---
tags: [type/implementation, status/active, domain/backend]
created: 2026-05-30
---
# Implement — mimalloc + moka Auth Cache (rust-work-service)

## Purpose / Context
First increment of the [[ADR-Rust-Dependency-Modernization-Roadmap]] on `rust-work-service` (the realtime hub, restored by [[Fix-Work-Service-Monorepo-Root-Directory-Misdeploy-2026-05-30]]). Two low-risk, high-ROI changes shipped together: a global allocator swap and an in-process JWT-validation cache. Branch `feat/rust-work-mimalloc-moka-auth-cache`, version bump `0.1.43 → 0.1.44`.

## mimalloc — global allocator
- `main.rs`: `#[global_allocator] static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;` + `mimalloc = "0.1"`.
- Rationale: rust-work is the most allocation-heavy service (per-subscriber `WsEvent` clone+serialize broadcast fan-out, per-NOTIFY deserialize, per-request JSON). Targets the allocator-retention RSS.
- **No Dockerfile change** — glibc/bookworm builder already has the C toolchain; vendored C links statically. Compatible with `panic="abort"` + the LTO release profile.

## moka — JWT-validation cache (inside `AuthClient`)
L1 cache in front of the rust-core `validate-with-profile` HTTP round-trip — the hottest inter-service hop (fired on every protected request + WS connect).
- `AuthClient.validate_token`: **hit** → return cached `AuthenticatedUser`, no rust-core call; **miss** → validate upstream, on success populate, on error return **without** caching.
- **Only successes are cached.** Errors / rejections / upstream failures are never stored → a revoked or expired token is re-checked next request. Staleness window for a mid-token authz change = the TTL.
- Transparent to callers — middleware unchanged. moka `Cache` is `Arc`-backed, so `AuthClient` clones share one cache.

### Env knobs (no new *required* env — safe defaults)
| Var | Default | Effect |
|---|---|---|
| `AUTH_CACHE_TTL_SECS` | `30` | Cache TTL; **`0` disables** caching (pure pass-through) |
| `AUTH_CACHE_MAX_CAPACITY` | `10_000` | LRU bound on distinct tokens |

Defaults shared via `AuthConfig::cache_settings_from_env()` (used by both `from_env` and the `main.rs` literal so the defaults live in one place).

### Metric
`work_auth_cache_total{outcome=hit|miss}` — bounded 2-value label, zero-seeded in `init_zero_value_series`. Hit-rate = `hit/(hit+miss)` measures load removed from rust-core.

## SLO considerations ([[ADR-Rust-Work-Service-Availability-SLO]])
Reduces rust-core load (helps `/ws` availability + p95). The only correctness tradeoff is the ≤30s staleness window on a mid-token permission/role change or revocation — bounded by the short TTL, disengageable via `AUTH_CACHE_TTL_SECS=0`. Live work-queue/dispatch state is deliberately **not** cached.

## Tests (all green)
- 4 new unit tests: cache enabled/disabled by TTL; **hit serves the user with no upstream call** (unreachable-upstream wiring proof); **failed validation is never cached** (security invariant).
- `cargo test` → **178 unit + all integration pass**. `cargo build --release` (LTO, codegen-units=1, mirrors Docker) clean. **No new clippy warnings** (all remaining lints are pre-existing, in other files).

## Prod result (v0.1.44, UTC 2026-05-31)
- `/metrics` → `work_auth_cache_total{outcome="hit"} 11`, `{outcome="miss"} 2` → **~85% hit rate immediately** post-deploy. rust-core per-WS-connect auth volume dropped.
- Clean boot, no panic/abort (mimalloc solid).

## Dead-code cleanup decision (do NOT delete `observability/middleware.rs`)
The build's 7 "never used" warnings were **all** in `observability/middleware.rs` — but that module is **intentional Phase 1.5 foundation**, not junk: migration `256_activate_work_engine_foundation.sql` creates `work_request_idempotency`, the ops runbook (`idempotency-replay-drift.md`) cites `observability::middleware::cleanup_expired` as the Rust cleanup path, and `tests/idempotency.rs` exercises it. It's unwired only because the SAP routes do idempotency inline. **Resolution:** module-level `#[allow(dead_code)]` + a comment explaining it's staged-but-unwired (remove when wired into mutating routes) — NOT deletion. `tests/common/mod.rs` got the same allow (shared fixtures unused in some test binaries; `ensure_zone_rules_enabled` IS used by `idempotency.rs`/`critical_priority.rs`). Build is now warning-free.

## Files
- `rust-work-service/Cargo.toml` (deps + version), `src/main.rs` (allocator + AuthConfig literal), `src/auth.rs` (cache + tests), `src/observability/metrics.rs` (metric), `src/observability/middleware.rs` + `tests/common/mod.rs` (allow attrs).

## Related
- [[Rust-Work-Service]]
- [[ADR-Rust-Dependency-Modernization-Roadmap]]
- [[ADR-Rust-Work-Service-Availability-SLO]]
- [[Fix-Work-Service-Monorepo-Root-Directory-Misdeploy-2026-05-30]]
- [[Optimize-Auth-Cache-Arc-Value-Work-Service]] — follow-up: Arc-wrap the cached value so a hit is a pointer bump, not a deep clone (0.1.45).
