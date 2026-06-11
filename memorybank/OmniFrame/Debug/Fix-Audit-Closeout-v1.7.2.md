---
tags: [type/debug, status/active, domain/backend, domain/frontend, domain/api]
created: 2026-05-01
---
# Fix — Audit Closeout v1.7.2

## Purpose / Context

Two readonly audit review passes reviewed the OmniFrame SAP Agent codebase
(v1.7.1 currently shipping) and surfaced 13 findings — 8 on the agent
runtime side (A1-A8) and 5 on the frontend side (F1-F5). v1.7.2 is the
audit-closeout release: every finding was validated against the actual
code, every confirmed bug got a surgical fix, and the few that turned
out to be partial / refuted are documented here so future audits don't
re-discover them.

Scope was deliberately narrow — NO existing handler logic touched, NO
trigger semantics changed beyond ADDING the missing `shipment_queue`
agent-side trigger, NO Supabase Storage touched, NO SAP COM behavior
changed.

## Validation Matrix

| ID | Severity | Finding | Verdict | Fix |
|---|---|---|---|---|
| A1 | HIGH | JWT expiry breaks lifecycle silently | **VALIDATED** | Persist refresh_token + token_expires_at; pre-emptive refresh on every `_supabase_request` |
| A2 | HIGH | `idempotency_key = trig:<id>:<row>` permanently 409s after a failure | **VALIDATED** | Append `:<unix-day>` so backfill can retry tomorrow |
| A3 | HIGH | `jobs_complete` / `jobs_fail` not terminal-state-safe — watchdog → completed inversion | **VALIDATED** | New `_patch_job_terminal` adds `&status=eq.running&claimed_by=eq.<self>` filters |
| A4 | MED-HIGH | `agent-side-triggers` capability silences ALL browser supabase-realtime triggers but agent only handles `rf_putaway_operations` → `shipment_queue` silently dropped | **VALIDATED** | Add `builtin-shipment-queue` to `_HARDCODED_TRIGGERS` + new realtime channel + granular capability id |
| A5 | MED | Realtime crash-loop containment unproven by user's console.txt | **REFUTED** | Handler IS correct; user's console was from v1.7.0. See discussion below. |
| A6 | MED | PyInstaller worker imports may load second `agent` module instance | **VALIDATED** | `sys.modules["agent"] = sys.modules[__name__]` at module-load |
| A7 | LOW-MED | `/jobs/claim` token-exempt + not active-job guarded | **VALIDATED** | Refuse claim when `state.active_job_id` is set |
| A8 | LOW-MED | LT22 Supabase calls bypass `_supabase_request` retry helper | **VALIDATED** | New `_lt22_request` mirrors agent's helper (30s timeout + single retry) |
| F1 | HIGH | Stale-token reconnect UX incomplete — pill says "Signed in" while JWT expired | **VALIDATED** | Status button reads `useAgentDetection().authenticated`; "Reconnect Account" copy when reachable but unauthenticated |
| F2 | HIGH | LT22 pinned-agent override defeats fleet auto-pin; picker lists ALL agents | **VALIDATED** | Picker filtered to `import-lt22` capability holders; stale localStorage pin auto-dropped with warning toast |
| F3 | MED | Inventory Management treats reachable agent as authenticated | **VALIDATED** | `agentStatus` derivation now gates on `authenticated`; new `'unauthenticated'` state with "session expired" yellow card |
| F4 | MED | Banner copy references `MIN_REQUIRED_AGENT_VERSION='1.4.0'` instead of latest | **VALIDATED** | Replaced user-facing strings with `LATEST_AGENT_VERSION='1.7.2'` |
| F5 | LOW | `testFire` doesn't actually bypass agent-side suppression | **VALIDATED** | `enqueueFire` accepts `forceFire` param; `testFire` passes true |

12 of 13 confirmed bugs. 1 refuted (A5 — handler correct).

## Per-Finding Detail

### A1 — JWT refresh

**Symptoms (production).** User's console showed `JWT expired` after ~1h.
Heartbeat (sap_agents.last_seen_at) silently stopped updating. Job
queue claim → 401. Trigger enqueue → 401. Agent process up but agent
was a dead weight until manual re-login via the Connect Account
dialog.

**Root cause.** `/supabase/login` only persisted `access_token`. No
`refresh_token`. No expiry. `/supabase/session` checked
`bool(state.supabase_token)` — pure existence — so the pill stayed
green even after the token died.

**Fix.**
- `AgentState`: added `refresh_token`, `token_expires_at`, `token_refresh_lock`.
- `load_config` / `persist_config`: round-trip both new fields.
- `/supabase/login`: capture `refresh_token` + `expires_in` from GoTrue
  response; compute absolute expiry.
- New `_refresh_supabase_token_if_needed()`: locks, throttles
  (30s cooldown on failed refreshes), POSTs to
  `/auth/v1/token?grant_type=refresh_token`, rewrites cached token +
  expiry, persists. On `400/401/403` from GoTrue (refresh token dead)
  clears the session entirely so the user re-prompts.
- `_supabase_request`: calls the helper at the top so the about-to-fly
  request always has a fresh JWT.
- `/supabase/session`: opportunistic refresh + `logged_in: false,
  reason: 'expired'` past expiry.
- `/supabase/logout`: clears all three fields.

**Capability id:** `jwt-refresh`.

### A2 — Idempotency day suffix

**Root cause.** `_enqueue_trigger_job` set
`idempotency_key = trig:<trigger>:<row>`. Combined with the
`(organization_id, idempotency_key)` UNIQUE constraint on
`sap_agent_jobs`, a row whose first job hit `failed` would 409 forever
on subsequent enqueues — backfill saw the row, retried, got 409,
poisoned the row.

**Fix.** Idempotency key now includes the current UTC unix-day
(`int(time.time() // 86400)`) so the SAME row can be retried tomorrow
without losing the within-day double-fire dedup the constraint exists
to enforce.

**Capability id:** `idempotency-day-suffix`.

### A3 — Terminal-state guards

**Root cause.** `_patch_job` PATCHed `?id=eq.<job_id>` only — no status
or claimed_by filter. The state machine inversion playback:

1. T+0: poller claims job, sets `running`.
2. T+0..120: SAP COM hangs inside the handler.
3. T+120: watchdog fires, PATCHes status `running → failed`, clears
   `state.active_job_id`.
4. T+? (much later): SAP eventually returns `{ok: true}`.
5. Poller's `jobs_complete` PATCHes `failed → completed` (no guard
   blocked it).

The DB row is now `completed` even though nobody believes the work
succeeded.

**Fix.** New `_patch_job_terminal(job_id, body, expected_claimed_by)`
adds two REST-level filters — `&status=eq.running` and
`&claimed_by=eq.<self>` — and uses `Prefer: return=representation` to
report `rows_affected`. When 0 rows match the caller logs WARN +
returns `skipped_reason`. Watchdog's own `jobs_fail` calls bypass the
guard via `step='watchdog'` so it can always transition stuck
`running` rows to `failed`.

**Capability id:** `terminal-state-guards`.

### A4 — `shipment_queue` agent-side trigger

**Root cause.** `_HARDCODED_TRIGGERS` only had the rf_putaway entry.
The browser's `useAgentTriggerRuntime` checks
`agentSideRef.current && trigger.source.type === 'supabase-realtime'`
— that condition is true for the `shipment_queue` trigger too (its
source type is `supabase-realtime`). So when v1.7.1 advertised
`agent-side-triggers`, the browser stopped firing the shipment trigger
AND the agent never picked it up. Silent drop — never logged anywhere.

**Fix.** Three coordinated additions:

1. `_HARDCODED_TRIGGERS`: added `builtin-shipment-queue` entry
   mirroring the frontend `TRIGGER_TEMPLATES[2]` (delivery, item,
   to_number, warehouse, tracking).
2. `_hardcoded_trigger_match` / `_hardcoded_trigger_payload` /
   `_hardcoded_trigger_post_patch`: extended to handle the new id.
   Post-patch returns `{}` for shipment_queue (no equivalent of
   rf_putaway's to_status flip).
3. New `_on_hardcoded_table_change(table, event_type, payload)`
   generalized dispatcher that filters `_HARDCODED_TRIGGERS` by table.
   `_on_rf_putaway_change` is now a thin wrapper around it. New
   `_on_shipment_queue_insert` callback subscribes the new third
   Realtime channel `shipment-queue-<org_id>`.
4. New capability id `agent-side-triggers:builtin-shipment-queue`
   (granular companion to the broad `agent-side-triggers` so future
   frontends can suppress per-id).

The broad `agent-side-triggers` capability is unchanged so existing
frontends continue to suppress correctly.

**Capability id:** `agent-side-triggers:builtin-shipment-queue` (also
mirror id `agent-side-triggers:builtin-rf-putaway-completed`).

### A5 — Realtime crash-loop containment validation (REFUTED)

**Audit claim.** User's console showed `Task exception was never
retrieved` repeatedly with no `CIRCUIT BREAKER TRIPPED` line.

**Validation.** Read `_realtime_loop_exception_handler` (agent.py
~line 3279). Confirms it:
- Catches `ValueError` containing `"Set of Tasks/Futures is empty"`.
- Catches `websockets.exceptions.ConnectionClosedError` AND
  `ConnectionClosedOK`.
- On suppression, increments
  `_realtime_circuit_breaker.record_error()` which trips after 20
  errors / 60s window.
- On trip, calls `_disable_realtime_subsystem(reason)` which prints
  the `CIRCUIT BREAKER TRIPPED` line.

`loop.set_exception_handler` is installed via
`loop.set_exception_handler(_realtime_loop_exception_handler)` BEFORE
the AsyncRealtimeClient is constructed. asyncio routes ALL unhandled
task exceptions through `loop.call_exception_handler`, including the
`Task.__del__` "exception was never retrieved" path, so suppression
works.

**Conclusion.** The handler IS correct as-is. The user's console must
have been from v1.7.0 (before the handler existed). No fix needed.

The audit also suggested adding `done_callback` on every spawned task.
Reviewed the code: there are NO manually-spawned `asyncio.create_task`
calls in the visible path. The realtime library spawns its own
internal tasks; their unhandled exceptions go through our handler.
Adding done_callbacks would only matter if WE spawned tasks, which we
don't.

**No code change.** Documented in this note for future audits.

### A6 — `sys.modules["agent"]` alias

**Root cause.** PyInstaller's --onefile bootloader preloads bundled
modules. When `lt22_import.py` does `from agent import (state, ...)`
and `material_master_read.py` does `import agent`, the bootloader
resolves "agent" by name. But agent.py is run as `__main__` (not
"agent"), so the resolution loads a SECOND copy with its own
`state = AgentState()` instance. Worker-side mutations like
`state.sap_connected = False` after a COM crash in `lt22_import` would
mutate the duplicate state — the `state` the FastAPI handlers + poller
read from would never see the change.

`material_master_read.py` already had a workaround
(`_resolve_agent_globals` lazily binds symbols at first request) so
the issue was less acute there. `lt22_import.py` had no workaround.

**Fix.** Single line at module-load (after imports):

```python
if __name__ == "__main__" and "agent" not in sys.modules:
    sys.modules["agent"] = sys.modules[__name__]
```

Now any subsequent `import agent` returns the same module object as
`__main__`, so `agent.state` is THE state.

**Capability id:** `agent-module-alias`.

### A7 — `/jobs/claim` single-flight guard

**Root cause.** `/jobs/claim` is in `_TOKEN_EXEMPT_PATHS` via the
`/jobs/*` middleware prefix (line 882). Any local browser tab can call
it. The DB `claim_sap_agent_job` RPC prevents two AGENTS from claiming
the same row, but a single agent can own multiple rows if `/jobs/claim`
is invoked while the in-process poller is already mid-dispatch.

**Fix.** At the top of `jobs_claim()`:

```python
with state.active_job_lock:
    active_id = state.active_job_id
if active_id:
    return {"ok": False, "error": "agent already has an active job",
            "active_job_id": active_id}
```

Safe with the in-process poller because the poller only calls
`jobs_claim()` when `active_job_id is None` (the cycle: claim → set
→ dispatch → clear in finally → claim).

**Capability id:** `jobs-claim-active-guard`.

### A8 — LT22 retry helper

**Root cause.** `lt22_import.py` used `_requests.post/patch` directly
with timeouts but no retry. Single corp-proxy / Citrix latency blip
during a 5000-row INSERT could fail the entire import.

**Fix.** New local `_lt22_request(method, url, **kwargs)` mirrors
agent.py's `_supabase_request` (30s timeout + single retry on
Timeout/ConnectionError after 2s sleep). Replaces the two direct call
sites: chunk-INSERT to `sap_outbound_to_imports` and `_patch_run` for
`sap_outbound_to_import_runs`.

Deliberately NOT importing `_supabase_request` from agent.py even
though A6's sys.modules alias would make it safe — keeping
`lt22_import.py` self-contained means it stays importable from tests
and REPL without dragging in the FastAPI app + COM init.

### F1 — Status button reads `authenticated`

**Root cause.** `AgentSupabaseStatusButton` polled `/supabase/session`
independently of `useAgentDetection`. The /supabase/session endpoint
in v1.7.1 reported `logged_in: bool(state.supabase_token)` — pure
existence — so the pill stayed green for an hour after JWT expiry.
Conflicted with the trigger banner's stale-token CTA.

**Fix.** The button now consumes `useAgentDetection().authenticated`.
When `available && !authenticated` (or session has
`reason: 'expired'`) it forces "Reconnect Account" copy with a yellow
accent. The agent-side `/supabase/session` was also fixed in A1 to
return `reason: 'expired'`, so v1.7.2-on-v1.7.2 surfaces the right
state from both sides. v1.7.2 frontend on v1.7.1 agent: the
detection-based path still flips the pill via the
`omniframe:agent-token-stale` event, even though /supabase/session
keeps lying.

### F2 — LT22 picker filter

**Root cause.** `import-lt22-dialog.tsx`:
- Picker (line 666) listed ALL `onlineAgents` — no capability filter.
- Auto-pin logic (line 369): `pinnedAgentId || (route === 'fleet' &&
  fleetAgent ? fleetAgent.id : null)`. Stale localStorage pin always
  won.

So a user who pinned to a v1.0.0 dev agent would keep claiming
`/sap/import-lt22` against an agent that doesn't expose the endpoint
forever, with no obvious recourse.

**Fix.** Two coordinated changes:

1. New `lt22CapableAgents = onlineAgents.filter(a =>
   a.capabilities?.includes('import-lt22'))`. Picker uses this.
   Picker only renders when `lt22CapableAgents.length > 1` (a single
   capable agent is just "use that one").
2. New `useEffect` watches `pinnedAgentId` + `lt22CapableAgents`.
   When the pin doesn't match any currently-online capable agent,
   resets `pinnedAgentId = ''` and toasts ONCE per dialog session
   ("Saved pinned agent X doesn't have import-lt22 — using Y
   instead." or "falling back to fleet auto-routing").

### F3 — Inventory tab gates on `authenticated`

**Root cause.** Inventory Management's status derivation:
```ts
agentStatus: AgentStatus = agentDetection.available ? 'connected' : ...
```
Didn't check `agentDetection.authenticated`. Stale-token users saw
green AgentHealthCard + every action button enabled, then any click
failed at the network layer.

**Fix.** Added `'unauthenticated'` to the `AgentStatus` union (already
existed in agent-triggers-tab.tsx for v1.6.5, so this is consistent).
`agentStatus` derivation:
```ts
agentDetection.available
  ? agentDetection.authenticated
    ? 'connected'
    : 'unauthenticated'
  : hasResolvedAgent ? 'missing' : 'checking'
```
Added an `'unauthenticated'` branch to the `AgentStatusBar` rendering
("Agent online — session expired" yellow card with a "Re-check"
button). All `agentStatus === 'connected'` action-button gates now
correctly disable until the JWT is refreshed.

### F4 — `LATEST_AGENT_VERSION` in user copy

**Root cause.** Banner copy (inventory-management-tab.tsx + recorder-
panel.tsx) referenced `MIN_REQUIRED_AGENT_VERSION = '1.4.0'`. So
users running v1.7.0 saw "Update your agent — v1.4.0 available" which
read as a downgrade.

**Fix.** Bumped `LATEST_AGENT_VERSION` to `'1.7.2'`. Replaced 3
user-facing strings in inventory-management-tab.tsx + 1 in recorder-
panel.tsx. `isAgentOutdated()` and the compat `compareAgentVersions`
still use `MIN_REQUIRED_AGENT_VERSION` (the floor — what we tolerate)
unchanged.

### F5 — `testFire` bypasses agent-side suppression

**Root cause.** `useAgentTriggerRuntime.enqueueFire` short-circuits
when `agentSideRef.current && trigger.source.type === 'supabase-realtime'`.
`testFire` called `enqueueFire(trigger, row)` — no escape hatch. The
comment claimed "Manual `testFire` from the UI explicitly bypasses
this gate" but the code didn't.

**Fix.** `enqueueFire` now accepts an optional third param
`forceFire: boolean = false`. Suppression check is gated on
`!forceFire`. `testFire` passes `true`. All other call sites
(Realtime callbacks) keep the default `false`.

## Files Modified

### Agent (Python)

- `omni_agent/agent.py`
  - +sys.modules alias (~12 LOC)
  - +AgentState refresh_token / token_expires_at / token_refresh_lock + load/persist (~25 LOC)
  - +_refresh_supabase_token_if_needed (~115 LOC)
  - +_supabase_request integration (~10 LOC)
  - +/supabase/login refresh capture (~10 LOC)
  - +/supabase/session expiry check (~25 LOC)
  - +/supabase/logout clear refresh (~5 LOC)
  - +_patch_job_terminal + jobs_complete/fail rewires (~80 LOC)
  - +_HARDCODED_TRIGGERS shipment_queue entry + match/payload/post_patch branches (~70 LOC)
  - +realtime channel 3 (shipment_queue) + _on_shipment_queue_insert callback (~25 LOC)
  - +_on_hardcoded_table_change generalization + _on_rf_putaway_change wrapper (~30 LOC)
  - +jobs_claim active-job guard (~15 LOC)
  - +AGENT_VERSION bump + 7 new capabilities (~50 LOC of comments)
  - Idempotency key day suffix (~5 LOC + comment)
  - Total agent.py delta: ~+475 LOC (mostly comments)

- `omni_agent/lt22_import.py`
  - +_lt22_request helper (~30 LOC)
  - 2 call site replacements (-12 LOC, +6 LOC)
  - Total delta: ~+24 LOC

- `omni_agent/material_master_read.py`: unchanged (already lazy-binds via _resolve_agent_globals).

### Frontend (TypeScript)

- `src/features/admin/sap-testing/lib/agent-fetch.ts`
  - LATEST_AGENT_VERSION '1.7.1' → '1.7.2' (1 LOC)

- `src/features/admin/sap-testing/components/agent-supabase-status-button.tsx`
  - Three-state pill (Signed in / Reconnect / Connect) (~40 LOC)

- `src/features/admin/sap-testing/components/agent-supabase-login-dialog.tsx`
  - AgentSupabaseSession.reason / expires_at fields (~10 LOC)

- `src/features/outbound/components/import-lt22-dialog.tsx`
  - lt22CapableAgents memo + auto-drop pin effect + filtered picker (~60 LOC)

- `src/features/admin/sap-testing/components/inventory-management-tab.tsx`
  - AgentStatus union + 'unauthenticated' branch + status bar card (~50 LOC)
  - 3 string replacements MIN_REQUIRED → LATEST (3 LOC)

- `src/features/admin/sap-testing/components/recorder-panel.tsx`
  - 1 string replacement (1 LOC)

- `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts`
  - enqueueFire forceFire param + testFire passes true (~10 LOC)

## Build Status

- `python3 -c "import ast; ast.parse(...)"` on all three Python files: ✅
- `npm run build`: ✅ (10.47s, no errors, no new warnings beyond the
  pre-existing chunk-size warnings)
- ReadLints on all 7 modified TS files: ✅ no new lints

## Capabilities Added (7)

- `jwt-refresh`
- `terminal-state-guards`
- `idempotency-day-suffix`
- `agent-module-alias`
- `jobs-claim-active-guard`
- `agent-side-triggers:builtin-rf-putaway-completed`
- `agent-side-triggers:builtin-shipment-queue`

## Rebuild Command

```bash
cd /Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent
build_exe.bat   # or: python -m PyInstaller --onefile --windowed --name OmniFrame_Agent agent.py
```

Then upload the resulting `dist/OmniFrame_Agent.exe` to Supabase
Storage (parent operator handles this — DO NOT auto-upload).

## What The User Needs To Do

1. **Rebuild the EXE** on Windows from the new `agent.py`
   (`build_exe.bat`).
2. **Upload to Supabase Storage** to replace the current EXE.
3. **Commit + push the frontend** (this branch).
4. Optional smoke test:
   - Launch the new agent EXE.
   - Connect via the Connect Account dialog.
   - Wait > 1h with the agent idle. Verify heartbeat keeps updating
     `sap_agents.last_seen_at` AND `[auth]  Refreshed Supabase JWT`
     appears in the agent console.
   - Test the `shipment_queue` trigger end-to-end (INSERT a row from
     the SAP Testing tab → verify `[triggers] Queued Shipment
     Processor (agent-side) → queued ...` line).

## Related

- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Debug/Fix-Realtime-Library-CrashLoop]] (v1.7.1)
- [[Debug/Fix-Agent-Throughput-Latency]] (v1.7.0)
- [[Debug/Fix-Agent-Triggers-Browser-Dependency]] (v1.6.4)
- [[Patterns/Async-Library-Circuit-Breaker]]
- [[Patterns/Job-Queue-Drain-Mode]]
- [[Sessions/2026-05-01]]
