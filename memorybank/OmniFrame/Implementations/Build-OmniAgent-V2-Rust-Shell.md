---
tags: [type/implementation, status/active, domain/agent, domain/backend, domain/infra, multi-session, rust]
created: 2026-05-15
---

# Build — OmniAgent v2 Rust Shell (Worker A)

## Purpose / Context

First-pass scaffold of the new Rust home for everything the v1.x Python
OmniAgent does that ISN'T SAP COM. The Python helper (Worker B's
territory) keeps owning COM via a long-lived JSON-RPC subprocess; the
Rust shell takes over the local HTTP server on `:8765`, the WebSocket
client to `rust-work-service`, the auth/JWT/service-key plumbing, the
jobs lifecycle, the heartbeat / watchdog / console relay daemons, and
the NEW v2 6-slot multi-session pool that motivates the major version
bump (see [[Plan-Multi-Session-Agent-Master]]).

## Details

### Workspace layout

Canonical path: `/Users/jaisingh/Documents/Projects/OneBoxFullStack/omni_agent_v2/`.
Rust 2021, Tokio 1, Axum 0.7, Reqwest 0.12 (rustls-native-roots),
tokio-tungstenite 0.21.

```
omni_agent_v2/
├── Cargo.toml              # workspace root, single source of truth for dep versions
├── rust-toolchain.toml     # pin to stable + windows-msvc target
├── .cargo/config.toml      # macOS host: never auto-cross-compile
├── crates/
│   ├── agent-types/        # 1702 LOC — shared serde models + RpcMethod enum
│   ├── agent-rpc/          #  792 LOC — JSON-RPC supervisor for the Python helper
│   ├── agent-ws/           #  529 LOC — resilient WS client to rust-work-service
│   ├── agent-core/         # 2903 LOC — HTTP server + 45 endpoints + lifecycle daemons
│   ├── agent-bin/          #  124 LOC — headless agent.exe entry point
│   └── agent-gui/          #  917 LOC — Tauri 2 commands (Worker C owns main/UI)
```

Total: **6967 LOC** (~7k Rust). All six crates compile on macOS host
with `cargo check --workspace --all-targets --all-features`.
[[Components/Omni-Agent - Headless SAP Agent]] (the v1.x Python
incumbent) stays untouched.

### Wire contract

Every type in `agent-types` mirrors either:

1. A Pydantic model in `omni_agent/agent.py` (or sibling modules:
   `lt22_import.py`, `zmm60_lookup.py`, `lx25_inventory_completion.py`,
   `material_master_read.py`).
2. A `WsEvent` variant from `rust-work-service::websocket::mod.rs`.
3. A NEW v2 shape — `SessionPoolSnapshot` (the 6-slot pool) and
   `SessionTarget` (the optional `session_id` flattened into every
   existing `/sap/*` request body) are the new ones.

FE callers can keep talking to the Rust agent without a coordinated
release; the v2 shapes are additive (`Option`-wrapped, defaulted).

### JSON-RPC supervisor (agent-rpc)

`PythonHelper::spawn(python_exe, helper_script)` returns a clonable
handle. Background supervisor task does:

- `tokio::process::Command::spawn` with stdin/stdout/stderr piped.
- Reader task line-decodes stdout, routes responses by `id` to oneshot
  channels (`DashMap<u64, oneshot::Sender>`) and notifications to a
  `broadcast` channel.
- Writer task drains an mpsc queue + ack channel; releases ownership
  back via a oneshot when the child dies (so the next iteration can
  keep draining).
- Crash → bounded exponential restart 1s→30s, reset on
  `stable_threshold` (60s default).
- Per-call timeout of 600s (configurable).
- Stderr tee'd to `tracing` at WARN.

End-to-end integration test runs `tests/mock_helper.py` and verifies
happy path + supervisor restart on SIGKILL.

### Resilient WS client (agent-ws)

Rust port of `omni_agent/work_service_ws.py`:

- Library-level ping (20s) + application-level watchdog (15s tick,
  60s deadline) — same belt-and-suspenders the Python client uses for
  Citrix / corp-proxy half-open sockets.
- Bounded exponential reconnect 1s→30s, reset to 1s after
  `STABLE_CONNECTION` (60s).
- `TokenProvider` trait — `agent-core` implements
  `StateBackedTokenProvider` against the in-process JWT cache so the
  identity-v2 refresher (every 540s) seamlessly hands fresh tokens to
  the WS reconnect loop.
- Unknown event variants land in `WsEvent::Unknown` — adds zero
  release pressure when `rust-work-service` adds a new variant.

### HTTP surface (agent-core)

All **45 endpoints** wired in `router.rs`. Most SAP routes forward to
`PythonHelper.call(method, params)`; exceptions implemented natively:

- `/sap/reversal/compute-inverse` — pure-fn port of
  `omni_agent/reversal_engine.py:compute_inverse`. 12 unit tests.
- `/sap/query-handlers` — static catalog.
- All `/sap/v2/sessions{,/...}` — multi-session pool (NEW v2).
- All `/jobs/*` — proxy to `rust-work-service /api/v1/sap-agents/jobs/*`.
- `/health`, `/status`, `/metrics`, `/realtime/status`, `/agent-token/*`.
- `/supabase/login`, `/supabase/session`, `/supabase/logout` — Rust-native HTTP forward to Supabase `/auth/v1/token`.

Middleware: CORS, Private-Network-Access (Chrome 108+ requirement),
`X-Agent-Token` gate with the same exempt-path semantics as v1.x.

Lifecycle daemons spawned at boot:

1. **JWT refresher** — 540s cadence, 3-tier service-key loader (env →
   `~/.omniframe/agent_service_key.txt` → alongside-EXE with
   auto-promote).
2. **Heartbeat** — 30s active / 60s idle adaptive.
3. **Helper watchdog** — bumps state counter when the supervisor
   restarts the child.
4. **Console relay** — subscribes to helper notifications, batches
   `log.line` / `log.batch` POSTs to
   `rust-work-service /api/v1/sap-console/lines`.
5. **WS runner** + **WS event router** — keep the WS singleton alive
   and dispatch incoming events.
6. **Job poller** — 5s fallback poll on `/api/v1/sap-agents/jobs/claim`.

### Multi-session pool (NEW v2)

`SessionPool` owns `[SessionSlot; 6]` behind a `parking_lot::RwLock`.
Every existing `/sap/*` request optionally carries `session_id: 0..6`
(via `SessionTarget` flattened into the request body) so the FE can
route parallel work without spawning multiple agent.exes.

New routes: `GET /sap/v2/sessions`, `POST
/sap/v2/sessions/{slot}/{connect,disconnect,pin,release}`. Capability
flag: `multi-session-pool` (added to `CAPABILITIES`).

### Validation harness — local results

```
cargo check --workspace                            ✓
cargo check --workspace --all-targets --all-features ✓
cargo clippy --workspace --all-targets --all-features --no-deps -- -D warnings ✓
cargo test --workspace --no-fail-fast              ✓ (24 tests passing)
cargo fmt --check                                  ✓
cargo check --target x86_64-pc-windows-msvc        agent-types + agent-rpc ✓; ring-using crates fail at C SDK link (expected — host-cross-compile linker issue, NOT a syntax issue)
```

Test counts: `agent-rpc` 2 (integration), `agent-types` 6,
`agent-ws` 4 (3 unit + 1 watchdog integration), `agent-core` 12 (reversal + session pool).

### Coexistence with Worker C

Worker C's `agent-gui/src/main.rs` (Tauri 2 entry point) was already in
place — they wired their own `mod commands;` HTTP-loopback approach
+ background pollers for `session-state-changed`, `agent-metrics`,
`console-line:N` events. We:

- Wrote the bin-internal `commands.rs` matching the signatures their
  `tauri::generate_handler!` references (`get_session_states`,
  `connect_session`, `disconnect_session`, `list_sap_sessions`,
  `pin_sap_session`, `release_session`, `run_quick_action`,
  `get_console_tail`, `get_agent_metrics`, `get_ws_status`,
  `get_settings`, `update_settings`, `get_build_info`,
  `open_log_directory`).
- Added a separate lib-level `InProcessCommands` struct under the
  `in-process` Cargo feature so a future cutover to shared
  `Arc<AgentCore>` is a feature-flip, not a rewrite.
- Gated the bin behind `required-features = ["gui"]` so
  `cargo check --workspace` (without features) skips the Tauri
  toolchain — keeps the macOS dev-host build linker-clean.

### Open follow-ups (v2.0.1)

- `/sap/shipment-progress` returns 501 — DB read passthrough not yet wired.
- `/sap/recording/list` / `get` / `delete` return 501 — FS-only, helper integration follows in v2.0.1.
- `console_relay` daemon has the wiring but the helper hasn't been
  taught to emit `log.batch` notifications yet (Worker B).
- `job_poller` claims jobs but doesn't yet dispatch them — full
  `job_dispatch.rs` lands when Worker B publishes the helper RPC
  schema.

## Related
- [[Plan-Multi-Session-Agent-Master]] — the broader multi-session
  motivation; this PR ships the per-process equivalent of Phase A's
  worker hardening directly in Rust.
- [[Components/Omni-Agent - Headless SAP Agent]] — v1.x Python
  agent. v2 mirrors its HTTP contract; v1 stays the production agent
  while v2 bakes.
- [[Components/Rust-Work-Service]] — control plane the WS client and
  jobs proxy talk to.
- [[Implement-Resilient-Work-Service-WS-Client]] — Python WS client
  whose two-layer keepalive `agent-ws` ports to Rust.
- [[Implement-Phase10-Service-Key-First-Rollout]] — service-key 3-tier
  loader the Rust shell honours unchanged.
- [[ADR-Agent-2.0.0-Release]] — version-bump framing for the v2 line.
