---
tags: [type/implementation, status/active, domain/agent, domain/realtime, domain/infra]
created: 2026-05-11
---
# Implement Resilient Work-Service WS Client (Python agent)

## Purpose / Context

Mirror the rust-side [[Implementations/Implement-Resilient-PgListener]]
keepalive + watchdog pattern onto the Python agent's WebSocket client
(`omni_agent/work_service_ws.py`). Closes the open follow-up flagged in
the May 7 PgListener resilience audit
([[Sessions/2026-05-07]] §"Open follow-ups"):

> **Python agent's WS reconnect logic.** `omni_agent/work_service_ws.py`
> has its own hand-rolled reconnect loop with exponential backoff but
> **no keepalive watchdog**. Same Railway egress NAT issue applies to
> the agent → rust-work-service WS path. Worth a follow-up sweep to
> add a client-side ping/pong watchdog.

User symptom that motivated the follow-up: the agent's console in
Citrix appears **frozen / disconnected from the browser** until the
user interacts with it ("press something"). The agent itself stays
alive (SAP COM working, queue claims still go through) but the WS
connection to `rust-work-service /ws` silently goes dead from the
frontend's perspective.

### Root cause

Citrix VDA + corporate proxy (Netskope / ZScaler) silently idle-close
TCP connections after ~30–90s of no traffic. The agent's WS to
`rust-work-service` has long quiet periods (no work to dispatch, FE
not driving updates). When the proxy closes the socket, the
`websockets` library may NOT see an exception immediately — the next
`recv()` blocks forever until the agent tries to send something the
user triggered. Half-open TCP sockets where the agent THINKS it's
connected but data never flows.

Identical failure-mode shape to the 2026-05-07 LISTEN-socket wedge
([[Debug/Fix-Auto-Confirm-Putaways-Trigger-Missing-And-Listener-Wedge]])
that motivated the rust-side `ResilientPgListener` — the wrapper here
applies the same defense to the agent → work-service WS hop.

## Design

### Two-layer keepalive stack

| Layer | Mechanism | Catches |
|---|----|----|
| **1. Library-level ping/pong** | `websockets.connect(ping_interval=20, ping_timeout=10)` — protocol-level `Ping` frame every 20s, `ConnectionClosedError` raised if no `Pong` in 10s. | Common case where the proxy honours the WebSocket protocol (most do — they count pings as activity and refuse to idle-close). Catches "library notices dead socket". |
| **2. App-level watchdog** | Sibling asyncio task that wakes every 15s and force-closes the socket if `last_message_received_at` is older than 60s. | Half-open case where the proxy silently absorbs traffic in both directions (some Netskope / ZScaler policies do this). Library's ping task can't distinguish, but the watchdog measures actual app-traffic gaps. |

Watchdog timeout (60s default) is set to 3× ping interval (20s) — a
single missed pong tick alone won't trip the watchdog before the
library's own `ConnectionClosedError` arrives. Mirrors the rust-side
`ResilientPgListener` 30s/90s ratio (also 3:1).

### Watchdog mechanics

```text
async with websockets.connect(ws_url,
                              ping_interval=20s,
                              ping_timeout=10s) as ws:
    await ws.send(Subscribe)
    last_message_received_at = time.time()    # connection ACK baseline
    watchdog_task = asyncio.create_task(_watchdog_loop(ws, state))
    try:
        async for raw in ws:
            last_message_received_at = time.time()   # refresh on EVERY frame
            on_event(json.loads(raw))
    finally:
        watchdog_task.cancel()

# _watchdog_loop:
while True:
    await asyncio.sleep(15s)
    if (time.time() - last_message_received_at) > 60s:
        state["tripped"] = True
        await ws.close(code=1011, reason="agent watchdog timeout")
        return
```

`ws.close()` from inside the watchdog surfaces back to the recv loop
as a `ConnectionClosedError`. The outer reconnect loop catches it,
consults `state["tripped"]` (which lives at the cycle scope — outside
the `try:` so every `except` arm can read it), and rebadges the
disconnect as `WatchdogTimeout` instead of `ConnectionClosedError` so
the operator's mental model stays honest:

- `WatchdogTimeout` = corp-proxy idle close (app-traffic gap, library
  pings may have looked fine).
- `ConnectionClosedError` = library detected the close itself
  (server-initiated drop, network reset, library ping timeout).

### Reconnect ladder — bounded exponential

| Knob | Old (v1.9.0) | New (2026-05-11) | Why |
|---|----|----|----|
| Initial backoff | 5s | **1s** | Transient blips recover in seconds, not 5s+. |
| Increment | additive +5s | exponential ×2 | Standard ladder shape; matches `rust-work-service::pglistener::RECONNECT_BACKOFF_MAX`. |
| Cap | 60s | **30s** | Mirrors rust-side `RECONNECT_BACKOFF_MAX` so a degraded upstream sees the same retry rate from both clients. |
| Stable reset | 60s | 60s | Unchanged. |

A chronic upstream outage now sees ladder `1s → 2s → 4s → 8s → 16s →
30s → 30s → …` instead of the legacy `5s → 10s → 15s → … → 60s`.
Net effect: faster recovery on transient blips, similar steady-state
behaviour on chronic outages.

### Tightened exception handling

The outer `try` block now distinguishes three failure classes for
diagnostic clarity:

```python
except (ConnectionClosedError, ConnectionClosedOK) as e:
    # Library-detected close — rebadge as WatchdogTimeout if our
    # watchdog initiated it, otherwise propagate the class name.
    ...
except (OSError, asyncio.TimeoutError) as e:
    # Network-level — DNS / TCP / TLS / open_timeout.
    ...
except Exception as e:
    # Catch-all so a never-before-seen shape doesn't kill the loop.
    ...
```

All three branches feed the same `_reconnect_count++` /
`_last_reconnect_reason` bookkeeping at the bottom of the loop.

### Self-reporting surface (new public API)

Added to `WorkServiceWsClient`:

| Method | Returns | Use |
|---|---|---|
| `last_message_received_at()` | epoch second of most recent inbound frame | `/health` exposure, dashboards, watchdog audit |
| `reconnect_count()` | monotonic counter, all reasons | steady-state ≈ 0; spikes = upstream churn |
| `watchdog_trips()` | subset of `reconnect_count()` triggered by the app-level watchdog | high = proxy is forwarding pings but blocking app traffic |
| `last_reconnect_reason()` | `"<ExcClass>: <repr[:160]>"` or `None` | one-glance disconnect attribution |

All four are GIL-protected reads of plain instance attributes — safe
to call from any thread. Exposed for future `/health` integration on
the agent (currently no metrics endpoint on `omni_agent`; see
[[#Open follow-ups]]).

## Configuration knobs (env-tunable, sensible defaults)

| Env var | Default | Purpose |
|---|---|---|
| `OMNIFRAME_WS_PING_INTERVAL_SEC` | **20.0** | Library-level ping cadence. Pings count as activity for most corp proxies. |
| `OMNIFRAME_WS_PING_TIMEOUT_SEC` | **10.0** | Library-level pong deadline. Library raises `ConnectionClosedError` on miss. |
| `OMNIFRAME_WS_WATCHDOG_INTERVAL_SEC` | **15.0** | App-level watchdog tick. |
| `OMNIFRAME_WS_WATCHDOG_TIMEOUT_SEC` | **60.0** | App-level no-traffic deadline. Must be ≥ 2× ping interval — module logs a WARN at import time if mis-ratio'd. |

No `AGENT_VERSION` bump (still `2.0.0`) — these defaults are
production-safe and the env vars are documentation rather than
required config. A future site with a more aggressive idle-close
policy can shorten them without an EXE rebuild.

Garbage-input env vars (e.g. `OMNIFRAME_WS_PING_INTERVAL_SEC=fifteen`)
fall back to the default and log a single warning at import — typo in
a Citrix shortcut's env block can't break boot.

## Boot banner addition

On `WorkServiceWsClient.start()`, the client now prints (once per
process lifetime):

```text
[work-ws] resilience config: library_ping=20s/10s, app_watchdog=15s/60s,
  reconnect_backoff=1s→30s exponential. Mirrors rust-work-service
  ResilientPgListener — see
  Implementations/Implement-Resilient-Work-Service-WS-Client.md.
```

Mirrors the rust-side `info!(channel = ..., keepalive_interval_secs =
..., watchdog_timeout_secs = ..., "resilient PgListener starting")`
log line emitted by `pglistener::run_with_sink`. Operators get a
one-line summary of the resilience posture without cracking open the
bundled agent.

## Reconnect log shape

Every reconnect now emits:

```text
[work-ws] reconnect #<N> (last message <X>s ago,
  reason=<WatchdogTimeout|ConnectionClosedError|OSError|TimeoutError|...>,
  watchdog_trips=<M>); sleeping <backoff>s
```

Example from the smoke test (silent server, 1.5s watchdog deadline):

```text
[work-ws] connected to http://127.0.0.1:18032 (org 0000…)
[work-ws] watchdog tripped — last message 1s ago > 1s; force-closing socket to trigger reconnect
[work-ws] reconnect #1 (last message 1s ago, reason=WatchdogTimeout, watchdog_trips=1); sleeping 0.2s
[work-ws] connected to http://127.0.0.1:18032 (org 0000…)
[work-ws] watchdog tripped — last message 1s ago > 1s; force-closing socket to trigger reconnect
[work-ws] reconnect #2 (last message 1s ago, reason=WatchdogTimeout, watchdog_trips=2); sleeping 1.0s
```

## Smoke verification (no live infrastructure required)

### Sad path — silent server (watchdog must trip)

Test fixture: stand up a `websockets.asyncio.server.serve` that ACKs
`Subscribe` with one event and then goes silent. Patched constants:
`ping_interval=60` (disable library pings during smoke window),
`watchdog_interval=0.3s`, `watchdog_timeout=0.8s`, `backoff=0.2→1.0s`.

Results after 5.5s wall time:

| Metric | Expected | Observed |
|---|----|----|
| `reconnect_count()` | ≥ 2 | **3** ✅ |
| `watchdog_trips()` | ≥ 2 | **3** ✅ |
| `last_reconnect_reason()` contains `WatchdogTimeout` | yes | ✅ |
| Server received ≥ 3 `Subscribe` messages | yes | **4** ✅ |
| `last_event_at()` > 0 (proves event delivery still works) | yes | ✅ |

### Happy path — server sends heartbeat every 0.4s (watchdog must NOT trip)

Fixture: server replies to `Subscribe` and then spawns a heartbeat
task sending one `{type: "Heartbeat"}` event every 0.4s. Watchdog
deadline 1.5s. Run for 4s.

| Metric | Expected | Observed |
|---|----|----|
| `reconnect_count()` | 0 | **0** ✅ |
| `watchdog_trips()` | 0 | **0** ✅ |
| `is_connected()` | True | ✅ |
| Events received via `on_event` | ≥ 5 | **9** ✅ |

Both smoke fixtures live in the agent's pre-merge verification
(reproducible via `python3 -c '...'` snippets in this file's
[[#Verification snippets]] section if needed for regression).

### Static checks

- `python3 -c "import ast; ast.parse(open('omni_agent/work_service_ws.py').read())"` ✅
- `python3 -c "from work_service_ws import WorkServiceWsClient"` ✅ (constructs cleanly, all 6 new methods accessible)
- `flake8` clean (line-length ≤ 79)
- `cmp omni_agent/work_service_ws.py /Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/work_service_ws.py` → **byte-identical** ✅
- 650 LOC source vs 281 LOC pre-change (+369 LOC, mostly docstring +
  watchdog scaffolding + 4 new public methods + tunable env-var
  parsing).

## File diff summary

| File | Change |
|---|---|
| `omni_agent/work_service_ws.py` | Full rewrite — preserves public API (`WorkServiceWsClient` ctor, `start/stop/is_connected/last_event_at/fallback_reason`, `WORK_SERVICE_URL` constant). Adds `ping_interval`/`ping_timeout` to `websockets.connect`, sibling `_watchdog_loop` task, 4 new env-tunable knobs, 4 new public methods, bounded-exponential reconnect ladder, tightened exception classes, boot banner. **+369 LOC net.** |
| `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/work_service_ws.py` | Mirror — `cp` from source, byte-identical (`cmp` clean). |

**No** changes to `agent.py`. **No** changes to
`rust-work-service` (server already supports the WS protocol pings
the library emits; close-code 1011 is treated cleanly). **No**
changes to message protocol (`Subscribe` / `WsEvent` shapes
unchanged). **No** new external dependencies (`websockets>=11.0` was
already pinned in `requirements.txt`; production env has 15.0.1).

## Constraints honoured

- ✅ `AGENT_VERSION` unchanged (still `2.0.0`)
- ✅ WS message protocol unchanged (event shapes, subscribe-token mechanics)
- ✅ `rust-work-service` source untouched
- ✅ Keepalive cadence (20s) and watchdog timeout (60s) tunable via env
- ✅ Existing-behaviour preservation on healthy connections — no extra
  latency (`async for` recv loop unchanged), no extra log spam (boot
  banner + reconnect lines only fire on disconnect events), no extra
  Supabase load (zero net-new HTTP traffic; the watchdog operates
  entirely on the existing WS socket)

## Recoverability example

Real-world scenario: a Citrix VDA's corporate proxy idle-closes the
WS socket after ~45s of quiet. With v1.9.0 the agent would block on
`recv()` forever (or until the user typed in the console). With this
change:

1. **t=0s** — connection established, `_last_message_received_at` set.
2. **t=20s** — library emits protocol `Ping`. Proxy may or may not
   forward it. Pong (if received) is handled internally by the
   library and does NOT update `_last_message_received_at` (Python
   user code never sees protocol pongs).
3. **t=45s** — proxy idle-closes the socket but absorbs the FIN. The
   library's `recv()` blocks; no exception surfaces.
4. **t=60s** — library tries another `Ping`. If the proxy blocks the
   write outright, the library raises `ConnectionClosedError` after
   `ping_timeout=10s` → reconnect at t≈70s.
5. **t=60s** (alternate path) — proxy SILENTLY swallows the ping and
   never returns a pong. Library can't tell. Watchdog wakes at t=15s,
   30s, 45s, 60s — at t=60s the gap (60s) exceeds the deadline (60s
   default), it logs `[work-ws] watchdog tripped — last message 60s
   ago > 60s; force-closing socket to trigger reconnect`, calls
   `ws.close(code=1011)`, the recv loop exits with
   `ConnectionClosedError`, the outer loop rebadges it as
   `WatchdogTimeout`, increments `_watchdog_trips`, sleeps 1s, then
   reconnects.

Worst-case recovery time: **75s** (60s watchdog + ~15s for the next
tick to fire). On defaults that's the absolute upper bound for the
"agent appears frozen" symptom — independent of how chatty the WS
protocol pings are or how aggressive the proxy is.

## Console relay verification (Phase C)

The console relay daemon (`agent.py:_start_console_relay_thread`,
added in Phase 6 / v2.0.0) reads from `state.console_buffer` and
POSTs batches to `rust-work-service /api/v1/sap-console/lines` every
500ms. Verified:

- The relay's HTTP call routes through `_work_service_request(...)`
  which sets `kwargs.setdefault("timeout", _DEFAULT_HTTP_TIMEOUT_SEC)`
  (= **30s**, defined at `agent.py:3979`).
- A failed POST is caught (`except Exception`), the lines are
  re-buffered via `state.console_buffer.appendleft(entry)` under the
  lock, and the relay sleeps `backoff_sec` (exponential 2s → 30s) before
  retrying.
- The relay thread is independent of the WS client thread
  (`omni-console-relay` vs `omni-work-service-ws`) — a stuck WS
  reconnect cannot block the relay or vice versa.

No code change needed for Phase C. The relay is correctly bounded
and independent of the WS path.

## Open follow-ups

- **Prometheus metrics on the agent.** `rust-work-service` ships 5
  per-channel Prometheus metrics for the resilient PgListener
  (`work_pglistener_status`, `_reconnects_total`,
  `_last_message_age_seconds`, `_keepalive_sent_total`,
  `_keepalive_received_total`). The agent has no `/metrics` endpoint
  today — `_reconnect_count`, `_watchdog_trips`,
  `_last_message_received_at`, `_last_reconnect_reason` are
  introspectable only via the new public methods. A future
  `/health` extension could surface these as JSON fields
  (`work_ws.reconnect_count`, `work_ws.watchdog_trips`,
  `work_ws.last_message_age_sec`, `work_ws.last_reason`) so the
  fleet card can show "agent WS reconnects: 3 this session" without
  shipping a full Prometheus exporter. Not urgent — operators can
  read the `[work-ws] reconnect #N` lines directly from the agent
  console window today. See [[Components/Omni-Agent - Headless SAP Agent]]
  §"REST API" for the existing `/health` shape if/when extended.
- **Browser-side `document.visibilitychange` audit.** The user's
  current symptom comes from the agent-side WS dying, not browser
  tab throttling. If reports persist after this lands, audit
  `useExecutionMode().fleet` and the SAP Console card's WS
  subscription for visibility-change handling — pause readiness
  probes on `hidden`, force a fresh fleet snapshot on `visible`.
  Not addressed in this change.
- **Per-connection close-code labelling on the rust side.** The
  agent's watchdog sends WS close code `1011` ("Internal Error")
  with reason `"agent watchdog timeout"`. `rust-work-service`'s
  `/metrics` does not currently bucket disconnects by close code,
  so a fleet-wide "how often is the watchdog firing across all
  agents" view would require a server-side change to record
  `WsClose{code, reason}` in a Prometheus counter. Easy follow-up
  if/when it becomes useful.

## Related

- [[Implementations/Implement-Resilient-PgListener]] — rust-side sibling, same keepalive + watchdog pattern
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Components/Rust-Work-Service]]
- [[Implementations/Implement-Rust-Work-Service-Phase4]] — original WS client (v1.9.0, replaced here)
- [[Patterns/Async-Library-Circuit-Breaker]] — sibling pattern; the v1.7.1 Realtime breaker still applies to the legacy Supabase Realtime path, this WS client deliberately has no local breaker
- [[Debug/Fix-Auto-Confirm-Putaways-Trigger-Missing-And-Listener-Wedge]] — same failure-mode shape that motivated the rust-side wrapper
- [[Decisions/Roadmap-Rust-WS-Unlocks]]
- [[Sessions/2026-05-11]]
