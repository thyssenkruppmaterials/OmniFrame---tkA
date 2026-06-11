---
tags: [type/implementation, status/active, domain/backend, domain/rust, topic/performance]
created: 2026-05-30
---
# Optimize — Arc-wrap the auth-cache value (rust-work-service)

## Purpose / Context
Follow-up micro-optimization to [[Implement-Mimalloc-And-Moka-Auth-Cache-Work-Service]]. The moka L1 JWT-validation cache stored a bare `AuthenticatedUser`, so **every cache hit deep-cloned** the struct — its `Vec<String>` permissions plus several `String`s — and then the value was deep-cloned **again** when each route handler extracted `Extension<AuthenticatedUser>` out of request extensions. Two heap-heavy clones per protected request, on the hottest inter-service path (fired on every protected request + WS connect under reconnect storms). `rust-work-service` `0.1.44 → 0.1.45`.

## The fix — `Cache<String, Arc<AuthenticatedUser>>`
Wrap the cached value in `Arc` and thread that same `Arc` all the way to the handlers, so the deep clones collapse into pointer bumps:
- **`auth.rs`** — `cache: Option<Cache<String, Arc<AuthenticatedUser>>>`; `validate_token` now returns `Arc<AuthenticatedUser>`. Hit → return the `Arc` (cache.get clones a pointer). Miss → `Arc::new(user)`, insert `Arc::clone` into cache, return the `Arc`. Cache-disabled (`ttl=0`) path maps the uncached result through `Arc::new`. `validate_token_uncached`/`try_validate_token` still build an owned `AuthenticatedUser` (no behavior change).
- **`middleware.rs`** — all three auth paths inject `Arc<AuthenticatedUser>` into request extensions (service-key `Arc::new(system_user)`, agent `Arc::new(synth)`, user JWT the `Arc` from `validate_token`). The rare org-id DB fallback uses `Arc::make_mut` so it clones the inner user **only** when org is missing, and the resolved org never leaks back into the shared cached entry. `require_organization` + `get_current_user` read `Arc<AuthenticatedUser>` from extensions.
- **Route handlers (12 files, 46 sites)** — `Extension<AuthenticatedUser>` → `Extension<Arc<AuthenticatedUser>>`. Bodies were untouched: every access is a borrow (`.as_ref()`/`.as_deref()`/`&user.user_id`/`.iter()`/`.clone()`) and helpers take `&AuthenticatedUser`, so `Arc` deref-coercion covers them all.

### Why the half-measure doesn't help
Arc-wrapping only the cache value while keeping `validate_token`/extensions owned gives **zero** net win: `Arc::unwrap_or_clone` at the boundary still deep-clones (cache holds a ref → refcount > 1), and the handler still deep-clones out of `Extension`. The `Arc` must propagate cache → middleware → extensions → handler for the clones to actually disappear. Common hit path is now **0 deep clones**.

## Correctness notes
- Cache semantics unchanged: only successes cached; errors/revocations re-checked each request; TTL-bounded staleness window. `work_auth_cache_total{outcome=hit|miss}` metric untouched.
- `Arc::make_mut` preserves the prior behavior of NOT writing the org-id fallback back into the cache (the cached entry stays as rust-core returned it).

## Verify (release/prod, not local single requests)
Per the analysis that prompted this: a cache only wins against a real network hop, and the allocator/clone wins only exist in `--release`. Don't judge by a local single request. Use the existing metric and a concurrent release-build load test:
```
# hit rate over 5m — high ⇒ cache + Arc are doing their job
sum(rate(work_auth_cache_total{outcome="hit"}[5m])) / sum(rate(work_auth_cache_total[5m]))
```
`oha`/`wrk` against an authenticated endpoint, release build, p50/p99.

## Tests
- `cargo check --all-targets` clean. `cargo test` all pass (existing auth cache-hit / failed-validation-not-cached tests updated to `Arc::new(sample_user())`). `cargo clippy` — 8 warnings, **all pre-existing** (sap_agents.rs:947, work.rs:235/348/965, db/, triggers/evaluator.rs), none at changed lines → **no new lints**. Release LTO build clean.

## Files
`rust-work-service/Cargo.toml` (0.1.45), `src/auth.rs`, `src/middleware.rs`, and 12 route files under `src/api/routes/` (work, sap_agents, triggers, notifications, presence, agent_identity, entity_focus, workers, dispatch, sap_mutations, sap_console, sap_testing).

## Related
- [[Implement-Mimalloc-And-Moka-Auth-Cache-Work-Service]]
- [[Rust-Work-Service]]
- [[ADR-Rust-Dependency-Modernization-Roadmap]]
- [[ADR-Rust-Work-Service-Availability-SLO]]
