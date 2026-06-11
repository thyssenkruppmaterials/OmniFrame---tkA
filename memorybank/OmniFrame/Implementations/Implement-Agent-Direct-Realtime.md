---
tags: [type/implementation, status/completed, domain/backend]
created: 2026-04-29
completed: 2026-04-29
---
# Implement: Agent-Direct Supabase Realtime (Phase D #16) — COMPLETED

## Purpose / Context
The Phase A1 job poller hit `claim_sap_agent_job` every 5 seconds. That added avg 2.5s of idle latency before a queued row started running and produced continuous traffic to Supabase's REST endpoint.

Switching to Supabase Realtime via the Python `realtime` library means the agent listens for `INSERT` events on `sap_agent_jobs` and kicks the poller immediately on each notification — sub-second latency, zero idle traffic.

## Implementation summary
**Dependency**: added `realtime>=2.0.0` to `omni_agent/requirements.txt`. We deliberately do NOT pull in the full `supabase` package — REST + JWT calls are still done via plain `requests`, so we only need the WebSocket layer. Soft import: missing this dep transparently degrades to polling-only mode with a `[realtime] realtime client not available; falling back to polling.` message.

**Agent (`omni_agent/agent.py`)**:
- New `_start_realtime_subscription()` — spawns a background thread that runs an asyncio loop, connects to `wss://<project>.supabase.co/realtime/v1`, authenticates with `state.supabase_token` (so RLS-protected INSERT payloads are delivered), and subscribes to:
  ```
  channel("sap-agent-jobs-<org_id>")
    .on_postgres_changes("INSERT",
        schema="public", table="sap_agent_jobs",
        filter=f"organization_id=eq.{state.org_id}",
        callback=_on_payload)
  ```
- Callback `_on_payload`:
  - Reads `assigned_agent_id` from the new row; if pinned to a different agent, ignores it (the RPC would skip it anyway).
  - Sets `_realtime_state["last_event_at"]`.
  - Calls `_kick_job_poller("realtime-insert")` — which sets `drain_event` so the poller wakes immediately.
- Auto-reconnect with exponential backoff (1s → 60s cap) — every WebSocket disconnect re-enters the connect loop on the same thread.
- Realtime is **complementary** to the polling fallback; the poller's `wait()` accepts whichever fires first (Realtime kick OR fallback timeout). On terminate or stop, both are released.
- Job poller fallback interval bumped from **5s → 60s** (`_job_poller_state["poll_interval_sec"] = 60.0`) — Realtime now drives sub-second wake-ups; the 60s sleep just covers missed-event / reconnect-gap edge cases.
- Realtime subscription is rearmed on `/supabase/login` so the user doesn't have to restart the agent after first login.
- Token-exempt `/agents` endpoint (Phase D #13) returns the realtime connection state (`connected`, `fallback_reason`, `last_event_at`, `reconnect_attempts`) so the dashboard fleet card can show whether each agent is in Realtime or polling mode.

## Edge cases handled
- **Realtime unavailable** (library not bundled, network down, JWT missing): `_realtime_state["fallback_reason"]` is set; polling-only mode kicks in transparently.
- **Two events in flight**: only one worker thread can hold the SAP session; `_kick_job_poller()` is idempotent (sets a `threading.Event`), the poller drains the queue tightly until empty before sleeping.
- **Pinned to a different agent**: the callback short-circuits without touching the RPC; saves traffic for fan-out scenarios.
- **WebSocket drop**: caught in the `_run_async()` loop, exponential backoff between reconnects (max 60s).
- **Filter coverage**: `sap_agent_jobs` was added to `supabase_realtime` publication in migration 245.

## Files
- `omni_agent/agent.py` (new `_start_realtime_subscription`, `_kick_job_poller`, drain_event wiring on poller)
- `omni_agent/requirements.txt` (`realtime>=2.0.0`)

## Capabilities (handoff to foreground for /health)
- `agent-direct-realtime`

## Related
- [[Implementations/Implement-Multi-Agent-Coordination]]
- [[Implementations/Implement-Scheduled-Recurring-Jobs]]
- [[Implementations/Job-Queue-Architecture]]
- [[Components/Omni-Agent - Headless SAP Agent]]
