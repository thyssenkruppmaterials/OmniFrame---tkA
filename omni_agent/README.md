# OmniFrame SAP Agent

A **headless** Windows background service that allows the OmniFrame web app
(running in any browser on a Citrix desktop) to drive SAP GUI automation
via COM without requiring the full `OmniFrame SAP Bridge` desktop app.

## Architecture

```
Chrome on Citrix  ──HTTPS──→  OmniFrame (Railway)
       │
       │  fetch('http://localhost:8765/...')
       ▼
OmniFrame SAP Agent ──COM──→ SAP GUI
```

The agent binds to `localhost:8765` and exposes a REST API. The web app
detects the agent on page load and, if missing, prompts the user to
download and run it once per Citrix session.

## Coexistence with `omni_bridge/`

Both the **Bridge** (`omni_bridge/`) and the **Agent** (`omni_agent/`)
implement the same SAP automation. Users can use either:

| Feature | Bridge (.exe app) | Agent (background) |
|---|---|---|
| UI | pywebview window | None (headless) |
| Browser | Built-in WebView2 | Any Chrome/Edge |
| Install | Manual .exe launch each session | Self-installs to AppData on first run |
| Web App detection | Injected JS (`window.pywebview.api`) | `fetch('http://localhost:8765')` |

The Bridge is retained as a fallback if Agent distribution doesn't work in
the target environment.

## Tier 4 Citrix (No IT Help)

This agent is designed for **non-persistent Citrix sessions without profile
persistence**. The flow:

1. User opens Chrome → navigates to OmniFrame
2. Web app detects no agent on `localhost:8765`
3. Modal: "Download SAP Agent"
4. User clicks Download → `OmniFrame_Agent.exe` downloads
5. User double-clicks → agent:
   - Copies itself to `%LOCALAPPDATA%\OmniFrameAgent\`
   - Creates a Startup shortcut
   - Launches the installed copy
   - Original download can be deleted
6. Web app polls `/health`, detects agent, dismisses modal
7. All SAP operations (One Click Ship, TO confirm) proxy through the agent

On logoff/logon in truly ephemeral environments the user repeats this
~10 second flow. In environments with profile persistence (FSLogix, Citrix
UPM) the agent survives and auto-starts on next login.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Lightweight detection + Citrix env |
| GET | `/status` | Detailed state |
| POST | `/sap/connect` | Attach to SAP GUI |
| POST | `/sap/disconnect` | Mark as disconnected |
| GET | `/sap/sessions` | List all SAP connections/sessions |
| POST | `/sap/session` | Select connection+session index |
| POST | `/supabase/login` | Authenticate for transaction logging |
| POST | `/sap/confirm-to` | LT12 Transfer Order confirmation |
| POST | `/sap/process-shipment` | Full 7-step shipment process |
| POST | `/shutdown` | Gracefully stop the agent |

## Citrix Detection

`detect_citrix()` inspects environment variables:

- `SESSIONNAME` - contains `ICA-*` in Citrix, `RDP-*` in RDP
- `ICAROOT` - Citrix client install dir
- `CITRIX_HDX_ENABLED` - HDX session indicator
- `CLIENTNAME` - Client machine name (only set in remote sessions)

The result is included in `/health` and `/status` so the web app can
adapt messaging ("Citrix session detected - agent will need to be
re-downloaded on logoff if profile persistence is not configured").

## Build

```bash
cd omni_agent
build_exe.bat
```

Output: `dist/OmniFrame_Agent.exe` - single-file, silent background process.

## Distribution

Host the .exe at a public URL accessible from Citrix (Supabase Storage,
Railway `/public/downloads/`, or GitHub Releases). The web app fetches
from `{origin}/downloads/omniframe-agent.exe` by default.

## Security Notes

- Agent only binds `127.0.0.1` (not all interfaces) - not reachable from
  other machines
- CORS restricted to known OmniFrame origins
- Chrome exemption allows HTTPS → http://localhost calls
- For production: add a shared-secret token that the web app passes in
  `Authorization: Bearer` - stops local malware from hijacking the agent
