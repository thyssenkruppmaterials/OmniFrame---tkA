---
tags: [type/implementation, status/active, domain/agent, domain/infra]
created: 2026-05-21
---

# Phase G — Packaging (Dual-EXE PyInstaller)

Phase G of [[Plan-Multi-Session-Agent-Master]] Section 9–10: additive `build_exe.bat` block builds **`OmniFrame_AgentMaster.exe`** beside the unchanged **`OmniFrame_Agent.exe`**, with SHA-256 sidecars and `dist/OmniFrame_AgentMaster.zip` for Supabase Storage distribution.

## Deliverables

| Path | Role |
|------|------|
| `omni_agent/build_exe.bat` | Steps [4/5]–[5/5] master PyInstaller + hash + zip; robocopy sync adds `master\` + `master_icon.ico` |
| `omni_agent/master_icon.ico` | PyInstaller `--icon` (from `omni_agent_v2/.../icon.ico`; swappable) |
| `omni_agent/master/__main__.py` | PyInstaller entry (`python -m omni_agent.master`) |
| `omni_agent/master/cli.py` | `--version` / `--probe-only` before Tk |
| `omni_agent/master/capabilities.py` | `AGENT_VERSION=2.1.0` + eight Phase A worker capability lines |
| `omni_agent/master/build/OmniFrame_AgentMaster.spec` | Documented equivalent of CLI invocation |
| `omni_agent/master/build/smoke_check_master_exe.ps1` | Windows post-build smoke |
| `omni_agent/master/build/README.md` | Operator runbook (build → hash → smoke → upload → rollback) |
| `omni_agent/master/pyinstaller_runtime_hook.py` | Optional CTk theme path hook (not wired) |

## PyInstaller master invocation (from `omni_agent/`)

```
--onefile --windowed --name OmniFrame_AgentMaster
--paths ..
--hidden-import customtkinter|psutil|httpx|yaml|omni_agent.master.master_gui
--collect-data customtkinter
--icon master_icon.ico
master\__main__.py
```

## CLI smoke contract

```
AGENT_VERSION=2.1.0
capability=master-controller-supported
… (8 Phase A worker capability ids)
```

`--probe-only` emits JSON from [[Implement-Phase-E-Setup-Wizard]] `sap_probe.probe_sap_sessions()`.

## Verification (macOS / CI)

- `omni_agent/master/tests/test_phase_g_packaging_static.py` — parses `build_exe.bat`
- `omni_agent/tests/test_phase_g_master_cli_flags.py` — CLI without Tk
- Full `omni_agent/master/tests/` — **186 passed, 2 skipped** (2026-05-21; same psutil skips as prior phases)

Windows: run `master\build\smoke_check_master_exe.ps1` after `build_exe.bat`.

## Distribution

Manual upload to Supabase `downloads/` — see `master/build/README.md` and [[Implement-Phase10-Service-Key-First-Rollout]]. **No** `agent_service_key.txt` in public zip.

## Known gaps

- `agent_id` on worker `/health` for stricter orphan matching (Phase A.1)
- No Authenticode signing (Plan §11 R2)
- No auto-update manifest

## Related

- [[Implement-Omni-Agent]] — legacy single-EXE runbook
- [[Implement-Phase-A-Worker-Hardening]] … [[Implement-Phase-F-Persistence-Orphan-Adoption]]
- [[Omni-Agent-System-Topology]]
- [[Fix-Agent-Distribution-Issues]]
