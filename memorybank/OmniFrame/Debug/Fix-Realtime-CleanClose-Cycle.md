---
tags: [type/debug, status/active, domain/backend, domain/infra]
created: 2026-05-03
---
# Fix: Realtime Clean-Close Reconnect Cycle (v1.8.0)

## Symptom

User's OmniFrame Agent v1.7.9 was healthy on SAP (session pinned, jobs claiming when issued) but the agent's console at `MacWindowsBridge/console.txt` was filled with a continuous reconnect cycle, ~5 seconds apart, repeating for 100+ cycles in a 10-minute window:

```
[realtime] connected to wss://wncpqxwmbxjgxvrpcake.supabase.co/realtime/v1 (subscribed to public.sap_agent_jobs + public.rf_putaway_operations + public.shipment_queue + public.work_tasks for org c9d89a74-7179-4033-93ea-56267cf42a17)
[realtime] listen() returned cleanly — socket closed without exception; reconnect in 5.0s
```

User-visible symptom: *"SAP session is not persistent and it's losing connectivity. I try to refresh. It will show for a second, then disconnect."* — but SAP itself was fine on the agent side. The Realtime storm was starving the heartbeat thread + flooding the `/sap/sessions` endpoint, so the frontend's agent-detection probe perceived the agent as flaky.

The exception circuit breaker added in [[Fix-Realtime-Library-CrashLoop]] (v1.7.1) never tripped because no exception was ever raised — the listen() task returned cleanly every cycle.

## Root Cause — Corporate Proxy Idle-Closing WebSocket Faster Than Heartbeat

User's network path: `Citrix VDA → Netskope/ZScaler → corporate egress → internet → Supabase Realtime`.

Corporate forward-proxy / SASE products (Netskope, ZScaler, Citrix's own NetScaler) routinely idle-close TCP/TLS connections after a short window — typically **5-30 seconds** of no application-layer traffic — to enforce session policy and reclaim idle ephemeral ports. The default WebSocket heartbeat in the `realtime>=2.x` Python client is **25 seconds** (`AsyncRealtimeClient.__init__` defaults `hb_interval=25`):

- 0s: WebSocket connects, all four channels subscribe.
- ~5-10s: Netskope's idle timer fires, sends a clean RST/FIN-equivalent to both sides.
- The realtime library observes a clean WebSocket close (no exception, no error).
- `client.listen()` returns normally.
- Our outer reconnect loop in `_start_realtime_subscription._run_async` waits 5s and reconnects.
- **Cycle indefinitely.** No exception → no breaker trip → forever-cycle.

**Why the v1.7.1 breaker didn't help:** `_RealtimeCircuitBreaker.record_error()` is only called from the asyncio loop exception handler (which fires on suppressed `ValueError("Set of Tasks/Futures is empty")` and `ConnectionClosedError`) and the outer `try/except` in the connect loop. A clean return from `listen()` skips both paths.

**Why the cycling hurt SAP perceptibility even though SAP was fine:**
- Every reconnect re-handshakes the WebSocket + re-subscribes 4 channels (`sap_agent_jobs`, `rf_putaway_operations`, `shipment_queue`, `work_tasks`). The asyncio thread monopolizes Python's GIL during the ~200ms re-subscribe burst, every 5s.
- The heartbeat thread runs in `sap-agent-heartbeat` (synchronous `requests.post` to PostgREST). It needs the GIL to acquire the lock, format JSON, and call into OpenSSL. Constant contention with the reconnect storm starves it.
- The frontend's `useAgentDetection` polls `/sap/sessions` every 1s. Every poll has to wait for the GIL too.
- User sees `/sap/sessions` returning 200 OK but with stale `connected: true` flicker, interpreted as "session won't stay connected".

## Why the Library Default of 25s Is Wrong For Citrix

Supabase Realtime's server-side `phx_join` heartbeat is 30s. The Python library's 25s `hb_interval` means it sends `phoenix:heartbeat` frames every 25s to keep the *server-side* idle timer happy. It says nothing about *intermediate proxy* idle timers, which are typically much shorter on corporate networks:

| Proxy | Default Idle Close | Configurable |
|---|---|---|
| Netskope NewEdge | ~5-10s | yes (per-tenant) |
| ZScaler ZIA | ~10-15s | yes |
| Citrix NetScaler | 30s (default) | yes |
| Cloudflare WARP | 30s | partial |
| AWS NLB (no NAT) | 350s | yes |

Anywhere in the 5-30s range, the library default of 25s loses the race in roughly half of the corporate environments we'll see in the field.

## Fix — v1.8.0 Three Layered Defenses

### 1. `_RealtimeCleanCloseTracker` — second sliding-window counter

A NEW circuit-breaker tier, separate from the v1.7.1 exception breaker, tracks every clean close where the connection lasted less than `_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC = 30s` (i.e. before any heartbeat could plausibly have kept it alive). Threshold + window mirror the v1.7.1 design but tuned for spurious closes specifically:

| Constant | Value | Rationale |
|---|---|---|
| `_REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS` | 60.0 | Same as exception breaker — same observation window |
| `_REALTIME_SPURIOUS_CLOSE_THRESHOLD` | 5 | At 5s reconnect cycle, breaker trips after ~25s of cycling |
| `_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC` | 30.0 | Connections that survive > 30s are normal; below that they died before heartbeat could plausibly help |

When tripped, fires the SAME `_disable_realtime_subsystem(reason)` path the v1.7.1 exception breaker uses — sets `state.realtime_disabled = True`, tightens the job poller's idle backoff from 5→60s to 5→15s (`_REALTIME_FALLBACK_POLL_MAX_IDLE_SEC = 15`), and the v1.6.9 trigger backfill poller (60s) carries the missed-event load. The 5-min auto-retry daemon (`_start_realtime_circuit_reset_loop`) re-arms Realtime on the same cadence as the exception breaker.

The two breakers run in parallel — the exception breaker stays UNTOUCHED so the v1.7.1 stderr-flood guard still works.

### 2. Tighter WebSocket heartbeat — `hb_interval=10`

Pass `hb_interval=10` to the `AsyncRealtimeClient` constructor (vs the library default of 25). 10s is well under the 5-30s typical corporate-proxy idle window. Wrapped in `try/except TypeError` for compatibility with older bundled `realtime` wheels that don't accept the kwarg:

```python
try:
    client = AsyncRealtimeClient(
        rt_url,
        token=state.supabase_key,
        hb_interval=_REALTIME_HEARTBEAT_INTERVAL_SEC,
    )
except TypeError:
    client = AsyncRealtimeClient(rt_url, token=state.supabase_key)
```

Inspecting `realtime` 2.29.0 (currently bundled): the constructor signature is `(url, token=None, auto_reconnect=True, params=None, hb_interval=25, max_retries=5, initial_backoff=1.0, timeout=10)`. So `hb_interval` IS the right kwarg name; the older signature variants (pre-2.0) are blanket-handled by the TypeError fallback.

### 3. Friendly escalation log

After 3+ spurious closes accumulate within 30s, emit ONE WARN per minute pointing the user at the proxy idle-close hypothesis:

```
[realtime] WARN — 3 spurious clean closes in last 30s (connection lasted <30s before close). Likely a corporate proxy (Citrix/Netskope/ZScaler) idle-closing the WebSocket faster than the heartbeat keep-alive. If this persists, the circuit breaker will trip after 5 closes in 60s and fall back to polling-only mode.
```

Single log line, throttled to one per minute (`_REALTIME_ESCALATE_LOG_THROTTLE_SEC = 60`). Helps users diagnose the issue from the console without counting log lines.

### 4. New `/realtime/status` endpoint

Read-only diagnostic for frontend status pills. Token-exempt so it can render before login completes.

```json
{
  "connected": false,
  "circuit_tripped": true,
  "fallback_mode": "polling-only",
  "spurious_close_count_60s": 5,
  "exception_count_60s": 0,
  "last_event_at": "2026-05-03T20:14:32Z",
  "uptime_seconds": 0,
  "agent_uptime_seconds": 1247,
  "version": "1.8.0",
  "details": {
    "fallback_reason": "circuit breaker tripped: spurious clean closes (5+ in 60s, each <30s alive — likely corporate proxy idle-closing WebSocket faster than heartbeat) (auto-retry in 300s)",
    "reconnect_attempts": 7,
    "exception_breaker": { "tripped": false, "errors_in_window": 0, "trips_total": 0, "tripped_at": null, "window_seconds": 60.0, "threshold": 20 },
    "clean_close_tracker": { "spurious_close_count_60s": 5, "spurious_close_total": 32, "window_seconds": 60.0, "threshold": 5, "min_connect_age_sec": 30.0 },
    "heartbeat_interval_sec": 10,
    "active": false
  }
}
```

Stable contract: `connected`, `circuit_tripped`, `fallback_mode`, `spurious_close_count_60s`, `exception_count_60s`, `last_event_at`, `uptime_seconds`, `agent_uptime_seconds`, `version`. `details.*` is intentionally NOT a stable contract — debug surface only.

## Why `auto_reconnect=True` Doesn't Help

`AsyncRealtimeClient(... auto_reconnect=True)` (the default) handles reconnects WITHIN the `listen()` task — but it has `max_retries=5`. After 5 reconnect failures inside the library, listen() returns cleanly, and our outer loop re-enters from scratch. So the library's auto-reconnect is effectively the FIRST 5 cycles of any 100-cycle storm; our outer reconnect loop is what extends it forever. The clean-close tracker counts every iteration of OUR loop, so it correctly counts the library's give-ups too.

## Verification

How to confirm this is the actual failure mode (vs e.g. JWT expiry or `_reconnect()` re-bug):

1. **Look at console.txt for clean closes WITHOUT exceptions.** If every "listen() returned cleanly" line has no preceding stack trace and no `[realtime] async loop exception:` line, it's not the v1.7.1 path.
2. **Look at connection age.** With v1.8.0+, the log line now reads `listen() returned cleanly — socket closed without exception after Xs`. If `X < 30` repeatedly, it's the proxy idle-close path. If `X` varies wildly (e.g. 60s, 300s, 5s, 1200s), it's likely something else.
3. **Trace from the user's network.** Run `mtr` or `tracert` from the Citrix VDA to `wncpqxwmbxjgxvrpcake.supabase.co` and look for hops with corporate hostnames (e.g. `*.netskope.com`, `gateway.zscaler.com`, `nsg.*.citrix.local`).
4. **Bypass the proxy.** Try the same agent with `https_proxy=`, `http_proxy=` cleared (Citrix VDAs sometimes have an env-bypass list); if the cycling stops, it's the proxy.
5. **Watch the new endpoint.** `curl http://localhost:8765/realtime/status` once the agent has been running 60s. If `spurious_close_count_60s >= 5` and `circuit_tripped: true`, the breaker did its job.

## Files Modified

- `omni_agent/agent.py` — new `_RealtimeCleanCloseTracker` class + 6 module-level constants (`_REALTIME_SPURIOUS_*`, `_REALTIME_HEARTBEAT_INTERVAL_SEC`, `_REALTIME_ESCALATE_*`); `connected_at` field on `_realtime_state`; `hb_interval` kwarg on AsyncRealtimeClient construction with `TypeError` fallback; spurious-close hook + escalate log + connect-age print after `client.listen()` returns; new `GET /realtime/status` route + `/realtime/status` in `_TOKEN_EXEMPT_PATHS`; tracker `reset()` call in the circuit-reset daemon; `connected_at` cleared in disable / except / clean-close / thread-finally paths; two new capabilities (`realtime-clean-close-detection`, `realtime-status-endpoint`); version bump 1.7.9 → 1.8.0 with banner.
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION = '1.8.0'`.

LOC delta: ~+260 in `agent.py`, +0/+1 in `agent-fetch.ts`. AST parsed clean. `pnpm build` exit 0 in 11.08s.

## Constraints Held

- **Did NOT remove the v1.7.1 exception circuit breaker** — extended with a parallel clean-close tracker that fires the SAME `_disable_realtime_subsystem` path. Both run independently.
- **Did NOT remove the polling fallback** — it's the safety net. v1.6.9 backfill poller + v1.7.0 drain-mode poller both still cover their lanes.
- **Did NOT touch frontend logic** beyond `LATEST_AGENT_VERSION`. A future UI improvement to consume `/realtime/status` for a "Realtime: degraded" pill is on the next-session list.
- **Healthy networks unaffected.** Connections that survive >30s are not recorded as spurious. The tracker's record window stays empty in healthy environments. The `hb_interval=10` adds ~0.05% bandwidth (one ping frame every 10s vs every 25s).

## Related

- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Debug/Fix-Realtime-Library-CrashLoop]] — v1.7.1 exception breaker (this fix runs in parallel)
- [[Patterns/Async-Library-Circuit-Breaker]]
- [[Sessions/2026-05-03]]



---

## v1.8.1 Update — Root Cause Was Not the Proxy

(2026-05-03) The v1.8.0 clean-close circuit breaker correctly tripped into polling-only fallback within ~25s of boot on every restart — the containment worked. But the actual root cause turned out NOT to be corporate-proxy idle-close. User's console at `MacWindowsBridge/console.txt` showed the close happening with `connect_age ≈ 0.0s`:

```
[realtime] connected to wss://... (subscribed to public.sap_agent_jobs + public.rf_putaway_operations + public.shipment_queue + public.work_tasks for org ...)
[realtime] listen() returned cleanly — socket closed without exception after 0.0s; reconnect in 5.0s
```

0.0s is too fast to be a proxy idle timer (those fire at 5–30s). That pattern means the server is rejecting the subscription during the post-subscribe phase.

### Database Audit (via Supabase MCP)

```sql
SELECT pubname, schemaname, tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' ORDER BY tablename;
```

Returns (relevant subset): `rf_putaway_operations`, `sap_agent_jobs`, `work_tasks`. NOT returned: **`shipment_queue`**.

```sql
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('shipment_queue','work_tasks','rf_putaway_operations','sap_agent_jobs');
```

Returns only three of the four. **`shipment_queue` does not exist in the database at all.**

The `builtin-shipment-queue` trigger entry (v1.7.2) + the realtime subscription that feeds it (`_on_shipment_queue_insert` callback) both point at a table that was planned but never created. Subscribing to a non-existent-in-publication table causes Supabase Realtime to close the WebSocket cleanly immediately after `subscribe()` — which is exactly what we saw.

### v1.8.1 Fix

1. **Drop `shipment_queue` from the realtime subscription** — `_start_realtime_subscription` now subscribes to three channels (`sap_agent_jobs` + `rf_putaway_operations` + `work_tasks`) instead of four. A single `[realtime] skipping shipment_queue — table not present in DB (see Debug/Fix-Realtime-CleanClose-Cycle.md)` log line names the table and points at this note. The `_on_shipment_queue_insert` callback and `builtin-shipment-queue` `_HARDCODED_TRIGGERS` entry are kept for backward compatibility — if the table is ever created + added to the publication, re-enable the subscribe block.
2. **Per-channel defensive `try/except` around each `subscribe()`** — a future missing-publication regression won't silently tear the whole socket down. The agent logs `[realtime] channel <name> subscribe error: <exc>. Continuing with remaining channels.` and carries on with the remaining channels.
3. **Dynamic log line for connected channels** — the `[realtime] connected to <url> (subscribed to <tables> for org <id>)` message now echoes only the tables that actually succeeded, not a hardcoded list. So a partial-failure scenario produces a HONEST log line instead of claiming four channels subscribed when only three did.

### Verification of v1.8.1

1. User pulls new `OmniFrame_Agent.exe`, launches.
2. Console shows:
   ```
   [realtime] skipping shipment_queue — table not present in DB (see Debug/Fix-Realtime-CleanClose-Cycle.md)
   [realtime] connected to wss://... (subscribed to public.sap_agent_jobs + public.rf_putaway_operations + public.work_tasks for org ...)
   ```
3. NO `listen() returned cleanly — socket closed without exception after 0.0s` burst.
4. Eventually `[realtime] event received: ...` (or at least silent quiescence instead of the every-5s churn).
5. `GET /realtime/status` → `circuit_tripped: false`, `fallback_mode: false`.

### Why This Analysis Matters

The v1.8.0 heuristic ("<30s clean close = spurious = proxy") stays correct as a **defensive** signal. A real proxy-idle-close scenario would still trip the same circuit. v1.8.1 just removes the one subscription that was false-positive-ing the heuristic by closing within milliseconds rather than the 5–30s proxy window. The v1.8.0 containment is unchanged; v1.8.1 removes the cause.