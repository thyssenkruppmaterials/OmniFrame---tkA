# Runbook — WS Lagged Events

**Symptom.** Prometheus metric `work_ws_lagged_events_total{org_hash=…}`
is non-zero (or the per-process `tracing::warn!` log line `ws send loop
lagged — dropped N broadcast events; receiver resynced` is firing). Each
increment value is the number of `WsEvent`s a per-socket receiver missed
because the slow consumer (or a transient burst) overran the
`broadcast::channel(1000)` buffer in `rust-work-service`.

The receiver auto-resyncs after a Lagged tick — clients keep their
sockets — but the dropped events are gone. Symptoms downstream:

- Frontend tab shows stale UI (`Agents Fleet` card not updating, work
  queue stats stuck, presence dropdown missing a colleague who just
  signed in, etc.).
- Specific WS handlers paired with a 5-min safety-net poll heal within
  5 minutes; handlers that DON'T have a safety-net (rare) stay stale
  until the user reloads.

## Triage

1. **Confirm the metric is actually firing now (not historical).**
   Visit the work-service Grafana dashboard or query Prometheus:
   ```promql
   sum(rate(work_ws_lagged_events_total[5m])) by (org_hash)
   ```
   A non-zero rate on any `org_hash` label means the slow-consumer
   pressure is current.

2. **Identify the affected org.** The `org_hash` label is a 4-hex-char
   hash; map back via the work-service log:
   ```bash
   railway logs rust-work-service | grep 'work_ws_lagged_events_total' \
     | tail -50
   ```
   The `tracing::warn!` line carries `organization_id` as a structured
   field for direct lookup.

3. **Are subscriptions concentrated on one org?** Cross-check with
   `work_websocket_subscribers` from the metrics endpoint:
   ```promql
   sum(work_websocket_subscribers) by (org_hash)
   ```
   A single org with > N subscribers (where N is the broadcaster
   throughput / typical event-per-org rate × buffer slots — currently
   ~50 subscribers per org with steady-state Tier 1 traffic) is the
   classic slow-consumer scenario.

4. **Catch the broadcast volume itself.** The `WsEvent` variants don't
   have per-variant counters yet (deliberate — we don't want
   per-event-type label cardinality). Rough proxy: tail the work-service
   log and sample `tracing::debug!` rates:
   ```bash
   railway logs rust-work-service --since 30s | wc -l
   ```
   If the per-second rate is materially above what the broadcaster
   sustained yesterday, a new feature or a runaway consumer is
   producing events faster than the per-socket fan-out can drain them.

## Mitigation

### Consumer-side (most likely cause)

1. **A specific browser tab is wedged.** The TCP socket stays open but
   the JavaScript event loop is blocked (heavy render, debugger paused,
   long-running synchronous work). Identify via the `org_hash` and
   reach out to the operator(s) — closing and re-opening the tab
   resyncs the consumer.

2. **A FE handler is throwing on every event** (silent in dev tools but
   blocks the next `recv()`). Check the browser console for repeated
   handler exceptions in `WorkServiceWebSocket.onmessage`. The
   defensive `try/catch` around handlers in `websocket.ts` already logs
   these as `[WorkServiceWS] Error in event handler` — search the
   browser-side Sentry / log forwarder.

3. **A Tier 1 / Tier 2 hook didn't add a safety-net poll.** Audit:
   ```bash
   rg "workServiceWs.connect" src/ | rg -v "safetyNet\|safety-net"
   ```
   Any hit that doesn't pair with a fallback timer is a candidate for
   silent staleness. (Fix: add a 5-min `setInterval` that runs ONLY
   when `workServiceWs.getConnectionState() !== 'connected'`.)

### Server-side (rare today; common once Tier 1 multiplies volume)

1. **Increase `broadcast::channel(1000)` buffer size.** The current
   value is parked pending load-test data — see
   [`memorybank/OmniFrame/Decisions/ADR-Broadcast-Channel-Sizing.md`](../../../memorybank/OmniFrame/Decisions/ADR-Broadcast-Channel-Sizing.md).
   Doubling to 2000 doubles peak memory per consumer (channel slots
   are per-receiver, not per-sender). Don't change this without
   capturing the steady-state Lagged rate first — bigger buffers MASK
   the underlying slow-consumer bug rather than fixing it.

2. **Audit per-listener log spam.** Listeners use `tracing::debug!` on
   the happy path (`sap_agents_listener` is the volume leader); if a
   recent change pushed any to `tracing::info!` the log layer's
   per-line cost can backpressure the broadcaster. Run:
   ```bash
   rg "tracing::info!" rust-work-service/src/*_listener.rs
   ```
   should return zero hits inside the per-event branches of any
   listener.

3. **Look for a runaway trigger.** A buggy NOTIFY trigger (e.g. one
   that fires inside a tight UPDATE loop) can produce thousands of
   broadcasts per second. Check the most recent migration:
   ```sql
   SELECT proname, prosrc FROM pg_proc
    WHERE proname LIKE 'notify_%_changed'
    ORDER BY oid DESC
    LIMIT 5;
   ```
   Then map back to the Rust listener that consumes it (`grep
   pg_listen channel name in rust-work-service/src`).

### Load-test guidance

When an SRE wants to characterize the Lagged threshold for a future
sizing decision (Workstream D2), the test rig in
`rust-work-service/tests/` is the right starting point. Two harnesses
matter:

- **Synthetic broadcaster.** A test that spawns N=1000 broadcast tasks
  with M=100 events each in tight succession, while a handful of
  subscribers `sleep(50ms)` between recvs. The Lagged counter should
  climb deterministically once the buffer is full. Record the
  steady-state `work_ws_lagged_events_total` rate.
- **Realistic mix.** Simulate the Tier 1 + Tier 2 mix: presence
  heartbeats (90s cadence × N users), `sap_agents` heartbeats (30s ×
  fleet size), `sap_agent_jobs` updates (5s × in-flight count), etc.
  Measure how many subscribers can hang off ONE broadcaster before
  Lagged starts firing.

Both should run in CI on every change to `rust-work-service`'s
broadcast plumbing.

## Escalation

- **Sustained > 10 events/min on `org_hash="unbound"`** — wider
  problem, not per-tenant slow consumer. Page the on-call. The
  `unbound` bucket is sockets that lagged before sending a `Subscribe`
  message; non-trivial rate here means a producer (likely a listener)
  is firing faster than upgraded sockets can claim their org.
- **Steady-state non-zero rate on > 3 distinct `org_hash` labels for
  > 1 hour** — the broadcaster itself is undersized; revisit the
  sizing ADR with this incident's metrics attached.
- **Lagged + a downstream user-facing complaint about staleness that
  outlives 5 minutes** — confirm the affected feature has a safety-net
  poll. If yes, re-tune. If no, file a P1 to add one.

## Related metrics + dashboards

- `work_ws_lagged_events_total{org_hash}` — the cumulative drop count
  (sum of `n` per Lagged tick), labelled by 4-hex org hash.
- `work_ws_broadcast_buffer_pct{org_hash}` — Phase 2 leading
  indicator. % headroom remaining in the broadcast channel buffer for
  THIS receiver, sampled on every successful `rx.recv()`. 100 ⇒
  caught up; 0 ⇒ at the cliff (next event will trip Lagged). Watch
  this gauge to predict Lagged events before they fire.
- `work_websocket_subscribers{org_hash, task_type}` — current
  subscriber count, balanced inc/dec via `WsSubscriberGuard`.
- `work_ws_auth_failure_total{reason}` — adjacent indicator. A spike
  in `reason="org_mismatch"` alongside Lagged events suggests a buggy
  client reconnecting in a loop — reconnect storms can starve the
  broadcaster if the Subscribe message is delayed long enough that
  org-scoped events accumulate against the `unbound` bucket.
- `work_websocket_messages_total{direction, message_type}` —
  send-side volume; useful for "is this a producer spike?"

Grafana dashboard: `work-engine / rust-work-service`
(`docs/runbooks/work-engine/dashboards/rust-work-service.json`,
panel **Broadcast Channel Saturation**) — Phase 2 of the
rust-work-service integration plan (2026-05-06) shipped the dashboard
JSON alongside the new `work_ws_broadcast_buffer_pct` gauge. The gauge
is the leading indicator (% headroom remaining); the
`work_ws_lagged_events_total` counter this runbook diagnoses is the
after-the-fact drop count.

## Related

- [`memorybank/OmniFrame/Implementations/Add-WsEvent-Lagged-Metric.md`](../../../memorybank/OmniFrame/Implementations/Add-WsEvent-Lagged-Metric.md)
  — implementation note for the metric this runbook diagnoses.
- [`memorybank/OmniFrame/Decisions/ADR-Broadcast-Channel-Sizing.md`](../../../memorybank/OmniFrame/Decisions/ADR-Broadcast-Channel-Sizing.md)
  — the parked sizing decision; revisit when the Lagged rate gives us
  data.
- [`memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-Channels-To-Rust-WS.md`](../../../memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-Channels-To-Rust-WS.md)
  — the Tier 1 deferred-channel migrations; each pushes more event
  volume through the same broadcast channel.
