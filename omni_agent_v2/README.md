# OmniAgent v2

A Windows-only desktop agent that drives **6 concurrent SAP GUI sessions**
from a single signed-in operator, written as a Rust shell with a Python
COM helper subprocess and a Tauri-based 6-tile master UI.

This is the v2 test to `omni_agent/` — the v1 PyInstaller monolith
(`agent.py`, ~650 KB single file) pinned the process to one SAP session
and serialised everything through one asyncio loop. v2 keeps the same
external HTTP contract (`http://127.0.0.1:8765/...`) so the existing
OmniFrame web frontend keeps working without coordinated releases, but
replaces the internals with:

- A **Rust shell** (`agent.exe`) — Tokio + Axum, handles HTTP, WebSocket
  back to `rust-work-service`, Supabase auth, the work-queue dispatcher,
  the 6-slot session pool state machine, and updater.
- A **Python COM helper** (`sap_helper.py`) — single subprocess spoken to
  over JSON-RPC on stdin/stdout, owns a tiny pool of STA threads (one per
  active SAP session) and the `pywin32` COM bindings to the SAP GUI
  Scripting Engine. We can't escape Python here — `pywin32` is still the
  only mature, battle-tested way to drive the SAP COM automation surface,
  and `pyrfc` would force NW RFC SDK redistribution.
- A **Tauri 2 GUI** (`agent-gui.exe`) — 6 session tiles, a setup wizard
  for first-run service-key onboarding, a console ring buffer, a recording
  panel that streams events from the helper, and a tray icon. The GUI is
  a thin window over the same `127.0.0.1:8765` REST surface — it never
  talks to SAP COM directly.

The split exists because:
1. **Memory safety + concurrency** — the work-queue, WS reconnect, and
   session-pool state machine are exactly the kind of code that benefits
   from Rust's borrow checker and Tokio's structured concurrency. v1's
   `_sap_conn_idx`/`_sap_sess_idx` globals are gone — slot state lives
   in one `RwLock<SessionPool>`.
2. **One installer, one process tree** — the Rust shell embeds the Python
   subprocess; users don't install Python separately. The packaging step
   bundles CPython 3.11 embed + pywin32 wheels into `python-embed/`.
3. **GUI ergonomics** — Tauri gives us a real native window with system
   tray, modern web UI in WebView2, and a 5–8 MB binary instead of a 100+ MB
   PyInstaller bundle.

## Architecture

```
                Windows host (operator desktop or Citrix VDA)
+--------------------------------------------------------------+
|                                                              |
|   +----------------------------+                             |
|   |   agent-gui.exe (Tauri)    |   WebView2 + Rust main      |
|   |   - 6 session tiles        |                             |
|   |   - Setup wizard           |                             |
|   |   - Console + recording    |                             |
|   |   - Tray icon              |                             |
|   +-------------+--------------+                             |
|                 |                                            |
|                 | HTTP 127.0.0.1:8765 (X-Agent-Token)        |
|                 v                                            |
|   +----------------------------+                             |
|   |       agent.exe (Rust)     |   Tokio + Axum, 1 proc      |
|   |                            |                             |
|   |   AgentCore                |                             |
|   |     - HTTP server :8765    |                             |
|   |     - Job dispatcher       |                             |
|   |     - Session pool (6)     |                             |
|   |     - Auth manager + JWT   |                             |
|   |     - Audit-log buffer     |                             |
|   |     - Updater (self_replace)                             |
|   +-----+-------------+--------+                             |
|         |             |                                      |
|         |             | JSON-RPC over stdio                  |
|         |             v                                      |
|         |   +-----------------------+                        |
|         |   |  sap_helper.py        |   CPython 3.11 embed   |
|         |   |  (subprocess)         |                        |
|         |   |                       |                        |
|         |   |  Slot 0 -> STA thread |                        |
|         |   |  Slot 1 -> STA thread |                        |
|         |   |  Slot 2 -> STA thread |                        |
|         |   |  Slot 3 -> STA thread |                        |
|         |   |  Slot 4 -> STA thread |                        |
|         |   |  Slot 5 -> STA thread |                        |
|         |   +-----------+-----------+                        |
|         |               |                                    |
|         |               v                                    |
|         |   +-----------------------+                        |
|         |   | SAP Logon -> SAP GUI  |                        |
|         |   | Scripting Engine COM  |                        |
|         |   | (6 visible windows)   |                        |
|         |   +-----------------------+                        |
|         |                                                    |
|         |                                                    |
+---------|----------------------------------------------------+
          |
          |  WS + REST (Bearer JWT)
          |
          v
+----------------------+        +----------------------+
| rust-work-service    |        | Supabase             |
| (Railway, existing)  |        | - auth.users         |
|   /ws                |        | - sap_agents         |
|   /api/v1/jobs/*     |<-------| - sap_agent_jobs     |
|   /api/v1/agents/*   |        | - audit log          |
+----------------------+        +----------------------+
```

External edges (in/out of the host):

- **AgentCore ↔ `rust-work-service`** — one WebSocket on `/ws` (job-claim
  push, recording-event push, presence) plus REST for slow paths
  (`POST /api/v1/jobs/:id/complete`, `POST /api/v1/agents/heartbeat`).
  Bearer JWT issued by Supabase, refreshed every 540s (well under the
  60-minute `exp`).
- **AgentCore ↔ Supabase** — direct REST to `auth.exchange` for the
  service-key → JWT flow on startup, then audit-log inserts on every
  privileged action. We do **not** open a Supabase Realtime channel from
  the agent — the org-fanout migration moved everything onto the
  rust-work-service WS (see the `.cursor/rules/Master Rule.mdc`
  "Realtime Policy" section).

## Repo layout

```
omni_agent_v2/
├── README.md                       <-- you are here
├── Cargo.toml                      Workspace manifest (Worker A)
├── rust-toolchain.toml             Pinned stable + Windows target
├── .cargo/config.toml              Build job cap + git CLI
├── .gitignore                      Standard Rust + Node + Python
├── crates/                         Worker A — Rust shell
│   ├── agent-types/                Wire-contract types (serde models)
│   ├── agent-rpc/                  JSON-RPC stdio client to python helper
│   ├── agent-ws/                   WebSocket client to rust-work-service
│   ├── agent-core/                 Session pool + dispatcher + auth + HTTP
│   ├── agent-bin/                  Headless binary entry point (agent.exe)
│   └── agent-gui/                  Tauri shell entry point (agent-gui.exe)
├── python/                         Worker B — COM helper subprocess
│   ├── sap_helper.py               JSON-RPC server, slot supervisor
│   ├── handlers/                   One module per RPC method
│   ├── tests/                      pytest + mock COM fixtures
│   └── requirements.txt            pywin32, cryptography, pytest
├── gui/                            Worker C — Tauri 6-tile frontend
│   ├── package.json                npm workspace root for the renderer
│   ├── src/                        TS + React + Tailwind, talks to :8765
│   ├── src-tauri/                  Tauri config + Rust glue (re-exports agent-gui)
│   └── public/                     Icons + manifest
└── packaging/                      Worker D — this directory
    ├── ARCHITECTURE.md             Deeper technical doc (process model, RPC spec)
    ├── build.ps1                   Windows production build script
    ├── build_macos_validate.sh     macOS validation harness
    ├── check_rpc_contract.py       Cross-checks RpcMethod vs python handlers vs TS types
    └── installer/
        └── installer.iss           Inno Setup config (optional installer)
```

## Prerequisites

| Tool        | Version  | Why                                         |
|-------------|----------|---------------------------------------------|
| Rust        | 1.75+    | Workspace builds with stable toolchain.     |
| Node.js     | 20+      | Vite + Tauri 2 renderer build.              |
| Python      | 3.11.x   | Helper subprocess + python-embed bundle.    |
| Inno Setup  | 6.x      | Windows installer (`packaging/installer/`). |
| Visual C++  | 2022 BT  | MSVC linker for the Windows Rust target.    |
| WebView2    | Evergreen| Tauri 2 renderer (installed by Windows 11). |

On the macOS dev host you only need Rust + Node + Python 3.11 — the
Inno Setup + MSVC bits are Windows-only and live on Parallels.

## Quick start (development on macOS)

The macOS path runs the helper in `--mock` mode (no real SAP COM, returns
canned responses from `python/handlers/_common.py` and per-handler mock
paths) so you can iterate on the Rust + GUI surface without a Windows
VM.

```bash
# Terminal 1 — Python helper in mock mode
python3 python/sap_helper.py --mock

# Terminal 2 — Rust agent (headless, HTTP on :8765)
cargo run -p agent-bin

# Terminal 3 — Tauri GUI in dev mode (Vite + Tauri hot-reload)
# The Tauri config lives at crates/agent-gui/tauri.conf.json. It
# auto-spawns `npm --prefix ../../gui run dev` and points the window
# at http://localhost:1420.
cd crates/agent-gui
cargo tauri dev
```

The GUI talks to `http://127.0.0.1:8765`; the Rust agent talks to the
helper over its stdio (spawned automatically). To enumerate the helper's
registered methods without running anything else:

```bash
python3 python/sap_helper.py --probe
# prints { "version": "...", "methods": [...], "num_slots": 6 }
```

## Production build (on Windows / Parallels)

```powershell
# Run from omni_agent_v2/ root
cd C:\Users\<you>\OneBoxFullStack\omni_agent_v2
pwsh ./packaging/build.ps1

# Output:
#   ./dist/agent/             — runnable folder layout
#   ./dist/OmniAgent_v2.zip   — portable ZIP (primary distribution)
#   ./dist/OmniAgent_v2_setup.exe — Inno Setup installer (optional)
#   ./dist/manifest.json      — SHA-256 of every file in agent/
```

The script:

1. Verifies `cargo`, `node`, `python --version 3.11`, and (optionally)
   `iscc.exe` are on `PATH`.
2. Runs `cargo build --release --workspace --target x86_64-pc-windows-msvc`.
3. Runs `npm ci && npm run build` in `gui/`, then `cargo tauri build
   --release` for the bundled `.msi` artefact.
4. Downloads CPython 3.11 embeddable zip from python.org, extracts to
   `packaging/python-embed/`, pip-installs `pywin32 + cryptography` via
   `pip install --target packaging/python-embed/Lib/site-packages`,
   and patches `python311._pth` to enable `import site`.
5. Copies the embed, the helper script, and the handlers into
   `dist/agent/python/`.
6. Copies the two release binaries into `dist/agent/`.
7. Computes SHA-256 for every file in `dist/agent/`, writes
   `dist/manifest.json` (used by the in-product updater).
8. Zips `dist/agent/` into `dist/OmniAgent_v2.zip`.
9. If `iscc.exe` is on `PATH`, runs Inno Setup against
   `packaging/installer/installer.iss` to produce the installer.

The ZIP is the **primary distribution** — it works out of an unzipped
folder with no admin rights and no `Program Files` write. The installer
is a convenience for fleet rollouts.

## Validation (anywhere)

```bash
bash ./packaging/build_macos_validate.sh
```

Runs the full quality gate on the macOS host: `cargo check` (host +
Windows syntax), `cargo clippy -D warnings`, `cargo test`, `cargo fmt
--check`, Python AST parse, `pytest`, `npm ci + typecheck + build`, and
the JSON-RPC contract cross-check (see `packaging/check_rpc_contract.py`).

If every banner prints and the final line says
`All validation checks passed.`, the codebase is ready to hand off to
Parallels for the Windows build.

## Configuration

The agent reads config from three places, in precedence order:

1. **Command-line flags** — `agent.exe --port 8765 --work-service-url
   https://work.omniframe.app --supabase-url https://...`
2. **`config.json`** — in `%LOCALAPPDATA%\OmniFrame\Agent v2\config.json`.
   Schema:
   ```json
   {
     "port": 8765,
     "agent_token": "<random 32-byte hex, persisted on first start>",
     "work_service_url": "https://work.omniframe.app",
     "supabase_url": "https://wncpqxwmbxjgxvrpcake.supabase.co",
     "supabase_anon_key": "eyJ...",
     "service_key_path": "%LOCALAPPDATA%\\OmniFrame\\Agent v2\\agent_service_key.txt",
     "log_level": "info",
     "max_sessions": 6
   }
   ```
3. **Environment variables** — `OMNIAGENT_PORT`, `OMNIAGENT_AGENT_TOKEN`,
   `OMNIAGENT_WORK_SERVICE_URL`, `OMNIAGENT_SUPABASE_URL`,
   `OMNIAGENT_SUPABASE_ANON_KEY`, `OMNIAGENT_SERVICE_KEY_PATH`,
   `OMNIAGENT_LOG_LEVEL`, `OMNIAGENT_MAX_SESSIONS`. Useful for CI and for
   the Tauri GUI spawning the headless binary with overrides.

The **service key** is a Supabase signing secret minted from the admin
console under "SAP Agents → New Agent". It is exchanged once at startup
for a short-lived JWT, then re-exchanged every 540s. The service key
file must have `0600` permissions on macOS / ACL `Owner-only` on Windows
— the loader refuses to start otherwise (see
`packaging/ARCHITECTURE.md` § Auth flow).

## Status & roadmap

**Phase 1 (this build) — Multi-session agent core**

- [x] Rust workspace scaffolding (6 crates)
- [x] Wire-contract types (`agent-types`)
- [x] JSON-RPC stdio client (`agent-rpc` — helper + supervisor + types)
- [x] WS client to `rust-work-service` (`agent-ws`)
- [x] Session pool + dispatcher + auth (`agent-core`)
- [~] Headless binary entry point (`agent-bin` — stub, fills out when
      `agent-core::AgentCore::run()` lands)
- [~] Tauri shell entry point (`agent-gui` — lib + commands; build.rs
      needs `tauri-build` added to `[build-dependencies]` before it
      compiles on a Tauri-installed host)
- [x] Python COM helper + handlers + 60-test pytest suite
- [x] Tauri renderer (6 tiles + wizard + console)
- [x] Build + packaging + validation harness

**Phase 2 — Operations & observability** *(deferred)*

- Prometheus `/metrics` endpoint on `127.0.0.1:8765`
- Structured JSON log file rotation (one per slot)
- In-product crash reporter

**Phase 3 — Fleet management** *(deferred)*

- Cross-agent presence in the OmniFrame admin UI
- Server-driven config push (rolling restart on `config.json` change)
- Recording library + replay

**Phase 4 — Auto-update** *(deferred until Phase 1 ships)*

- Signed manifest delivery from `rust-work-service`
- Background download + atomic swap on next start (`self_replace`)

## License

Proprietary — OmniFrame / OneBox AI Logistics. Internal use only.
