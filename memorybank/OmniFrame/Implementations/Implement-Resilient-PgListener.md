---
tags: [type/implementation, status/active, domain/backend, domain/realtime, domain/infra]
created: 2026-05-07
---
# Implement Resilient PgListener (rust-work-service)

## Purpose / Context

Replace the hand-rolled `sqlx::postgres::PgListener` reconnect loop in
every `rust-work-service` listener with a single resilient wrapper that
publishes its own keepalive heartbeat on a 30 s cadence, receives the
echo on the dedicated PgListener socket, and force-reconnects when no
frame (real or keepalive) arrives within 90 s.

Resolves the production wedge documented in
[[Debug/Fix-Auto-Confirm-Putaways-Trigger-Missing-And-Listener-Wedge]] —
on 2026-05-07 the auto-confirm putaway pipeline failed because most of
the 13 `PgListener` tasks silently died between boot and ~30 minutes
later. `pg_stat_activity` showed only 3–5 surviving LISTEN backends
out of the 13 spawned at boot, with NO `recv() failed` log lines
because sqlx's `recv()` was hung in epoll waiting for an EOF that
Railway's egress NAT silently consumed.

## Design

### Single source of truth — `rust-work-service/src/pglistener.rs`

Public surface:

```rust
pub const KEEPALIVE_CHANNEL: &str = "rust_work_service_keepalive";
pub const DEFAULT_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
pub const DEFAULT_WATCHDOG_TIMEOUT: Duration = Duration::from_secs(90);
pub const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(30);

pub struct ListenerConfig {
    pub keepalive_interval: Duration,   // default 30 s
    pub watchdog_timeout: Duration,     // default 90 s (must be ≥ 2× interval)
}

pub struct NotifyFrame { pub channel: String, pub payload: String }

pub async fn run<F, Fut>(pool: PgPool, channel: impl Into<String>, callback: F)
where F: FnMut(NotifyFrame) -> Fut + Send + 'static,
      Fut: Future<Output = ()> + Send + 'static;

pub async fn run_with_config<F, Fut>(pool: PgPool, channel: impl Into<String>,
                                     cfg: ListenerConfig, callback: F)
where /* same bounds */;
```

### Outer reconnect loop

```text
loop {
    sink.connect_listener(channel)        // PgListener::connect_with + LISTEN <channel> + LISTEN rust_work_service_keepalive
    drive_inner(...)                      // until disconnect / watchdog
    on exit:
        WORK_PGLISTENER_STATUS{channel}.set(0)
        WORK_PGLISTENER_RECONNECTS_TOTAL{channel}.inc()
        warn!(reason = ..., "resilient PgListener disconnected; reconnecting")
        sleep(backoff)                    // 1s → 2s → 4s → … → 30s cap
}
```

### Inner drive loop

```text
let mut last_message = Instant::now();
let mut keepalive_tick = interval(30s);   // first tick consumed (no immediate keepalive)

loop {
    WORK_PGLISTENER_LAST_MESSAGE_AGE{channel}.set(last_message.elapsed())
    select! {
        biased;
        msg = source.next() => match msg {
            Ok(Some(frame)) => {
                last_message = Instant::now();
                if frame.channel == KEEPALIVE_CHANNEL { keepalive_received_inc(); continue; }
                callback(frame).await;
            }
            Ok(None)  => return ExitReason::SourceClosed,
            Err(e)    => return ExitReason::RecvError(e),   // sqlx surfaced a hard error
        },
        _ = keepalive_tick.tick() => {
            if last_message.elapsed() > 90s { return ExitReason::WatchdogTimeout(...); }
            sink.send_keepalive(channel) → pg_notify('rust_work_service_keepalive', channel)
            // success → keepalive_sent_inc(), failure → warn! and continue
        }
    }
}
```

### Why the keepalive design works

| Failure mode | Detection path |
|---|---|
| sqlx `recv()` returns `Err` (hard close) | Inner loop hits `RecvError` arm, exits, outer loop reconnects. |
| sqlx `recv()` returns `Ok(None)` (clean source close) | `SourceClosed` arm exits and reconnects. |
| sqlx auto-reconnects transparently after kill | Wrapper sees the keepalive echo on the new connection within 30 s — no false-positive watchdog fire. |
| sqlx `recv()` hangs forever (Railway NAT swallows the FIN) | Keepalive tick fires every 30 s. After 3 ticks (~90 s) of no echo, watchdog returns `WatchdogTimeout` and the outer loop reconnects. **This is the original wedge bug.** |
| Pool starved (keepalive `pg_notify` send fails) | Logged at `warn!`, recv loop continues. The watchdog still catches a truly dead socket because the dead listener can't echo any keepalive — own or sibling. |

### Why the keepalive uses the main pool

The keepalive `pg_notify` is sent from a *different* TCP connection
(the main `PgPool`) than the dedicated `PgListener` socket. This is
critical: a one-way socket failure on the dedicated socket (the most
common failure mode under Railway → Supabase pgbouncer) cannot affect
the keepalive send, so the test signal is independent of the test
subject. Postgres delivers the keepalive to every backend that has
`LISTEN rust_work_service_keepalive` registered — including the test
subject, whose dedicated socket either echoes it back (alive) or
doesn't (wedged).

### Why a single shared keepalive channel

All 13 listener tasks subscribe to the same `rust_work_service_keepalive`
channel and broadcast their own keepalives on it. This means each
listener's dedicated socket receives ~N keepalives per interval (where
N = number of active listener tasks), so even a low-frequency channel
(e.g. `agent_triggers_changed`, hours between real notifications) sees
~13 keepalives every 30 seconds. The watchdog deadline (90 s) is
always far above the cumulative inter-arrival time.

Trade-off: the `work_pglistener_last_message_age_seconds` Prometheus
gauge collides labels for the two channels with multiple listeners
(`rf_putaway_operation_changed` has both Phase 4 + Phase 9 evaluator
subscribers; same for `sap_agent_job_changed`). Last-write-wins on the
gauge is acceptable because the *internal* `last_message: Instant`
inside each task is what drives the watchdog — the gauge is just for
operator dashboards.

## Watchdog parameters

| Knob | Default | Why |
|---|---|---|
| `keepalive_interval` | **30 s** | Twice / minute is a low cardinality on the keepalive counter — well below pgbouncer's `idle_timeout`, well above the per-listener cost of a `pg_notify`. |
| `watchdog_timeout` | **90 s** | 3× keepalive interval — absorbs one missed tick + jitter. A truly wedged listener trips the watchdog within 90–120 s (next tick after the deadline). |
| `reconnect_backoff_max` | **30 s** | Matches the cap the legacy hand-rolled loops used so reconnect storm behaviour is unchanged. |

Tests cover non-default values (1 s / 2 s / 100 ms / 250 ms) so future
operators can shrink the deadlines for staging without touching the
production defaults.

## Metrics surface (`/metrics`)

Per LISTEN channel (label `channel`):

| Metric | Type | Meaning |
|---|---|---|
| `work_pglistener_status{channel}` | gauge | `1` = subscribed and draining, `0` = reconnecting (or pre-first-subscribe). |
| `work_pglistener_reconnects_total{channel}` | counter | Reconnect attempts. Steady-state ≈ 0. Non-zero rate = upstream is idle-killing sockets. |
| `work_pglistener_last_message_age_seconds{channel}` | gauge | Refreshed on each keepalive tick. Watchdog reconnects when this exceeds the configured timeout. |
| `work_pglistener_keepalive_sent_total{channel}` | counter | Keepalive `NOTIFY`s emitted by THIS listener (one per keepalive tick). |
| `work_pglistener_keepalive_received_total{channel}` | counter | Keepalive `NOTIFY`s observed on the dedicated socket. Includes own + sibling keepalives. Non-zero = TCP is alive. |

Cardinality: bounded by the number of distinct channel names declared
in `main.rs` + the per-table evaluator subscriptions (12 distinct
labels today).

## Refactored callsites

| File | Status |
|---|---|
| `pglistener.rs` | **NEW** — the wrapper. |
| `settings/listener.rs` | Refactored to call `pglistener::run`. |
| `sap_agents_listener.rs` | Refactored. |
| `sap_jobs_listener.rs` | Refactored (preserves the `patch_audit_row_on_terminal` side effect). |
| `sap_import_runs_listener.rs` | Refactored. |
| `cycle_count_listener.rs` | Refactored. |
| `lx03_listener.rs` | Refactored. |
| `rf_putaway_listener.rs` | Refactored. |
| `notifications_listener.rs` | Refactored (preserves the `WORK_NOTIFICATIONS_TOTAL` enqueue counter). |
| `triggers/loader.rs` | Refactored — keeps the synchronous first-load before entering the wrapper so the evaluator never observes a default-empty rule set. |
| `triggers/evaluator.rs` | Refactored — `run_for_table` is now a thin `pglistener::run` adapter that defers to `handle_notification`. The `channel_for_table` mapping (singular vs plural NOTIFY name) is unchanged. |

DB schema: **untouched**. Keepalive uses an in-memory channel name
(`rust_work_service_keepalive`); nothing needs to be created in
Postgres. The existing `<table>_changed` NOTIFY triggers (migrations
270–276, 281, 285) are unchanged.

## Tests

Unit tests in `pglistener::tests` (no live Postgres required):

| Test | Asserts |
|---|---|
| `keepalive_channel_constant_matches_specification` | `KEEPALIVE_CHANNEL == "rust_work_service_keepalive"` (wire-compat). |
| `default_config_has_safe_production_values` | 30 s keepalive, 90 s watchdog, ratio ≥ 2:1. |
| `exit_reason_display_includes_diagnostic_detail` | `Display` impl carries the elapsed seconds + `"watchdog"` token. |
| `drive_forwards_real_frames_to_callback_and_swallows_keepalives` | mpsc-mocked `NotifySource`: real frames hit the callback, keepalive frames are silently dropped. |
| `drive_fires_watchdog_when_no_messages_arrive` | 100 ms interval + 250 ms watchdog: deadline trips → reconnects to a second mocked source within 1 s. |
| `drive_reconnects_after_recv_error` | mpsc emits `Err(sqlx::Error::PoolTimedOut)`: drive loop exits, outer loop reconnects to a second source. |

The full suite is `cargo test --lib` — **154 passing** (146 pre-existing + 6 new + 2 from `evaluator::tests` regressions that survive the refactor).

## Deploy + verification (Railway service `rust-work-service`)

1. Bumped `Cargo.toml` to `0.1.33`.
2. `railway up -s rust-work-service` (CI mode). Build complete @ 17:58:50 UTC, image `sha256:d4a59402480ce49b…`.
3. Boot logs show 13× `resilient PgListener starting` + 13× `resilient PgListener subscribed` between 17:59:05 and 17:59:08 UTC.
4. `pg_stat_activity` post-deploy: **13 listener backends alive**, age 56–58 s (matches new process spawn).
5. `/metrics` after 2 minutes:
   - `work_pglistener_status{channel="*"} = 1` for all 12 channel labels.
   - `work_pglistener_keepalive_sent_total = 3` per single-listener channel, `6` for `rf_putaway_operation_changed` / `sap_agent_job_changed` (the two channels with both a Phase 4 dedicated listener AND a Phase 9 evaluator subscriber).
   - `work_pglistener_keepalive_received_total = 39` per single-listener channel — exactly **13 senders × 3 ticks** = 39, confirming every listener's dedicated socket is receiving every other listener's keepalive.
   - `work_pglistener_reconnects_total` absent from output (counter never incremented = 0 reconnects).
6. Forced-disconnect test: `SELECT pg_terminate_backend(2230591)` killed one of the LISTEN backends. sqlx's documented internal `PgListener` auto-reconnect transparently recovered (no recv error surfaced to the wrapper), and pg_stat_activity returned to 13 backends shortly thereafter. Our wrapper's `reconnects_total` stayed at 0 — correct behaviour, since the wrapper's reconnect path is the *second-line defence* for the case where sqlx's auto-reconnect itself silently fails (the original wedge mode).

## Watchdog math

For a typical low-frequency listener (e.g. `agent_triggers_changed`,
which fires only when an admin edits a trigger via the SAP Testing
UI — order of single-digit times per week):

```
last_real_NOTIFY = T0
keepalive_received += 13 every 30s (own + 12 siblings)
                                       ↓
last_message = T0 + (60s mod 30s rounded)
            ≤ now - 30s    always
```

The watchdog never trips in steady-state because at minimum, the
listener observes ~13 keepalive frames per 30 s window. The watchdog
trips ONLY when the dedicated TCP socket genuinely cannot deliver
frames — exactly the wedge mode.

## Open follow-ups

- ~~**Python agent's WS reconnect logic.**~~ **DONE** (2026-05-11) —
  see [[Implementations/Implement-Resilient-Work-Service-WS-Client]].
  `omni_agent/work_service_ws.py` now mirrors the same keepalive +
  watchdog pattern: library-level WebSocket ping/pong (20s/10s) as the
  first line of defense, plus an application-level asyncio watchdog
  task (15s tick, 60s no-traffic deadline) that force-closes the
  socket when the proxy silently absorbs both directions. Reconnect
  ladder retightened to bounded exponential 1s→30s (matches
  `RECONNECT_BACKOFF_MAX` here). New self-reporting surface
  (`reconnect_count()`, `watchdog_trips()`,
  `last_message_received_at()`, `last_reconnect_reason()`). No
  `AGENT_VERSION` bump. Mirrored to MacWindowsBridge.
- **Per-listener label.** The shared-channel label collision
  (`rf_putaway_operation_changed` has 2 listener tasks) means the
  `last_message_age` gauge for those channels is "best effort". If we
  ever need per-task observability, add a `task_id` label (`phase4`
  vs `evaluator`) to the metric vec.

## Related

- [[Debug/Fix-Auto-Confirm-Putaways-Trigger-Missing-And-Listener-Wedge]]
- [[Components/Rust-Work-Service]] — listener inventory
- [[Implementations/Implement-Rust-Work-Service-Phase9]] — trigger evaluator architecture
- [[Implementations/Migrate-Tier1-Deferred-Channels-To-Rust-WS]] — listener landings
