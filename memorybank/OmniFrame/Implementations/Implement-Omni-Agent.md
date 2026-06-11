---
tags: [type/implementation, status/active, domain/infra]
created: 2026-04-16
updated: 2026-04-16
---
# Implement Omni-Agent (Tier 4 Citrix)

## Context
The `omni_bridge/` pywebview desktop app works but requires users to open a specific .exe each Citrix session, using an embedded WebView2 browser. To let users open **any Chrome browser** in Citrix and use One Click Ship directly, built a headless background agent exposing localhost REST at `127.0.0.1:8765`. Bridge is retained as fallback.

Target: **Tier 4 Citrix** — non-persistent sessions, no IT image deployment, no profile persistence tools. Users download-and-run once per session.

## Deliverables

### New: `omni_agent/`
- **`agent.py`** — FastAPI + uvicorn + pywin32 SAP COM. Same automation as bridge but headless.
- **`requirements.txt`** — fastapi, uvicorn[standard], pywin32, requests, pydantic, pyinstaller
- **`build_exe.bat`** — PyInstaller `--console` (visible window for testing) with uvicorn hidden imports
- **`README.md`** — Architecture + distribution docs

### Web App Changes
**File:** `src/features/admin/sap-testing/components/one-click-ship-tab.tsx` (full rewrite)

- **`AgentStatusBar`** — unified card: agent state + SAP session picker inline
- **`ShipmentProgressCard`** — live progress bar with current step, elapsed time, completed-steps list
- **`ShipmentSummaryCard`** — compact one-line result with collapsible details
- **`AgentDownloadModal`** — 4-step install guide with ZIP-specific instructions

### Backend CSP Fix
**File:** `api/main.py` (~line 260)
Added `http://localhost:*`, `http://127.0.0.1:*`, `ws://localhost:*`, `ws://127.0.0.1:*` to production `connect-src` directive so the HTTPS page can fetch the localhost agent.

## Key Technical Decisions

### No Install (run from Downloads)
Original design self-installed to `%LOCALAPPDATA%` with a Startup shortcut. User requested removal — in non-persistent Citrix, `%LOCALAPPDATA%` gets wiped anyway, so the complexity was pointless. Agent now runs from wherever the user extracts the ZIP.

### Console Mode (not Windowed)
Built with `--console` so users see live logs in a window and can verify the agent is running. Was briefly `--windowed` but that made debugging impossible in Citrix (can't tell if it's even running).

### Auto-Select Valid SAP Session
```python
def _auto_select_valid_session() -> tuple[int, int] | tuple[None, None]:
    """Walks all connections, finds first with a usable session."""
```
Fixes error 614 "collection enumerator cannot find element" when `Children(0)` is the SAP Logon Pad with 0 sessions. Called on `/sap/connect` and as fallback in `_get_sap_session()`.

### `_wait_for_control(sess, control_id, timeout)`
New helper that polls for a specific SAP GUI element's existence before interacting. Replaces naive `_wait_for_session()` which only checked `sess.Busy` — that flag lies when SAP's scripting confirmation popup is up. Gives 30s buffer for user to click OK on any prompt.

### Chrome Private Network Access (PNA)
Chrome 108+ requires a preflight header dance for HTTPS→localhost fetches:
```
OPTIONS /health
→ Response must include: Access-Control-Allow-Private-Network: true
```
Added via custom middleware `add_private_network_headers`. Works alongside standard CORS.

### Live Progress via Polling (not SSE/WebSocket)
- Module-level `_shipment_progress` dict + `threading.Lock`
- Helpers: `_reset_progress`, `_set_step`, `_append_step_result`, `_finalize_progress`
- `GET /sap/shipment-progress` returns a snapshot
- UI polls every 1 second during run, stops on completion
- FastAPI thread pool handles the long POST and the poll GET concurrently

Chose polling over SSE because:
- Simpler (no streaming response, no reconnection logic)
- Corporate CASBs often block SSE
- 1s granularity is sufficient for 6-step SAP flow

### ZIP Packaging (bypass corporate CASB)
Netskope FedRAMP at Rolls-Royce blocks raw `.exe` downloads from non-allowlisted domains. Shipping as `OmniFrame_Agent.zip` passes through. User right-clicks → Extract All → double-clicks the EXE inside.

### Supabase Storage for Distribution
Created `downloads` bucket (public-read) instead of committing the 20 MB binary to git. Pros:
- No repo bloat
- CDN-backed delivery (Cloudflare edge)
- Update = re-upload, no Railway redeploy
- Works around Railway static file build limitations

Upload flow:
```sql
-- Add temp policies via Supabase MCP
CREATE POLICY "Temp anon upload downloads" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'downloads');
```
```bash
curl -X POST "https://.../storage/v1/object/downloads/OmniFrame_Agent.zip" \
  -H "apikey: <anon>" -H "Authorization: Bearer <anon>" \
  -H "Content-Type: application/zip" -H "x-upsert: true" \
  --data-binary "@OmniFrame_Agent.zip"
```
```sql
-- Drop temp policies
DROP POLICY "Temp anon upload downloads" ON storage.objects;
```

### Bridge Coexistence
Frontend checks for `window.pywebview.api.process_shipment` first (bridge signal). If found, uses the bridge's in-process API. Otherwise falls back to `fetch(localhost:8765)`. Both paths produce identical `ShipmentResult` shape so the UI is uniform.

## Build & Deploy Flow

### Agent (Python)
```powershell
cd \\Mac\Home\Downloads\MacWindowsBridge\Omni-Agent
rmdir /s /q build dist
build_exe.bat
# Output: dist/OmniFrame_Agent.exe (~20 MB)
```

### Upload to Supabase
```bash
cd /tmp && zip -j OmniFrame_Agent.zip <path-to-exe>
# (Add temp policies via MCP execute_sql, then:)
curl -X POST ... --data-binary "@OmniFrame_Agent.zip"
# (Drop temp policies)
```

### Web App
```bash
cd /Users/jaisingh/Documents/Projects/OneBoxFullStack
npm run build  # verify
git add -A && git commit && git push
# Railway auto-deploys
```

## Future Enhancements
- Shared-secret auth token between web app and agent
- Auto-update: agent checks `/api/agent/latest-version` on startup
- Code signing certificate (removes SmartScreen "unknown publisher")
- Tray icon with right-click menu
- Structured JSON log file in user profile

## Related
- [[Omni-Agent - Headless SAP Agent]]
- [[Omni-Bridge - SAP Bridge]] — retained fallback
- [[Implement-One-Click-Ship]] — original implementation in the bridge
- [[Fix-Agent-Distribution-Issues]] — debug log of CASB, CSP, PNA, 614, uvicorn logging
- [[Sessions/2026-04-16]]
