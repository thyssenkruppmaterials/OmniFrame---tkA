@echo off
pushd "%~dp0"
echo ============================================
echo  OmniFrame SAP Bridge — Build .exe
echo ============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.9+ from python.org
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed.
    pause
    exit /b 1
)

echo.
echo [2/3] Building OmniFrame_SAP_Bridge.exe...
python -m PyInstaller --onefile --windowed --name OmniFrame_SAP_Bridge ^
    --add-data "requirements.txt;." ^
    onebox_sap_bridge.py

if errorlevel 1 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Build complete!
echo  Output: dist\OmniFrame_SAP_Bridge.exe
echo ============================================
echo.
echo Copy dist\OmniFrame_SAP_Bridge.exe to your Citrix desktop.
echo No Python needed on Citrix — the .exe is self-contained.
echo.
popd
pause
