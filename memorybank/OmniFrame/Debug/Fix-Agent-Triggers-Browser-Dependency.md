---
tags: [type/debug, status/active, domain/infra, domain/backend, domain/frontend, domain/auth, domain/database]
created: 2026-04-30
---
# Fix — Agent Triggers Don't Fire When Browser Tab Is Closed (v1.6.4)

## Symptoms
User reported that on agent v1.6.3, the SAP Testing → Agent Triggers automation only fired while the browser tab was open. Closing the tab silently disabled all auto-confirm-TO triggers; opening it later resumed firing. Console log at `/Users/jaisingh/Downloads/MacWindowsBridge/consolelog.txt` also showed three secondary problems on a healthy boot:

1. `GET /supabase/session` flipping between **404 Not Found** and **401 Unauthorized** across requests from the same client (no PID change → not two agents).
2. `POST /supabase/logout` returning **404 Not Found**.
3. `[realtime] disconnected (server rejected WebSocket connection: HTTP 401)` looping with exponential backoff (1s → 2s → 4s → 8s → 16s → 32s) that never recovered.
4. (Cosmetic) `[boot] WARN material_master_read import failed: cannot import name 'router' from partially initialized module 'material_master_read' (most likely due to a circular import)` at the top of every boot.

## Root Causes

### 1. `/supabase/session` and `/supabase/logout` were declared but never mounted

v1.6.3 added `supabase-session` and `agent-supabase-logout` to `AGENT_CAPABILITIES` and conceptually carved them out of the per-user-token middleware (the version-bump comment claimed both were shipping). But the actual `@app.get("/supabase/session")` and `@app.post("/supabase/logout")` route handlers were never written — only `/supabase/login` exists in the router table. So:

- Requests with **no** `X-Agent-Token` (or a matching token) → middleware allows → FastAPI returns **404** (no route).
- Requests with a **stale/different** `X-Agent-Token` (the browser had multiple in-flight clients holding old tokens after a re-login) → middleware returns **401** before routing.

This explained the alternating 404/401 in the log — neither was the "real" status; the route just didn't exist. The `AgentSupabaseStatusButton` poller had a fallback to `/status` for pre-1.6.2 agents, so the green pill still rendered, but `Disconnect` was completely broken (logout 404'd unconditionally).

### 2. Realtime WebSocket auth was using the JWT as the apikey

The Supabase Realtime protocol requires:
- `?apikey=<anon-key>` query param on the WebSocket URL (validated BEFORE the WS upgrade), AND
- `Authorization: Bearer <user-JWT>` header OR an `access_token` payload in `phx_join` (validated AFTER upgrade for RLS).

`realtime>=2.x` (the Python client) uses its `AsyncRealtimeClient(url, token=...)` constructor `token` arg as the `?apikey=` query param. v1.6.3 was passing `state.supabase_token or state.supabase_key` — i.e. the user JWT first, falling back to the anon key. Once `/supabase/login` ran, every reconnect sent the JWT as the apikey and Supabase rejected the upgrade with `HTTP 401` before `set_auth()` could attach the real auth token. The exponential-backoff loop in the console was the visible symptom.

### 3. Agent triggers lived entirely in the browser

`src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts` did the whole pipeline browser-side: subscribe to `rf_putaway_operations` Realtime → match the `to_status=Completed` template → call `agentFetch('/sap/confirm-to', ...)` → patch the source row to `TO Confirmed`. Close the tab and the entire pipeline stops. The agent had no own knowledge of what the browser had configured. (And even if the realtime auth hadn't been broken, the agent was only subscribed to `sap_agent_jobs` INSERT — not the source tables — so it wouldn't have driven triggers anyway.)

### 4. PyInstaller circular-import warning

`material_master_read.py` had `from agent import (_classify_sbar, _get_sap_session, …, state)` at module top. PyInstaller's `--onefile` bootloader preloads bundled modules before `agent.py` finishes top-level execution; during that window, `from material_master_read import router` raised `cannot import name 'router' from partially initialized module 'material_master_read'`. The retry inside agent.py's `try: from material_master_read import router` succeeded the second time (agent.py was fully loaded by then), so the warning was cosmetic — but it appeared on every boot.

## Fix (v1.6.4)

### A. Mount the missing routes (agent.py)
```python
@app.get("/supabase/session")
def supabase_session() -> dict:
    return {
        "ok": True,
        "logged_in": bool(state.supabase_token),
        "email": state.user_email or None,
        "user_id": state.user_id or None,
        "org_id": state.org_id or None,
    }

@app.post("/supabase/logout")
def supabase_logout() -> dict:
    state.supabase_token = ""
    state.user_id = state.user_email = state.org_id = state.agent_token = ""
    _stop_realtime_subscription()
    return {"ok": True}
```
Both paths added to `_TOKEN_EXEMPT_PATHS`. Boot now prints `[boot]   Auth-exempt paths: <comma-list>` so the next time this is in question we can eyeball it without cracking the bundle.

### B. Fix Realtime auth (agent.py)
```python
# constructor `token` is the `?apikey=` query param — MUST be the anon key
client = AsyncRealtimeClient(rt_url, token=state.supabase_key)
await client.connect()
if state.supabase_token:
    await client.set_auth(state.supabase_token)  # JWT for RLS
```
Boot now prints `[realtime] connected to wss://... (subscribed to public.sap_agent_jobs + public.rf_putaway_operations for org <id>)`. The exponential-backoff loop never triggers on a healthy startup.

### C. Agent-side trigger evaluator (agent.py)
The agent now subscribes to a SECOND Realtime channel — INSERT and UPDATE events on `rf_putaway_operations` — and runs a hardcoded trigger list server-side. On match, it INSERTs into `sap_agent_jobs` (org-scoped, `priority=50`, `idempotency_key=trig:<trigger-id>:<row-id>`) so the existing job poller picks the work up. The post-success DB patch (the "flip to TO Confirmed" step) is embedded in the job's `payload.__omni_trigger_meta.post_success_patch` and applied by the poller after a successful SAP dispatch.

Key pieces:
- `_HARDCODED_TRIGGERS` — currently one rule mirroring `TRIGGER_TEMPLATES[0+1]` in `agent-triggers-tab.tsx` (Auto-Confirm Completed Putaways INSERT + UPDATE, collapsed).
- `_hardcoded_trigger_match` — `to_status=='Completed'` AND `!is_mca_workflow` AND `confirmed_source NOT IN ('manual', 'agent_trigger', 'agent_one_click_ship', 'agent_trigger_direct')`.
- `_enqueue_trigger_job` — POST to `/rest/v1/sap_agent_jobs` with idempotency key.
- `_apply_trigger_post_patch` — PATCH `rf_putaway_operations?id=eq.<row>&to_status=neq.TO Confirmed` to flip status atomically.
- Job poller's success branch: read `payload.__omni_trigger_meta.post_success_patch` BEFORE marking complete; apply the patch; then `jobs_complete(...)`.
- `_dispatch_job` strips `__omni_trigger_meta` from the payload before constructing the `ConfirmTORequest` Pydantic model.

New capability `agent-side-triggers`. Frontend gates `useAgentTriggerRuntime` on this — when present, the browser-side runtime becomes a dormant status reflector (subStatus → `'agent-side'`, the violet pill). `enqueueFire` short-circuits with a "Agent-side triggers active" log. Manual `testFire` still works for smoke-testing.

Boot prints `[triggers] loaded 1 hardcoded trigger(s) (builtin-rf-putaway-completed); no sap_agent_triggers table — see Debug/Fix-Agent-Triggers-Browser-Dependency.md.`

### D. Lazy bridge in `material_master_read.py`
Replaced the top-level `from agent import …` with a `_resolve_agent_globals()` call from the top of each handler entry point (`read_bin`, `read_storage_types`). The decorator `@_track_metric("name")` got a thin lazy-resolving wrapper that defers to `agent._track_metric` on first invocation. By the time any handler runs, agent.py is fully loaded and uvicorn is serving traffic — so the PyInstaller circular-import window is closed.

### E. Frontend (use-agent-trigger-runtime.ts + agent-triggers-tab.tsx + agent-fetch.ts)
- New `SubscriptionStatus` value `'agent-side'` (violet pill, ShieldCheck icon) so the trigger card visually distinguishes browser-driven from agent-driven listening.
- `UseAgentTriggerRuntimeOptions.agentSideTriggersActive: boolean` — when true, the subscription `useEffect` doesn't open Supabase channels; the enqueue gate short-circuits.
- `agent-triggers-tab.tsx` extends its local `AgentHealth` to include `capabilities?: string[]` and computes `agentSideTriggersActive = agentStatus === 'connected' && agentHealth?.capabilities?.includes('agent-side-triggers')`. A new violet info banner explains that the agent is handling triggers headless when active.
- `agent-fetch.ts` `LATEST_AGENT_VERSION` bumped to `'1.6.4'` (download banners + recorder gating). `MIN_REQUIRED_AGENT_VERSION` left at `'1.4.0'`.

## Backward compatibility
- Older agents (no `agent-side-triggers` capability) → frontend keeps the existing browser-side runtime (closes-on-tab-close behavior, but no double-fire risk).
- Newer agents (capability present) → browser becomes a status reflector; agent owns the pipeline; triggers fire even when no tab is open.
- The fallback hardcoded trigger only handles `rf_putaway_operations` → `/sap/confirm-to`. The third template in `agent-triggers-tab.tsx` (`shipment_queue` → `/sap/process-shipment`) is NOT in the agent-side fallback yet; if a user enables that template AND has agent-side-triggers active, the shipment trigger silently won't fire (browser was suppressed but agent has no rule for it). Future work: externalize triggers via a `sap_agent_triggers` Postgres table so users don't have to wait for an agent rebuild to add new triggers.

## Verification on a healthy v1.6.4 boot
```
[boot]   truststore injected — using Windows certificate store for TLS verification
[boot]   Mounted reversal_engine router (1 endpoint: /sap/reversal/compute-inverse)
[boot]   Mounted lt22_import router (1 endpoint: /sap/import-lt22)
[boot]   Mounted material_master_read router (2 endpoints)
  OmniFrame SAP Agent v1.6.4
[start]  Listening on http://127.0.0.1:8765
[boot]   Auth-exempt paths: /agents, /health, /metrics, /sap/connect, /sap/sessions, /sap/shipment-progress, /shutdown, /status, /supabase/login, /supabase/logout, /supabase/session
[triggers] loaded 1 hardcoded trigger(s) (builtin-rf-putaway-completed); no sap_agent_triggers table — see Debug/Fix-Agent-Triggers-Browser-Dependency.md.
[jobs]   Background poller started (fallback interval 60s; Realtime-driven wake-ups when connected).
[heartbeat] Agent registry heartbeat started (30s).
[heartbeat] Registered as <HOST>-console-<PID> in sap_agents.
[realtime] connected to wss://wncpqxwmbxjgxvrpcake.supabase.co/realtime/v1 (subscribed to public.sap_agent_jobs + public.rf_putaway_operations for org <id>)
INFO: 127.0.0.1:xxxxx - "GET /supabase/session HTTP/1.1" 200 OK
```
No more `material_master_read` WARN. No more 404/401 oscillation on /supabase/session. No more exponential-backoff Realtime loop.

## Files Modified
- `omni_agent/agent.py` — version bump, new routes, exempt paths, realtime auth fix, agent-side trigger evaluator, post-success patch in poller, boot prints (~+260 LOC).
- `omni_agent/material_master_read.py` — lazy bridge into agent module (~+45 LOC, -10 LOC).
- `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts` — `agentSideTriggersActive` option, new `'agent-side'` SubscriptionStatus, gated useEffect + enqueueFire (~+45 LOC).
- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` — capabilities-aware health interface, capability detection, banner, violet pill in `deriveLiveStatus` (~+30 LOC).
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION = '1.6.4'`.

## Related
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Components/Agent-Triggers - Realtime Automation]]
- [[Implementations/Implement-Agent-Supabase-Login-UI]]
- [[Debug/Fix-Agent-Corporate-SSL-Inspection]]
- [[Debug/Fix-LT22-SAP-Crash-Pagedown]]
- [[Sessions/2026-04-30]]
