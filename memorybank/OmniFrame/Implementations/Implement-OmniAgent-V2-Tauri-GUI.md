---
tags: [type/implementation, status/active, domain/frontend, domain/agent, multi-session, tauri]
created: 2026-05-15
---

# Implement -- OmniAgent v2 Tauri Master GUI

## Purpose / Context

OmniAgent v2 ships a Tauri 2 desktop shell that supervises six concurrent SAP GUI sessions, dispatches quick actions, streams console output, and surfaces fleet + agent telemetry from a single window. This replaces the CustomTkinter direction in [[Plan-Multi-Session-Agent-Master]] -- Tauri lets us reuse our React / Tailwind / shadcn design language and keeps the Windows EXE self-contained (WebView2 + a single Rust binary).

Worker C (this implementation) owns the GUI: the `omni_agent_v2/gui/` Vite + React app and the `omni_agent_v2/crates/agent-gui/` Tauri shell. Worker A owns the headless agent runtime crates (`agent-types`, `agent-core`, `agent-rpc`, `agent-ws`, `agent-bin`). Worker D mirrors the output to `Downloads/MacWindowsBridge/` for the Parallels-side `cargo tauri build`.

## Architecture

```
React 18 SPA (Vite + Tailwind + shadcn + Radix + framer-motion)
   |  invoke("get_session_states") / listen("session-state-changed")
   v
Tauri command surface (crates/agent-gui/src/commands.rs)
   |  reqwest HTTP
   v
Local agent control plane @ 127.0.0.1:8765
   |  same surface the v1 admin UI already uses
   v
rust-work-service + Python SAP helper subprocess
```

- **Why HTTP, not in-process state sharing?** The sibling Rust crates (`agent-core`, `agent-rpc`, `agent-ws`) are still skeletons. Talking to the agent over its existing HTTP control plane lets the GUI ship independently of those crates and keeps it back-compatible with the v1 Python agent that still serves `/health`, `/sap/sessions`, etc. A future Cargo feature (`in-process`) will fan-in directly.
- **Why TanStack Query + Tauri events?** Each Tauri command has a typed wrapper in `gui/src/lib/tauri.ts` and a parallel HTTP wrapper in `gui/src/lib/http.ts` so the same React tree boots both in the Tauri shell (preferred) and in a plain Vite dev tab (offline development). Background pollers in `main.rs` emit `session-state-changed`, `agent-metrics`, `console-line:{slot}`, `ws-event` events. Hooks layer those over a stale-but-resilient `useQuery` poll so a missed event self-heals within 5s.

## Tauri commands implemented

All signatures match Worker A's contract verbatim.

| Command | Args | Returns |
|---|---|---|
| `get_session_states` | -- | `SessionPoolSnapshot` |
| `connect_session` | `slot_id` | `Result<()>` |
| `disconnect_session` | `slot_id` | `Result<()>` |
| `list_sap_sessions` | -- | `Vec<SapSession>` |
| `pin_sap_session` | `slot_id`, `conn_idx`, `sess_idx` | `Result<()>` |
| `release_session` | `slot_id` | `Result<()>` |
| `run_quick_action` | `slot_id`, `action`, `payload` | `Result<serde_json::Value>` |
| `get_console_tail` | `slot_id`, `since_seq` | `Vec<ConsoleLine>` |
| `get_agent_metrics` | -- | `AgentMetrics` |
| `get_ws_status` | -- | `WsStatus` |
| `get_settings` | -- | `GuiSettings` (GUI-local) |
| `update_settings` | `settings` | `Result<()>` (GUI-local) |
| `get_build_info` | -- | `BuildInfo` (GUI-local) |
| `open_log_directory` | -- | `String` (GUI-local) |

Tauri events emitted by the Rust background tasks: `session-state-changed`, `agent-metrics`, `ws-event`, `console-line:{slot_id}` (one per slot, 0..5), `recording-status` (placeholder), `helper-restarted` (placeholder).

## Design tokens

Dark default (slate-950 -> 900 -> 800), light alt (zinc/ash). Accent slots: emerald success, amber warning, rose error, violet info, blue active. State pills follow the v1 admin's `agents-fleet-card.tsx` palette so a Citrix operator who has used both sees the same color language.

Typography: Inter (sans), JetBrains Mono (console tail). Density: compact (matches the LT24 timeline bar from [[Implement-LT24-History-Trail]]).

## Validation

```
cd omni_agent_v2/gui
npm install                # 320 packages
npm run typecheck          # tsc --noEmit, clean
npm run build              # tsc --noEmit && vite build, 2105 modules

cd omni_agent_v2
cargo check -p agent-gui   # host (macOS) target, clean
cargo check -p agent-gui --target x86_64-pc-windows-msvc
                            # expected to fail on `ring` C build because
                            # the macOS host lacks the MSVC Windows SDK
                            # headers -- Worker D builds on Parallels.
```

## LOC summary

| Surface | Lines |
|---|---|
| TS / TSX (gui/src/**) | **3,550** |
| CSS (gui/src/index.css) | 191 |
| Rust (crates/agent-gui/src/**) | **828** (commands.rs 598 + main.rs 226 + build.rs 3 + lib.rs stub 1) |
| Config (Cargo.toml + tauri.conf.json + capabilities + Vite + Tailwind + tsconfig + package.json + index.html) | 450 |

Total hand-authored: ~5,019 LOC.

## Open coordination items

1. **Worker A** owns the `/session-pool`, `/metrics-summary`, `/console/tail`, `/sessions/{slot}/*` HTTP endpoints on the agent control plane. Until those land, the GUI renders the synthetic `SnapshotSource::Offline` placeholder so operators see a clean "agent offline" state instead of a blank screen.
2. **Worker D** replaces the placeholder PNG/ICO in `crates/agent-gui/icons/` with the OmniFrame brand assets and runs `cargo tauri build` on Parallels.
3. **Frozen `package.json` dep list** is captured in the session log for Worker D's lockfile pin.

## Related

- [[Plan-Multi-Session-Agent-Master]] -- the planning doc this implements (with Tauri swap-in)
- [[Omni-Agent - Headless SAP Agent]] -- the agent this GUI supervises
- [[2026-05-15]] -- session entry tracking this work
