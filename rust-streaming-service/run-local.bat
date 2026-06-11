@echo off
echo ============================================
echo  OneBox AI Streaming Service (Local)
echo ============================================
echo.

REM ExacqVision Configuration
set EXACQ_URL=http://localhost:22609
set EXACQ_USER=tkaerospace
set EXACQ_PASSWORD=1110Smith#

REM Service Configuration
set PORT=8020
set RUST_LOG=info

echo Starting streaming service...
echo.
echo ExacqVision URL: %EXACQ_URL%
echo Listening on: http://localhost:%PORT%
echo.
echo Press Ctrl+C to stop the service.
echo.

rust-streaming-service.exe

pause
