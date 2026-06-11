---
tags: [type/implementation, status/active, domain/agent, domain/frontend]
created: 2026-05-21
---
# Implement — Phase B Master GUI Skeleton

## Purpose / Context

Phase B of [[Plan-Multi-Session-Agent-Master]] adds the **CustomTkinter supervisor shell** under `omni_agent/master/`. It reads [[Implement-Phase-A-Worker-Hardening]] probes (`GET /health` on `127.0.0.1:876N`) and spawns workers with Phase A env vars. Fix logic, console streaming, setup wizard, config persistence, and PyInstaller packaging are **explicitly deferred** (Phases D, C, E, F, G).

**Prerequisite:** Python **3.10+** (matches `agent.py` union syntax); master tests collect on 3.9+ but full GUI import needs `customtkinter`, `httpx`, `psutil`, `pyyaml` installed per `omni_agent/requirements.txt`.

## Details

### Package layout

| Module | Role |
|--------|------|
| `master_gui.py` | Entry: `python -m omni_agent.master.master_gui` — 1280×800, title `OmniFrame Agent Master   v2.1.0` |
| `config.py` | Load/validate `~/.omniframe/master_config.yaml`; built-in defaults (6 workers, W6 `auto_start=false`) |
| `supervisor.py` | `Popen` spawn/stop, env injection, `/shutdown` ladder, orphan `psutil` helper (Phase F) |
| `probe.py` | `ThreadPoolExecutor` + `httpx` `/health` → `queue.Queue` |
| `state.py` | `WorkerRuntimeState`, thread-safe `MasterRuntimeState` |
| `tile.py` / `layout.py` | `WorkerTile` UI + 3-column grid math |
| `theme.py` | Section 4 palette (`#10b981`, `#f59e0b`, `#f97316`, `#e11d48`, `#475569`) |
| `ports.py` | Port 8765+N allocation + conflict probe |
| `logging_setup.py` | `master.log` under configured `log_dir` |

### Spawn env (strict service-key mode)

Master injects on every spawned worker:

- `OMNIFRAME_AGENT_SELF_ID_OVERRIDE`, `OMNIFRAME_AGENT_PORT`, `OMNIFRAME_SAP_CONN_IDX`, `OMNIFRAME_SAP_SESS_IDX`
- `OMNIFRAME_AGENT_SERVICE_KEY_PATH`, `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1`
- `worker.extra_env` overlay last

### Integration seams (not implemented in B)

| Phase | Seam |
|-------|------|
| **D** | Tile `[Fix][R][Rst][C]` stubs → `pick_fix_action`; hidden `_sap_banner` in top bar |
| **C** | Bottom `Console — Phase C` frame; supervisor `_drain_to_devnull` → ring buffer readers |
| **E** | Missing config → wizard instead of built-in defaults banner |
| **F** | Settings modal stub; `find_orphan_pid` / `adopt_orphan`; YAML write-back |
| **G** | `build_exe.bat` AgentMaster target unchanged |

### Tests

`omni_agent/master/tests/` — 12 pytest cases (config, probe parsing, grid layout, thread-safe drain). `test_supervisor_spawn` skips when `psutil` not installed (CI agent env).

### Exit criteria (static verification on 2026-05-21)

1. GUI entry + window constants in `theme.py` / `master_gui.py`
2. Config path + defaults in `config.py`
3. Tiles + stubs in `tile.py`
4. Top bar + actions in `master_gui.py`
5. Spawn/stop in `supervisor.py`
6. Probe loop in `probe.py` (no `/admin/*`)
7. Executor + `queue` + `root.after(0)` marshalling
8. No Phase D/C/E/F/G logic beyond stubs/placeholders

## Related

- [[Plan-Multi-Session-Agent-Master]]
- [[Implement-Phase-A-Worker-Hardening]]
- [[Omni-Agent-System-Topology]]
