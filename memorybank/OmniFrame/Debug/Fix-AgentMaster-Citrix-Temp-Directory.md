---
date: 2026-05-26
type: debug
status: status/active
domain: [domain/agent, domain/infra]
tags: [type/debug, domain/agent, domain/infra, agent, citrix, pyinstaller, packaging]
links: ["[[Implement-Phase-G-Packaging-DualExe]]", "[[Implement-Omni-Agent]]", "[[Implement-Phase10-Service-Key-First-Rollout]]"]
---

# Fix: AgentMaster crash on Citrix non-persistent — "Could not create temporary directory!"

## Symptom

Operator on a Citrix non-persistent VDI extracts `OmniFrame_AgentMaster.zip`, double-clicks `OmniFrame_AgentMaster.exe`, and immediately gets a Win32 dialog reading **"Could not create temporary directory!"**. `OmniFrame_Agent.exe` (the headless worker) exhibits the same root cause but, being a `--console` build, vanishes silently within milliseconds of launch.

## Root cause

Both EXEs are built with PyInstaller `--onefile`. At every launch, the PyInstaller bootloader extracts the bundled Python runtime + dependencies into a `_MEIxxxxxx` directory under the OS temp folder. On Windows that path is resolved via `GetTempPathW`, which honors `TMP` → `TEMP` → `USERPROFILE` in order.

In this customer's Citrix non-persistent build:

- The per-session `%TEMP%` is redirected by App Layering / Profile Management to a path that the locked-down session account cannot write to.
- Profile-management policies also wipe and recreate that path mid-session, so even when the initial mkdir succeeds, follow-up file writes fail.
- `%USERPROFILE%` is similarly redirected and read-only for the published-app account.

The bootloader hits an `mkdir` / `CreateFile` failure during extraction and aborts with the generic *"Could not create temporary directory!"* dialog before any Python code runs. There is no `master.log` entry because the failure happens in the C bootloader, not the Python entry point.

The operator's mental model is correct: in a non-persistent Citrix, the **only** guaranteed-writable persistent location is wherever the operator manually extracted the agent zip. Any solution that depends on `%TEMP%` or `%LOCALAPPDATA%` is fragile.

## Why we did not use `--runtime-tmpdir`

PyInstaller's `--runtime-tmpdir PATH` build flag pins the extraction location **statically at build time** and makes the bootloader **ignore** `TEMP/TMP` env vars (per [PyInstaller usage docs](https://pyinstaller.org/en/stable/usage.html#defining-the-extraction-location)). Considered options:

| Option | Verdict |
|--------|---------|
| `--runtime-tmpdir "."` | Relative paths resolve from the bootloader's CWD. When launched from Explorer the CWD is the .exe's folder, but a Citrix-published shortcut with no "Start in" overrides that. Fragile. |
| `--runtime-tmpdir "%LOCALAPPDATA%\OmniFrame\Temp"` | Locked / redirected in the same way `%TEMP%` is on this customer's image. |
| `--runtime-tmpdir "%OMNIFRAME_RUNTIME_TMPDIR%"` | Works *with* a launcher .bat that sets the env var, but if the operator double-clicks the .exe directly the env var is unset and Windows `ExpandEnvironmentStrings` returns the literal string `%OMNIFRAME_RUNTIME_TMPDIR%`, which the bootloader then tries to `mkdir` and fails. Worse than the status quo. |

We specifically guard against a future regression that re-adds `--runtime-tmpdir` in `omni_agent/master/tests/test_citrix_launchers_static.py::test_build_bat_does_not_use_runtime_tmpdir`.

## Fix — launcher `.bat` files that pin `TEMP/TMP` next to the `.exe`

New folder: `omni_agent/launchers/` containing three batch files:

| Launcher | Wraps | `start ""`? |
|----------|-------|-------------|
| `OmniFrame_AgentMaster.bat` | `OmniFrame_AgentMaster.exe` (`--windowed` GUI) | yes — lets the launching cmd window close behind the GUI |
| `OmniFrame_Connect.bat`     | `OmniFrame_Connect.exe` (`--windowed` GUI)     | yes — same rationale |
| `OmniFrame_Agent.bat`       | `OmniFrame_Agent.exe` (`--console` worker)     | **no** — inline run keeps the cmd window as the live log view for standalone diagnostics |

Each launcher's body is the same six-line pattern:

```batch
setlocal
set "_OMNIFRAME_TMP=%~dp0_omniframe_tmp"
if not exist "%_OMNIFRAME_TMP%" mkdir "%_OMNIFRAME_TMP%" >nul 2>&1
set "TEMP=%_OMNIFRAME_TMP%"
set "TMP=%_OMNIFRAME_TMP%"
[start ""] "%~dp0OmniFrame_<Variant>.exe" %*
endlocal
```

`%~dp0` expands to the launcher's own directory (with trailing `\`), so `_omniframe_tmp` is **always** a sibling of the launcher regardless of CWD, shortcut "Start in" field, or whatever Citrix App Layering does to the session.

Key property: workers spawned by the AgentMaster's supervisor (`omni_agent/master/supervisor.py::WorkerSupervisor.spawn`) inherit the env via `os.environ.copy()`, so they pick up the pinned `TEMP/TMP` automatically. Operators only need to launch the **master** through the .bat; the worker .bat exists for the standalone-diagnostics case.

## Build/packaging changes

`omni_agent/build_exe.bat`:

1. New `robocopy` line syncs `omni_agent/launchers/` from the workspace alongside the existing `master/` and `connect/` syncs, so the shipped .bat files always match what's checked into git.
2. New "Stage Citrix launcher .bat files into dist\" block copies all three launchers from `launchers/` to `dist/` after the three EXE builds succeed.
3. Both `Compress-Archive` calls now include the matching launcher .bat file(s):
   - `OmniFrame_AgentMaster.zip` → `OmniFrame_AgentMaster.bat` + `OmniFrame_Agent.bat`
   - `OmniFrame_Connect.zip` → `OmniFrame_Connect.bat` + `OmniFrame_Agent.bat`
4. `dist\README.txt` rewritten from a one-liner to four lines that explicitly call out the launcher and the Citrix rationale.
5. End-of-build summary now lists the launchers and tells the operator to point Citrix users at the .bat.

## Tests

`omni_agent/master/tests/test_citrix_launchers_static.py` (new, 13 cases) locks in:

- Every launcher exists and is non-trivial in size.
- Every launcher pins `TEMP` and `TMP` via `%~dp0_omniframe_tmp`, mkdirs the folder, and launches the matching sibling `.exe` via `%~dp0...`.
- Windowed launchers use `start ""`; the console worker launcher does not (REM lines are filtered before the substring check so banner prose doesn't false-positive).
- `build_exe.bat` syncs `launchers/`, copies into `dist/`, includes the .bat files in both zip bundles, and does **not** add `--runtime-tmpdir` (regression guard).

Existing `test_phase_g_packaging_static.py` (6 cases) still passes — the worker/master PyInstaller invocations are unchanged.

## Verification

Operator workflow on the affected Citrix box, after rebuild:

1. Download fresh `OmniFrame_AgentMaster.zip` from Supabase Storage `downloads/`.
2. Extract anywhere persistent (the user's mapped drive or the Citrix-published app folder).
3. Double-click **`OmniFrame_AgentMaster.bat`** (not the .exe).
4. Launcher creates `_omniframe_tmp\` next to itself, exports `TEMP`/`TMP`, then `start "" OmniFrame_AgentMaster.exe`.
5. Bootloader's `GetTempPathW` returns the sibling folder, extracts `_MEIxxxxxx` there, and the AgentMaster GUI opens normally.
6. Operator hits *Run* on a worker tile; the supervisor inherits the env and spawns `OmniFrame_Agent.exe` into the same temp folder.

Hash-verify the rebuilt artifacts via the existing `master\build\smoke_check_master_exe.ps1` / `connect\build\smoke_check_connect_exe.ps1` smoke scripts — those are unchanged.

## Files touched

- `omni_agent/launchers/OmniFrame_AgentMaster.bat` (new)
- `omni_agent/launchers/OmniFrame_Agent.bat` (new)
- `omni_agent/launchers/OmniFrame_Connect.bat` (new)
- `omni_agent/build_exe.bat` (sync + stage + zip + README + summary)
- `omni_agent/master/build/README.md` (dist layout + new "Citrix non-persistent launcher .bat" section)
- `omni_agent/master/tests/test_citrix_launchers_static.py` (new)

## Related

- [[Implement-Phase-G-Packaging-DualExe]] — original two-EXE packaging
- [[Implement-Omni-Agent]] — single-EXE distribution baseline
- [[Implement-Phase10-Service-Key-First-Rollout]] — `agent_service_key.txt` distribution flow (also affected by Citrix profile redirection)
