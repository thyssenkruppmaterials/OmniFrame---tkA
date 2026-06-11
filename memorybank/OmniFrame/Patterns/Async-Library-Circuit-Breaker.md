---
tags: [type/pattern, status/active, domain/backend, domain/infra]
created: 2026-05-01
---
# Async Library Circuit Breaker

## Purpose

A reusable defense for **asyncio-based third-party libraries that crash and flood stderr at high frequency**. Pattern is: **catch → count → trip → fall back → auto-recover**. Eliminates the "library bug wedges the whole agent" failure mode where a loud failing thread starves quieter sibling threads via stderr lock contention.

First applied in OmniFrame Agent v1.7.1 to contain the `realtime>=2.x` `_reconnect()` bug (`asyncio.wait([])` → `ValueError: Set of Tasks/Futures is empty.`). See [[Debug/Fix-Realtime-Library-CrashLoop]] for the original incident.

## When to use

Use when ALL of these are true:

1. The third-party library uses asyncio internally (`asyncio.create_task`, etc.) and you can't await every internal task.
2. The library has a known (or suspected) failure mode that produces **bursts** of unhandled exceptions, not just one-shot failures.
3. The agent has a **fallback path** for the same work (polling, secondary channel, etc.) so degrading from the realtime path is a tolerable user experience, not an outage.
4. Auto-recovery is desirable — "restart the agent" is too disruptive for the use case.

Do NOT use when:

- The library is mission-critical with no fallback path. (Better to crash loud and force operator attention.)
- The failure mode is one-shot (e.g. malformed payload). A try/except inside your callback is enough.
- The library is well-behaved and respects normal cancellation. (No need to over-engineer.)

## Failure model this pattern addresses

Without containment, the following chain wedges quiet sibling threads:

1. Library spawns an internal asyncio task: `self._task = asyncio.create_task(self._inner())`. Nobody awaits the task directly.
2. The task hits a library bug and raises an unhandled exception.
3. Because the task wasn't awaited, asyncio routes the exception through `loop.call_exception_handler(context)`.
4. The default handler logs `Task exception was never retrieved` + multi-line traceback to stderr (via `logging.getLogger("asyncio").error(...)`, which propagates to the root logger → stderr).
5. The library's auto-reconnect spawns a **new** task immediately. It races to the same bug and crashes the same way.
6. Stderr fills with thousands of multi-line tracebacks per minute.
7. **Python's `print(...)` and `sys.stderr` are line-buffered and globally serialized.** Every other thread that tries to print logs blocks on the contended stderr lock — in extreme cases for tens of seconds at a time.
8. Background threads that *should* be independent (heartbeat, polling, watchdog) are now starved. The agent looks wedged from outside even though COM/SAP work could still execute if the threads were ever scheduled.

The stderr lock is the actual coupling mechanism. **Bound the flood, fix the wedge.**

## The pattern — four defensive layers

### Layer A: Custom asyncio loop exception handler

```python
import asyncio

async def _run_async():
    loop = asyncio.get_running_loop()

    def _handler(_loop, context):
        exc = context.get("exception")
        # Match KNOWN suppressible exceptions explicitly. Don't blanket-catch —
        # a never-before-seen failure mode should still be visible (just bounded).
        if isinstance(exc, KnownLibraryBug) and "<specific message>" in str(exc):
            _circuit_breaker.record_error()
            return
        if isinstance(exc, NetworkDropException):
            _circuit_breaker.record_error()
            return
        # Catch-all: log ONCE per exception class per minute (throttled)
        # so a new failure mode is visible without carpet-bombing stderr.
        if exc is not None and _should_log(type(exc).__name__):
            print(f"[mysubsystem] async loop exception: {exc!r} (suppressed)")
        _circuit_breaker.record_error()

    loop.set_exception_handler(_handler)
    # ... spawn library client ...
```

**Why install BEFORE the library client is constructed:** `loop.set_exception_handler` is per-loop state. Setting it after the library has already spawned tasks means any task that crashes between client construction and handler install hits the default handler.

**Why explicit `isinstance(exc, KnownLibraryBug)` matching:** if you blanket-suppress, you'll silently swallow legitimate bugs in your own code that happen to raise during the library's callbacks. Be specific about what you suppress.

### Layer B: Sliding-window circuit breaker

```python
from collections import deque
import threading
import time

_ERROR_WINDOW_SECONDS = 60.0
_ERROR_THRESHOLD = 20

class _CircuitBreaker:
    def __init__(self):
        self._errors = deque()
        self._lock = threading.Lock()
        self._tripped = False

    def record_error(self) -> bool:
        """Returns True ONCE when the threshold is crossed."""
        with self._lock:
            now = time.time()
            self._errors.append(now)
            cutoff = now - _ERROR_WINDOW_SECONDS
            while self._errors and self._errors[0] < cutoff:
                self._errors.popleft()
            if len(self._errors) >= _ERROR_THRESHOLD and not self._tripped:
                self._tripped = True
                return True
            return False

    def reset(self) -> None:
        with self._lock:
            self._errors.clear()
            self._tripped = False
```

**Why deque:** O(1) append + popleft for the sliding window. A list would be O(n) for the prune step.

**Why a one-shot `True` return:** the caller takes a one-time action (disable subsystem, log once). Subsequent `record_error()` calls during the disabled window still increment the counter (which is fine — errors keep arriving) but don't re-trip. Without the one-shot, you'd log "CIRCUIT BREAKER TRIPPED" 100 times in the next minute.

**Tuning the threshold:** start with 20 errors / 60s. This is sensitive enough to catch a true crash loop (1000+ errors/sec saturates the deque in milliseconds) but tolerant enough to not trip on a single transient bug + retry pattern (3-5 errors over 60s is normal flapping, not a wedge).

### Layer C: Disable + fall back

```python
class _SubsystemState:
    realtime_disabled: bool = False  # checked by all callsites

def _disable_subsystem(reason: str) -> None:
    if state.realtime_disabled:
        return  # idempotent
    print(f"[mysubsystem] CIRCUIT BREAKER TRIPPED — {reason}. Disabling.")
    state.realtime_disabled = True
    # Tear down the live client cleanly. Signal stop_event from THIS thread
    # (the exception handler runs on the asyncio thread); don't try to cancel
    # tasks from a non-loop thread.
    _stop_event.set()
    # Tighten the fallback path's polling backoff so degraded mode doesn't
    # also degrade throughput.
    _kick_fallback_thread("subsystem-disabled")
```

Fallback paths in agent codebases typically have a configurable idle backoff. When the primary subsystem is disabled, **shrink the ceiling**:

```python
def _resolve_idle_max() -> float:
    if state.realtime_disabled:
        return min(configured_max, _FALLBACK_TIGHT_CEILING_SEC)
    return configured_max
```

This is the trick: **fallback mode only loses the fast-path push wake-up, not the polling fallback itself**. If the fallback was tuned for "primary path is healthy, polling is just a safety net," tighten it for "primary is offline, polling carries the load."

### Layer D: 5min auto-recovery loop

```python
def _start_circuit_reset_loop():
    def _loop():
        while not _shutdown.is_set():
            if _shutdown.wait(_RESET_INTERVAL_SEC):
                break
            if _circuit_breaker.tripped:
                print("[mysubsystem] Circuit breaker reset attempt — re-enabling.")
                _circuit_breaker.reset()
                state.realtime_disabled = False
                _start_subsystem()
    threading.Thread(target=_loop, daemon=True, name="<subsystem>-reset").start()
```

**5 minutes** is the right cadence for most subsystems. Long enough that a flapping network has time to stabilize; short enough that the user's "why isn't this responding" tolerance window isn't exceeded.

If the network has recovered, we're back on the primary path within 5min. If not, the breaker trips again immediately and we cycle. **No EXE restart required.**

### Bonus: bound stderr noise (Layer D')

Even with Layer A in place, library-internal `logging.getLogger("<lib>").info(...)` calls can flood at high volume:

```python
import logging
logging.getLogger("realtime").setLevel(logging.WARNING)
logging.getLogger("websockets").setLevel(logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.ERROR)
```

Raising `asyncio` to ERROR is defense-in-depth: an exception class your handler doesn't predict bypasses your handler → asyncio's default handler tries to log at WARNING → suppressed.

## Threading isolation — the prerequisite

This pattern only works if your other background threads don't share the broken subsystem's loop. Audit:

- **Heartbeat** → should use synchronous `requests.post()`, not asyncio.
- **Job poller** → synchronous claim + dispatch.
- **Watchdog** → synchronous tick.
- **Backfill** → synchronous bounded query.

If any of those genuinely need asyncio, give each its own loop in its own thread. **Never share a loop across functional concerns.**

After Layers A+B+D bound the stderr flood, the threads are truly independent. Before, they were sharing the stderr lock.

## Capability advertising

Surface the new defensive posture to ops dashboards via `/health.capabilities`:

- `realtime-circuit-breaker` — the breaker is wired in.
- `realtime-fallback-mode` — the fallback path tightens its polling when the breaker trips.
- `crash-loop-containment` — asyncio loop exception handler is installed.

Three IDs (instead of one umbrella) so dashboards can show partial coverage as the pattern is rolled out across multiple subsystems.

## Trade-offs

| Pro | Con |
|---|---|
| Survives library bugs without an EXE restart | Adds ~250 LOC of containment infra per subsystem |
| Auto-recovery is invisible to the user | Suppressing exceptions means you may miss novel failure modes (catch-all branch + throttled log mitigates this) |
| Bounded stderr flood means quiet threads stay responsive | Requires a fallback path — not applicable to truly critical subsystems |
| Defense-in-depth — stays in place even after library is upgraded | Must monitor library upstream and update the suppress-list when the bug changes shape |

## Concrete files / data structures (v1.7.1 reference implementation)

- `omni_agent/agent.py:1502-1779` — `_RealtimeCircuitBreaker`, `_disable_realtime_subsystem`, `_start_realtime_circuit_reset_loop`, throttled log helper.
- `omni_agent/agent.py:_run_async` — `loop.set_exception_handler(_realtime_loop_exception_handler)` BEFORE `AsyncRealtimeClient(...)`.
- `AgentState.realtime_disabled: bool` — read by `_resolve_idle_max()` in the job poller and short-circuit at the top of `_start_realtime_subscription()`.
- Job poller `_resolve_idle_max()` — returns `min(configured, 15s)` when disabled.
- `_start_realtime_circuit_reset_loop()` daemon — mirrors `_start_trigger_backfill_poller` shape.
- New capabilities advertised: `realtime-circuit-breaker`, `realtime-fallback-mode`, `crash-loop-containment`.

## Sibling pattern: self-healing schema fallback

[[Self-Healing-Schema-Fallback]] applies the same "5min cooldown then re-test" idea **one layer down** — to a single PostgREST column instead of a whole subsystem. Same shape:

1. Catch the failure (PostgREST 400 "Could not find column X").
2. Trip a flag.
3. Fall back (strip the column from subsequent calls).
4. Auto-recover after 5min (re-attempt with the column).

The two patterns compose. v1.7.1 agent has BOTH active simultaneously: schema-fallback flags trip per-column, the realtime circuit breaker trips per-subsystem. They never interact because they live at different layers.

## Sibling pattern: missed-event backfill

[[Job-Queue-Drain-Mode]]'s sibling pattern in [[Debug/Fix-Missed-Realtime-Events-Backfill]] applies the same "primary fast path + bounded slow recovery" idea **at the upstream Realtime layer** — a 60s backfill poller catches events the WebSocket missed during reconnect blips. The realtime circuit breaker is the layer ABOVE that: when the WebSocket layer is too unhealthy to recover with the backfill alone, the breaker disables it entirely and the backfill becomes the primary path until the breaker resets.

Three-layer defense: drain mode → backfill → circuit breaker. Each layer's primary path has a cheap, bounded, quiet recovery mechanism.

## Related

- [[Debug/Fix-Realtime-Library-CrashLoop]] — the original incident this pattern was extracted from
- [[Patterns/Self-Healing-Schema-Fallback]] — sibling 5min-cooldown auto-retry pattern
- [[Patterns/Job-Queue-Drain-Mode]] — the trio: drain mode + backfill + circuit breaker
- [[Debug/Fix-Missed-Realtime-Events-Backfill]] — the upstream-Realtime-layer recovery
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[_Index/Patterns]]
