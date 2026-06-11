---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/auth]
created: 2026-04-29
---
# Implement Agent Supabase Login UI

## Purpose / Context
The agent's `POST /supabase/login` endpoint has shipped since v1.4.0 but had no first-class call site in the frontend — users had to open a terminal and `curl -X POST http://127.0.0.1:8765/supabase/login -d '{...}'` to mint the per-session `agent_token` that the trigger runtime, queue poller, and audit-log writer all depend on. This implementation adds a proper modal + status pill so non-technical users can authenticate the EXE in one click.

## Agent changes (`omni_agent/agent.py`)
**No `AGENT_VERSION` bump** (still `1.6.1`) — the version comment now references the new endpoints for the next bump (1.6.2).

- `AgentState.load_config()` / `persist_config()` — now persist + rehydrate `supabase_token`, `user_id`, `user_email`, `org_id`, `agent_token` (previously only URL + anon key were persisted). Survives EXE restarts. Stored at `%APPDATA%\OmniFrameAgent\config.json`.
- `GET /supabase/session` — read-only login state for the UI. Returns `{ok, logged_in, email, user_id, org_id}`. Token-exempt so the UI can poll it before having a token.
- `POST /supabase/logout` — wipes JWT + user/org/email + agent_token, persists the wiped state, returns `{ok: True}`. URL + anon key preserved (re-login is one form submit).
- `_TOKEN_EXEMPT_PATHS` — added `/supabase/session` and `/supabase/logout`.
- `main()` — prints `[boot] Restored Supabase session (email=…, org=…, user=…)` on startup so users can verify rehydration in the agent console.

## Frontend changes
### New files
- `src/features/admin/sap-testing/components/agent-supabase-login-dialog.tsx` (~280 LOC) — shadcn `Dialog` with email/password form. Hydrates `url` + `key` from `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (same as [[Components/Configuration Services - Supabase Service|the singleton Supabase client]]). On success: stores `agent_token` via `setAgentToken()`, fires `refreshAgentDetection()`, toasts "Agent connected as <email>", closes. When already logged in, shows a Disconnect button that calls `POST /supabase/logout`.
- `src/features/admin/sap-testing/components/agent-supabase-status-button.tsx` (~150 LOC) — single shared `<AgentSupabaseStatusButton size='compact' />` pill used by every surface. Polls `/supabase/session` every 30s, on mount, on dialog close, and after login/logout. Falls back to `/status.supabase_logged_in` for agents <1.6.2 that don't have the new endpoint. Hides itself when the agent isn't reachable (configurable via `hideWhenAgentMissing`).

### Edited files
- `src/features/admin/sap-testing/components/agent-health-card.tsx` — added the status pill to the card header (right of the metrics-refresh button). Only renders when `agentConnected`.
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — added the pill inline next to the "SAP GUI: connected/not connected" badge in `AgentStatusBar`.
- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` — added the pill to the connected-state `AgentStatusBar` next to the session refresh button.
- `src/components/outbound-data-manager.tsx` — added the pill next to the SmartImportButton in the outbound TO header.

## Surfaces (where the button appears)
1. **Agent Health Card** header (Inventory Management tab) — compact pill, right of the metrics refresh button.
2. **Inventory Management** tab `AgentStatusBar` — inline next to the SAP GUI badge.
3. **Agent Triggers** tab `AgentStatusBar` — inline next to the session refresh button.
4. **Outbound Apps Data Manager** — left of the `SmartImportButton` in the outbound TO header.

All four use the same shared component → guaranteed visual + state consistency.

## Persistence semantics
- `persist_config()` writes the **full** session blob now (not just url + key).
- `load_config()` rehydrates everything on `AgentState.__init__()` — so an EXE restart with a still-valid Supabase JWT means triggers + queue jobs keep firing without user intervention.
- The Supabase access token expires (typically 1h); when it does, the next API call 401s. The `agent_token` (per-session, locally-minted) does NOT expire — only `/supabase/logout` clears it.
- Logout wipes everything except url + key (so re-login is one form).

## Failure modes handled
- **Agent not reachable** — pill hides itself by default; the SmartImportButton's existing "Import via Agent" disable already covers this surface.
- **Endpoint missing (agent <1.6.2)** — status button falls back to `/status.supabase_logged_in` so old agents still show the right state.
- **Bad credentials** — error surfaces inline from `data.error`; dialog stays open so the user can retry without retyping email.
- **Missing env vars** — dialog shows a yellow banner explaining `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing.

## Build status
`npm run build` — passes (~9.3s, no new warnings).

## Rebuild required?
**Yes** — for the new `GET /supabase/session` and `POST /supabase/logout` endpoints + full session persistence. The frontend's status button gracefully falls back to `/status` on older agents, so this is a soft requirement; the persistence + `/supabase/logout` path only works after rebuild.

Steps: copy `omni_agent/agent.py` → `~/Downloads/MacWindowsBridge/Omni-Agent/agent.py` (already done), build on Parallels Windows via `build_exe.bat`, then upload the ZIP per [[Components/Omni-Agent - Headless SAP Agent#Update Procedure]].

## Related
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-Agent-Triggers]]
- [[Implementations/Implement-LT22-Outbound-Import]]
- [[Patterns/Smart-Import-Button]]
- [[Decisions/ADR-Auth-Architecture]]
- [[Sessions/2026-04-29]]
