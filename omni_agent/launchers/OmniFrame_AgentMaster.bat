@echo off
REM ============================================================================
REM OmniFrame AgentMaster launcher — Citrix non-persistent shim.
REM
REM PyInstaller's --onefile bootloader extracts its _MEIxxx payload to %TEMP%
REM at launch. In Citrix non-persistent VDIs the per-session %TEMP% is often:
REM   * redirected to a locked-down or read-only profile path,
REM   * wiped mid-session by profile-management tools, or
REM   * absent entirely (the dialog shows "Could not create temporary directory!").
REM
REM This wrapper pins TEMP/TMP to "_omniframe_tmp" next to itself BEFORE the
REM .exe starts. The bootloader's GetTempPathW then picks up our path, so the
REM extraction always lands in the folder the operator already extracted the
REM zip into — guaranteed-writable on every Citrix box. Workers spawned by the
REM AgentMaster inherit this env, so the supervisor's child .exes also use it.
REM ============================================================================

setlocal

set "_OMNIFRAME_TMP=%~dp0_omniframe_tmp"
if not exist "%_OMNIFRAME_TMP%" mkdir "%_OMNIFRAME_TMP%" >nul 2>&1

set "TEMP=%_OMNIFRAME_TMP%"
set "TMP=%_OMNIFRAME_TMP%"

REM `start ""` returns immediately so the launching cmd window closes cleanly
REM after the GUI takes focus. Double-clicking the .bat from Explorer behaves
REM identically to double-clicking the .exe used to before the fix.
start "" "%~dp0OmniFrame_AgentMaster.exe" %*

endlocal
