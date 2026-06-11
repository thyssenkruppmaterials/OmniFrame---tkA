@echo off
setlocal EnableDelayedExpansion
pushd "%~dp0"
echo ============================================
echo  OmniFrame SAP Agent — Build .exe
echo ============================================
echo.

REM ============================================================================
REM v2.0.1 — Workspace sync guard. Phase 11 of the rust-work-service integration
REM uncovered drift between this build folder and the workspace `omni_agent/`,
REM resulting in a v1.9.0 .exe being shipped after the v2.0.0 cutover. This
REM block resyncs the seven build inputs from the workspace before invoking
REM PyInstaller so the rebuilt .exe always matches what's checked into git.
REM
REM   - Default workspace path:  \\Mac\Home\Documents\Projects\OneBoxFullStack\omni_agent
REM   - Override via env var:    set OMNIFRAME_AGENT_SOURCE=D:\path\to\workspace\omni_agent
REM   - Skip the sync entirely:  set OMNIFRAME_AGENT_SKIP_SYNC=1
REM
REM Files synced: agent.py, work_service_ws.py, lt22_import.py,
REM material_master_read.py, reversal_engine.py, requirements.txt, build_exe.bat,
REM master_icon.ico, omni_agent\master\ (Phase G), omni_agent\connect\ (Phase H.4).
REM
REM Phase G hot-fix (2026-05-21): the master EXE entry uses absolute imports
REM (from omni_agent.master.X import ...). PyInstaller resolves those at
REM analysis time only if the build folder exposes an `omni_agent` package on
REM sys.path. We therefore robocopy `master\` into `omni_agent\master\` (and
REM seed `omni_agent\__init__.py`) so `--paths .` makes `omni_agent` importable.
REM Leaving a flat `master\` at the build root would silently drop the hidden
REM imports and ship a broken EXE that crashes with `No module named 'omni_agent'`.
REM ============================================================================
if defined OMNIFRAME_AGENT_SKIP_SYNC (
    echo [sync] OMNIFRAME_AGENT_SKIP_SYNC is set — skipping workspace sync.
    echo [sync] Building from whatever sources currently live next to this script.
    goto :after_sync
)

if not defined OMNIFRAME_AGENT_SOURCE (
    set "OMNIFRAME_AGENT_SOURCE=\\Mac\Home\Documents\Projects\OneBoxFullStack\omni_agent"
)

if not exist "%OMNIFRAME_AGENT_SOURCE%\agent.py" (
    echo ERROR: Workspace source not found at:
    echo     %OMNIFRAME_AGENT_SOURCE%
    echo.
    echo Either:
    echo   - Set OMNIFRAME_AGENT_SOURCE to your workspace omni_agent folder, OR
    echo   - Set OMNIFRAME_AGENT_SKIP_SYNC=1 to build from local copies anyway.
    echo.
    pause
    exit /b 1
)

echo [sync] Mirroring workspace omni_agent ^-^> build folder
echo [sync]   source: %OMNIFRAME_AGENT_SOURCE%
echo [sync]   dest:   %CD%
robocopy "%OMNIFRAME_AGENT_SOURCE%" "%CD%" agent.py work_service_ws.py lt22_import.py material_master_read.py reversal_engine.py lx25_inventory_completion.py zmm60_lookup.py ll01_warehouse_activity_monitor.py requirements.txt build_exe.bat master_icon.ico /NJH /NJS /NDL /NP /R:2 /W:2
REM Phase G hot-fix: master\ ships under omni_agent\master\ so absolute imports resolve.
robocopy "%OMNIFRAME_AGENT_SOURCE%\master" "%CD%\omni_agent\master" /E /XD tests __pycache__ .pytest_cache /NJH /NJS /NDL /NP /R:2 /W:2
robocopy "%OMNIFRAME_AGENT_SOURCE%\connect" "%CD%\omni_agent\connect" /E /XD tests __pycache__ .pytest_cache /NJH /NJS /NDL /NP /R:2 /W:2
robocopy "%OMNIFRAME_AGENT_SOURCE%" "%CD%\omni_agent" __init__.py /NJH /NJS /NDL /NP /R:2 /W:2
REM Citrix non-persistent hot-fix (2026-05-26): pull launcher .bat shims that pin
REM TEMP/TMP next to the .exe so PyInstaller's onefile bootloader extracts into
REM the operator's deploy folder instead of a locked-down per-session %TEMP%.
REM See [[Fix-AgentMaster-Citrix-Temp-Directory]].
robocopy "%OMNIFRAME_AGENT_SOURCE%\launchers" "%CD%\launchers" /E /XD __pycache__ /NJH /NJS /NDL /NP /R:2 /W:2
set "RC=%ERRORLEVEL%"
REM robocopy returns 0 (no copy) or 1 (copied) for success; 2+ means warnings/errors.
if %RC% GEQ 8 (
    echo ERROR: robocopy failed with exit code %RC%.
    popd
    pause
    exit /b 1
)

REM Show the synced AGENT_VERSION so the operator sees what they're about to ship.
for /f "usebackq tokens=*" %%v in (`findstr /B /C:"AGENT_VERSION" agent.py`) do (
    echo [sync] %%v
    goto :after_version_print
)
:after_version_print

:after_sync
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.9+ from python.org
    popd
    pause
    exit /b 1
)

echo [1/5] Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed.
    popd
    pause
    exit /b 1
)

echo.
echo [2/5] Building OmniFrame_Agent.exe (CONSOLE mode for debugging)...
REM Console mode shows a window with live logs so users/devs can verify
REM the agent is running. Switch to --windowed for silent production builds.
REM v1.6.2: --hidden-import truststore so the corporate-SSL inject in
REM agent.py can find the package in the bundled EXE. truststore is
REM pure Python (no extra data files) so no --add-data needed.
python -m PyInstaller --onefile --console --name OmniFrame_Agent ^
    --hidden-import uvicorn.logging ^
    --hidden-import uvicorn.protocols ^
    --hidden-import uvicorn.protocols.http ^
    --hidden-import uvicorn.protocols.http.h11_impl ^
    --hidden-import uvicorn.lifespan ^
    --hidden-import uvicorn.lifespan.on ^
    --hidden-import truststore ^
    agent.py

if errorlevel 1 (
    echo ERROR: Build failed.
    popd
    pause
    exit /b 1
)

echo.
echo [3/5] Computing SHA-256 of OmniFrame_Agent.exe...
REM v2.0.1 — Operators need this hash to verify the binary published to
REM Supabase Storage matches what they just built. The certutil-formatted
REM hash is also written to dist\OmniFrame_Agent.exe.sha256 so the upload
REM pipeline can ship it next to the .exe inside the .zip.
certutil -hashfile dist\OmniFrame_Agent.exe SHA256 > "%TEMP%\omni_agent_hash.txt"
for /f "usebackq tokens=*" %%h in (`findstr /R "^[0-9a-f][0-9a-f]" "%TEMP%\omni_agent_hash.txt"`) do (
    set "AGENT_HASH=%%h"
    goto :after_hash
)
:after_hash
set "AGENT_HASH=!AGENT_HASH: =!"
> dist\OmniFrame_Agent.exe.sha256 echo !AGENT_HASH!  OmniFrame_Agent.exe
del "%TEMP%\omni_agent_hash.txt" >nul 2>&1

REM ============================================================================
REM Phase G — Multi-Session Master Build (additive; worker EXE steps above unchanged)
REM ============================================================================
echo.
echo [4/5] Building OmniFrame_AgentMaster.exe (WINDOWED — no console for GUI)...
if not exist "master_icon.ico" (
    echo ERROR: master_icon.ico not found next to build_exe.bat.
    popd
    pause
    exit /b 1
)
REM Phase G hot-fix: build entry is omni_agent\master\__main__.py (proper package
REM layout) and --paths . exposes the build root so `omni_agent.master.X`
REM absolute imports resolve at analysis time. The original `master\__main__.py`
REM entry with `--paths ..` shipped a broken EXE that crashed with
REM `ModuleNotFoundError: No module named 'omni_agent'` at runtime.
python -m PyInstaller --onefile --windowed --name OmniFrame_AgentMaster ^
    --paths . ^
    --hidden-import customtkinter ^
    --hidden-import psutil ^
    --hidden-import httpx ^
    --hidden-import yaml ^
    --hidden-import omni_agent.master.master_gui ^
    --hidden-import omni_agent.master.capabilities ^
    --collect-data customtkinter ^
    --icon master_icon.ico ^
    omni_agent\master\__main__.py

if errorlevel 1 (
    echo ERROR: OmniFrame_AgentMaster build failed.
    popd
    pause
    exit /b 1
)

echo.
echo [5/5] Computing SHA-256 of OmniFrame_AgentMaster.exe...
certutil -hashfile dist\OmniFrame_AgentMaster.exe SHA256 > "%TEMP%\omni_master_hash.txt"
for /f "usebackq tokens=*" %%h in (`findstr /R "^[0-9a-f][0-9a-f]" "%TEMP%\omni_master_hash.txt"`) do (
    set "MASTER_HASH=%%h"
    goto :after_master_hash
)
:after_master_hash
set "MASTER_HASH=!MASTER_HASH: =!"
> dist\OmniFrame_AgentMaster.exe.sha256 echo !MASTER_HASH!  OmniFrame_AgentMaster.exe
del "%TEMP%\omni_master_hash.txt" >nul 2>&1

REM ============================================================================
REM Phase H.4 — OmniFrame Connect Build (additive; worker + master steps unchanged)
REM ============================================================================
echo.
echo [6/7] Building OmniFrame_Connect.exe (WINDOWED — no console for GUI)...
python -m PyInstaller --onefile --windowed --name OmniFrame_Connect ^
    --paths . ^
    --hidden-import customtkinter ^
    --hidden-import psutil ^
    --hidden-import httpx ^
    --hidden-import yaml ^
    --hidden-import pywin32 ^
    --hidden-import omni_agent.connect.connect_gui ^
    --hidden-import omni_agent.connect.capabilities ^
    --hidden-import omni_agent.connect.self_replace ^
    --collect-data customtkinter ^
    --icon master_icon.ico ^
    omni_agent\connect\__main__.py

if errorlevel 1 (
    echo ERROR: OmniFrame_Connect build failed.
    popd
    pause
    exit /b 1
)

echo.
echo [7/7] Computing SHA-256 of OmniFrame_Connect.exe...
certutil -hashfile dist\OmniFrame_Connect.exe SHA256 > "%TEMP%\omni_connect_hash.txt"
for /f "usebackq tokens=*" %%h in (`findstr /R "^[0-9a-f][0-9a-f]" "%TEMP%\omni_connect_hash.txt"`) do (
    set "CONNECT_HASH=%%h"
    goto :after_connect_hash
)
:after_connect_hash
set "CONNECT_HASH=!CONNECT_HASH: =!"
> dist\OmniFrame_Connect.exe.sha256 echo !CONNECT_HASH!  OmniFrame_Connect.exe
del "%TEMP%\omni_connect_hash.txt" >nul 2>&1

REM ============================================================================
REM v2.0.0 post-release hot-fix (2026-05-07) — Service-key deploy convenience.
REM
REM If the operator dropped a registered `agent_service_key.txt` in this build
REM folder (the workspace robocopy whitelist intentionally omits it, so it
REM survives every rebuild), copy it into `dist\` so it sits next to the
REM freshly-built `.exe`. The agent's multi-path service-key loader (slot #3
REM in `_load_agent_service_key`) will pick it up on first run and PROMOTE
REM it to `%USERPROFILE%\.omniframe\agent_service_key.txt` — meaning the
REM agent finds the key automatically the first time it boots, and then the
REM canonical copy persists across all future .exe rebuilds.
REM
REM   - The .exe itself NEVER carries the key (the .spec passes only
REM     `agent.py`; no `--add-data`). This is per-machine convenience, NOT
REM     a bundled credential.
REM   - Distribution warning: the operator must NOT publish the .zip/.exe
REM     pair alongside `agent_service_key.txt` to a shared download. Each
REM     Citrix box gets its OWN per-agent key — see
REM     `memorybank/OmniFrame/Implementations/Implement-Phase10-Service-Key-First-Rollout.md`
REM     for the registration flow.
REM ============================================================================
REM ============================================================================
REM Stage Citrix launcher .bat shims next to the freshly-built EXEs in dist\.
REM These are the recommended double-click entry points for non-persistent VDIs
REM (the bare .exe still works on healthy machines). See header notes inside
REM each .bat for the full rationale.
REM ============================================================================
echo.
echo Staging Citrix launcher .bat files into dist\...
if not exist "launchers\OmniFrame_AgentMaster.bat" (
    echo ERROR: launchers\OmniFrame_AgentMaster.bat not found. Did the workspace sync run?
    popd
    pause
    exit /b 1
)
copy /Y "launchers\OmniFrame_AgentMaster.bat" "dist\OmniFrame_AgentMaster.bat" >nul
copy /Y "launchers\OmniFrame_Agent.bat"       "dist\OmniFrame_Agent.bat"       >nul
copy /Y "launchers\OmniFrame_Connect.bat"     "dist\OmniFrame_Connect.bat"     >nul

echo.
if exist "agent_service_key.txt" (
    copy /Y "agent_service_key.txt" "dist\agent_service_key.txt" >nul
    if errorlevel 1 (
        echo [key] WARNING: failed to copy agent_service_key.txt into dist\
    ) else (
        echo [key] Found agent_service_key.txt in build folder.
        echo [key] Copied to dist\agent_service_key.txt — agent will load on first run.
        echo [key] WARNING: do NOT distribute dist\OmniFrame_Agent.exe + agent_service_key.txt as a pair.
        echo [key]          The key is per-agent. Each Citrix box needs its own key.
    )
) else (
    echo [key] No agent_service_key.txt in build folder. Agent will run on legacy user-JWT fallback unless one is registered later.
)

echo.
echo Packaging OmniFrame_AgentMaster.zip (both EXEs + launchers + sidecars + icon)...
powershell -NoProfile -Command ^
  "Compress-Archive -Path @('dist\OmniFrame_Agent.exe','dist\OmniFrame_Agent.exe.sha256','dist\OmniFrame_Agent.bat','dist\OmniFrame_AgentMaster.exe','dist\OmniFrame_AgentMaster.exe.sha256','dist\OmniFrame_AgentMaster.bat','master_icon.ico') -DestinationPath 'dist\OmniFrame_AgentMaster.zip' -Force"
if errorlevel 1 (
    echo ERROR: failed to create dist\OmniFrame_AgentMaster.zip
    popd
    pause
    exit /b 1
)

echo.
echo Writing dist\README.txt for Connect bundle...
REM Multi-line README. Tells the Citrix operator to use the .bat launcher,
REM which is the workaround for the "Could not create temporary directory!"
REM dialog from PyInstaller's onefile bootloader on non-persistent VDIs.
> dist\README.txt echo Extract this folder, then double-click OmniFrame_Connect.bat to start OmniFrame.
>>dist\README.txt echo.
>>dist\README.txt echo The .bat launcher pins the PyInstaller bootloader's temp-extraction folder
>>dist\README.txt echo next to the .exe ("_omniframe_tmp"), which is required on Citrix non-persistent
>>dist\README.txt echo VDIs where the per-session %%TEMP%% directory is locked down or wiped.
>>dist\README.txt echo Launching OmniFrame_Connect.exe directly still works on healthy machines.

echo.
echo Packaging OmniFrame_Connect.zip (Connect + worker + launchers + sidecars + icon + README)...
powershell -NoProfile -Command ^
  "Compress-Archive -Path @('dist\OmniFrame_Connect.exe','dist\OmniFrame_Connect.exe.sha256','dist\OmniFrame_Connect.bat','dist\OmniFrame_Agent.exe','dist\OmniFrame_Agent.exe.sha256','dist\OmniFrame_Agent.bat','master_icon.ico','dist\README.txt') -DestinationPath 'dist\OmniFrame_Connect.zip' -Force"
if errorlevel 1 (
    echo ERROR: failed to create dist\OmniFrame_Connect.zip
    popd
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Build complete!
echo ============================================
echo  Worker:    dist\OmniFrame_Agent.exe
echo  Worker hash: !AGENT_HASH!
echo  Worker sidecar: dist\OmniFrame_Agent.exe.sha256
echo  Master:    dist\OmniFrame_AgentMaster.exe
echo  Master hash: !MASTER_HASH!
echo  Master sidecar: dist\OmniFrame_AgentMaster.exe.sha256
echo  Connect:   dist\OmniFrame_Connect.exe
echo  Connect hash: !CONNECT_HASH!
echo  Connect sidecar: dist\OmniFrame_Connect.exe.sha256
echo  Master bundle zip: dist\OmniFrame_AgentMaster.zip
echo  Connect bundle zip: dist\OmniFrame_Connect.zip
echo  Citrix launchers : dist\OmniFrame_AgentMaster.bat, OmniFrame_Connect.bat, OmniFrame_Agent.bat
echo ============================================
echo.
echo Distribute dist\OmniFrame_AgentMaster.zip or dist\OmniFrame_Connect.zip.
echo Tell Citrix non-persistent operators to double-click the .bat launchers
echo (they pin TEMP/TMP next to the .exe so the PyInstaller bootloader does not
echo crash with "Could not create temporary directory!"). The bare .exe still
echo works on healthy machines.
echo Legacy single-agent operators can still run OmniFrame_Agent.exe alone.
echo Post-build smoke (master): powershell -File master\build\smoke_check_master_exe.ps1
echo Post-build smoke (connect): powershell -File connect\build\smoke_check_connect_exe.ps1
echo.
popd
endlocal
pause
