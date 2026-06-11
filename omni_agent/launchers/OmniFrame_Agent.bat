@echo off
REM ============================================================================
REM OmniFrame Agent (worker) launcher — Citrix non-persistent shim.
REM
REM Mirrors OmniFrame_AgentMaster.bat for the headless worker. The worker is
REM normally spawned by the AgentMaster (which already inherits the pinned
REM TEMP/TMP from its own launcher), so this .bat is mostly for operators who
REM run the worker standalone for diagnostics. The worker .exe is built in
REM --console mode, so we run it inline (no `start ""`) and keep this cmd
REM window open as the live log view.
REM ============================================================================

setlocal

set "_OMNIFRAME_TMP=%~dp0_omniframe_tmp"
if not exist "%_OMNIFRAME_TMP%" mkdir "%_OMNIFRAME_TMP%" >nul 2>&1

set "TEMP=%_OMNIFRAME_TMP%"
set "TMP=%_OMNIFRAME_TMP%"

"%~dp0OmniFrame_Agent.exe" %*

endlocal
