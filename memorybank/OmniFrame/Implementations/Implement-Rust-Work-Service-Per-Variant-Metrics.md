---
tags: [type/implementation, status/active, domain/backend, domain/observability, domain/realtime]
created: 2026-05-07
---

# Implement Rust Work Service — Per-Variant WS Metrics + Zero-Init (Items 7a + 7b)

## Purpose / Context

Part of the post-audit cleanup pass (Workstream B, item 7 of the
final-audit deliverable). Two observability gaps shipped together in
`rust-work-service` v0.1.34:

- **Item 7a** — `work_ws_messages_sent_total` was previously not exported
  per `WsEvent` variant. We had `work_websocket_messages_total` but its
  labels are `direction` + `message_type` (in/out client message bytes),
  not the actual `WsEvent` enum variant being broadcast. Operators
  couldn't chart per-variant fan-out volume ("how many SapAgentChanged
  events per second is the listener producing?").

- **Item 7b** — `work_pglistener_reconnects_total{channel=...}` and
  `work_ws_lagged_events_total{org_hash=...}` were ABSENT from `/metrics`
  until the first observation. The audit's "0 reconnects" claim is
  verifiable by absence-of-series, but that's fragile — a freshly
  deployed instance shows neither metric at all, so dashboard panels and
  alert rules that rely on the series existing render as "no data"
  instead of "healthy zero".

## Item 7a — per-`WsEvent`-variant counter

### Wiring

New Prometheus `IntCounterVec` in `observability/metrics.rs`:

```text
work_ws_messages_sent_total{variant=...}
```

Incremented exactly once per call to the new
`crate::websocket::broadcast_event(tx, event)` helper, which wraps every
production `tx.send(WsEvent)` callsite. The helper records the metric
BEFORE delegating to `tx.send` so the counter advances even when there
are zero subscribers (`broadcast::Sender::send` returns
`Err(SendError(_))` in that case). This matches the operator mental
model — "did we publish anything?" — and pairs with the receive-side
`work_ws_lagged_events_total` + `work_ws_broadcast_buffer_pct` for the
full picture.

Variant names come from a new `WsEvent::variant_name(&self) -> &'static str`
method — a single exhaustive `match` on the enum, allocation-free,
guaranteed by the compiler to cover every variant (adding a new
`WsEvent` variant without extending `variant_name` is a compile error).

### Callsite migration

Every production callsite of `tx.send(WsEvent::...)` was rewritten to
`crate::websocket::broadcast_event(&tx, WsEvent::...)`. Touched files:

- `src/api/routes/work.rs` — 11 callsites (TaskAssigned / TaskStatusChanged / PushedWork)
- `src/api/routes/sap_console.rs` — 1 production callsite (the test-only callsite at line 609 stays raw — the unit test creates its own broadcast channel and doesn't need the metric)
- `src/api/routes/dispatch.rs` — 1 callsite
- `src/api/routes/entity_focus.rs` — 2 callsites
- `src/api/routes/presence.rs` — 2 callsites
- `src/scheduler/mod.rs` — 3 callsites (ReservationEscalated, TaskStatusChanged auto_release, QueueStatsUpdated)
- `src/websocket/mod.rs` — 1 callsite (inbound Heartbeat fan-out)
- `src/triggers/evaluator.rs` — 1 callsite (TriggerFired)
- `src/sap_agents_listener.rs`, `src/sap_jobs_listener.rs`, `src/sap_import_runs_listener.rs`, `src/cycle_count_listener.rs`, `src/lx03_listener.rs`, `src/rf_putaway_listener.rs`, `src/notifications_listener.rs` — 1 callsite each
- `src/presence/evictor.rs`, `src/entity_focus/evictor.rs` — 1 callsite each

Total: ~26 production callsites; the helper is a single instrumentation
point for all of them.

## Item 7b — zero-initialised series

New function `observability::metrics::init_zero_value_series()` is called
from `main.rs` at boot, BEFORE any spawned task can emit a metric. It
materialises the `IntCounterVec` series at zero so the labels show up
in `/metrics` from the moment the service comes up:

```rust
for channel in KNOWN_PGLISTENER_CHANNELS {
    WORK_PGLISTENER_RECONNECTS_TOTAL
        .with_label_values(&[channel])
        .inc_by(0);
    WORK_PGLISTENER_KEEPALIVE_SENT_TOTAL
        .with_label_values(&[channel])
        .inc_by(0);
    WORK_PGLISTENER_KEEPALIVE_RECEIVED_TOTAL
        .with_label_values(&[channel])
        .inc_by(0);
}
for variant in KNOWN_WS_EVENT_VARIANTS {
    WORK_WS_MESSAGES_SENT_TOTAL
        .with_label_values(&[variant])
        .inc_by(0);
}
WORK_WS_LAGGED_EVENTS_TOTAL
    .with_label_values(&["unbound"])
    .inc_by(0);
```

`KNOWN_PGLISTENER_CHANNELS` and `KNOWN_WS_EVENT_VARIANTS` are
`pub const &[&str]` arrays mirroring the actual boot inventory. Two CI
tests in `websocket/mod.rs` keep them in lockstep with the enum:

- `variant_name_is_stable_for_every_variant` — sanity that every variant
  returns a non-empty literal.
- `ws_event_variant_names_match_known_set` — exact equality between the
  set of names produced by the enum's `variant_name` and the const array.
  Adding a `WsEvent` variant without updating the const fails this test
  immediately.

## Sample `/metrics` snippet (post-deploy)

Freshly-deployed v0.1.34 instance with NO traffic, ~5 s after boot:

```text
# HELP work_ws_messages_sent_total Total WsEvent broadcasts emitted on the per-process WS fan-out, labelled by variant.
# TYPE work_ws_messages_sent_total counter
work_ws_messages_sent_total{variant="CycleCountOperationChanged"} 0
work_ws_messages_sent_total{variant="EntityFocus"} 0
work_ws_messages_sent_total{variant="Heartbeat"} 0
work_ws_messages_sent_total{variant="ImportRunStatusChanged"} 0
work_ws_messages_sent_total{variant="Lx03DataChanged"} 0
work_ws_messages_sent_total{variant="Notification"} 0
work_ws_messages_sent_total{variant="PresenceJoined"} 0
work_ws_messages_sent_total{variant="PresenceLeft"} 0
work_ws_messages_sent_total{variant="PresenceUpdated"} 0
work_ws_messages_sent_total{variant="PushedWork"} 0
work_ws_messages_sent_total{variant="QueueStatsUpdated"} 0
work_ws_messages_sent_total{variant="ReservationEscalated"} 0
work_ws_messages_sent_total{variant="RfPutawayChanged"} 0
work_ws_messages_sent_total{variant="SapAgentChanged"} 0
work_ws_messages_sent_total{variant="SapAgentConsoleLine"} 0
work_ws_messages_sent_total{variant="SapJobStatusChanged"} 0
work_ws_messages_sent_total{variant="TaskAssigned"} 0
work_ws_messages_sent_total{variant="TaskStatusChanged"} 0
work_ws_messages_sent_total{variant="TriggerFired"} 0
work_ws_messages_sent_total{variant="WorkerStatusChanged"} 0

# HELP work_pglistener_reconnects_total Resilient PgListener reconnect attempts ...
# TYPE work_pglistener_reconnects_total counter
work_pglistener_reconnects_total{channel="agent_triggers_changed"} 0
work_pglistener_reconnects_total{channel="cycle_count_data_changed"} 0
work_pglistener_reconnects_total{channel="lx03_data_changed"} 0
work_pglistener_reconnects_total{channel="notification_created"} 0
work_pglistener_reconnects_total{channel="rf_putaway_operation_changed"} 0
work_pglistener_reconnects_total{channel="sap_agent_changed"} 0
work_pglistener_reconnects_total{channel="sap_agent_job_changed"} 0
work_pglistener_reconnects_total{channel="sap_import_run_changed"} 0
work_pglistener_reconnects_total{channel="shipment_queue_changed"} 0
work_pglistener_reconnects_total{channel="work_engine_settings_changed"} 0
work_pglistener_reconnects_total{channel="work_tasks_changed"} 0

# HELP work_ws_lagged_events_total broadcast::RecvError::Lagged events on WS receivers ...
# TYPE work_ws_lagged_events_total counter
work_ws_lagged_events_total{org_hash="unbound"} 0
```

After ~30 s of traffic:

```text
work_ws_messages_sent_total{variant="SapAgentChanged"} 12
work_ws_messages_sent_total{variant="RfPutawayChanged"} 5
work_ws_messages_sent_total{variant="QueueStatsUpdated"} 2
work_ws_messages_sent_total{variant="Heartbeat"} 1
# all other variants still at 0
```

## Why `inc_by(0)` instead of `.with_label_values(&["..."])` alone?

Prometheus `IntCounterVec` lazily creates the per-label child counter on
the first call to `with_label_values`. But the client crate's `gather()`
method only includes children that have been MUTATED (i.e. had
`inc()`/`inc_by()` called). `with_label_values` alone creates the child
but the child reports nothing until something writes to it. `inc_by(0)`
is the idiomatic "create-and-zero" call recommended by the official
Prometheus client docs.

## Files modified

- `src/observability/metrics.rs`:
  - Added `WORK_WS_MESSAGES_SENT_TOTAL: IntCounterVec` registered against the existing `REGISTRY`.
  - Added `pub fn init_zero_value_series()` for boot-time materialisation.
  - Added `pub const KNOWN_PGLISTENER_CHANNELS: &[&str]` and `KNOWN_WS_EVENT_VARIANTS: &[&str]` for the bounded label sets.
  - Added 3 unit tests (zero-init metrics body smoke + per-channel smoke + sanity that the variant const isn't empty).

- `src/websocket/mod.rs`:
  - Added `WsEvent::variant_name(&self) -> &'static str`.
  - Added `pub fn broadcast_event(tx, event)` helper.
  - Added 3 tests in a new `ws_event_tests` module (variant-name stability, enum/const parity, helper increments the counter).

- `src/main.rs`:
  - Calls `observability::metrics::init_zero_value_series()` immediately after `tracing` is initialised.

- 18 production callsites across listeners + routes + scheduler + evictors switched from `tx.send(WsEvent::...)` to `crate::websocket::broadcast_event(&tx, WsEvent::...)`.

## Quality gates

- `cargo build --quiet` — clean.
- `cargo test --lib` — 160 passing (was 154; +6 new tests).
- `cargo clippy --lib --all-targets` — no new warnings.

## Related

- [[Implementations/Implement-Rust-Work-Service-PgBouncer-Pooler]] — companion PR (items 4 + 5 shipped same release).
- [[Components/Rust-Work-Service]] — component overview, updated with the per-variant counter.
- [[Implementations/Implement-Resilient-PgListener]] — owns the per-channel reconnect counter we zero-initialise here.
- [[Sessions/2026-05-07]] — EOD cleanup (Workstream B) section.
