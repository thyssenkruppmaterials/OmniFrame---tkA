# Phase 12 — Observability

The engine is unsafe at warehouse scale without first-class telemetry. This
doc is the operator contract for what's emitted, where it's scraped, and
which thresholds page.

## Rust work-service `/metrics`

The endpoint lives at `GET /metrics` on the work service (port 8030 by
default; override via `WORK_ENGINE_PROMETHEUS_BIND`).

The `prometheus` crate is gated behind a feature flag in
`rust-work-service/Cargo.toml` so the scaffold compiles in isolation. To
turn metrics on:

```toml
prometheus = { version = "0.13", features = ["process"] }
```

…and replace `crate::observability::metrics::render_text` with the standard
`TextEncoder::encode_to_string(&prometheus::gather())` path.

### Metric inventory (Phase 12.1)

| Name | Type | Labels | Notes |
| ---- | ---- | ------ | ----- |
| `work_claim_duration_seconds` | Histogram | task_type, strategy_phase, outcome | buckets 5ms–10s |
| `work_claim_total` | Counter | task_type, priority, outcome | every claim path emit |
| `work_push_duration_seconds` | Histogram | task_type, mode={single,batch} | push_batch latency |
| `work_push_failure_total` | Counter | task_type, reason | reason ∈ zone_locked / zone_assigned / permission / other |
| `work_complete_duration_seconds` | Histogram | task_type, has_supervisor_signoff | supervisor PIN path tagged true |
| `work_release_total` | Counter | task_type, kind | voluntary / abandonment_soft / escalation_hard / heartbeat_stale |
| `work_queue_depth` | Gauge | org_hash, task_type, priority, status | refreshed every 30s |
| `work_reservation_age_seconds` | Histogram | task_type | sampled per scheduler tick |
| `work_dispatcher_fairness` | Counter | task_type, priority | starvation dashboard |
| `work_websocket_subscribers` | Gauge | org_hash, task_type | per-WS subscription |
| `work_websocket_messages_total` | Counter | direction={in,out}, message_type | |
| `work_idempotency_hits_total` | Counter | route | replay rate |
| `work_payload_validation_failures_total` | Counter | task_type, payload_version | non-zero = deploy mismatch |
| `work_capability_fallback_total` | Counter | task_type | non-zero ⇒ require_capability=false picked the fall-back |
| `work_starvation_total` | Counter | task_type, priority | Phase 2.6 starvation guard |
| `work_settings_refresh_total` | Counter | outcome | LISTEN consumer health |
| `work_ws_auth_failure_total` | Counter | reason | mismatch / replay / expired / bad_sig |
| `work_idempotency_cleanup_total` | Counter |  | TTL pass row count |

`org_hash` is bounded — never expose raw UUIDs in Prometheus labels.

## Sentry

The `WorkflowErrorBoundary` (Phase 4.5) forwards every render error to
`window.__OMNI_SENTRY_CAPTURE` with tags `{ work_type, flow }`. App shell
init (Phase 12.4a) wires this; the boundary stays Sentry-agnostic so
build doesn't break in Sentry-less environments.

## Alert rules (commit before canary)

Land these as YAML under `infra/alerts/work-engine/*.yaml` (operator-driven;
the file shape mirrors what the team already uses for other services):

- `work_claim_p95 > 500ms for 10 min` → page
- `work_claim_p99 > 2s for 5 min` → page
- `work_push_batch_p95(10) > 2s for 5 min` → page
- `work_reservation_age_p95 > heartbeat_release × 2 for 15 min` → page
- `work_starvation_total{priority="critical"} > 0 for 30s` → page
- `work_starvation_total{priority="hot"} > 0 sustained 30 min` → page
- `work_ws_auth_failure_total rate > 1% for 10 min` → page
- `work_engine_drift > 0` → ticket (not page) during shadow mode
- `work_payload_validation_failures_total > 0 in 5 min` → page (deploy mismatch)

## Drift dashboard (Phase 12.5)

Live admin dashboard during shadow mode reads from
`public.work_engine_drift`. The plan retires this dashboard once
`work_tasks_read_primary = true` for all orgs and zero drift has been
reported for the soak window.
