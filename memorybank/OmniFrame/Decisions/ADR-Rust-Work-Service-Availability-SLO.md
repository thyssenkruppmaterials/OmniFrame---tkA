---
tags: [type/decision, status/active, domain/infra, domain/realtime]
created: 2026-05-06
---

# ADR — rust-work-service Availability SLO

## Status: Draft (locked-in 2 weeks after Phase 4 cutover)

## Context

The [[plans/rust_work_service_full_integration_5b88165d.plan]]
moves the on-prem agent (Phase 4), SAP Material Master mutations
(Phase 5), and the Agent Triggers evaluator (Phase 9) onto
rust-work-service as the critical path. Pre-Phase-4, the service was
load-bearing for FE Tier 1 channels (see
[[Migrate-Tier1-Deferred-Channels-To-Rust-WS]]) and Tier 2 product
surfaces (presence, entity-focus, notifications, dispatch); post-Phase-4
it owns the entire SAP automation pipeline.

Phase 2 of the integration plan
([[Implement-Rust-Work-Service-Phase2]]) shipped the telemetry
foundation — the `work_ws_broadcast_buffer_pct` leading-indicator
gauge, the `work_http_requests_total` counter, the four Prometheus
alerts under
[`docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml`](../../../docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml),
and the Grafana dashboard at
[`docs/runbooks/work-engine/dashboards/rust-work-service.json`](../../../docs/runbooks/work-engine/dashboards/rust-work-service.json).
This ADR captures the SLO numbers that telemetry will defend; the
exact thresholds are flagged Draft until 2 weeks of post-Phase-4
production data is in.

## Decision

| Indicator                              | Target                                  |
| -------------------------------------- | --------------------------------------- |
| `/ws` availability                     | **99.9%** rolling 30-day window         |
| `/api/v1/*` p95 latency                | **< 200ms**                             |
| `/metrics` scrape success              | **99.95%**                              |
| `work_ws_lagged_events_total`          | zero sustained (any > 0 for 5min = SEV) |
| Cross-tenant org-filter regressions    | **zero tolerance** (P0 if observed)     |

The `/ws` SLO is the headline indicator post-Phase-4: if the WS pipe
is unreliable, the on-prem agent loses event delivery and the SAP
automation pipeline silently falls back to the legacy Realtime path
(or, when `OMNIFRAME_AGENT_USE_RUST_WS=1` is the only path, stalls
entirely).

The `/api/v1/*` p95 < 200ms covers the synchronous request path
(claim, push, complete). The Phase 2 dashboard exposes p50/p95/p99
timeseries for each.

The `/metrics` scrape success target is high because the alerts
themselves depend on it — silence the metrics and you silence the
alerts.

The lagged-events and cross-tenant lines are zero-tolerance because
their cost (silent staleness for an org, cross-tenant data leak)
dwarfs the cost of the alert-fatigue tax.

## Burn rate alerting (multi-window, multi-burn-rate)

The 99.9% / 30-day budget allows ~43.2min of downtime per month. The
multi-window approach pages on FAST burn (catch outages now) and
tickets on SLOW burn (catch slow leaks before they exhaust the budget):

| Burn rate | Budget consumed | Window | Severity        |
| --------- | --------------- | ------ | --------------- |
| 14.4×     | 2% in 1h        | 1h     | page on-call    |
| 6×        | 5% in 6h        | 6h     | ticket / Slack  |
| 3×        | 10% in 24h      | 24h    | ticket / Slack  |

The 14.4× threshold pairs with `WorkServiceHealthFailing` (5xx-rate >
1% sustained 5min) so a deploy regression that drives 5xx pages within
~5min, not 30. The 3× / 6× thresholds are slow-leak signals.

(The exact PromQL for burn-rate calculation is parked behind landing
real production data — the `up` / `work_http_requests_total{status=~"5.."}`
ratio approach is the obvious starting point but the right window
sizing depends on traffic baseline.)

## Error budget policy

| Budget remaining | Policy                                                        |
| ---------------- | ------------------------------------------------------------- |
| > 50%            | ship features freely                                          |
| 10 – 50%         | focus 30% of capacity on reliability (alert tuning, runbooks) |
| < 10%            | feature freeze until budget recovers; reliability-only work    |

The freeze line is intentional: the lesson from the agent
v1.7.1→v1.8.4 storm (see
[[ADR-Presence-Architecture-Next-Steps]]) is that tighter coupling
between rust-work-service and the agent makes "ship through the
incident" a worse trade than it used to be. The freeze creates the
explicit pause that lets the team reconcile.

## Open items

- **Lock numbers in 2026-05-20** — 2 weeks after Phase 4 cutover,
  after we have baseline data from the Phase 2 telemetry. Today's
  thresholds are educated guesses.
- **Burn-rate PromQL** — write the multi-window queries once we know
  the production traffic baseline; add them to
  [`docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml`](../../../docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml)
  as `WorkServiceSLOBurn{Fast,Slow}` rules.
- **Datadog/Grafana dashboard link** — the dashboard JSON ships in
  Phase 2; once it's imported into the production Grafana instance,
  add the dashboard ID + URL here so the on-call can deep-link from
  pager → dashboard in two clicks.
- **Document escalation path** — Slack channel (#oncall-omniframe?),
  on-call rotation tooling (PagerDuty / OpsGenie), and the
  service-owner directory. Today the implicit owner is the team that
  wrote `rust-work-service` and the agent; codify it.
- **Tier scope clarification** — once Phase 4 lands, the SLO scope
  expands to cover the agent ↔ work-service path. Decide whether the
  agent's outbound HTTP (POST `/api/v1/sap-agents/heartbeat`,
  `/api/v1/sap_agent_jobs/*`) gets its own SLO or rolls up under the
  parent `/api/v1/*` p95.
- **Per-org SLO carve-out for Tier 0 customers** — the hashed
  `org_hash` label keeps cardinality bounded; if a Tier 0 customer
  needs a stricter SLO (e.g. 99.95%) we'll need a per-org ratio. For
  now: single global SLO.

## Related

- [[Implement-Rust-Work-Service-Phase0-Phase1]] — Phase 0 baseline
  capture + Phase 1 free wins.
- [[Implement-Rust-Work-Service-Phase2]] — the telemetry foundation
  this SLO defends.
- [[Roadmap-Rust-WS-Unlocks]] — the seed planning doc.
- [[ADR-Presence-Architecture-Next-Steps]] — the cross-tenant leak
  postmortem that motivated the rust-work-service tier in the first
  place.
- [[ADR-Broadcast-Channel-Sizing]] — sibling decision; the broadcast
  channel buffer is one of the dependencies of the lagged-events SLO
  line.
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] — the cutover that
  made `rust-work-service` load-bearing for Tier 1 channels.
- [`docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml`](../../../docs/runbooks/work-engine/alerts/rust-work-service-alerts.yml)
  — the four Phase 2 alert rules that defend this SLO today.
- [`docs/runbooks/work-engine/dashboards/rust-work-service.json`](../../../docs/runbooks/work-engine/dashboards/rust-work-service.json)
  — the Grafana dashboard.
- [`docs/runbooks/work-engine/ws-lagged-events.md`](../../../docs/runbooks/work-engine/ws-lagged-events.md)
  — runbook for the zero-tolerance lagged-events line.
- [`docs/runbooks/work-engine/auth-failure-org-mismatch.md`](../../../docs/runbooks/work-engine/auth-failure-org-mismatch.md)
  — runbook for the cross-tenant zero-tolerance line.
- [`docs/runbooks/work-engine/service-health-failing.md`](../../../docs/runbooks/work-engine/service-health-failing.md)
  — runbook for the `/api/v1/*` 5xx-rate line.
- [`docs/runbooks/work-engine/idempotency-replay-drift.md`](../../../docs/runbooks/work-engine/idempotency-replay-drift.md)
  — runbook for the soft drift indicator.
