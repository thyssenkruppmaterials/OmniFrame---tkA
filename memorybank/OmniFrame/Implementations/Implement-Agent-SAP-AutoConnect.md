---
tags: [type/implementation, status/active, domain/infra, domain/backend]
created: 2026-04-30
---

# Implement — Agent SAP Auto-Connect on Boot (v1.6.6)

## Purpose

Pre-1.6.6, the headless SAP agent sat idle on Citrix until the user clicked **SAP Connect** in the web UI (or any query that called `/sap/connect` under the hood — Inventory Management's Run Query did this side-effect). On a fresh Citrix session where SAP Logon hadn't been launched yet, the user had to remember to do it themselves. This added one click to every workday and was the leading cause of "agent is online but my queries are failing — I forgot to connect SAP" support pings.

v1.6.6 adds a self-healing daemon thread that attempts attach immediately after FastAPI startup, retries with exponential backoff until SAP becomes reachable, then sleeps until a future COM crash flips the connection back to false — at which point the same loop notices and resumes.

## Where the code lives

`omni_agent/agent.py` (~+135 LOC):

- **`_sap_autoconnect_state`** — module-level `dict` mirroring the shape of `_job_poller_state` / `_agent_heartbeat_state` / `_realtime_state` so the existing thread-tracking idiom stays consistent.
- **`_SAP_AUTOCONNECT_BACKOFFS = (10, 20, 40, 60)`** — backoff schedule between failed attach attempts. Caps at 60s. Reset to index 0 every time the connection drops, so a transient COM crash retries fast without waiting through the long tail of a previous backoff.
- **`_SAP_AUTOCONNECT_HEALTHY_TICK = 5.0`** — sleep between checks while already attached. Short enough to notice a flip-to-False quickly, long enough to keep idle CPU at zero.
- **`_start_sap_autoconnect_loop()`** — spawns the daemon. Idempotent; honors `OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1`.
- **`_stop_sap_autoconnect_loop()`** — clean shutdown counterpart. Called from `@app.on_event("shutdown")`.
- Wired into the existing `_on_startup()` hook AFTER `_start_realtime_subscription()`.

## Why a single monitor thread instead of a property hook

Two designs considered:

1. **Property setter on `AgentState.sap_connected`** — make `sap_connected` a `@property` and have its setter trigger `_kick_autoconnect_loop()` on `True → False`. Cleaner separation but requires changing `AgentState` from a dumb attribute holder to a class with descriptor logic — every existing `state.sap_connected = False` line then runs a side effect that callers don't expect, and any future caller has to remember the descriptor exists.
2. **Single monitor thread** (chosen) — daemon thread polls `state.sap_connected`. While True it sleeps `_SAP_AUTOCONNECT_HEALTHY_TICK` seconds; while False it tries `sap_connect()` on the backoff schedule. Auto-resumes on disconnect with no explicit hook needed — whoever flips `state.sap_connected = False` (the COM-crash defence in `lt22_import.py`, `/sap/disconnect`, the `sap_connect` handler itself when it can't find a session, etc.) doesn't have to know the loop exists.

Single monitor wins on simplicity AND on the "loose coupling" angle — no consumer of `state.sap_connected` needs awareness of the loop.

## Loop body

```python
def _loop() -> None:
    print("[sap-auto] SAP auto-connect loop started …")
    backoff_idx = 0
    while not stop_event.is_set():
        if state.sap_connected:
            backoff_idx = 0  # reset for next disconnect
            if stop_event.wait(_SAP_AUTOCONNECT_HEALTHY_TICK):
                break
            continue
        # Not attached — try sap_connect() defensively.
        reason = "unknown"
        try:
            result = sap_connect()
            if isinstance(result, dict) and result.get("ok"):
                print("[sap-auto] Attached to SAP session — sap_connected=True")
                backoff_idx = 0
                if stop_event.wait(_SAP_AUTOCONNECT_HEALTHY_TICK):
                    break
                continue
            if isinstance(result, dict):
                reason = str(result.get("error") or "unknown")
        except Exception as e:
            reason = str(e)
        wait = _SAP_AUTOCONNECT_BACKOFFS[
            min(backoff_idx, len(_SAP_AUTOCONNECT_BACKOFFS) - 1)
        ]
        print(f"[sap-auto] SAP not yet available ({reason[:160]}); retrying in {wait}s")
        backoff_idx = min(backoff_idx + 1, len(_SAP_AUTOCONNECT_BACKOFFS) - 1)
        if stop_event.wait(wait):
            break
```

Three key invariants:

1. **Doesn't block FastAPI startup.** Spawned as a daemon thread; the startup hook returns instantly so /health is reachable before the first attach attempt completes.
2. **Doesn't crash the agent on persistent failure.** `sap_connect()` itself catches every exception path and returns `{ok: False, error: "..."}`; the loop wraps the whole call in `try/except` as defense in depth.
3. **Auto-resumes on disconnect.** The COM-crash defence in `lt22_import.py` (added v1.6.3) flips `state.sap_connected = False` after a `pywintypes.com_error`. The loop's next 5s tick notices, resets `backoff_idx = 0`, and starts retrying immediately — no explicit hook needed.

## Boot prints (healthy v1.6.6 startup)

```
[boot]   SAP auto-connect: ENABLED — daemon will attempt attach immediately after startup, then retry every 10-60s until SAP GUI is reachable. Set OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1 to disable.
…
[sap-auto] SAP auto-connect loop started (will keep retrying every 10-60s until SAP GUI is reachable).
[sap-auto] Attached to SAP session — sap_connected=True
```

When SAP isn't running yet:

```
[sap-auto] SAP not yet available (No active SAP GUI session found. Please log in to an SAP system first…); retrying in 10s
[sap-auto] SAP not yet available (No active SAP GUI session found…); retrying in 20s
[sap-auto] SAP not yet available (No active SAP GUI session found…); retrying in 40s
[sap-auto] SAP not yet available (No active SAP GUI session found…); retrying in 60s
…
[sap-auto] Attached to SAP session — sap_connected=True
```

When the user opts out:

```
[boot]   SAP auto-connect: DISABLED via OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1 …
[sap-auto] DISABLED via OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1 — use POST /sap/connect …
```

## Capability

New advertised capability `sap-auto-connect` in `AGENT_CAPABILITIES`. The frontend can use this to (eventually) hide the manual **SAP Connect** button or downgrade it to a **Force reconnect** affordance on agents that advertise it. Today the button is left as-is for backward compat with pre-1.6.6 agents.

## Concurrency notes

`sap_connect()` calls `_init_com()` which calls `pythoncom.CoInitialize()` per-thread. Each calling thread (the auto-connect daemon, the FastAPI worker handling a manual `/sap/connect`, the heartbeat thread reading `_current_sap_session_info`, …) initialises its own apartment so there's no STA/MTA conflict. Concurrent `sap_connect()` calls from the daemon and the browser race on the global `_sap_conn_idx` / `_sap_sess_idx` — but both write the same valid `(ci, si)` from `_auto_select_valid_session()` when the previous selection is invalid, so the race is benign.

## Disable flag

`OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1` (env var) — for users who want manual control. Useful when:

- Running Bridge in parallel and you don't want both attaching to SAP simultaneously.
- Debugging SAP scripting policy with frequent `/sap/connect` toggling and you don't want the daemon racing your tests.
- A specific SAP build's COM behaviour breaks under repeated reconnect attempts.

## Related

- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Patterns/Agent-Self-Attribution]] — the v1.6.6 attribution-fix companion
- [[Debug/Fix-LT22-SAP-Crash-Pagedown]] — origin of the `state.sap_connected = False` flip on COM crash that this loop rides on
- [[Sessions/2026-04-30]]
