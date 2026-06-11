---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/infra]
created: 2026-05-02
---
# Implement Work Engine Operational Hardening (Items 14, 15, 18)

## Purpose / Context

Closed the three operational-hardening punch-list items that don't require
operator soak time, completing the Work Engine Foundation cutover before
operator-driven canary work begins. Migrations 254-266 are already applied,
shadow-write enabled for `c9d89a74-7179-4033-93ea-56267cf42a17` (j.AI
OneBox); all other work-engine flags remain FALSE.

Plan source-of-truth: `plans/work_engine_foundation_e9c4a217.plan.md`
(read-only).

## Details

### Item 14 — Prometheus exporter live

- `rust-work-service/Cargo.toml`: added `prometheus = "0.13"` (with the
  `process` feature so default process collectors come along) and
  `lazy_static = "1.4"`.
- `rust-work-service/src/observability/metrics.rs`: replaced the stub with
  a process-global `prometheus::Registry` and 14 metric handles registered
  via `lazy_static!`:
  - Histograms (LATENCY_BUCKETS_SECONDS): `work_claim_duration_seconds`,
    `work_push_duration_seconds`, `work_complete_duration_seconds`.
  - Int counters: `work_claim_total`, `work_push_failure_total`,
    `work_release_total`, `work_idempotency_hits_total`,
    `work_capability_fallback_total`, `work_settings_refresh_total`,
    `work_ws_auth_failure_total`, `work_payload_validation_failures_total`,
    `work_starvation_total`, `work_websocket_messages_total`.
  - IntGauge: `work_websocket_subscribers` (labels: `org_hash`, `task_type`).
  - Counter: `work_idempotency_cleanup_total`.
- `render_text()` now calls `TextEncoder::encode(&REGISTRY.gather(), …)`.
- `WsSubscriberGuard` provides RAII inc/dec around the WS connection
  lifecycle and a `rebind_org` helper for the post-Subscribe hash flip.
- Three unit tests added under `#[cfg(test)]` in the metrics module.
- Instrumentation wiring (route boundary only — strategy traits left
  untouched):
  - `claim_next` (api/routes/work.rs): timer wraps `claim_next_task`,
    emits `work_claim_duration_seconds{strategy_phase=ranker, outcome=hit|miss|error}`
    and `work_claim_total{priority,outcome}`.
  - `push_batch`: per-task savepoint loop timed; failures bucketed
    `savepoint_begin|savepoint_release|not_pushable|db_error`.
  - `reassign_zone`: pre-RPC SELECT on `work_request_idempotency`
    detects replays and increments `work_idempotency_hits_total{route="reassign_zone"}`.
  - WS upgrade (`websocket/mod.rs`): `WsSubscriberGuard` inc/dec, plus
    `work_ws_auth_failure_total{reason=bad_sig|missing_token|org_mismatch}`
    on rejection paths.
  - Settings listener (`settings/listener.rs`): emits
    `work_settings_refresh_total{outcome=success|error}` per consumed
    notification.
- `cargo check / build / test --lib` all pass; 20/20 lib tests green.

### Item 15 — Sentry init shim

- `pnpm add @sentry/react` → `^10.51.0`.
- New `src/lib/observability/sentry.ts`:
  - `initSentry()` — installs `Sentry.init` only when `VITE_SENTRY_DSN` is
    set, with `tracesSampleRate=0.1` in prod / `1.0` in dev. When DSN is
    unset it installs a no-op `window.__OMNI_SENTRY_CAPTURE` so the
    `WorkflowErrorBoundary` lookup stays safe.
  - Default integrations only (no replay / profiling).
  - `__resetSentryForTests()` exported for unit-test isolation.
- `src/main.tsx`: calls `initSentry()` once before the auto-update bootstrap
  and React mount.
- New Vitest under `src/lib/observability/__tests__/sentry.test.ts` covers
  both DSN-set and DSN-absent code paths (2/2 passing).

### Item 18 — CI strict matrix gate

- `.github/workflows/ci.yml` already invokes `node scripts/validate-check-matrix.mjs`
  in the `frontend-unit` job (step "Validate CI / check-matrix alignment")
  with no `CHECK_MATRIX_LENIENT` override. Strict-by-default behaviour was
  landed in a prior cleanup pass.
- `package.json`: appended `node scripts/validate-check-matrix.mjs` to both
  `quality:check` and `quality:ci` chains so local runs hit the gate
  before tests start.
- `docs/work-engine/phase-9-verification.md` updated with the precise CI
  invocation pattern, the current baseline of 22/40 present (18 missing),
  and a clarifying note that operators may export `CHECK_MATRIX_LENIENT=1`
  locally but CI MUST NOT.
- Local strict run today: `exit=1`, 18 missing scaffolds (confirmed).

## Verification

```
cargo check          → 0
cargo build          → 0
cargo test --lib     → 20 passed / 20 total
cargo test --no-run  → all integration test targets compile cleanly

vitest run (targeted) → 40/40 passed
node scripts/validate-check-matrix.mjs → exit=1 (18 missing — by design)
```

TSC reports pre-existing errors in untracked `pick-runner.tsx` /
`zone-audit-runner.tsx` (different work stream) — not introduced by this
change; my touched files are TS-clean.

## Related

- [[Implement-Work-Engine-Foundation]]
- [[Work-Tasks-Zone-Exclusivity]]
