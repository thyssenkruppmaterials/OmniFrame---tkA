# OmniAgent v2 — Architecture

This document is the **technical companion** to the top-level
[`README.md`](../README.md). It assumes you've already read the elevator
pitch and the prerequisites — what follows is the "why each line of code
ended up where it ended up" so a new contributor (or a future you)
doesn't have to re-derive the decisions.

> A note on scope. This is an architecture document, not an ADR. The
> per-decision rationale lives in
> [`memorybank/OmniFrame/Decisions/`](../../memorybank/OmniFrame/Decisions/);
> this file aggregates the surface-level facts a developer needs to
> navigate the codebase. When two facts disagree, the ADR wins.

## Table of contents

- [Why Rust shell + Python subprocess (not single .exe)](#why-rust-shell--python-subprocess-not-single-exe)
- [Process model](#process-model)
- [JSON-RPC wire protocol](#json-rpc-wire-protocol)
- [Session pool](#session-pool)
- [Auth flow](#auth-flow)
- [Update strategy](#update-strategy)
- [Threat model](#threat-model)
- [Observability hooks](#observability-hooks)
- [File layout reference](#file-layout-reference)

## Why Rust shell + Python subprocess (not single .exe)

The obvious shape for a Windows agent is "one PyInstaller bundle, ship
it." That's what v1 did. It got us to production but the seams hurt:

1. **PyInstaller bundle size** — v1 ships ~100 MB to deliver ~650 KB of
   actual logic. The footprint is CPython + numpy + pandas + a thousand
   pages of stdlib. Even with `--exclude-module`, the bundle stays north
   of 60 MB, and the cold-start time on a Citrix VDA is ~5 seconds.
2. **GIL bottleneck on multi-session** — v1 serialised SAP COM calls
   behind a single STA thread. The asyncio event loop, the FastAPI worker,
   the WS client, the heartbeat, and the job poller all ran in one
   process competing for the GIL. Going to 6 concurrent SAP sessions
   inside one Python process meant 6× STA threads sharing one interpreter
   — viable, but every cross-thread `asyncio.run_coroutine_threadsafe`
   hop adds ~0.5–1 ms of GIL contention.
3. **Concurrency primitives** — the work-queue dispatcher (claim, lease,
   complete, retry, dead-letter) is genuinely concurrent code. In Rust
   with Tokio + `RwLock<SessionPool>` and structured concurrency, the
   state machine is a 200-line file. In Python with `asyncio.Queue` and
   manual locking, it was ~1,200 lines and shipped two race conditions
   in 2026Q1.
4. **A single .exe is a lie** — we can't really ship a single .exe
   because `pywin32`'s COM client cannot be statically linked into a
   Rust binary; it lives inside a Python interpreter that talks to
   `oleaut32.dll`. So the choice was never "Rust monolith vs Python
   monolith" — it was "Rust with embedded Python helper" vs "Python
   monolith". We picked the former.

The minor cost is a second binary (`python.exe`-like — really
`python311.exe` from the embeddable bundle) launched as a subprocess.
Net win: ~8 MB total install footprint, ~150 ms cold start, true
parallelism across 6 SAP sessions because each STA thread sees its own
Tokio task wake-up but shares the GIL only when entering Python code
(everything in the Rust core runs lock-free in async land).

## Process model

There are **three processes** in the running system:

| PID role        | Binary           | What runs there                              |
|-----------------|------------------|----------------------------------------------|
| Tauri main      | `agent-gui.exe`  | WebView2 host + Tauri runtime + a thin Rust  |
|                 |                  | layer that re-uses `agent-core` to start the |
|                 |                  | HTTP server in-proc (single-instance mode)   |
|                 |                  | or proxies to a separately-running           |
|                 |                  | `agent.exe` (split-instance mode).           |
| Headless agent  | `agent.exe`      | `agent-core::AgentRuntime` — HTTP :8765,     |
|                 |                  | WS client, session-pool state machine,       |
|                 |                  | dispatcher, auth manager, updater.           |
| Python helper   | `python311.exe`  | `sap_helper.py` — JSON-RPC server on stdio,  |
|                 |                  | 6 STA threads (one per active slot),         |
|                 |                  | `pywin32` COM bindings to SAP GUI.           |

The default deployment is **split-instance**: `agent.exe` runs at logon
(`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), and the operator
opens `agent-gui.exe` only when they want to see status / approve a
prompt. This lets the agent keep dispatching jobs while the GUI is
closed, and it lets the operator close the GUI without stopping the
agent.

Single-instance mode (the GUI hosts the core in-process) is supported
for development and for the "small site" deployment where one machine
runs everything — pass `agent-gui.exe --embed-core` to use it.

### Threading inside `agent.exe`

```
agent.exe (1 process)
├── Tokio main thread
│   ├── Axum HTTP server on :8765
│   ├── WS client to rust-work-service /ws
│   ├── Heartbeat tick (every 30s) -> POST /agents/heartbeat
│   ├── Auth refresh tick (every 540s) -> /auth/v1/token?grant_type=refresh_token
│   ├── Job dispatcher (consumes WS push, owns Slot 0..5)
│   └── Recording event stream (in-memory mpsc channel)
└── Blocking pool (rayon-style, managed by Tokio)
    └── (rarely used) — file IO for audit log batch writes
```

The Python helper is **not** modeled as Tokio tasks — it's a single
`tokio::process::Child` with bidirectional stdio. The `agent-rpc` crate
spawns one reader task that demultiplexes incoming JSON frames by
`request_id` and one writer task that owns the stdin handle.

### Threading inside `sap_helper.py`

```
sap_helper.py (1 process, 1 GIL)
├── Main thread
│   ├── RPC reader (reads stdin, parses one JSON-RPC frame per line)
│   ├── RPC writer (serialises stdout writes behind one lock)
│   └── Slot supervisor (spawns/joins STA threads on demand)
└── Slot N STA thread (one per active session, N ∈ {0..5})
    ├── pythoncom.CoInitialize(STA)
    ├── win32com.client.Dispatch("SapGui.ScriptingCtrl.1")
    ├── Per-slot inbox: queue.Queue() of (method, params, request_id)
    ├── Drains inbox, executes the COM call, pushes result back to writer
    └── pythoncom.PumpWaitingMessages() in idle loop (for COM callbacks)
```

The slot supervisor is the gatekeeper for **"which session this RPC
runs on"** — every RPC method that touches SAP carries a `slot: u8`
parameter; the supervisor routes the call to that slot's STA thread.
RPCs that don't touch SAP (e.g. `health.ping`, `version.get`) run on
the main thread directly.

## JSON-RPC wire protocol

The Rust shell talks to the Python helper over stdin/stdout using a
**line-delimited JSON-RPC 2.0** dialect. One JSON object per line, no
chunked framing, UTF-8 throughout. The choice of line-delimited (vs
length-prefixed or msgpack) is deliberate: it's trivially debuggable
with `cat helper.log`, the helper can be exercised by hand with
`echo '{...}' | python3 sap_helper.py --mock`, and the parsing overhead
is negligible for the message rates we see (peak ~50/sec).

### Request shape

```json
{
  "jsonrpc": "2.0",
  "id": "9b3e1f4a-...",          // UUID v4, set by the Rust side
  "method": "sap.execute_screen",
  "params": { /* method-specific */ }
}
```

### Success response shape

```json
{
  "jsonrpc": "2.0",
  "id": "9b3e1f4a-...",
  "result": { /* method-specific */ }
}
```

### Error response shape

```json
{
  "jsonrpc": "2.0",
  "id": "9b3e1f4a-...",
  "error": {
    "code": -32001,
    "message": "Session 3 is not in Ready state (current: Busy)",
    "data": {
      "slot": 3,
      "current_state": "Busy",
      "expected_states": ["Ready"]
    }
  }
}
```

### Notification shape (helper → core, no `id`)

Notifications are the **only** frame the helper sends without being
asked. They're used for:

- **Recording events** — `recording.event` carries a single user-visible
  action (click, key, screen-change) the SAP scripting engine emitted
  while a recording is active. The Rust core multiplexes these onto the
  in-memory mpsc and the WS push so the GUI's recording panel updates
  in real time.
- **Slot health transitions** — `slot.state_changed` fires whenever a
  slot moves between `Ready`, `Busy`, `Pinning`, `Degraded`, `Dead`.
- **Stderr/log lines** — `helper.log` carries one line of Python logging
  output the helper wants surfaced in the GUI's console ring buffer.
  (The helper also writes to its own log file; this notification is
  best-effort.)

```json
{
  "jsonrpc": "2.0",
  "method": "recording.event",
  "params": {
    "slot": 2,
    "ts_ms": 1763209102331,
    "event_type": "click",
    "control_id": "wnd[0]/usr/ctxtRLT22-LGNUM",
    "value": "WH5"
  }
}
```

### Error codes

| Code     | Meaning                                                       |
|----------|---------------------------------------------------------------|
| `-32700` | Parse error — invalid JSON on stdin.                          |
| `-32600` | Invalid request — missing `jsonrpc`, `method`, or `id`.       |
| `-32601` | Method not found — `method` not registered.                   |
| `-32602` | Invalid params — schema mismatch on the method's params.      |
| `-32603` | Internal error — uncaught Python exception, full traceback in `data.traceback`. |
| `-32001` | Slot state violation — slot not in the expected state.        |
| `-32002` | SAP COM error — pywin32 raised, error in `data.com_hresult`.  |
| `-32003` | Slot pinning failed — `Children(c).Children(s)` raised.       |
| `-32004` | Recording not active — `recording.stop` called when no recording was running. |
| `-32005` | Session not signed in — `slot.acquire` called on a slot whose SAP window is not at the SAP Easy Access screen. |

### Methods (canonical list)

The canonical method list lives in two places that **must stay in sync**:

1. **Rust** — `crates/agent-types/src/rpc.rs` `enum RpcMethod`. The
   `Display` impl on each variant is the wire method name.
2. **Python** — `python/handlers/*.py` `register(dispatcher)` functions
   that call `dispatcher.register("sap.foo", handle_foo)`.

The validation script
[`packaging/check_rpc_contract.py`](./check_rpc_contract.py) cross-checks
both lists in CI. It prints the symmetric difference and fails the build
when the two diverge.

The current (Phase 1, as of this commit) method set the Rust side declares:

```
sap.connect                        sap.confirmTo
sap.disconnect                     sap.transferInventory
sap.listSessions                   sap.binBlocks
sap.pinSession                     sap.materialMasterBin
                                   sap.materialMasterStorageTypes
sap.query.lt10                     sap.createStorageBin
sap.query.lt24                     sap.materialMasterReadBin
sap.query.mb52                     sap.materialMasterReadStorageTypes
sap.query.mmbe                     sap.processShipment
                                   sap.importLt22
sap.recording.start                sap.zmm60Lookup
sap.recording.stop                 sap.lx25Completion
sap.recording.status               sap.reversal.computeInverse
sap.recording.replay
```

The Python side adds a number of helper methods Worker A's enum has not
caught up with yet (`sap.health`, `sap.fleet`, `sap.session`,
`sap.selectSession`, `sap.unpinSession`, the recording library
`sap.recording.{list,get,delete,translate}`, `sap.shipmentProgress`,
`sap.reverseTransaction`, plus a single `sap.query` dispatcher that
fans out to the four `sap.query.*` shapes the Rust side declares).
**This is a known Phase-1 divergence** — the validation script reports
it on every run as a reminder that the workers need to converge before
the v2.0 final cut. See the "Outstanding cross-side mismatches" note
at the bottom of `packaging/check_rpc_contract.py` output for the live
list.

> The wire-spec rule: every method any side declares MUST eventually be
> declared by every other side. The script's failure is a forcing
> function, not a bug — it's there to make the divergence impossible
> to land silently.

## Session pool

The session pool is the single source of truth for **"which SAP sessions
this agent is driving right now"**. It lives in `agent-core::SessionPool`,
holds 6 slots, and exposes its state via the HTTP API as
[`GET /sap/sessions`](../crates/agent-core/src/http/sap.rs) (response
shape matches the v1 contract so the existing frontend works unchanged).

### Slot states

```
   ┌──────────┐  slot.pin_window ok    ┌──────────┐
   │          │ ─────────────────────► │          │
   │   Idle   │                        │ Pinning  │
   │          │ ◄───────────────────── │          │
   └──────────┘  slot.unpin_window     └──────┬───┘
        ▲                                     │ COM pin verified
        │                                     ▼
        │  slot.release                ┌──────────┐
        │  (slot stays Idle on hold)   │          │
        ├──────────────────────────────│  Ready   │
        │                              │          │
        │                              └─┬──────┬─┘
        │                                │      │
        │ heartbeat times out            │      │ dispatcher claims job
        ▼ (5 consecutive failed pings)   │      ▼
   ┌──────────┐                          │   ┌──────────┐
   │ Degraded │ ◄────────────────────────┘   │   Busy   │
   │          │  slot.health = error         │          │
   └────┬─────┘                              └─────┬────┘
        │                                          │ job complete
        │ session window closed                    ▼
        │ (slot.list shows slot gone) ───►   ┌──────────┐
        ▼                                    │  Ready   │
   ┌──────────┐                              └──────────┘
   │   Dead   │
   └──────────┘
```

States:

- **Idle** — slot has no SAP session pinned. Initial state of every slot
  at startup; entered after `slot.unpin_window`.
- **Pinning** — `slot.pin_window` was called and the helper is verifying
  the pin (one COM round-trip to `Children(c).Children(s).Info.User`).
- **Ready** — slot is pinned, SAP user is signed in, no job in flight.
  This is the only state from which the dispatcher will claim a job
  for this slot.
- **Busy** — dispatcher gave this slot a job. The slot stays Busy until
  the helper returns a final response (success or COM error). Heartbeat
  is suspended for slots in Busy state (the in-flight COM call would
  block the ping anyway).
- **Degraded** — 5 consecutive `slot.health` pings failed. The slot is
  no longer eligible for new jobs but the GUI tile shows a yellow warning
  and a "Recover" button. Recovery = `slot.unpin_window` → user re-pins
  via the wizard.
- **Dead** — the underlying SAP session window was closed (the helper
  detected `Children(c).Children(s)` raised). The slot is permanently
  out of the rotation until the user runs the wizard again.

### Concurrency model

- One `parking_lot::RwLock<SessionPool>` protects the slot states.
- Writers (state transitions) hold the write lock for ≤ 1 ms.
- Readers (`GET /sap/sessions`, dispatcher polling for `Ready` slots)
  take the read lock and never await across the guard.
- Each slot's STA thread on the Python side has its own
  `queue.Queue()` inbox. The Rust dispatcher writes RPC requests into
  that queue via the JSON-RPC channel; the STA thread drains
  serially. No cross-slot coordination on the Python side.

### Why 6 slots and not N?

SAP GUI Scripting Engine has a hard cap at 6 concurrent sessions per
SAP Logon connection (`Children(c).Children(0..5)`). We expose 6 slots
to match. If a future SAP release lifts the cap to 16, the change is
mechanical: bump `MAX_SLOTS` in `agent-types::constants` and add tiles
in the GUI.

## Auth flow

### Service-key onboarding (first run)

```
+----------------+    1. User pastes service key in the wizard
| Tauri wizard   |───────────────────────────────────────────────┐
+----------------+                                               │
                                                                 ▼
+----------------+    2. POST /onboard/service-key          +---------+
| Headless agent | ◄────────────────────────────────────── │ wizard  │
| (agent.exe)    |                                          │ (HTTP)  │
+-------+--------+                                          +---------+
        │ 3. Validate key format (32-byte hex, prefix `sak_`)
        ▼
+----------------+    4. POST /auth/v1/token?grant_type=password
| ServiceKey     |    body: { email: "agent+...@omniframe.app",
| loader         |            password: <key> }
+-------+--------+
        │ 5. Returns access_token (JWT, exp ≈ 60min) + refresh_token
        ▼
+----------------+    6. Encrypt service_key with AES-256-GCM,
| AuthStore      |       store at $LOCALAPPDATA\OmniFrame\Agent v2\
|                |       agent_service_key.txt (0600 perms)
+----------------+
```

The 3-tier loader (from `agent-core::auth::service_key`):

1. **Env var** — `OMNIAGENT_SERVICE_KEY` if set.
2. **File** — `config.service_key_path` if it exists and is readable.
3. **Wizard** — block on `POST /onboard/service-key`; the GUI surfaces
   the wizard step when the loader reports "not configured".

The encryption key for tier 2 is derived from
`Windows DPAPI (CryptProtectData)` on Windows and from the macOS
Keychain on the dev host. **Never** ship a shared symmetric key in the
binary; the encrypted blob is only useful on the machine that wrote it.

### Token refresh

A Tokio task runs every 540 seconds (9 minutes, well under the
60-minute Supabase JWT lifetime) and POSTs to
`/auth/v1/token?grant_type=refresh_token` with the stored refresh token.
On success, the in-memory `AuthState` swaps atomically (one `RwLock<JwtBundle>`
write).

The WebSocket client to `rust-work-service` reads the JWT via the
**`TokenProvider` trait** — not via a snapshot — so a reconnect after
a refresh always uses the freshest token. The trait shape:

```rust
#[async_trait::async_trait]
pub trait TokenProvider: Send + Sync {
    async fn current(&self) -> Result<Bearer, AuthError>;
    async fn force_refresh(&self) -> Result<Bearer, AuthError>;
}
```

A failed refresh (401, 503, network) does **not** kill the agent. The
WS task enters its exponential-backoff loop (1s, 2s, 4s, …, capped at
60s) and the `TokenProvider` re-attempts the refresh on each
reconnect. The GUI surfaces "Auth degraded" once the failure has
persisted for ≥ 60 seconds.

## Update strategy

The agent self-updates without admin rights using the
[`self_replace`](https://crates.io/crates/self-replace) crate. Flow:

1. **Manifest poll** — every 30 minutes, `agent.exe` GETs
   `https://updates.omniframe.app/agent/v2/latest.json`. The manifest
   is signed (Ed25519) by the build pipeline; the public key is
   embedded in the binary.
2. **Manifest shape**:
   ```json
   {
     "version": "2.0.1",
     "released_at": "2026-05-21T17:42:00Z",
     "channel": "stable",
     "files": [
       { "path": "agent.exe",     "sha256": "...", "size": 11_234_567 },
       { "path": "agent-gui.exe", "sha256": "...", "size":  9_876_543 },
       { "path": "python/sap_helper.py", "sha256": "...", "size": 18_421 },
       /* ... */
     ],
     "min_compat": "2.0.0",
     "signature": "ed25519:..."
   }
   ```
3. **Download** — if `manifest.version > current_version` and
   `min_compat ≤ current_version`, download every file with a mismatched
   SHA-256 into `%LOCALAPPDATA%\OmniFrame\Agent v2\pending\`.
4. **Verify** — recompute SHA-256 on the downloaded files; abort if
   any mismatch.
5. **Swap** — call `self_replace::self_replace(pending/agent.exe)` for
   the main binary; for the GUI binary and the Python files, do
   ordinary `std::fs::rename` from `pending/` into the install dir.
6. **Restart** — exit with code 0 after spawning the new `agent.exe`
   with `--just-updated`. The Windows Service Wrapper / Run-key relaunch
   handles the case where the user is not signed in.

The updater never touches `config.json` or `agent_service_key.txt`.

## Threat model

### What we defend against

- **Cross-origin browser fetch** — any web page on the host that
  attempts to `fetch('http://127.0.0.1:8765/sap/sessions')` is rejected
  by the CORS preflight (`Access-Control-Allow-Origin` only echoes
  approved origins) **and** by the Private Network Access header check
  (`Access-Control-Request-Private-Network: true` must be present and
  the requesting origin must be on the allowlist).
- **Unauthorised API calls** — every endpoint except `/health` requires
  the `X-Agent-Token` header to match `config.agent_token`. The token
  is a 32-byte hex string generated at first start and never rotated
  through the wire; it lives only in `config.json` (0600 perms) and in
  the GUI's per-session memory.
- **Disk-resident secret exfiltration** — `agent_service_key.txt` is
  encrypted at rest with the machine-bound DPAPI key (Windows) or
  Keychain item (macOS dev). Copying the file off the box and reading
  it on another machine yields ciphertext only.
- **WebView2 XSS / pivot** — the Tauri GUI's `tauri.conf.json` sets
  `app.security.csp` to a strict CSP that allows only `'self'` and
  `http://127.0.0.1:8765`. No external script or font sources.

### What we explicitly do NOT defend against

- **A malicious operator with admin rights.** If the operator can read
  raw memory, they can pull the unencrypted JWT out of `agent.exe`. We
  assume the local user is trusted; the agent ships in a managed-
  endpoint environment.
- **A compromised SAP backend.** The agent is a thin pass-through to
  the SAP scripting engine — if the backend serves a malicious screen,
  we'll dutifully type into it. Defensive read-back is the operator's
  job (and the audit log is the forensic trail).
- **Side-channel timing attacks on the agent token.** `X-Agent-Token`
  is compared with `subtle::constant_time_eq`, but the agent's HTTP
  surface is on `127.0.0.1` only — to mount a timing attack you'd need
  to already be on the box.

### Trust boundaries

```
                       ╔═══════════════════════════════════════╗
   Browser tab  ───►  ║  http://127.0.0.1:8765                ║
   Other LAN host ─X─ ║  - CORS preflight                     ║
                       ║  - PNA allowlist                      ║
   GUI WebView2 ───►  ║  - X-Agent-Token mandatory            ║
                       ╚═══════════════════════════════════════╝
                                       │
                                       ▼
                       ╔═══════════════════════════════════════╗
                       ║  agent-core (Rust)                    ║
   rust-work-service ──╣  - Bearer JWT (Supabase-issued)       ║
                       ║  - WS over TLS                        ║
                       ║  - REST over TLS                      ║
                       ╚═══════════════════════════════════════╝
                                       │
                                       ▼
                       ╔═══════════════════════════════════════╗
                       ║  sap_helper.py (subprocess, stdio)    ║
                       ║  - No network surface                 ║
                       ║  - Only parent process can talk to it ║
                       ╚═══════════════════════════════════════╝
                                       │
                                       ▼
                       ╔═══════════════════════════════════════╗
                       ║  SAP GUI Scripting Engine (COM)       ║
                       ║  - Local IPC via oleaut32             ║
                       ║  - Authenticated as the SAP user      ║
                       ╚═══════════════════════════════════════╝
```

## Observability hooks

| Surface             | What it emits                                            |
|---------------------|----------------------------------------------------------|
| `tracing` logs      | Console + rotating file at `%LOCALAPPDATA%\OmniFrame\Agent v2\logs\agent-YYYY-MM-DD.log`. Level controlled by `OMNIAGENT_LOG_LEVEL`. |
| `helper.log` notif  | Helper-emitted line buffered into the GUI console.       |
| `/metrics` (Phase 2)| Prometheus text; agent uptime, slot states, RPC latency. |
| Audit log           | Every successful SAP write inserts into Supabase `audit_log`. |

## File layout reference

> Cross-link map for navigating the repo. Maintained by hand — keep in
> sync when files move.

| File                                                | Owner    | Purpose                                       |
|-----------------------------------------------------|----------|-----------------------------------------------|
| `Cargo.toml`                                        | Worker A | Workspace manifest, pinned versions.          |
| `rust-toolchain.toml`                               | Worker A | Stable + Windows MSVC target.                 |
| `.cargo/config.toml`                                | Worker A | Build job cap; no default-target.             |
| `crates/agent-types/src/lib.rs`                     | Worker A | Module re-exports for wire types.             |
| `crates/agent-types/src/rpc.rs`                     | Worker A | `RpcMethod` enum (validated by Worker D).     |
| `crates/agent-rpc/src/lib.rs`                       | Worker A | JSON-RPC stdio client to the helper.          |
| `crates/agent-ws/src/lib.rs`                        | Worker A | WS client to rust-work-service.               |
| `crates/agent-core/src/lib.rs`                      | Worker A | Session pool, dispatcher, auth, HTTP server.  |
| `crates/agent-bin/src/main.rs`                      | Worker A | Headless binary entry point.                  |
| `crates/agent-gui/src/main.rs`                      | Worker A | Tauri entry point; spawns agent-core.         |
| `python/sap_helper.py`                              | Worker B | JSON-RPC server, slot supervisor.             |
| `python/handlers/sap_*.py`                          | Worker B | One module per `sap.*` RPC method.            |
| `python/handlers/_mocks/`                           | Worker B | Fixtures for `--mock` mode.                   |
| `python/tests/`                                     | Worker B | pytest suite, run in CI by Worker D.          |
| `gui/package.json`                                  | Worker C | Vite + React + Tauri renderer deps.           |
| `gui/src/lib/types.ts`                              | Worker C | TS mirror of `agent-types` (validated by D).  |
| `gui/src-tauri/tauri.conf.json`                     | Worker C | Tauri shell config; bundles agent-gui.        |
| `packaging/build.ps1`                               | Worker D | Windows production build (this dir).          |
| `packaging/build_macos_validate.sh`                 | Worker D | macOS validation harness.                     |
| `packaging/check_rpc_contract.py`                   | Worker D | RpcMethod ↔ Python ↔ TS cross-check.          |
| `packaging/installer/installer.iss`                 | Worker D | Inno Setup config (optional).                 |
