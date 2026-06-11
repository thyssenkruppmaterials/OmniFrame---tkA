---
tags: [type/implementation, status/active, domain/agent, domain/infra, domain/frontend, planning, multi-session]
created: 2026-05-14
---

# Plan — Multi-Session Agent Master Controller

> Planning document only. No application code is written or modified
> by this note. Code blocks are illustrative pseudocode. Implementation
> work is sequenced under Section 10 (Phased rollout) and gated on the
> open questions in Section 11.

## Section 1 — Context and problem statement

OmniFrame's headless SAP agent ([[Components/Omni-Agent - Headless SAP Agent]],
`omni_agent/agent.py` at v2.0.0) is **fundamentally single-session**:
the FastAPI app, the SAP COM bridge, the job poller, the WS client,
and the heartbeat thread all live in one Python process that pins to
one SAP GUI session via `(_sap_conn_idx, _sap_sess_idx)` globals
([`omni_agent/agent.py:551-580`](../../../omni_agent/agent.py)). With
the warehouse running 6 SAP sessions concurrently for multi-bay
outbound / multi-zone inventory / LX25 + LT24 + LT22 in parallel
(see [[Implementations/Implement-LX25-Inventory-Completion]] +
[[Implementations/Implement-LT22-Outbound-Import]] +
[[Implementations/Implement-LT24-History-Trail]]),
a single-session agent forces sequential execution: a long warehouse-wide
LT10 export (~30s) blocks an in-flight LT12 confirm (~3s), which blocks
a quick MMBE lookup, which blocks the next putaway auto-confirm
trigger fire. **Success** = 6 SAP windows working in parallel, one
per worker, all visible and recoverable from one local GUI; one
operator can see "5/6 healthy, 1 degraded — click Fix" without
opening Task Manager or a browser tab.

## Section 2 — Architecture overview

```
            Windows host (Citrix VDA or bare-metal)
+----------------------------------------------------------+
|                                                          |
|   +--------------------------+                           |
|   |   AgentMaster.exe (GUI)  |   CustomTkinter, 1 proc   |
|   |   - 6 tiles + top bar    |                           |
|   |   - Setup wizard         |                           |
|   |   - Spawn supervisor     |                           |
|   |   - Health probe loop    |                           |
|   |   - Console ring buffer  |                           |
|   +--------------------------+                           |
|       |          |     ^                                 |
|       |   stdout |     | HTTP 127.0.0.1:876N             |
|       v          v     |                                 |
|   +-----+   +-----+   +-----+   +-----+   +-----+   +-----+
|   | W1  |   | W2  |   | W3  |   | W4  |   | W5  |   | W6  |
|   |Agent|   |Agent|   |Agent|   |Agent|   |Agent|   |Agent|
|   |.exe |   |.exe |   |.exe |   |.exe |   |.exe |   |.exe |
|   |8765 |   |8766 |   |8767 |   |8768 |   |8769 |   |8770 |
|   +--+--+   +--+--+   +--+--+   +--+--+   +--+--+   +--+--+
|      |        |        |        |        |        |     |
|      v        v        v        v        v        v     |
|   +----------------------------------------------------+ |
|   | SAPLogon -> SAPGUI Scripting Engine                | |
|   | Children(c0).Children(s0)   <- W1                  | |
|   | Children(c0).Children(s1)   <- W2                  | |
|   | Children(c0).Children(s2)   <- W3                  | |
|   | Children(c0).Children(s3)   <- W4                  | |
|   | Children(c0).Children(s4)   <- W5                  | |
|   | Children(c0).Children(s5)   <- W6                  | |
|   +----------------------------------------------------+ |
+----------------------------------------------------------+
        |                              |
        | HTTPS (per-worker JWT)       | HTTPS (auth)
        v                              v
+----------------------+     +----------------------+
| rust-work-service    |     | Supabase             |
| (Railway, existing)  |     | (auth + Postgres +   |
| /ws + /api/v1/*      |     |  sap_agents +        |
| 6 distinct AuthN     |     |  sap_agent_jobs +    |
| identities           |     |  audit log)          |
+----------------------+     +----------------------+
        ^
        | per-org fan-out
+----------------------+
| Frontend Web App     |
| (already fleet-aware |
|  via [[Implement-    |
|  Multi-Agent-        |
|  Coordination]])     |
+----------------------+
```

### IPC choice — Master ↔ Worker

The plan **does not invent a new IPC channel**. The worker today
already exposes a complete local FastAPI on `127.0.0.1:8765`
(verified — `app = FastAPI(...)` at `omni_agent/agent.py:1677`, 50+
routes including `/health`, `/status`, `/sap/sessions`,
`/sap/select-session`, `/sap/unpin-session`, `/realtime/status`,
`/shutdown`, `/jobs/claim`, `/agent-token/check`, `/metrics`).
Master poll model:

- **Control plane** — `httpx.get(f"http://127.0.0.1:{worker.port}/health", timeout=2)` every `health_probe_interval_ms` (default 2000ms).
- **Console plane** — workers spawned via `subprocess.Popen(stdout=PIPE, stderr=PIPE, bufsize=1, text=True)`; master spawns one reader thread per worker that line-reads into a thread-safe `collections.deque(maxlen=10000)` ring buffer per worker. Buffer is consumed by the GUI's pop-out console drawer.
- **Command plane** — additive endpoints added in Phase A (`POST /admin/ws/reconnect`, `POST /admin/job/abort`); existing `POST /shutdown` (`omni_agent/agent.py:11577`) handles graceful exit.

The 6 worker FastAPIs each bind a distinct loopback port (8765-8770);
no cross-worker mesh, no shared IPC bus. This preserves the existing
HTTP contract the frontend already uses (`fetch('http://127.0.0.1:8765/health')`).

## Section 3 — SAP session assignment model

### Discovery
Master, at startup, spawns a transient **probe** (worker 1 with
`--probe-only` flag, or directly via a tiny standalone
`probe_sap_sessions.py` that imports nothing from `agent.py` and
performs only `SAPGUI.GetScriptingEngine.Children(ci).Children(si).Info`
enumeration). Probe returns the same shape today's `/sap/sessions`
returns (`omni_agent/agent.py:2555-2688`). Master shows the
discovered sessions in the setup wizard.

### Claim — recommend **static assignment**, write into config
Each worker is launched with two env vars:

```
OMNIFRAME_SAP_CONN_IDX=0
OMNIFRAME_SAP_SESS_IDX=0   # 1, 2, 3, 4, 5 for workers 2..6
```

The worker reads these at boot (Phase A change: read env before
restoring `pinned_session` from `config.json` so master-supplied
indices win) and seeds `_sap_conn_idx, _sap_sess_idx` accordingly,
then immediately calls the existing `POST /sap/select-session`
internal logic (`omni_agent/agent.py:2738-2810`) with
`pin_by_criteria=True` so the criteria-match fallback kicks in if
SAP renumbers sessions on restart.

### Static vs dynamic — recommendation

| | **Static (recommended)** | Dynamic claim |
|---|---|---|
| Setup | Wizard maps W1→sess0, W2→sess1, etc. once. Operator labels them ("Bay 1 — Outbound"). | Workers boot, master holds a lock, each worker atomically picks the first free session GUID. |
| Recovery after SAP restart | Pin-by-criteria already handles renumbering (`omni_agent/agent.py:539-580` + `Implement-SAP-Session-Pinning`). Master shows red dot, operator clicks Fix → reattach via same code path. | Dynamic discovery rerun on every worker restart; risk of two workers racing to claim the same session if the master-lock breaks. |
| Operator mental model | "W3 is always my LT22 import bay" — labels stick. | Labels float, post-it notes lie. |
| Failure modes | A worker with a closed session sits red until operator opens that session; cannot silently grab a peer's session. | Workers can silently steal sessions from each other if pin-by-criteria misfires, hijacking manual SAP work. |
| Code reuse | Reuses the existing `pinned_session` infrastructure shipped in v1.7.9. | Requires net-new "free session pool" + atomic claim code in the master. |

**Recommendation: static.** It is strictly safer (the existing
pinning guarantees from [[Implementations/Implement-SAP-Session-Pinning]]
already prevent a pinned worker from hijacking the wrong session),
matches the warehouse mental model, and reuses code that's been
in production since 2026-05-03.

### Failure detection
Worker handles COM exceptions from `Children(i)` calls today
(`omni_agent/agent.py:543-548`, `omni_agent/agent.py:2497-2512`)
and flips `state.sap_connected = False`. Phase A adds two new
booleans to `/health`: `ws_connected` (from `WorkServiceWsClient.is_connected()`,
already exists per [[Implementations/Implement-Resilient-Work-Service-WS-Client]])
and `sap_attached` (from `state.sap_connected`). Master reads
those and renders the tile color/state. **Re-attach button** on the
tile sends `POST /admin/sap/reattach` (new Phase A endpoint that
internally runs the same body as `sap_connect()` at line 2423).

## Section 4 — Master GUI design

### Framework recommendation: **CustomTkinter**

| | CustomTkinter | PyQt6 | PySide6 | DearPyGui |
|---|---|---|---|---|
| License | MIT | GPL/commercial (Riverbank) | LGPL (Qt PSF) | MIT |
| Install size (wheel) | ~1MB (depends on Tk shipped w/ CPython) | ~80MB | ~80MB | ~7MB |
| PyInstaller single-file | Trivial (Tk is in CPython stdlib) | Bulky; needs `--collect-all PyQt6`, dozens of QtCore/Gui DLLs | Same as PyQt6 | Lean, but adds C++ runtime |
| Theming | Built-in dark mode + custom JSON themes | Excellent (QSS) | Excellent (QSS) | Built-in |
| Threading model | Tk's `after()` + thread-safe `queue.Queue` is well-trodden | `QThread` + signals, robust but heavyweight | Same as PyQt6 | Single render thread; needs careful queueing |
| Native deps on Citrix | None beyond Python | C++ Qt DLLs (often blocked by Citrix CASB on managed images) | Same | C++ DearImGui DLL (smaller surface than Qt) |
| Production references | Many small ops tools | Massive ecosystem | Massive | Smaller community |

**Recommendation: CustomTkinter** for these reasons:
1. **Zero net-new native deps** — Tk ships with CPython. The Citrix
   image team already approved the agent EXE (which bundles
   `tkinter` implicitly via PyInstaller's CPython embed); the
   master adds zero new DLLs, which means **no new CASB approval**
   needed. PyQt6 / PySide6 will trigger a fresh review.
2. **PyInstaller story is the simplest** — the existing
   `build_exe.bat` (single `--onefile --console` invocation) will
   work for the master with a single new flag (`--windowed` instead
   of `--console`).
3. **Threading model matches what the agent already uses** — the
   existing `omni_agent/work_service_ws.py` and the heartbeat
   thread are stdlib `threading` + `queue.Queue` based; CustomTkinter
   plays nicely with that via `master.after(ms, fn)` for marshalling
   updates back to the Tk thread.
4. **Dark theme is one-liner** — `customtkinter.set_appearance_mode("dark")`
   + a single JSON theme file matches the slate/emerald/amber/rose
   palette of the existing web admin without writing QSS.

Trade-off acknowledged: PyQt/PySide ship more polished native
widgets (sortable tables, dockable panels). Worth revisiting if
the master grows beyond a 6-tile grid + console drawer — but for
this scope, CustomTkinter wins on shipability.

### Layout (1280×800 window, dark theme, **3×2 grid**)

3-wide × 2-tall is recommended over 2×3 because:
- a 1280px-wide window gives each tile ~420px (comfortable for a
  status pill + 2 lines of session info + 4 action buttons in a row);
- 2×3 would give 640px-wide tiles (wasted horizontal space) and
  scroll-only vertical access for tiles 5-6.

```
+---------------------------------------------------------------------------+
| OmniFrame Agent Master   v2.1.0   5/6 healthy  124 jobs/hr  2 err/hr  ... |
| [Start All]  [Stop All]  [Refresh Fleet]  [Open Logs Folder]   [Settings] |
+---------------------------------------------------------------------------+
| +------------------+ +------------------+ +------------------+            |
| | W1 Bay 1 Outbound| | W2 Bay 2 Invento.| | W3 Putaway Conf. |            |
| | (green pill)     | | (green pill)     | | (amber pill)     |            |
| | sess: PRD/800/   | | sess: PRD/800/   | | sess: PRD/800/   |            |
| |  U8206556 / LT12 | |  U8206556 / LT10 | |  U8206556 / MMBE |            |
| | hb 1s ago        | | hb 2s ago        | | hb 18s ago       |            |
| | running: TO 8801 | | idle             | | reconnecting WS  |            |
| | last err: --     | | last err: --     | | last: 429 hint   |            |
| | [Fix][R][Rst][C] | | [Fix][R][Rst][C] | | [Fix][R][Rst][C] |            |
| +------------------+ +------------------+ +------------------+            |
| +------------------+ +------------------+ +------------------+            |
| | W4 LT22 Imports  | | W5 LX25 / LT24   | | W6 Spare / Util  |            |
| | (green pill)     | | (red pill)       | | (grey pill)      |            |
| | ...              | | ...              | | (Stopped)        |            |
| | [Fix][R][Rst][C] | | [Fix][R][Rst][C] | | [Start][C]       |            |
| +------------------+ +------------------+ +------------------+            |
+---------------------------------------------------------------------------+
| Console: [W3 ▼]                                  [Pop out] [Pause] [Clear]|
| 19:43:11 [work-ws] reconnect #1 (last message 18s ago, reason=Watchdog... |
| 19:43:12 [work-ws] connected to https://...                               |
| 19:43:13 [jobs] claim hit: job_id=ab...                                   |
+---------------------------------------------------------------------------+
```

Button glyphs in tile footer: **[Fix]** (primary, emerald) ·
**[R]** = Reassign Session · **[Rst]** = Restart Worker ·
**[C]** = Open Console.

### Color system

| State | Pill background | Pill text |
|---|---|---|
| Connected (green) | `#10b981` (emerald-500) | white |
| Connecting (amber) | `#f59e0b` (amber-500) | `#1e293b` (slate-800) |
| Degraded (orange) | `#f97316` (orange-500) | white |
| Disconnected (red) | `#e11d48` (rose-600) | white |
| Stopped (grey) | `#475569` (slate-600) | white |

Window background `#0f172a` (slate-900). Tile background `#1e293b`
(slate-800). Border `#334155` (slate-700). Matches the existing
web fleet card (`src/features/admin/sap-testing/components/agents-fleet-card.tsx`)
so a Citrix operator who's used both will feel at home.

### Widget table

| Widget | Type | Grid position | Refresh cadence |
|---|---|---|---|
| App title + version | `CTkLabel` | top bar, col 0 | static |
| Healthy counter | `CTkLabel` | top bar, col 1 | 1s |
| Jobs/hr rolling | `CTkLabel` | top bar, col 2 | 5s |
| Errors/hr rolling | `CTkLabel` | top bar, col 3 | 5s |
| Master uptime | `CTkLabel` | top bar, col 4 | 1s |
| Start All / Stop All / Refresh / Logs / Settings | `CTkButton` ×5 | top bar, col 5-9 | n/a |
| Tile container | `CTkFrame` (1 per worker) | 3×2 grid | structure static |
| Worker label + id | `CTkLabel` | tile row 0 | on config save |
| Status pill | `CTkLabel` w/ rounded `fg_color` | tile row 1 | 1s (driven by /health probe) |
| Session info | `CTkLabel` | tile row 2 | 2s (matches probe cadence) |
| Heartbeat age | `CTkLabel` | tile row 3 | 1s (computed `now - last_ok`) |
| In-flight job | `CTkLabel` | tile row 4 | 2s |
| Last error | `CTkLabel` truncated + "Show details" `CTkButton` | tile row 5 | on probe |
| Action buttons (Fix / Reassign / Restart / Console) | `CTkButton` ×4 | tile row 6 | n/a |
| Console drawer | `CTkTextbox` (read-only, monospaced) | bottom panel | 50ms tick (consume queue) |
| Worker selector for console | `CTkOptionMenu` | bottom-left | n/a |
| Pop out / Pause / Clear | `CTkButton` ×3 | bottom-right | n/a |

Refresh is driven by a single `Tk.after(1000, _tick)` loop that
fans out (a) cheap UI labels and (b) marshals the latest probe
snapshot from the background probe thread into the foreground via
`queue.Queue`. All HTTP calls run in a dedicated `concurrent.futures.ThreadPoolExecutor(max_workers=6)`
so a slow probe never freezes the UI.

## Section 5 — One-click Fix state machine

| Failure mode | Detection signal | Fix action |
|---|---|---|
| **A. Worker process dead** | `worker.popen.poll() is not None` (returncode set) | Master re-runs spawn step with same env + args. Within 2s. |
| **B. Worker FastAPI unresponsive** | `GET /health` returns non-2xx OR `httpx.ReadTimeout` 3× in a row (per `_consec_health_misses`) | `POST /shutdown` (existing — `omni_agent/agent.py:11577`), `Popen.wait(timeout=5)`, fall back to `Popen.kill()`, respawn. |
| **C. WS disconnected from work-service** | `/health.ws_connected == false` (new Phase A field) for >30s | `POST /admin/ws/reconnect` (new Phase A endpoint that calls `WorkServiceWsClient.stop()` + `.start()` internally). After 15s if still false → escalate to **B** (restart worker). |
| **D. SAP session not attached** | `/health.sap_attached == false` | `POST /admin/sap/reattach` (new Phase A; wraps existing `sap_connect()` body). If SAP itself is dead (the call returns `{ok: false, error: "GetObject SAPGUI failed"}`) → master shows modal "SAP GUI not running on this box. Launch SAPLogon?" with a `[Launch SAPLogon]` button that runs the configured `sap_logon_path` (settings). |
| **E. Children(i) raises COM error** | Captured in worker; logged + reflected as `/health.sap_attached=false` with a typed reason `last_sap_error: "session_index_invalid"` (new Phase A field) | Master pops "Reassign Session" dialog pre-populated with the discovered free indices from a fresh `/sap/sessions` enumeration on a healthy peer. Writes new `OMNIFRAME_SAP_SESS_IDX` into `master_config.yaml`, restarts worker. |
| **F. Service key invalid (401 from work-service)** | Worker log line `agent identity v2 rejected` parsed from console buffer OR new field `/health.identity_status: "rejected"` (Phase A) | Modal: "Service key for worker N invalid. Re-register?" with a button that opens the system browser to `https://omniframe.up.railway.app/admin/sap-testing?tab=agent-setup&register=<self_id>`. See [[Implementations/Implement-Phase10-Service-Key-First-Rollout]] §"Failure recovery" — same flow, deep-linked. |
| **G. Stale job lease** | `/health.job_age_seconds > 300` AND `/health.job_progress_unchanged_seconds > 60` (new Phase A fields, derived from `state.active_job_started_at`) | `POST /admin/job/abort` (new Phase A; calls existing `jobs_fail(job_id, step='master-fix', detail='aborted by master controller')` internal helper). The existing migration 247's `claim_sap_agent_job` lease semantics + the v1.7.0 watchdog will reconcile within 90s if the worker is still alive. |
| **H. Work-service unreachable (network split)** | All 6 workers report `ws_connected=false` simultaneously AND each one's `last_reconnect_reason` contains `OSError` or `DNS` or `TimeoutError` | Top-bar banner: "Work-service unreachable — checking network…". Each tile's Fix button rebadges to "Check Network" and opens the diagnostic dialog: DNS `resolve('rust-work-service-production.up.railway.app')` + TCP connect to 443 + `GET /health`. Surfaces the failure shape so the operator knows whether to call IT (DNS) vs Railway (service). |

### The single click — decision tree

```python
def on_fix_clicked(worker):
    snap = worker.last_health_snapshot  # never older than 2s
    if not snap.process_alive:
        return master.respawn(worker)                          # A
    if snap.http_fails >= 3:
        return master.kill_and_respawn(worker)                 # B
    if all_workers_ws_down():
        return master.show_network_diagnostic_dialog()         # H
    if snap.identity_status == "rejected":
        return master.show_reregister_modal(worker)            # F
    if not snap.sap_attached:
        return master.reattach_sap(worker)                     # D / E
    if not snap.ws_connected and snap.ws_down_seconds < 60:
        return master.send_ws_reconnect(worker)                # C step 1
    if not snap.ws_connected and snap.ws_down_seconds >= 60:
        return master.kill_and_respawn(worker)                 # C step 2
    if snap.job_age_seconds > 300 and snap.job_progress_unchanged_seconds > 60:
        return master.abort_stale_job(worker)                  # G
    return master.show_toast(worker, "Worker is healthy — no action needed")
```

The whole tree runs synchronously on the GUI thread (it's pure
local-state inspection + one HTTP call), reports outcome inline as
a toast within 10s (the longest path — kill+respawn — has a hard
5s SIGTERM grace + ~3s spawn + ~2s for first `/health` 200).

### Admin gating (Open Question Q3)

While a worker is mid-`running` (current_action.job_id set), Fix
buttons C/G are enabled but D/E/B/A prompt a confirmation modal:
"Worker is currently processing job <id> at step <step>. Restarting
will fail this job (lease expires in ~90s, peer worker can retake).
Proceed?" Eligible-to-decide rests with the user — see Section 11.

## Section 6 — Identity and service key management

### Naming convention
Each worker's stable id: `<COMPUTERNAME>-W<1..6>`. Example on
Citrix box `CITRIX01`: `CITRIX01-W1`, `CITRIX01-W2`, …, `CITRIX01-W6`.

Worker reads this from env at boot:

```
OMNIFRAME_AGENT_SELF_ID_OVERRIDE=CITRIX01-W1
```

Phase A change to `_agent_self_id()` at `omni_agent/agent.py:4603`:
honour the env override before computing the default. The default
remains `<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>` for back-compat
with operators who still run a single Agent.exe directly.

### Per-worker service key paths
Master sets per-worker:

```
OMNIFRAME_AGENT_SERVICE_KEY_PATH=%USERPROFILE%\.omniframe\agents\W1\agent_service_key.txt
```

Worker's existing 3-tier loader (slot #1 env, slot #2 canonical
path, slot #3 alongside-exe — see
[[Implementations/Implement-Phase10-Service-Key-First-Rollout]]
§"Persistence across rebuilds") handles this **today** with no code
change because `OMNIFRAME_AGENT_SERVICE_KEY_PATH` is already a slot-#2
override (confirmed `omni_agent/agent.py:927`, line 1141). Master
just sets it to a per-worker subfolder.

### First-Run Setup Wizard

A `CustomTkinter.CTkToplevel` modal that runs when
`%USERPROFILE%\.omniframe\master_config.yaml` doesn't exist OR
when any worker's `agent_service_key.txt` is missing. Steps:

1. **Welcome** — explains "we'll set up 6 workers and register each one as a fleet member."
2. **Probe SAP** — runs the standalone probe script; shows the detected sessions; if <6, warns "Only N sessions detected. Open N more in SAPLogon and rescan."
3. **Pair workers to sessions** — shows a 6-row table: `[Worker]  [Label (editable)]  [SAP session ▾]  [Auto-start ☑]`. Defaults: W1→sess0, W2→sess1, etc., labels prefilled "Bay N — Generic", auto-start all checked.
4. **Register identities** — for each worker: master inspects `%USERPROFILE%\.omniframe\agents\W<N>\agent_service_key.txt`; if missing, opens default browser to `https://omniframe.up.railway.app/admin/sap-testing?tab=agent-setup&register=<HOST>-W<N>`, then provides a paste box where operator drops the plaintext `omni_sk_*`. Master writes it to the per-worker canonical path with `0o600` semantics on POSIX (Phase A — Windows uses `icacls /inheritance:r /grant:r` mirroring [[Implements-Phase10-Service-Key-First-Rollout]] step 3).
5. **SAPLogon launcher path** (optional) — autodetect `C:\Program Files (x86)\SAP\FrontEnd\SapGui\saplogon.exe`; allow override.
6. **Confirm + persist** — writes `master_config.yaml`, closes wizard, main window opens with all 6 workers ready to start.

The wizard is **resumable** — quitting halfway just means the next launch
detects missing keys and resumes at step 4.

## Section 7 — Configuration model

File: `%USERPROFILE%\.omniframe\master_config.yaml`. YAML chosen over
TOML/JSON for human-editability (operators do hand-edit labels).

```yaml
master:
  workers: 6                          # int [1..12]; Section 11 Q2 covers <6
  ui_refresh_ms: 1000                 # tile widgets refresh interval
  health_probe_interval_ms: 2000      # HTTP /health probe cadence
  log_retention_days: 7               # console ring buffer is in-memory; this gates the on-disk rotation
  log_dir: "%USERPROFILE%\\.omniframe\\logs"
  sap_logon_path: "C:\\Program Files (x86)\\SAP\\FrontEnd\\SapGui\\saplogon.exe"
  agent_exe_path: ""                  # blank = auto-detect next to AgentMaster.exe
  parallel_spawn_concurrency: 2       # cap concurrent Popen during Start All
  fix_admin_confirm_required: true    # see Section 5 admin-gating

workers:
  - id: CITRIX01-W1
    label: "Bay 1 — Outbound"
    sap_conn_idx: 0
    sap_session_index: 0
    auto_start: true
    health_port: 8765
    extra_env: {}                     # optional escape hatch
  - id: CITRIX01-W2
    label: "Bay 2 — Inventory"
    sap_conn_idx: 0
    sap_session_index: 1
    auto_start: true
    health_port: 8766
    extra_env: {}
  - id: CITRIX01-W3
    label: "Bay 3 — Putaway Confirm"
    sap_conn_idx: 0
    sap_session_index: 2
    auto_start: true
    health_port: 8767
    extra_env: {}
  - id: CITRIX01-W4
    label: "Bay 4 — LT22 Imports"
    sap_conn_idx: 0
    sap_session_index: 3
    auto_start: true
    health_port: 8768
    extra_env: {}
  - id: CITRIX01-W5
    label: "Bay 5 — LX25 / LT24"
    sap_conn_idx: 0
    sap_session_index: 4
    auto_start: true
    health_port: 8769
    extra_env: {}
  - id: CITRIX01-W6
    label: "Bay 6 — Spare"
    sap_conn_idx: 0
    sap_session_index: 5
    auto_start: false                 # cold spare; Start All skips
    health_port: 8770
    extra_env: {}
```

### Key-by-key documentation

| Key | Default | Edited by | Notes |
|---|---|---|---|
| `master.workers` | 6 | Setup Wizard | Range 1-12. Master constructs tiles for all configured workers, regardless of cap. |
| `master.ui_refresh_ms` | 1000 | Settings dialog | Lower bound 250ms (UI thrash); upper 5000ms (stale feel). |
| `master.health_probe_interval_ms` | 2000 | Settings dialog | Affects per-worker HTTP load + the heartbeat-age display. |
| `master.log_retention_days` | 7 | Settings dialog | Rotates files in `log_dir`; the in-memory ring buffer is fixed at 10k lines. |
| `master.log_dir` | `%USERPROFILE%\.omniframe\logs` | Settings dialog | Each worker gets `W<N>.log` rotated daily. |
| `master.sap_logon_path` | autodetect | Setup Wizard step 5 | Used by the "Launch SAPLogon" button in failure mode D. |
| `master.agent_exe_path` | blank (auto) | Settings dialog | Override only if `Agent.exe` lives somewhere other than next to `AgentMaster.exe`. |
| `master.parallel_spawn_concurrency` | 2 | Settings dialog | Caps simultaneous COM-init storms during Start All. |
| `master.fix_admin_confirm_required` | true | Settings dialog | Section 5 admin-gating toggle. |
| `workers[].id` | `<HOST>-W<N>` | Setup Wizard | Cannot rename after registration (it's the primary key in `sap_agents` + `agent_service_keys`). |
| `workers[].label` | "Bay N — Generic" | Tile context menu | Free text, ~30 chars max in UI; truncated with ellipsis. |
| `workers[].sap_conn_idx` | 0 | Reassign Session dialog | Almost always 0 on a single-tenant SAP install. |
| `workers[].sap_session_index` | N-1 | Reassign Session dialog | The COM index this worker pins on. |
| `workers[].auto_start` | true | Tile context menu | Toggles inclusion in Start All. |
| `workers[].health_port` | 8765 + N - 1 | Settings dialog | Master auto-assigns from a single base port; override only if a conflicting service squats on 8765. |
| `workers[].extra_env` | `{}` | Settings dialog raw editor | Escape hatch for `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` etc. |

## Section 8 — Process lifecycle

### Master start
1. Read `master_config.yaml`; if absent → Setup Wizard.
2. Validate (every `id` unique, every `health_port` unique, every `(sap_conn_idx, sap_session_index)` unique).
3. Initialize CustomTkinter root, render empty tiles in `Stopped` state.
4. Start single background probe thread (`concurrent.futures.ThreadPoolExecutor(max_workers=6)`).
5. For workers with `auto_start=true`: enqueue spawn jobs, capped at `parallel_spawn_concurrency=2`.
6. Start `Tk.after(1000, _ui_tick)` refresh loop.

### Worker start (per worker)
```python
env = os.environ.copy()
env["OMNIFRAME_AGENT_SELF_ID_OVERRIDE"] = w.id
env["OMNIFRAME_AGENT_SERVICE_KEY_PATH"] = canonical_key_path(w.id)
env["OMNIFRAME_AGENT_PORT"] = str(w.health_port)
env["OMNIFRAME_SAP_CONN_IDX"] = str(w.sap_conn_idx)
env["OMNIFRAME_SAP_SESS_IDX"] = str(w.sap_session_index)
env["OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY"] = "1"   # master always provisions a key
env.update(w.extra_env)

popen = subprocess.Popen(
    [str(master.agent_exe_path)],
    env=env,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    bufsize=1, text=True,
    creationflags=subprocess.CREATE_NO_WINDOW,    # Windows: hide child console
)
master.workers[w.id].pid = popen.pid
threading.Thread(target=_console_reader, args=(w.id, popen.stdout, "stdout"), daemon=True).start()
threading.Thread(target=_console_reader, args=(w.id, popen.stderr, "stderr"), daemon=True).start()
```

Phase A change to `omni_agent/agent.py:266` and `agent.py:13450`:
read `OMNIFRAME_AGENT_PORT` (default 8765) instead of hardcoded
constant. ~3 line change.

### Console streaming
Each `_console_reader` thread does:

```python
for line in stream:                       # blocks on \n, returns one line at a time
    ts = datetime.utcnow().isoformat()
    entry = {"ts": ts, "stream": which, "line": line.rstrip("\n")}
    worker.console_buffer.append(entry)   # collections.deque(maxlen=10000)
    worker.console_queue.put_nowait(entry)  # for live drawer; bounded queue
```

UI tick consumes `console_queue` (the live tail) and appends to the
`CTkTextbox` selectively (only the worker currently shown in the
console selector). The full ring buffer is what "Pop out" snapshots
into a separate `CTkToplevel`. **Log rotation**: a fourth thread per
worker tails the ring buffer and rotates to `log_dir/W<N>-YYYY-MM-DD.log`
hourly (or on size > 10MB).

### Master shutdown
On Ctrl+C, `WM_DELETE_WINDOW`, or system shutdown:
1. UI shows "Shutting down…" overlay; Start All / Stop All disabled.
2. For each worker (parallel): `POST /shutdown` (existing endpoint, `omni_agent/agent.py:11577`); 5s grace.
3. `Popen.wait(timeout=5)`; any still alive get `Popen.terminate()`; final 2s grace; `Popen.kill()` as last resort.
4. Console reader threads exit naturally when streams close (daemon=True ensures no hang).
5. Flush remaining log buffer to disk; close UI.

### Crash recovery — orphan adoption
If the master crashes (UI Tk loop dies), the workers keep running
because they are standalone `Agent.exe` processes with no IPC
dependency on the master. On master restart:

1. Read `master_config.yaml`.
2. For each configured worker, attempt `GET http://127.0.0.1:{w.health_port}/health` with 1s timeout.
3. If 200 OK and the body's `agent_id` matches `w.id`: **adopt** — bind the existing `Popen`-less state (master can't recover the original `popen` handle; falls back to `psutil.process_iter()` filtering by command line `Agent.exe` to find the pid for `kill`-on-shutdown).
4. If no response: spawn fresh per the normal start sequence.

Adopted workers can still be Stopped / Restarted via the tile —
the master kills by pid (looked up via `psutil`) rather than via
the `Popen.terminate()` it would have had if it spawned them.

## Section 9 — Packaging and distribution

### Two executables, one build script

The existing `omni_agent/build_exe.bat` produces a single
`OmniFrame_Agent.exe` via `pyinstaller --onefile --console`
(verified — lines 92-100). Phase G extends it to drive a **second**
PyInstaller invocation for `AgentMaster.exe`:

```bat
REM ============================================================================
REM Phase G — Multi-Session Master Build (additive to existing single-exe flow)
REM ============================================================================

REM Step A: existing OmniFrame_Agent.exe build (unchanged from today)
python -m PyInstaller --onefile --console --name OmniFrame_Agent ^
    --hidden-import uvicorn.logging ^
    ... ^
    agent.py

REM Step B: new OmniFrame_AgentMaster.exe build
python -m PyInstaller --onefile --windowed --name OmniFrame_AgentMaster ^
    --hidden-import customtkinter ^
    --hidden-import psutil ^
    --hidden-import httpx ^
    --hidden-import yaml ^
    --collect-data customtkinter ^
    --icon master_icon.ico ^
    master_gui.py

REM Step C: SHA-256 sidecar for the new exe too
certutil -hashfile dist\OmniFrame_AgentMaster.exe SHA256 > "%TEMP%\master_hash.txt"
... (mirror the existing OmniFrame_Agent.exe.sha256 logic)
```

`master_gui.py` lives at `omni_agent/master/master_gui.py` (new
folder under `omni_agent/`). It imports only:
- `customtkinter`, `tkinter`
- `httpx` (sync client for /health probes)
- `psutil` (orphan adoption + kill)
- `pyyaml` (config)
- Python stdlib (`subprocess`, `threading`, `queue`, `collections`, `logging`, `pathlib`, `webbrowser`, `socket`)

**No new runtime dep on the agent process** — the agent stays
exactly as it is today (with the small Phase A additive endpoints).

### Resulting `dist/` layout
```
dist/
├── OmniFrame_Agent.exe              <- existing, unchanged
├── OmniFrame_Agent.exe.sha256       <- existing
├── OmniFrame_AgentMaster.exe        <- NEW
├── OmniFrame_AgentMaster.exe.sha256 <- NEW
├── master_icon.ico                  <- NEW (bundled in --icon arg)
└── agent_service_key.txt            <- conditional (existing hot-fix logic; harmless when running master)
```

The master locates `Agent.exe` via `os.path.dirname(sys.executable)`
+ `/OmniFrame_Agent.exe`, so dropping the zip into any folder
works. The setup wizard exposes an override field for unusual
installs.

### Backward compatibility
A user who just wants the legacy single-agent experience launches
`OmniFrame_Agent.exe` directly, ignoring the master. Phase A
endpoints (`/admin/ws/reconnect`, `/admin/job/abort`,
`/admin/sap/reattach`) are additive — they exist whether or not the
master is running. The `OMNIFRAME_AGENT_PORT` env var defaults to
8765 (unchanged), so a single-exe launch keeps the existing port
contract the web app relies on.

## Section 10 — Phased rollout

| Phase | Effort | Risks | Exit criteria |
|---|---|---|---|
| **A — Worker hardening** | **S** | Tiny — all additive endpoints, no contract change | (1) `/admin/ws/reconnect` returns 200 and triggers a measurable WS reconnect (verified via `last_message_received_at` jump). (2) `/admin/job/abort` PATCHes the row to `failed` with step `master-abort`. (3) `/admin/sap/reattach` works. (4) `/health` exposes `ws_connected`, `sap_attached`, `job_age_seconds`, `job_progress_unchanged_seconds`, `identity_status`. (5) `OMNIFRAME_AGENT_PORT` + `OMNIFRAME_AGENT_SELF_ID_OVERRIDE` + `OMNIFRAME_SAP_CONN_IDX` / `OMNIFRAME_SAP_SESS_IDX` env vars honoured at boot. (6) `_agent_self_id()` consults the override before computing the default. (7) AGENT_VERSION bumped to 2.1.0 with full capabilities list extended. (8) Existing single-agent flow unchanged on the existing `127.0.0.1:8765` port. |
| **B — Master GUI skeleton** | **M** | Tk + CustomTkinter version mismatch in PyInstaller bundle; resolve early with a small smoke test EXE | (1) `OmniFrame_AgentMaster.exe` launches on a clean Windows box; 6 tiles render with stub data. (2) Reading `master_config.yaml`. (3) Start All / Stop All spawn / kill processes via `Popen`. (4) `/health` probe loop fills tile state correctly. (5) No Fix logic yet. (6) No console streaming yet. (7) Refresh cadence + threading model verified — UI doesn't freeze under 6 concurrent probe timeouts. |
| **C — Console streaming + ring buffer** | **S** | Encoding pitfalls — Windows console default cp1252 vs the agent's emoji-free utf-8 prints. Solve with `creationflags=CREATE_NO_WINDOW` and explicit `encoding="utf-8", errors="replace"` on Popen pipes | (1) Selected worker's last 200 lines visible in drawer. (2) Pop-out detached window. (3) Pause + Clear work. (4) On-disk log rotation in `log_dir`. (5) No leaks: starting + stopping a worker 50× doesn't grow master memory by >100MB. |
| **D — One-click Fix state machine** | **M** | Wrong action selected silently — needs the tree to be unit-testable. Mitigation: extract `pick_fix_action(snap) -> Action` as a pure function | (1) Each of the 8 failure modes triggers the correct recovery, verified by injecting fault into a test worker. (2) Toast confirmation shown within 10s on every path. (3) Admin-confirm modal honoured when `fix_admin_confirm_required=true`. (4) `WS unreachable` mode H surfaces the diagnostic dialog. |
| **E — First-Run Setup Wizard** | **M** | The browser-roundtrip for service-key registration depends on the existing admin UI staying stable. No FE change needed but the deep-link URL must be stable | (1) Fresh box (no `master_config.yaml`, no `.omniframe\agents\`) → wizard guides through SAP probe + 6 paired sessions + 6 key registrations + SAPLogon path. (2) Resumable — close + relaunch starts at the right step. (3) Per-worker key file ends up at `%USERPROFILE%\.omniframe\agents\W<N>\agent_service_key.txt` with restricted ACL. |
| **F — Config persistence + orphan adoption** | **S** | `psutil` cross-version quirks on the locked-down Citrix image; might need to bundle a specific version | (1) Master crash + restart re-discovers all running workers via port probes. (2) Adopted worker is killable via tile (uses pid from `psutil`). (3) Settings dialog persists edits + warns about restart-required changes (port + sap indices). |
| **G — Packaging, dual-exe PyInstaller, internal QA** | **M** | Citrix CASB approval cycle for the new EXE (no new native deps, so should be a rubber-stamp, but allow 1 week). PyInstaller bundle size growth from CustomTkinter assets | (1) `build_exe.bat` produces both exes in `dist/`. (2) Operator can copy `dist/` to a clean 6-session SAP host, run wizard, and have all 6 workers green within 10 minutes. (3) SHA-256 sidecars uploaded to Supabase Storage `downloads` bucket alongside the existing single-agent zip. |

Effort legend: **S** = ≤2 dev-days, **M** = 3-7 dev-days, **L** = 1-2 weeks.

## Section 11 — Risks and open questions

1. **Q1 — CustomTkinter license confirmation.** CustomTkinter is
   MIT (verified upstream as of 2026-05-14); proceed. Flag only as
   a sanity check before Phase B.
2. **Q2 — Graceful support for <6 workers?** Recommend **yes**.
   The setup wizard caps at `master.workers` (default 6, min 1,
   max 12). A small warehouse with 2 SAP sessions configures
   `master.workers: 2` and only sees 2 tiles. Confirm operator
   wants this knob before Phase B.
3. **Q3 — Should Fix actions be admin-only when the worker is
   mid-job?** Recommend **yes by default**, with
   `master.fix_admin_confirm_required` toggle for ops who'd rather
   keep one-click semantics. User decision needed before Phase D.
4. **Q4 — Should the master surface the existing Putaway backfill
   alert?** Recommend **yes** — fold it into the per-tile error
   row when migration 289's `backfill_pending_putaway_confirms`
   metric reports a backlog older than 30 min (visible via a thin
   query proxied through the worker's existing
   `/sap/shipment-progress`-style read path; specific endpoint
   added in Phase A if user wants this in v1). Defer to Phase D
   follow-up.
5. **Q5 — sapgui restart hot-swap.** When SAP GUI is restarted (the
   most common operator action that breaks all 6 workers at once),
   what should the master do? **Recommend: detect via mass
   `sap_attached=false` across all 6 simultaneously → top-bar
   banner "SAP GUI restart detected — workers will reattach
   automatically when sessions reappear" → no individual Fix
   prompts spam.** Behaviour decision needed before Phase D.
6. **Q6 — Per-worker `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1`
   default.** Master always provisions keys, so it should default
   to 1 for spawned workers. But this means a worker spawned with
   a deleted-on-disk key exits 78 instead of falling back. Confirm
   user wants strict mode by default (recommended) — see
   [[Implementations/Implement-Phase10-Service-Key-First-Rollout]]
   §"Checkpoint B" for the gradual-rollout precedent.
7. **R1 — COM init storm.** Spawning 6 workers in parallel each
   doing `pythoncom.CoInitialize()` + `GetObject("SAPGUI")` can
   stress the SAP COM bridge. Mitigated by
   `parallel_spawn_concurrency=2` cap; verify under load in
   Phase G QA.
8. **R2 — Citrix profile drift across boxes.** Different Citrix
   images mount `%USERPROFILE%` differently. The Phase 10 runbook
   already calls this out; the master per-worker subfolder
   (`agents/W<N>/`) inherits the same caveats. Document in
   Section 6's setup wizard step 4.
9. **R3 — Cross-fleet visibility.** The frontend's existing fleet
   card already shows 6 distinct `sap_agents` rows once each
   worker registers; no FE change required to see them.

## Section 12 — Out of scope

- **Multi-host orchestration.** One master GUI per Windows host.
  Cross-host coordination remains the web admin's job
  ([[Components/Agents-Fleet-Manager]]).
- **Auto-scaling workers based on queue depth.** Manual config
  knob today (`master.workers`); auto-scaling is a future ADR.
- **Web UI changes.** The existing
  `agents-fleet-card.tsx` (per [[Implementations/Implement-Multi-Agent-Coordination]])
  already supports N agents. No FE change required in this plan.
- **Cross-worker job balancing.** The existing
  `claim_sap_agent_job` RPC (migration 247) handles fair-share via
  `FOR UPDATE SKIP LOCKED`. The master GUI is presentational +
  supervisory; it does not dispatch work.
- **Rust changes.** `rust-work-service` treats 6 distinct fleet
  agents identically to 1; no changes anticipated.
- **Per-worker capability differentiation.** All 6 workers share
  the same Agent.exe and thus the same `AGENT_CAPABILITIES`. If a
  future plan wants W1 to only do LT12 and W4 to only do LT22, that
  routing is the queue's job (pin via `assigned_agent_id`), not
  master's.

## Verification (per task constraints)

- ✅ `/health` endpoint exists today — `omni_agent/agent.py:2390`. Phase A is **additive** (new fields, not breaking).
- ✅ `/shutdown` endpoint exists — `omni_agent/agent.py:11577`. Master uses it before `Popen.terminate()`.
- ✅ `/sap/sessions` endpoint exists — `omni_agent/agent.py:2555` — enumerates `SAPGUI.GetScriptingEngine.Children`. Master leverages this verbatim during probe + Reassign Session.
- ✅ `/sap/select-session` endpoint exists — `omni_agent/agent.py:2738`. Master uses it to pin a worker to its assigned session.
- ✅ Worker today claims `Children(_sap_conn_idx).Children(_sap_sess_idx)` — `omni_agent/agent.py:558-580`. Globals are seeded by the existing pinning code path; the env-override in Phase A is a 3-line addition that runs before `_restore_pinned_session_indexes()`.
- ✅ `_agent_self_id()` exists at `omni_agent/agent.py:4603`; format `<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>`; honour env override in Phase A.
- ✅ `AGENT_PORT = 8765` is hardcoded at `omni_agent/agent.py:266` and `omni_agent/agent.py:13453`; Phase A reads `OMNIFRAME_AGENT_PORT` env var (default 8765).
- ✅ `build_exe.bat` uses `pyinstaller --onefile --console --name OmniFrame_Agent ... agent.py` (lines 92-100). Phase G adds a sibling invocation for the master (`--onefile --windowed --name OmniFrame_AgentMaster ... master_gui.py`) plus a SHA-256 sidecar block mirroring lines 110-122.
- ✅ Service-key 3-tier loader honours `OMNIFRAME_AGENT_SERVICE_KEY_PATH` today — `omni_agent/agent.py:927`, line 1141; no code change needed for per-worker key path.
- ✅ Resilient WS client at `omni_agent/work_service_ws.py` (per [[Implementations/Implement-Resilient-Work-Service-WS-Client]]) already exposes `last_message_received_at()`, `is_connected()`, etc. — Phase A's `/health.ws_connected` reads from these directly.

## Related

- [[Components/Omni-Agent - Headless SAP Agent]] — the worker binary this plan supervises
- [[Implementations/Implement-Multi-Agent-Coordination]] — the existing N-agent fleet primitives in the DB (migration 247) and frontend fleet card; this plan piggy-backs on those without redesign
- [[Implementations/Implement-SAP-Session-Pinning]] — the session-pinning machinery the master leverages instead of inventing a new "dynamic claim" model
- [[Implementations/Implement-Phase10-Service-Key-First-Rollout]] — the per-agent service-key runbook; master's setup wizard automates it
- [[Implementations/Implement-Rust-Work-Service-Phase10]] — service-key identity v2 (Argon2id-hashed `omni_sk_*`) used unchanged
- [[Implementations/Implement-Rust-Work-Service-Phase11]] — release boundary that ships AGENT_VERSION 2.0.0; this plan bumps to 2.1.0 in Phase A
- [[Implementations/Implement-Resilient-Work-Service-WS-Client]] — the WS client whose `is_connected()` + reconnect surface the master probes
- [[Implementations/Implement-LX25-Inventory-Completion]] — multi-session workload that motivates the plan
- [[Implementations/Implement-LT22-Outbound-Import]] — same
- [[Implementations/Implement-LT24-History-Trail]] — same
- [[Decisions/ADR-Agent-2.0.0-Release]] — release framing for the AGENT_VERSION bump in Phase A
- [[Sessions/2026-05-14]] — session log entry for this planning artifact
