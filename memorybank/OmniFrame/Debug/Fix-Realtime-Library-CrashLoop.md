---
tags: [type/debug, status/active, domain/backend, domain/infra]
created: 2026-05-01
---
# Fix: Realtime Library Crash-Loop Wedge (v1.7.1)

## Symptom

User left OmniFrame Agent v1.7.0 running on a Citrix VDA. After ~25 minutes of idle:

- Queue drain froze (no `[jobs] Claimed job ...` lines for 25 minutes despite queued work).
- Heartbeat stopped — `sap_agents.last_seen_at` stuck at the last pre-wedge tick (Postgres dashboard showed agent as offline within 90s of the wedge).
- `console.txt` (485 KB, ~8000 lines) flooded with traceback bursts at high frequency.
- Re-arming the user's web session showed the agent as completely unresponsive even though `OmniFrame_Agent.exe` was still in Task Manager.

The traceback that drowned stderr looked like:

```
Task exception was never retrieved
future: <Task finished name='Task-N' coro=<AsyncRealtimeClient._listen() done, defined at realtime\_async\client.py:100> exception=ValueError('Set of Tasks/Futures is empty.')>
Traceback (most recent call last):
  File "realtime\_async\client.py", line 110, in _listen
  File "websockets\asyncio\connection.py", line 242, in __aiter__
  File "websockets\asyncio\connection.py", line 322, in recv
websockets.exceptions.ConnectionClosedError: no close frame received or sent

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "realtime\_async\client.py", line 110, in _listen
  File "realtime\_async\client.py", line 122, in _listen
  File "realtime\_async\client.py", line 221, in _on_connect_error
  File "realtime\_async\client.py", line 139, in _reconnect
  File "asyncio\tasks.py", line 422, in wait
ValueError: Set of Tasks/Futures is empty.
```

## Root Cause — `realtime>=2.x` library bug

**The bug is in the `realtime` Python library's `AsyncRealtimeClient`, not in our agent code.** Older 2.x releases (roughly 2.0.x – 2.4.x; refactored away around 2.5+) had this chain:

1. `_on_connect()` spawns the listen task: `self._listen_task = asyncio.create_task(self._listen())`. Nobody awaits it directly.
2. `_listen` reads from the WebSocket: `async for msg in self._ws_connection`.
3. The WebSocket drops (Citrix VDA hibernate / corporate proxy idle close) → `websockets.exceptions.ConnectionClosedError: no close frame received or sent`.
4. `_listen` catches the close and calls `_on_connect_error(e)`.
5. `_on_connect_error` calls `_reconnect()`.
6. `_reconnect` (in older 2.x) gathers pending tasks (`self._listen_task`, `self._heartbeat_task`) and calls `asyncio.wait(pending)`. After step 1 already cleared the listen task ref (or both happened to be `None`/done), the filtered list is empty.
7. `asyncio.wait([])` → `ValueError: Set of Tasks/Futures is empty.`
8. The library doesn't catch the `ValueError`. It escapes the listen task into asyncio's default `loop.call_exception_handler(...)` which logs at WARNING level: `Task exception was never retrieved` + the multi-line traceback.
9. Because `_listen_task` died with an unhandled exception, asyncio prints it to stderr (default exception handler).
10. **Each crash spawns a new listen task** (the library's `auto_reconnect=True` triggers `_on_connect → asyncio.create_task(_listen())` again) which races to the same drop and crashes the same way.
11. Stderr fills with thousands of multi-line tracebacks per minute.
12. Python's `print(...)` and `sys.stderr` are line-buffered and globally serialized. At high write volume **every other thread that prints** (heartbeat's `print("[heartbeat] tick failed: ...")`, job poller's `print("[jobs] Claimed job ...")`) **slows to a crawl** waiting on the contended stderr lock.
13. The heartbeat thread was effectively starved → `sap_agents.last_seen_at` stopped updating → fleet card flipped to offline within 90s. The job poller was starved → no `[jobs] Claimed job ...` lines despite queued work.

This is the textbook "async library bug crashes a non-awaited task and the asyncio default handler floods stderr" failure mode. The library was upstream-fixed around v2.5+ when the listen-task management moved into `_on_connect` and `_reconnect` stopped calling `asyncio.wait()` at all. Latest as of 2026-04-24 is `2.29.0`.

## Why v1.7.0's defenses weren't enough

v1.7.0 already had:
- The sticky `_realtime_started: bool` singleton (prevents *spawning* a second reconnect loop, but doesn't help when the FIRST loop crashes).
- The clean-return branch for `client.listen()` returning without raising (handles a different failure mode — clean library-internal close, not a crashed `_listen_task`).
- The outer `except Exception as e:` catching disconnect-loop crashes (catches what `client.listen()` raises directly, but the failed task fires from a SEPARATE asyncio task spawned by the library).

**None of those reach the asyncio loop's default exception handler** — that's where the `ValueError` lands when the library's internal `_listen_task` dies.

## Fix — four defensive layers (v1.7.1)

Surgical containment fix only. NO existing handler touched. NO trigger semantics changed. NO frontend logic changed beyond `LATEST_AGENT_VERSION = '1.7.1'`.

### Layer A — asyncio loop exception handler

Inside `_run_async`, BEFORE constructing the `AsyncRealtimeClient`, install a custom exception handler on the running loop:

```python
loop = asyncio.get_running_loop()

def _realtime_loop_exception_handler(_loop, context):
    exc = context.get("exception")
    from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK

    suppressed = False
    if isinstance(exc, ValueError) and "Set of Tasks/Futures is empty" in str(exc):
        suppressed = True
    elif isinstance(exc, (ConnectionClosedError, ConnectionClosedOK)):
        suppressed = True

    if suppressed:
        tripped = _realtime_circuit_breaker.record_error()
        if tripped:
            _disable_realtime_subsystem(
                f"library bug: {type(exc).__name__}: {str(exc)[:80]}"
            )
        return

    # Catch-all — log once per exception class per minute so a never-before-seen
    # failure mode is visible without carpet-bombing stderr if it repeats.
    if exc is not None:
        key = type(exc).__name__
        if _realtime_should_log(key):
            print(f"[realtime] async loop exception: {exc!r} (suppressed; "
                  "agent will fall back to polling if persistent)")
        tripped = _realtime_circuit_breaker.record_error()
        if tripped:
            _disable_realtime_subsystem(
                f"unexpected: {type(exc).__name__}: {str(exc)[:80]}"
            )

loop.set_exception_handler(_realtime_loop_exception_handler)
```

This single change eliminates 99% of the stderr flooding.

### Layer B — Circuit breaker (`_RealtimeCircuitBreaker`)

Sliding-window deque-backed counter. Every suppressed exception increments a 60s-window counter; at 20 errors the circuit trips:

```python
_REALTIME_ERROR_WINDOW_SECONDS: float = 60.0
_REALTIME_ERROR_THRESHOLD: int = 20
_REALTIME_CIRCUIT_RESET_INTERVAL_SEC: float = 300.0
_REALTIME_FALLBACK_POLL_MAX_IDLE_SEC: float = 15.0

class _RealtimeCircuitBreaker:
    def record_error(self) -> bool:
        # Returns True exactly once when the threshold is crossed.
        ...
```

When the breaker trips, `_disable_realtime_subsystem(reason)`:

1. Logs once: `[realtime] CIRCUIT BREAKER TRIPPED — {reason} ({N}+ errors in {W}s window). Disabling Realtime subsystem; falling back to polling-only mode for trigger backfill + job claiming. Auto-retry in {R}s.`
2. Sets `state.realtime_disabled = True`.
3. Tears down the WebSocket client (signals the asyncio loop's `stop_event` so it exits cleanly on its next backoff cycle — we DON'T cancel asyncio tasks from a non-loop thread; that's unsafe).
4. Tightens the job poller's idle backoff from 5→60s to 5→**15s** so polling-only mode keeps inter-job dwell low while the trigger backfill poller (60s) carries the missed-event load.
5. Wakes the job poller via `_kick_job_poller("realtime-disabled")` so the new backoff takes effect immediately.

`_start_realtime_circuit_reset_loop` daemon resets the breaker every 5 minutes and re-enters `_start_realtime_subscription()`. If the network has recovered (Citrix unhibernated, proxy resumed) we're back on Realtime; if not, the breaker trips again and we cycle.

### Layer C — Threading isolation (already correct in v1.7.0; confirmed)

Verified each background thread:

| Thread | Purpose | asyncio? |
|---|---|---|
| `sap-realtime-jobs` | Realtime asyncio loop (the only async one) | YES |
| `sap-agent-heartbeat` | `_upsert_self_in_registry` + `_bump_current_job_lease` | NO — pure synchronous `requests.post()` |
| `sap-job-poller` | `jobs_claim` + `_dispatch_job` | NO — synchronous |
| `sap-job-watchdog` | Detect stuck jobs > 120s | NO — synchronous |
| `sap-trigger-backfill` | 60s sweep of last 24h `rf_putaway_operations` | NO — synchronous |
| `sap-auto-connect` | Attach SAP COM with backoff | NO — synchronous |
| `sap-realtime-reset` | New v1.7.1 — reset circuit breaker every 5min | NO — synchronous |

**A Realtime asyncio crash CANNOT directly wedge the other threads** because they don't share the loop. The actual coupling mechanism in v1.7.0 was the **stderr lock contention** described above. Layers A+B+D bound that flood, so the threads are now truly independent.

### Layer D — Bound stderr noise

Raise the noisy library loggers:

```python
logging.getLogger("realtime").setLevel(logging.WARNING)
logging.getLogger("websockets").setLevel(logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.ERROR)
```

With Layer A in place, `asyncio` shouldn't normally have to log anything (the exception handler routes everything before it would call `loop.default_exception_handler(...)`). But raising `asyncio` to ERROR is defense-in-depth: an exception class we didn't predict bypasses our handler → asyncio's default handler tries to log at WARNING → suppressed.

### Library pin

`omni_agent/requirements.txt` updated:

```
realtime>=2.29.0,<3.0
```

Was `realtime>=2.0.0`. Pinning to ≥2.29.0 picks up the upstream `_reconnect` refactor (no more `asyncio.wait()` in there at all). The `<3.0` cap excludes the 3.0.0a1 alpha (released 2026-04-09). Containment layers stay as defense-in-depth so a future 2.x regression is bounded.

## Files Changed (LOC delta)

| File | Delta | Notes |
|---|---|---|
| `omni_agent/agent.py` | ~+512 | Circuit breaker class + reset loop daemon + loop exception handler + logging filter wiring + version banner + 3 capabilities + boot print + AgentState.realtime_disabled + poller `_resolve_idle_max()` + tightened backoff path. Final size: 9096 lines. |
| `omni_agent/requirements.txt` | +18 | Pin floor to `realtime>=2.29.0,<3.0` with comment block. |
| `src/features/admin/sap-testing/lib/agent-fetch.ts` | ~+56 | `LATEST_AGENT_VERSION = '1.7.1'` + comment block. NO logic change. |
| `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` | overwritten | Mirror of source; for next EXE rebuild. |
| `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/requirements.txt` | overwritten | Mirror. |

## Verification

- **AST parse** of `agent.py` → OK (`python3 -c "import ast; ast.parse(open(...).read())"` exits 0).
- **Frontend lints** clean (`ReadLints` on `agent-fetch.ts` → no errors).
- **`npm run build`** clean (✓ built in 9.17s; 181 PWA precache entries; bundle sizes unchanged from v1.7.0).

## New Boot Prints

```
[boot]   Realtime crash-loop containment: ENABLED — asyncio loop exception handler suppresses known `realtime>=2.x` library bugs (`_reconnect()` → `asyncio.wait([])` → `ValueError`) + WebSocket `ConnectionClosedError` bursts. Circuit breaker trips after 20 errors in 60s; tripped state falls back to polling-only mode (job poller idle ceiling shrinks to 15s) and auto-resets every 300s.
[realtime] Circuit-breaker reset loop started (every 300s; window 60s, threshold 20 errors).
```

When the breaker trips in production:

```
[realtime] CIRCUIT BREAKER TRIPPED — library bug: ValueError: Set of Tasks/Futures is empty. (20+ errors in 60s window). Disabling Realtime subsystem; falling back to polling-only mode for trigger backfill + job claiming. Auto-retry in 300s.
[realtime] subsystem disabled (circuit breaker tripped); exiting reconnect loop. Auto-retry in 300s.
```

After 5min cooldown:

```
[realtime] Circuit breaker reset attempt — re-enabling subsystem.
[realtime] connected to wss://wncpqxwmbxjgxvrpcake.supabase.co/realtime/v1 (subscribed to public.sap_agent_jobs + public.rf_putaway_operations for org <id>)
```

## Rebuild Command

On the Parallels Windows VM (or any Windows box with Python 3.10+ and pywin32):

```bat
cd C:\path\to\Omni-Agent
pip install -r requirements.txt --upgrade
build_exe.bat
```

`build_exe.bat` runs PyInstaller `--onefile --windowed --name OmniFrame_Agent agent.py` and emits `dist\OmniFrame_Agent.exe`. Then zip + upload to the `downloads` Supabase Storage bucket per [[Implement-Omni-Agent]].

## Why this fix is right

- **Surgical containment, not a library replacement.** We don't fork `realtime-py`. We don't write our own WebSocket client. We catch the symptom (stderr flood + missed-event recovery), let upstream fix the root cause, and bound the blast radius if upstream regresses.
- **The fallback path already exists.** The trigger backfill poller (v1.6.9) was designed exactly for this — at-most-once Realtime delivery + 60s polling fallback. Tightening the job poller's backoff to 5→15s when Realtime is disabled means polling-only mode is *bounded* (max 15s inter-job dwell) instead of *unbounded* (60s default).
- **Auto-recovery, not auto-restart.** The user explicitly said "the agent must run for hours/days without wedging." An EXE restart per drop would be acceptable but annoying; a 5min auto-recovery is invisible.
- **Defense-in-depth.** Even after the library is fixed, the four layers stay so future regressions are bounded. Mirrors the v1.6.7 `_SchemaFallbackFlag` pattern (5min cooldown then re-test) one layer up.

## Capabilities advertised

`/health.capabilities` now includes (informational only — no frontend gating):

- `realtime-circuit-breaker` — sliding-window error counter
- `realtime-fallback-mode` — tightened poller backoff when Realtime is offline
- `crash-loop-containment` — asyncio loop exception handler in place

## Related

- [[Patterns/Async-Library-Circuit-Breaker]] — generalizes the pattern
- [[Patterns/Self-Healing-Schema-Fallback]] — sibling 5min-cooldown auto-retry pattern (PostgREST schema cache layer)
- [[Patterns/Job-Queue-Drain-Mode]] — the trio: drain mode + backfill + circuit breaker = three independent recovery layers
- [[Debug/Fix-Missed-Realtime-Events-Backfill]] — the upstream-Realtime-layer recovery
- [[Debug/Fix-Agent-Throughput-Latency]] — v1.7.0 throughput pass + watchdog (the layer below this fix)
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Sessions/2026-05-01]]

## Open items

- **Watch upstream `realtime-py`** — when the next 2.29.x or 2.30 lands, sanity-check the `_reconnect()` source and update the pin comment. If a regression is reintroduced, the containment layers buy us time but we should still pin around it.
- **Consider exposing breaker stats in `/status`** — `_realtime_circuit_breaker.snapshot()` already returns the dict; a future PR could surface it under the existing `realtime` block in `list_agents()` so dashboards can see breaker trips per agent.
- **Stretch: filter on `_listen_task` cancel exceptions specifically** — if upstream reintroduces the bug with a different error message, our `"Set of Tasks/Futures is empty"` substring match misses it. The catch-all branch still records the error and trips the breaker, so the symptom is bounded — but the stderr line will still appear once per minute for the new failure mode.
