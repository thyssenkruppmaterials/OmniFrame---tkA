@echo off
echo ============================================
echo  OmniFrame Streaming Service (Local)
echo ============================================
echo.

rem 
REM Service Configuration
set PORT=8020
set RUST_LOG=info

echo Starting streaming service...
echo.
echo Listening on: http://localhost:%PORT%
echo.
echo Press Ctrl+C to stop the service.
echo.

rust-streaming-service.exe

pause
