---
tags: [type/implementation, status/active, domain/backend, domain/infra, domain/realtime]
created: 2026-05-06
---

# Implementation: `RecvError::Lagged` Observability on `rust-work-service` WS

## What

`rust-work-service`'s WebSocket fan-out runs on `tokio::sync::broadcast::channel(1000)`. Each per-socket task does `rx.recv().await` to drain events into the client. The previous `while let Ok(event) = rx.recv().await {…}` loop silently swallowed `broadcast::error::RecvError::Lagged(n)` — a slow consumer, OR a flood of events larger than the 1000-slot buffer, would dropped events into the void with zero observability.

Once Tier 1 of [[Roadmap-Rust-WS-Unlocks]] starts multiplying event volume (presence + sap_agents + work-engine health + work-queue stats all on one `broadcast::Sender<WsEvent>`), this becomes load-bearing. Adding the metric NOW — before the volume increase — gives the SRE a baseline to alert on.

## Where

### `rust-work-service/src/observability/metrics.rs` — +~25 LOC

- New const in `pub mod names`: `WORK_WS_LAGGED_EVENTS_TOTAL = "work_ws_lagged_events_total"` with a runbook-pointer doc comment.
- New `IntCounterVec` in the `lazy_static!` block: `WORK_WS_LAGGED_EVENTS_TOTAL` labelled by `org_hash` (uses the existing `org_hash_label()` 4-hex-char helper so cardinality stays bounded, mirroring `WORK_WS_AUTH_FAILURE_TOTAL` and `WORK_WS_SUBSCRIBERS`). `unbound` is the bucket for sockets that lagged before sending a `Subscribe` (unlikely but kept honest).
- Counter is registered against the existing process-global `prometheus::Registry` (`REGISTRY`) so it shows up at `GET /metrics` for free.

### `rust-work-service/src/websocket/mod.rs` — +~30 LOC, -1 LOC

Replaced the `while let Ok(event) = rx.recv().await {…}` loop with `loop { match rx.recv().await {…} }`:

```rust
Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
    let current_org = *subscribed_org_send.read().await;
    let org_hash = current_org
        .as_ref()
        .map(metrics::org_hash_label)
        .unwrap_or_else(|| "unbound".to_string());
    metrics::WORK_WS_LAGGED_EVENTS_TOTAL
        .with_label_values(&[&org_hash])
        .inc_by(n);
    tracing::warn!(
        lagged = n,
        organization_id = ?current_org,
        metric = metrics::names::WORK_WS_LAGGED_EVENTS_TOTAL,
        "ws send loop lagged — dropped {} broadcast events; receiver resynced",
        n
    );
    continue;
}
Err(tokio::sync::broadcast::error::RecvError::Closed) => {
    tracing::debug!("ws broadcast channel closed; ending send loop");
    break;
}
```

Key decisions:

- **`continue`, not `break`.** The receiver auto-resyncs to the front of the buffer — disconnecting on Lagged would punish the client for the server's queue pressure. Slow consumer (or temporary burst) keeps its socket; we just record what was dropped.
- **Increment by `n`.** The counter sums dropped events (not Lagged ticks), which is the metric the SRE actually wants when picking a `broadcast::channel` size.
- **Org hash, not raw UUID.** Bounded label cardinality. Mirrors `WORK_WS_AUTH_FAILURE_TOTAL` shape.
- **Channel size unchanged at 1000.** Sizing is a separate decision that requires load-testing once the metric tells us what the steady-state Lagged volume actually looks like.

## Runbook

Stub pointer left in code: `RUNBOOK: docs/runbooks/work-engine/ws-lagged-events.md` (TODO). When a real burst lands and the runbook gets written, both the `metrics.rs` doc comment and the `tracing::warn!` callsite have the path so it's easy to find and update.

## Observability notes

- Metric name: `work_ws_lagged_events_total{org_hash="abcd|unbound"}`.
- Suggested alert (when runbook lands): non-zero rate over 5 min on any `org_hash` label — or > 10 events/min on `unbound` (which would indicate a wider problem, not a per-tenant slow consumer).
- The `tracing::warn!` carries `lagged`, `organization_id`, and the metric name as a structured field so log-side correlation works without parsing the message.

## File deltas

| File | Change |
|---|---|
| `rust-work-service/src/observability/metrics.rs` | +1 const + +1 lazy_static counter (~25 LOC). |
| `rust-work-service/src/websocket/mod.rs` | Replaced the `while let Ok` recv loop with explicit `match` on the three `Result` variants (Ok, Lagged(n), Closed). +30 LOC, -1 LOC. |

## Quality

- `cargo build` — clean (only pre-existing warnings about `observability/middleware.rs` dead code that's reserved for Phase 12.6).
- `cargo test` — 20 lib + 20 doc tests pass. The single intermittent `ws_token::tests::tampered_signature_rejected` failure is a pre-existing base64-no-pad reserved-bits flakiness in the test itself (random UUID happens to produce a sig whose last char, when flipped to/from `'A'`/`'B'`, lands on a base64-invalid bit pattern, causing `Malformed` instead of `BadSignature`). Reproducible without my changes by re-running the suite. Out of scope for this work.
- `cargo clippy --all-targets` — only pre-existing warnings (`redundant field names` in `api/routes/work.rs`, dead-code in `observability/middleware.rs`, etc.). Zero clippy warnings introduced by this change.
- No new Rust deps. `prometheus`, `tokio::sync::broadcast`, `tracing` all already in `Cargo.toml`.

## What this is NOT

- NOT a change to the channel size (1000). That's a future load-test-driven decision.
- NOT a Lagged → disconnect policy change. The receiver keeps going on Lagged.
- NOT a per-event-type label. We label by `org_hash` only — splitting by `event_type` would multiply cardinality without giving the SRE a better signal (Lagged is a queue-pressure event, not an event-type problem).

## Related

- [[Roadmap-Rust-WS-Unlocks]] — Section 6 ("Risks / things to budget for") explicitly called out the silent-loss hazard before Tier 1 multiplies event volume.
- [[Migrate-SapAgentChanged-To-Rust-WS]] — first Tier 1 migration shipped same-day; the Lagged metric exists so we can SEE if/when its event volume pushes the buffer.
- [[Fix-ScheduledJobsTab-Cross-Tenant-Filter]] — sibling deliverable (security fix) shipped same-day.
- [[Sessions/2026-05-06]] — session log.
