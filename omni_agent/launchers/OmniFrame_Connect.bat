@echo off
REM ============================================================================
REM OmniFrame Connect launcher — Citrix non-persistent shim.
REM
REM Same idea as OmniFrame_AgentMaster.bat. Connect is also a --windowed
REM onefile build, so we pin TEMP/TMP next to the .exe and use `start ""` so
REM the launcher cmd window closes once the GUI takes focus.
REM ============================================================================

setlocal

set "_OMNIFRAME_TMP=%~dp0_omniframe_tmp"
if not exist "%_OMNIFRAME_TMP%" mkdir "%_OMNIFRAME_TMP%" >nul 2>&1

set "TEMP=%_OMNIFRAME_TMP%"
set "TMP=%_OMNIFRAME_TMP%"

start "" "%~dp0OmniFrame_Connect.exe" %*

endlocal
