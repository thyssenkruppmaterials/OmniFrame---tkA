---
tags: [type/implementation, status/active, domain/infra, domain/frontend]
created: 2026-05-03
---
# Implement-SAP-Session-Pinning (v1.7.9)

## Purpose / Context
User ran into a class of bug where multiple SAP GUI sessions were open on the same Citrix box (different system / client / user — e.g. PRD/800 for production work + DEV/100 for testing) and the OmniFrame Agent's `_auto_select_valid_session()` greedily attached to whichever session it scanned first. Manual SAP work in the OTHER session would get hijacked by the agent's job poller as soon as a queued job fired (LT12 confirmation, LT22 import, etc.).

v1.7.9 introduces **SAP session pinning** — bind the agent to ONE specific SAP GUI session so the rest of the user's SAP windows are safe.

## Pinning Model

### Pin shape (`AgentState.pinned_session`)
```python
{
  "conn_idx": int,           # last-known SAP scripting index
  "sess_idx": int,           # last-known SAP scripting index
  "system":   str,           # session.Info.SystemName
  "client":   str,           # session.Info.Client
  "user":     str,           # session.Info.User
  "pinned_at": ISO 8601 str,
  "by_criteria": bool,       # default True — enables criteria-match
}
```

Persisted to `%APPDATA%\OmniFrameAgent\config.json` so the pin survives EXE rebuild + restart. `load_config()` rehydrates it; `_restore_pinned_session_indexes()` primes the `_sap_conn_idx, _sap_sess_idx` globals so `sap_connect()` tries the pinned coordinates first.

### Two-strategy lookup (`_find_pinned_session`)
1. **Fast path** — try the stored `(conn_idx, sess_idx)` directly. If they resolve AND identity (system/client/user) still matches, return them.
2. **Criteria scan** (when `by_criteria=True`) — walk every connection × session and return the first one whose identity matches the pinned system + client + user. SAP renumbers session indexes across GUI restart so the criteria match is the durable identity.

If neither strategy finds a match, `_auto_select_valid_session` returns `(None, None)` with a clear log line:
```
[sap]   PINNED session (sys=PRD client=800 user=U8206556) not currently available — agent will retry on next auto-connect tick. Use POST /sap/unpin-session to release the pin.
```
The agent stays disconnected — it does NOT silently jump to a different session. The auto-connect daemon (`_start_sap_autoconnect_loop`) keeps retrying every 10–60s, so the moment the user opens the pinned SAP session again, the agent reattaches automatically.

## Endpoints

### `POST /sap/select-session` (new)
```json
// request
{ "conn_idx": 0, "sess_idx": 0, "pin_by_criteria": true }

// response
{ "ok": true, "pinned": { "conn_idx": 0, "sess_idx": 0,
                          "system": "PRD", "client": "800",
                          "user": "U8206556",
                          "pinned_at": "2026-05-03T14:22:00Z",
                          "by_criteria": true } }
```
Validates the session exists and has a usable `wnd[0]` before persisting the pin. Captures system/client/user from `sess.Info` so the criteria-match fallback knows what to look for.

### `POST /sap/unpin-session` (new)
```json
{ "ok": true, "had_pin": true }
```
Clears `state.pinned_session`, persists, logs once. Auto-select resumes on the next attach.

### `GET /sap/sessions` (augmented)
Each session entry now carries:
- `system`, `client`, `user`, `transaction` — identity strings used by the picker
- `pinned: bool` — true when this session matches the stored pin (by indexes OR by criteria)
- `is_active: bool` — true when this is currently `(_sap_conn_idx, _sap_sess_idx)`

Top-level response also echoes `pinned_session` (the full criteria) so the picker can show the pinned identity even when the pinned SAP session isn't currently visible.

## Frontend

### Shared component `SapSessionPicker`
File: [`src/features/admin/sap-testing/components/sap-session-picker.tsx`](src/features/admin/sap-testing/components/sap-session-picker.tsx)

Compact pill + dropdown:
- **Pinned** → 🔒 SYS/CLT/USER ▾ (lock icon, env-coloured pill — PRD red, QA amber, DEV/TST green)
- **Auto-select** → Auto: SYS/CLT/USER ▾ (open lock, neutral pill)
- **No SAP session** → static "No SAP session" pill

Dropdown contents:
- One row per available session with `system / client / user` slug + connection name + transaction code
- Currently-pinned row gets a checkmark + 'pinned' badge
- Currently-active row gets an 'active' badge
- When a pin is set but the pinned session isn't visible: amber callout "Pinned session not currently available — Looking for SYS/CLT/USER. Open it in SAP Logon or unpin to resume auto-select."
- Footer: "Unpin (return to auto-select)" when something is pinned

On pin/unpin, calls `onChanged()` so the parent re-fetches `/sap/sessions` and `/health` (fresh `sap_connected` + `is_active` flags).

### Wired into both SAP Testing tabs
- [`inventory-management-tab.tsx`](src/features/admin/sap-testing/components/inventory-management-tab.tsx) — `AgentStatusBar` renders the picker WHEN `hasCapability(health, 'sap-session-pinning')`, otherwise falls back to the v1.7.8 inline `<select>` so older agents don't lose functionality.
- [`agent-triggers-tab.tsx`](src/features/admin/sap-testing/components/agent-triggers-tab.tsx) — `StatusStrip` (the connected-state branch) appends the picker next to `AgentSupabaseStatusButton` under the same capability gate.

## Files modified (LOC delta vs HEAD)
- `omni_agent/agent.py` — +~290 lines (state field + persist/load + `_find_pinned_session` + `_read_session_identity` + `_restore_pinned_session_indexes` + `select_session` / `unpin_session` endpoints + `/sap/sessions` augmentation + `_auto_select_valid_session` pin-aware branch + boot banner + capability + version banner)
- `src/features/admin/sap-testing/components/sap-session-picker.tsx` — NEW (~370 LOC including types + helpers)
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — +35 lines (LATEST_AGENT_VERSION bump + jsdoc block)
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — +30/-15 (type alias swap + capability-gated picker render)
- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` — +12 (import + capability-gated picker render)

## Constraints honoured
- **DO NOT remove the auto-select fallback** — kept; default behaviour when no pin is set is byte-identical to v1.7.8 (`_auto_select_valid_session` returns the first usable session as before).
- **The pin must survive agent restart via `config.json`** — `pinned_session` is added to both `load_config()` and `persist_config()`.
- **The agent MUST NOT silently jump to another session when pinned** — `_auto_select_valid_session` returns `(None, None)` when pinned and the pinned session is unavailable; `sap_connect()` then errors out and the auto-connect daemon retries.
- **DO NOT touch any other handler** — confirmed via grep: only the four sites touched are `_auto_select_valid_session`, `/sap/sessions`, `AgentState.__init__/load/persist`, and the two new endpoint handlers.

## How the user uses it
1. Rebuild the EXE on Windows from the copy at `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py`:
   ```cmd
   cd MacWindowsBridge\Omni-Agent
   build_exe.bat
   ```
2. Replace the running `OmniFrame_Agent.exe` and relaunch.
3. Open the SAP Testing tab in the OmniFrame web app — the StatusStrip pill now shows `Auto: PRD/800/U8206556 ▾`.
4. Click the dropdown → pick the SAP session you want to dedicate to the agent → 🔒 pill updates.
5. Manual SAP work in any OTHER SAP window is now safe — the agent will only ever attach to the pinned session.
6. To release: dropdown → "Unpin (return to auto-select)".

## Verification
- `python3 -c 'import ast; ast.parse(open("omni_agent/agent.py").read())'` — exit 0
- `pnpm tsc -b` — exit 0
- `pnpm build` — built in ~14s; bundle delta negligible (picker is +1.5 KB inside `feature-admin-sap` chunk)
- Copy of `agent.py` re-AST-parsed at `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` — exit 0

## Related
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Components/Agent-Triggers - Realtime Automation]]
- [[Components/Inventory-Management - SAP Query Framework]]
- [[Sessions/2026-05-03]]
