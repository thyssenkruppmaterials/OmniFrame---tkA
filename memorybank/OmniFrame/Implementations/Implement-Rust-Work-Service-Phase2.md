---
tags: [type/implementation, status/active, domain/infra, domain/realtime, domain/observability]
created: 2026-05-06
---

# Implement Rust Work Service Integration — Phase 2

Phase 2 (telemetry foundation) of the comprehensive
[[plans/rust_work_service_full_integration_5b88165d.plan]].
HARD precondition for Phase 4 (the headline agent-on-Rust-WS migration)
— ships the metrics, alerts, runbooks, dashboard, and SLO draft that
make the cutover monitorable.

Picks up from [[Implement-Rust-Work-Service-Phase0-Phase1]].

## Deliverables

### A. New Rust gauge — broadcast channel saturation

`work_ws_broadcast_buffer_pct{org_hash}` — `GaugeVec` (f64), registered
in [`rust-work-service/src/observability/metrics.rs`](../../../rust-work-service/src/observability/metrics.rs)
alongside the existing `WORK_WS_LAGGED_EVENTS_TOTAL` counter.

Sampled inside the WS send loop in
[`rust-work-service/src/websocket/mod.rs`](../../../rust-work-service/src/websocket/mod.rs)
on every successful `rx.recv()` call. Computed as:

```
let pct = (BROADCAST_CHANNEL_CAPACITY.saturating_sub(rx.len()) as f64
           / BROADCAST_CHANNEL_CAPACITY as f64) * 100.0;
```

100 ⇒ caught up; 0 ⇒ at the cliff (next event will trip Lagged). The
gauge is also forced to 0.0 in the `RecvError::Lagged(n)` branch so
the panel reflects the cliff event itself, not just the post-resync
recovery.

`BROADCAST_CHANNEL_CAPACITY` is a new public constant exported from
the websocket module so the sampler doesn't have to hard-code 1000
twice. Tokio's `broadcast::Receiver` doesn't expose `capacity()`
directly, hence the constant.

The gauge complements the existing
`work_ws_lagged_events_total{org_hash}` counter — counter is the
after-the-fact drop count, gauge is the leading indicator.

**Sample Prometheus exposition (captured locally via a one-shot
`cargo run --example`):**

```
# HELP work_ws_broadcast_buffer_pct Broadcast-channel buffer headroom
# (% remaining) sampled by each WS send loop on every successful
# recv. Pairs with `work_ws_lagged_events_total` — this gauge is
# the leading indicator (how close to the cliff), the counter is the
# after-the-fact drop count.
# TYPE work_ws_broadcast_buffer_pct gauge
work_ws_broadcast_buffer_pct{org_hash="c997"} 99.7
work_ws_broadcast_buffer_pct{org_hash="unbound"} 100
```

The `unbound` bucket is sockets that haven't sent a `Subscribe` yet
(matches the existing `WsSubscriberGuard` initial label).

### B. New Rust counter — HTTP requests total

`work_http_requests_total{route, method, status}` — `IntCounterVec`,
also registered in `metrics.rs`. Backs the `WorkServiceHealthFailing`
alert (5xx-rate threshold). Cardinality is bounded because `route` is
the axum `MatchedPath` template (e.g.
`/api/v1/work/tasks/:id/complete`), not the raw URL.

Incremented by a new axum middleware in
[`rust-work-service/src/observability/http_metrics.rs`](../../../rust-work-service/src/observability/http_metrics.rs):

```rust
pub async fn track_http_metrics(req: Request, next: Next) -> Response {
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "unmatched".to_string());
    let method = req.method().as_str().to_string();
    let response = next.run(req).await;
    let status = response.status().as_u16().to_string();
    metrics::WORK_HTTP_REQUESTS_TOTAL
        .with_label_values(&[&route, &method, &status])
        .inc();
    response
}
```

Layered at the top of the merged Router in
[`rust-work-service/src/main.rs`](../../../rust-work-service/src/main.rs)
so it sees every request (public + protected — `/health`, `/metrics`,
and `/ws` upgrade attempts included). 404s on unmatched paths are
bucketed as `route="unmatched"` to surface scanning traffic without
unbounded label growth.

**Sample Prometheus exposition:**

```
# HELP work_http_requests_total Total HTTP requests served. Labels:
# route (matched path template), method, status (3-digit). Used by
# the WorkServiceHealthFailing alert and per-route dashboards.
# TYPE work_http_requests_total counter
work_http_requests_total{method="GET",route="/health",status="200"} 1
work_http_requests_total{method="POST",route="/api/v1/work/claim",status="200"} 42
work_http_requests_total{method="POST",route="/api/v1/work/push",status="500"} 1
```

### C. Prometheus alert rules

[`docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml`](../../../docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml)
ships four alerts:

| Alert | Severity | Threshold | Pages? |
|---|---|---|---|
| `WorkWsLaggedEventsSustained` | warning | `increase(work_ws_lagged_events_total[5m]) > 0` for 5min | ticket |
| `WorkWsAuthFailureOrgMismatch` | critical | `increase(work_ws_auth_failure_total{reason="org_mismatch"}[1m]) > 0` | page on-call |
| `WorkServiceHealthFailing` | critical | 5xx-rate over 5m > 1% sustained 5min | page on-call |
| `WorkIdempotencyReplayDrift` | warning | rate(`work_idempotency_hits_total`[10m]) drift > ±50% from same-hour baseline | ticket |

Each carries `runbook_url` and (where applicable) `dashboard_url`
annotations so PagerDuty / Slack notifications deep-link to triage
material.

The drift alert uses the existing `work_idempotency_hits_total`
counter (registered pre-Phase-2). The `clamp_min(..., 0.001)` guard
keeps the divide-by-zero edge case safe when the baseline is
literally zero (e.g. brand-new tenant).

### D. Runbooks

| Runbook | Path | Scenario |
|---|---|---|
| WS Lagged Events | [`docs/runbooks/work-engine/ws-lagged-events.md`](../../../docs/runbooks/work-engine/ws-lagged-events.md) | already existed; minor edits to drop the `(TODO)` dashboard reference and add the new `work_ws_broadcast_buffer_pct` gauge to "Related metrics" |
| WS Auth Failure (org_mismatch) | [`docs/runbooks/work-engine/auth-failure-org-mismatch.md`](../../../docs/runbooks/work-engine/auth-failure-org-mismatch.md) | new |
| Service Health Failing | [`docs/runbooks/work-engine/service-health-failing.md`](../../../docs/runbooks/work-engine/service-health-failing.md) | new |
| Idempotency Replay Drift | [`docs/runbooks/work-engine/idempotency-replay-drift.md`](../../../docs/runbooks/work-engine/idempotency-replay-drift.md) | new |

Each follows the standard format:

- Symptom (with the exact PromQL the alert fires on)
- Likely causes (3–5 bullets, ranked by frequency in our experience)
- Triage queries (Prometheus + work-service log + SQL where relevant)
- Mitigation playbook (consumer-side / server-side / load-test
  guidance)
- Escalation path
- Related metrics + dashboards
- Related (cross-links to sibling notes)

`(TODO)` runbook pointers in
[`rust-work-service/src/observability/metrics.rs`](../../../rust-work-service/src/observability/metrics.rs)
and
[`rust-work-service/src/websocket/mod.rs`](../../../rust-work-service/src/websocket/mod.rs)
were checked — no literal `(TODO)` strings exist in either file; the
existing runbook doc-comments already point at `docs/runbooks/work-engine/ws-lagged-events.md`
which is live.

### E. Grafana dashboard JSON

[`docs/runbooks/work-engine/dashboards/rust-work-service.json`](../../../docs/runbooks/work-engine/dashboards/rust-work-service.json)
ships a 15-panel v8+ dashboard:

1. **Service Up** — `up{job="rust-work-service"}` stat panel
2. **WebSocket Subscribers** — per-org timeseries from `work_websocket_subscribers`
3. **Broadcast Channel Saturation** — Phase 2 gauge (min + avg per org_hash); thresholds at 25%/50%
4. **WS Lagged Events (cumulative)** — counter timeseries
5. **WS Lagged Events Rate (5m)** — alert-source rate
6. **Listener Event Rate** — proxy via `work_websocket_messages_total{direction="out"}` + `work_notifications_total` + `work_dispatch_broadcast_total` (Phase 4 will add a per-listener counter for `rf_putaway_listener` when it lands)
7. **HTTP Requests by Status** — stacked, per-status-class
8. **5xx Rate (% of total)** — mirrors the alert query; threshold band at 1%
9. **Claim Latency p50/p95/p99** — `histogram_quantile` on `work_claim_duration_seconds_bucket`
10. **Push Latency p50/p95/p99**
11. **Complete Latency p50/p95/p99**
12. **WebSocket Auth Failures** — bucketed by reason; org_mismatch is the alert source
13. **Idempotency Replay Health** — replay-hit rate per route + cleanup sweeper liveness
14. **Presence + Entity Focus** — Tier 2 feature gauges
15. **Redis + DB Errors (Subsystem Health)** — dependency-error rates

Top-of-dashboard `links` carry the four runbook URLs + the SLO ADR so
on-call has one click from pager → dashboard → runbook.

The dashboard's `templating` exposes an `org_hash` variable populated
from `label_values(work_websocket_subscribers, org_hash)` so panels
can be filtered to one tenant when triaging a per-org incident. JSON
validated with `python3 -c "import json; json.load(open(...))"`.

### F. Availability SLO ADR

[`memorybank/OmniFrame/Decisions/ADR-Rust-Work-Service-Availability-SLO.md`](../Decisions/ADR-Rust-Work-Service-Availability-SLO.md)
captures the draft SLO targets:

- `/ws` availability: 99.9% over rolling 30-day window
- `/api/v1/*` p95 latency: < 200ms
- `/metrics` scrape success: 99.95%
- Lagged events: zero sustained
- Cross-tenant org-filter regressions: zero tolerance

Multi-window burn-rate alerting (14.4×/6×/3×) and an explicit error
budget policy (>50% / 10–50% / <10%). Status: **Draft, locked-in
2026-05-20** (2 weeks after Phase 4 cutover, after we have baseline
data from this Phase 2 telemetry).

Open items in the ADR cover the burn-rate PromQL (parked behind
production data), the Datadog/Grafana dashboard URL stamping, the
escalation path codification, and the Tier 0 customer carve-out
question.

## Files created

- `rust-work-service/src/observability/http_metrics.rs` (new module +
  `track_http_metrics` middleware + tests)
- `docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml`
- `docs/runbooks/work-engine/auth-failure-org-mismatch.md`
- `docs/runbooks/work-engine/service-health-failing.md`
- `docs/runbooks/work-engine/idempotency-replay-drift.md`
- `docs/runbooks/work-engine/dashboards/rust-work-service.json`
- `memorybank/OmniFrame/Decisions/ADR-Rust-Work-Service-Availability-SLO.md`
- `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase2.md`
  (this note)

## Files modified

- `rust-work-service/src/observability/metrics.rs` — added
  `WORK_WS_BROADCAST_BUFFER_PCT` (`GaugeVec`),
  `WORK_HTTP_REQUESTS_TOTAL` (`IntCounterVec`), name constants, and
  two new tests.
- `rust-work-service/src/observability/mod.rs` — re-export
  `http_metrics` module.
- `rust-work-service/src/websocket/mod.rs` — sample the new gauge in
  the send loop on every successful `rx.recv()` AND on the
  `RecvError::Lagged(n)` branch (force 0%); export
  `BROADCAST_CHANNEL_CAPACITY` constant.
- `rust-work-service/src/main.rs` — layer `track_http_metrics` on the
  merged Router so every request flows through it.
- `docs/runbooks/work-engine/ws-lagged-events.md` — drop `(TODO)`
  dashboard reference, add `work_ws_broadcast_buffer_pct` to the
  metrics list.

## Quality gates

| Gate | Status |
|---|---|
| `cargo build` | ✓ clean (7 pre-existing warnings in `observability/middleware.rs` for unused `IdempotencyError` / `lookup` / `record` / `cleanup_expired` — Phase 1.5 scaffold; not introduced by Phase 2) |
| `cargo test --lib` | ✓ 27/27 pass (including 2 new gauge/counter tests + 2 new http_metrics tests) |
| `cargo clippy --all-targets` | ✓ no new warnings (pre-existing `clamp-like pattern` + `redundant field names` in `src/api/routes/work.rs`) |
| `pnpm tsc -b --noEmit` | ✓ clean (no FE changes) |
| `pnpm build` | ✓ clean (chunk sizes unchanged from Phase 1) |
| Dashboard JSON validity | ✓ `python3 -c "import json; json.load(open(...))"` |
| Alerts YAML validity | ✓ `python3 -c "import yaml; yaml.safe_load(open(...))"` |

## Phase 2 entry → Phase 4 readiness

The Phase 2 deliverables make the Phase 4 cutover monitorable. Before
Phase 4 ships the new agent WS client and parallel-run telemetry, the
SRE can:

1. Watch `work_ws_broadcast_buffer_pct{org_hash="c997"}` (the agent's
   org) on the dashboard and pre-compare with the lagged-events
   counter to characterize the steady-state headroom.
2. Use the `WorkServiceHealthFailing` alert to catch a regression
   from the agent's new POST endpoints (e.g. SAP Material Master
   mutations in Phase 5) before it becomes user-visible.
3. Use `WorkWsAuthFailureOrgMismatch` to catch a regression in the
   agent's new `WS-Subscribe-Token` minting (Phase 4 step 4.6 flips
   `WORK_WS_REQUIRE_TOKEN=true`) before it cuts off legitimate
   traffic.
4. Use `WorkIdempotencyReplayDrift` to catch the agent reconnect-
   loop scenario (Phase 4 risk #3) within minutes instead of hours.

The SLO ADR's `lock-in 2026-05-20` deadline is exactly 2 weeks from
today (2026-05-06); that gives Phase 4 time to ship + bed in before
the team commits to the numbers.

## Open items for Phase 3 (or sooner)

- Per-listener event-rate counter — the dashboard's "Listener Event
  Rate" panel currently uses `work_websocket_messages_total{direction="out"}`
  as a proxy. A dedicated counter (e.g.
  `work_listener_events_total{listener="sap_agents|sap_jobs|...|rf_putaway"}`)
  is cleaner and lands naturally in Phase 4 when `rf_putaway_listener`
  is added.
- Burn-rate PromQL for the 99.9% `/ws` SLO. Parked in the ADR until
  there's production data to size the windows correctly.
- HTTP latency histogram per route (we have claim/push/complete
  histograms but not a generic per-route latency). Ideally another
  middleware that wraps `next.run` in a `Histogram::start_timer()`
  call. Easy follow-up.
- Wire the dashboard JSON into the production Grafana instance and
  capture the assigned dashboard ID; backfill the URLs in the alert
  annotations + SLO ADR.

## Related

- [[Implement-Rust-Work-Service-Phase0-Phase1]] — predecessor; Phase
  0 baseline + Phase 1 free wins (presence flip, env-var stub, dead
  code removal).
- [[ADR-Rust-Work-Service-Availability-SLO]] — the SLO this Phase
  2 telemetry defends.
- [[ADR-Broadcast-Channel-Sizing]] — sibling decision; the broadcast
  channel buffer's headroom is what `work_ws_broadcast_buffer_pct`
  measures.
- [[ADR-Presence-Architecture-Next-Steps]] — the Tier 2 architecture
  the metrics surface in panel 14.
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] — the Tier 1
  cutover that sets the throughput floor the Phase 2 telemetry
  measures against.
- [[Roadmap-Rust-WS-Unlocks]] — the seed planning doc.
- [`docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml`](../../../docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml)
  — the four Phase 2 alerts.
- [`docs/runbooks/work-engine/dashboards/rust-work-service.json`](../../../docs/runbooks/work-engine/dashboards/rust-work-service.json)
  — the Phase 2 Grafana dashboard.
