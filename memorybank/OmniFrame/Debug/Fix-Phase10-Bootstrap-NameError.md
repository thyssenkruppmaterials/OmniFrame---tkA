---
tags: [type/debug, status/active, domain/agent, domain/auth]
created: 2026-05-07
---
# Fix Phase 10 Bootstrap NameError (v2.0.0 regression)

## Symptom

The v2.0.0 SAP agent boot banner on `USINDPR-CXA103V` (2026-05-07 11:02 UTC) printed:

```
[boot]   Agent identity v2 bootstrap raised: NameError("name '_bootstrap_agent_identity_v2' is not defined") (continuing)
```

Every agent in the fleet logged the same line. The exception was caught by the
`_ensure_agent_identity_v2_bootstrap()` defensive `try/except`, so the agent
kept running — but it never loaded the on-disk service key, never started the
Work Service JWT refresh thread (line 6874 short-circuits when
`state.agent_service_key` is unset), and silently downgraded to the legacy
user-JWT path.

## Root cause

[`omni_agent/agent.py`](../../../omni_agent/agent.py) at the v2.0.0 ship had
this sequence at module load:

```python
# line 857  def _ensure_agent_identity_v2_bootstrap(): ...
# line 867      _bootstrap_agent_identity_v2()    # <-- referenced here
# line 872  _ensure_agent_identity_v2_bootstrap() # <-- INVOKED
# ...
# line 1151 def _bootstrap_agent_identity_v2():   # <-- DEFINED here
```

The wrapper was invoked ~280 lines BEFORE its inner helper was defined. At
invocation time `_bootstrap_agent_identity_v2` is not yet bound in module
globals → `NameError`. The docstring on the wrapper claimed "the function is
invoked at the bottom of this module — by which time every helper it
transitively references is defined," but the actual invocation was at the top.

Because the `try/except` was in place the agent did not crash; it just lost
the Phase 10 service-key boot path silently.

## Fix

Moved the `_ensure_agent_identity_v2_bootstrap()` invocation from line 872 to
line 1218 — directly after `_bootstrap_agent_identity_v2()` is defined and
immediately following the Phase 10 helper block (`_load_agent_service_key` /
`_exchange_service_key_for_jwt` / `_refresh_work_service_jwt_if_needed` /
`_start_work_service_jwt_refresh_thread`).

The wrapper definition stays where it was for narrative continuity; only the
call site moved. Banner output order is unchanged in the success case.

Kept `AGENT_VERSION` at `2.0.0`; the inline comment notes
`(post-release fix 2026-05-07)` so subsequent log inspectors can correlate.

## Why TO confirmation was a separate bug

The Phase 10 bootstrap failure is a soft regression — the agent runs cleanly
on user-JWT fallback, claim/heartbeat/complete all succeed (verified via
`work_http_requests_total{route="/api/v1/sap-agents/jobs/claim",status="200"}`
on `https://rust-work-service-production.up.railway.app/metrics`). The actual
blocker for putaway TOs not being confirmed is the rust-work-service trigger
evaluator channel-name mismatch — see
[[Fix-Trigger-Evaluator-Channel-Singular-Plural]].

## Verification

- `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` → OK
- `ReadLints` on `agent.py` → no errors
- Mirrored to `~/Downloads/MacWindowsBridge/Omni-Agent/agent.py`
  (the canonical PyInstaller build source); next `build_exe.bat` rebuild
  picks up the fix.
- Look for in next `console.txt`: the `Agent identity v2 bootstrap raised:`
  line should be GONE. Replaced by either
  `Agent identity v2: ENABLED. Service key loaded from ...` (if a key is
  registered) or `Agent identity v2: NOT CONFIGURED. ... Falling back to the
  legacy user-JWT path.` (default — service-key registration is OPTIONAL
  during the v2.0.0 → v2.1.0 transition window).

## Related

- [[Implement-Rust-Work-Service-Phase10]]
- [[ADR-Agent-Identity-V2-Phase10]]
- [[Fix-Trigger-Evaluator-Channel-Singular-Plural]]
- [[Omni-Agent - Headless SAP Agent]]
- [[2026-05-07]]
