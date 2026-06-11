---
tags: [type/debug, status/active, domain/backend, sap, ll01, agent]
created: 2026-05-31
---
# Fix: LL01 killed by the 120s stuck-job watchdog

## Symptom
The Warehouse Activity Monitor (LL01) job failed with:
```
Watchdog: job exceeded 120s timeout — likely SAP session hang
```
even though the report legitimately takes ~5 minutes (5 plants × 7 categories,
sequential SAP COM extraction).

## Cause
`omni_agent/agent.py` runs a `stuck-job-watchdog` daemon thread that kills the
active job when `time.time() - state.active_job_started_at > _WATCHDOG_TIMEOUT_SEC`
(default 120s, `OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS`). It measures **absolute
time since claim**, with a flat 120s cap for every endpoint — sized for the
typical sub-60s handler. LL01 (and LX25's 5-warehouse fan-out) blow past 120s on
a healthy run, so the watchdog mis-fires and marks the job `failed`.

Why not just make the watchdog "progress-aware"? The `state.active_job_progress_at`
field exists, but the **heartbeat thread bumps it every 30s unconditionally**
(`_touch_active_job_progress()` is called from the lease-bump path), so it tracks
agent liveness, not SAP-work progress — using it would mean the watchdog never
fires on a true hang. That's exactly why the watchdog uses absolute start time.

Note: the server-side lease (`claim_lease_until`, bumped every 30s by the
heartbeat thread) stays fresh during a long run, so rust-work-service does NOT
reclaim it — the **agent-local watchdog was the sole killer**.

## Fix — per-endpoint watchdog budget
Long, known multi-minute SAP fan-outs get a generous per-endpoint budget; every
other endpoint keeps the fast 120s default so a genuine COM hang still recovers
quickly. (`agent.py`)
```python
_WATCHDOG_ENDPOINT_TIMEOUT_SEC: dict[str, float] = {
    "/sap/ll01/warehouse-activity": 900.0,   # ~5 min typical; matches FE 15-min dispatch ceiling
    "/sap/lx25/inventory-completion": 600.0, # 5-warehouse fan-out, bursty on slow SAP
}

def _watchdog_timeout_for(endpoint):
    if not endpoint:
        return _WATCHDOG_TIMEOUT_SEC
    return max(_WATCHDOG_ENDPOINT_TIMEOUT_SEC.get(endpoint, 0.0), _WATCHDOG_TIMEOUT_SEC)
```
- New `state.active_job_endpoint` is set on claim and cleared everywhere the
  active job is cleared (poller `finally`, `/admin/job/abort`, watchdog kill).
- The watchdog loop reads it and compares `elapsed > _watchdog_timeout_for(endpoint)`;
  the failure message + log now report the applied budget + endpoint.
- `max(per-endpoint, env default)` so an ops bump of
  `OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS` still lifts these endpoints too.

## Verification
- `python3 -m py_compile agent.py` clean.
- Verified live in the build VM (Python 3.14): `_watchdog_timeout_for` →
  LL01 900.0, LX25 600.0, `/sap/query` 120.0, None 120.0.
- Unit test `omni_agent/tests/test_watchdog_endpoint_budget.py` (4 cases incl.
  the env-bump max semantics). Skips on the Mac's Python 3.9 (agent.py uses
  3.10+ `X | Y` annotations; the agent runs on 3.14).
- Rebuilt `OmniFrame_Agent.exe` (worker hash `bd9bf8241a02b42db94aeefb9d7e9d8b1716632d4fc222801638a14f91e561db`; Master/Connect unchanged). **Redeploy + restart the agent on Citrix to take effect.**

## Lesson
A one-size watchdog timeout fights long-but-healthy batch handlers. Make the
budget per-operation (keyed off the job's endpoint) rather than bumping the
global — fast hang-recovery for normal jobs, generous headroom for the few
known multi-minute fan-outs. Don't repurpose a liveness signal (heartbeat-bumped
`progress_at`) as a work-progress signal.

## Related
- [[Implement-LL01-Run-History-Date-Picker]] (this watchdog fix unblocks LL01
  runs completing → history actually accrues).
- [[Components/Omni-Agent - Headless SAP Agent]] — `stuck-job-watchdog` capability.
- [[Implement-LX25-Inventory-Completion]] — same "lease budget caveat" class.
