---
tags: [type/debug, status/active, domain/infra, domain/backend, domain/frontend, domain/auth, domain/database]
created: 2026-04-30
---
# Fix — Agent Fleet Bloat & Token Rotation (v1.6.5)

## Symptoms (production, Citrix Tier-4 environment)

User reported the OmniFrame agent had gotten "much clunkier" since v1.6.2 introduced the per-session `agent_token`. Three concrete symptoms over the course of a workday with 4–5 EXE rebuilds:

1. **Agents Fleet shows 6 entries but only 1 is online.** Each rebuild registered a NEW row in `sap_agents` with id like `USINDPR-CXA105V-console-<PID>`. The reaper marked old rows offline after 90s but never deleted them, so the card bloated with dead PIDs.

2. **Top banner says "SAP Agent Not Detected" even though the local agent is online.** Console showed `Bin Stock by Material failed – invalid or stale Token from the web app`. Detection only checked `/health` (token-exempt) so the banner stayed green even when every authenticated call 401'd.

3. **Page refresh kills the agent connection.** Pre-v1.6.2 (no agent_token) refreshing the OmniFrame tab "just worked". Post-v1.6.2: refresh → stale token in localStorage → 401 on every authenticated call → user re-logs through the dialog. After every rebuild AND every fresh-day browser refresh.

## Root Causes

### A. Agent ID carried the PID (`<host>-<sess>-<PID>`)

```python
_AGENT_SELF_ID = f"{host}-{sess}-{os.getpid()}"
```

Every EXE restart got a new PID from Windows → new `_AGENT_SELF_ID` → new row inserted via the `merge-duplicates` upsert on `sap_agents`. The reaper (`reap_stale_sap_agents(p_grace_seconds=90)`) flipped the dead rows to `offline` but never removed them. After 4 rebuilds in a workday, the fleet card showed 5 grey rows + 1 green row — visually noisy, not actionable.

### B. `agent_token` was minted (rotated) on every `/supabase/login`

```python
state.agent_token = secrets.token_hex(32)  # called inside supabase_login()
```

This was the v1.4.0 design: per-Supabase-session token, scoped to that browser tab's logged-in account. In practice it broke three flows:

1. **Re-login after token expiry** rotated the token, invalidating the X-Agent-Token in localStorage of the tab that just logged in (it stores it again from the response, but other tabs/windows are silently broken).
2. **EXE rebuild** lost the in-memory token entirely (the persisted config only held url + anon key). Every browser tab's localStorage value was now stale relative to the freshly-booted agent's empty `agent_token`.
3. **`/supabase/logout`** wiped `agent_token` to empty. Any background tab still holding the value 401'd until it caught a fresh login.

Underlying root cause: `AgentState.persist_config()` only persisted `supabase_url` + `supabase_anon_key`. The vault note for [[Implementations/Implement-Agent-Supabase-Login-UI]] claimed it persisted the full session blob — that was aspirational; the actual code never landed.

### C. `useAgentDetection` only checked /health

`/health` is in `_TOKEN_EXEMPT_PATHS`. So when the agent was running but the browser's X-Agent-Token was stale, /health 200'd → `available = true` → banner stayed green → user got `"Invalid or stale X-Agent-Token. Re-login from the web app."` 401s on every Inventory Management query and every Agent Triggers fire, with no top-level UX feedback explaining why.

### D. The reaper was never invoked on a schedule

`reap_stale_sap_agents()` was only called from:
  - `GET /agents` (so opening the fleet card cleaned the table)
  - The agent's own 30s heartbeat tick (so a healthy agent cleaned up rivals)

If no agent was running AND no one was watching the fleet card, dead rows persisted indefinitely with `status='online'`.

## Fix (v1.6.5)

### Fix 1 — Stable `_agent_self_id()` (no PID)

```python
host = os.getenv("COMPUTERNAME") or socket.gethostname() or "unknown-host"
sess = os.getenv("SESSIONNAME") or "Console"
user = os.getenv("USERNAME") or os.getenv("USER") or "unknown-user"
_AGENT_SELF_ID = f"{_slug(host)}-{_slug(sess)}-{_slug(user)}"
```

Same Windows box + same Citrix session + same Windows user → same id forever. The `merge-duplicates` upsert on `sap_agents` now updates the existing row instead of inserting a new one. Per-process debug info migrates to a new `process_started_at` column (migration 250).

The slug helper strips problematic characters so a quirky CLIENTNAME like `ICA-tcp#0` doesn't break PostgREST `?id=eq.<value>` filters elsewhere.

### Fix 2 — Persistent agent token

`AgentState.load_config()` and `persist_config()` now read/write the full session blob:

```json
{
  "supabase_url": "...",
  "supabase_anon_key": "...",
  "supabase_token": "<jwt>",
  "user_id": "...",
  "user_email": "...",
  "org_id": "...",
  "agent_token": "<persistent>"
}
```

A new module-level call after `state = AgentState()` mints + persists `agent_token` ONCE if it's empty:

```python
def _ensure_persistent_agent_token() -> bool:
    if state.agent_token:
        return False
    state.agent_token = secrets.token_urlsafe(32)
    state.persist_config()
    return True

_AGENT_TOKEN_FRESHLY_MINTED = _ensure_persistent_agent_token()
```

`/supabase/login` no longer rotates the token — it only mints if the token doesn't already exist. `/supabase/logout` clears the Supabase JWT but **leaves `agent_token` intact**, so logging in/out doesn't kick browser tabs back to the Connect Account dialog.

The user can rotate explicitly via `POST /agent-token/rotate` (auth-required — caller must hold the current token to rotate it). New `GET /agent-token/check` (auth-required) lets the frontend's `useAgentDetection` verify token validity.

New capabilities: `persistent-agent-token`, `stable-agent-id`, `agent-token-rotate`, `agent-token-check`.

### Fix 3 — Browser-side stale-token detection + auto-recovery

`agentFetch()` in `lib/agent-fetch.ts`:

```ts
if (res.status === 401 && token) {
  _handleAgentUnauthorized(!!options?.suppressStaleToast)
}
```

`_handleAgentUnauthorized` clears the stored token, dispatches `omniframe:agent-token-stale`, and (unless suppressed) emits a single throttled toast (5min/tab cooldown):

> **Agent session expired** — Your agent token is stale (likely due to a rebuild or a logout from another tab). Click the Connect Account pill to reconnect.

Background pollers (fleet refresh, /metrics card, agent detection itself) pass `suppressStaleToast: true` so a single bad token doesn't fan out into N toasts as those pollers tick.

The handler does NOT auto-retry the original request (avoids loops). Existing 401-handling callsites remain untouched.

### Fix 4 — Aggressive fleet reaper (Postgres + pg_cron)

Migration `250_fleet_hygiene_and_token_persistence.sql`:

- `ALTER TABLE sap_agents ADD COLUMN process_started_at TIMESTAMPTZ` (per-process debug fingerprint).
- `mark_stale_sap_agents_offline()` — flips `status='offline'` when `last_seen_at < now() - interval '2 minutes'`. Idempotent.
- `purge_old_offline_sap_agents(p_max_age_days)` — DELETEs offline rows older than N days. Default 7. Idempotent.
- pg_cron jobs:
  - `omniframe-reap-stale-sap-agents` — every minute.
  - `omniframe-purge-old-offline-sap-agents` — Sundays at 03:30 UTC.

Frontend (`agents-fleet-card.tsx`):

- Default view hides agents with `status='offline'` AND `last_seen_at < now() - 24h`. The badge shows `(+N hidden)` so the count isn't deceptive.
- New eye-toggle button: "Show all (incl. ancient offline)".
- New trash button (only when there are >0 purgeable rows): calls `purge_old_offline_sap_agents(7)` after a confirm dialog. Toasts the count of deleted rows.

The agent's heartbeat upsert is tolerant of `process_started_at` not existing yet — if migration 250 hasn't been applied, it retries the upsert without that field and remembers to drop it for subsequent ticks.

### Fix 5 — Auth-aware detection

`useAgentDetection`:

- Probes `/health` (token-exempt). 200 → `available = true`.
- If available AND a token is in localStorage AND the agent reports `agent-token-check` capability → also probe `/agent-token/check` (auth-required). 200 → `authenticated = true`. 401 → `authenticated = false`.
- Pre-v1.6.5 agents (no `agent-token-check` capability) get `authenticated = available` so older versions don't trip the new banner.
- Subscribes to `omniframe:agent-token-stale` so the snapshot flips immediately when `agentFetch()` observes a 401, without waiting for the next 5s tick.

`agent-triggers-tab.tsx`'s `AgentStatusBar` adds a new `'unauthenticated'` state. When `available && !authenticated`, it renders a yellow card:

> **Agent online — session expired** — The local agent is running but your X-Agent-Token is stale or missing (typical after a logout from another tab). Click Connect Account in the toolbar to reconnect — your triggers stay configured.

The card embeds an `AgentSupabaseStatusButton` so the user can act without scrolling. The local 3s polling is dropped — `useAgentDetection`'s 5s shared poller is now the single source of truth.

## Files Modified

| File | LOC delta |
|------|-----------|
| `omni_agent/agent.py` | +180 / -25 |
| `src/features/admin/sap-testing/lib/agent-fetch.ts` | +75 |
| `src/features/admin/sap-testing/hooks/use-agent-detection.ts` | +110 / -25 |
| `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` | +55 / -25 |
| `src/features/admin/sap-testing/components/agents-fleet-card.tsx` | +110 / -10 |
| `supabase/migrations/250_fleet_hygiene_and_token_persistence.sql` | +130 (new) |

## New boot prints (healthy v1.6.5 startup)

```
[boot]   Stable agent_id: USINDPR-Console-jsingh (PID 12345, started 2026-04-30T19:53:44.012Z)
[boot]   Restored persistent agent_token from C:\Users\jsingh\AppData\Roaming\OmniFrameAgent\config.json — browser sessions that already hold this token (X-Agent-Token in localStorage) keep working without re-login.
[boot]   Restored Supabase session: jaisingh@example.com (org abcd-...)
```

For a fresh first-boot the second line reads instead:

```
[boot]   Minted NEW per-machine agent_token (no prior token in config.json). It will be reused across EXE rebuilds + restarts. Stored at C:\Users\jsingh\AppData\Roaming\OmniFrameAgent\config.json.
```

## Migration cleanup (run separately)

After the v1.6.5 agent rebuild lands, the existing 6 stale rows in `sap_agents` are still there. Run via Supabase MCP `execute_sql` on project `wncpqxwmbxjgxvrpcake`:

```sql
DELETE FROM sap_agents
 WHERE last_seen_at < now() - interval '6 hours';
```

After that, the new pg_cron schedule keeps the table clean automatically.

## Backward compatibility

- **Pre-v1.6.5 agents** still work with the v1.6.5 frontend. `useAgentDetection` capability-gates the `/agent-token/check` probe (skipped if `agent-token-check` isn't in `health.capabilities`), so older agents continue to render as `authenticated=true`. They don't get the auto-recovery toast either, since `_handleAgentUnauthorized` only fires when a 401 came back AND a token was sent — the old per-session token still works for them within a session.
- **v1.6.5 agent + pre-v1.6.5 frontend** still work too. The frontend doesn't call `/agent-token/check` so the new endpoint is dormant. The persistent token is still consumed via the X-Agent-Token header. Logout no longer clears the token, but the old frontend doesn't depend on that behaviour.
- **Migration 250 applied AFTER an agent rebuild** is safe. The agent's `_REGISTRY_DROP_PROCESS_STARTED_AT` flag toggles to True after the first 400-with-column-missing response, so the upsert keeps working with the legacy schema until the migration lands.

## Related
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-Agent-Supabase-Login-UI]]
- [[Debug/Fix-Agent-Triggers-Browser-Dependency]]
- [[Sessions/2026-04-30]]
