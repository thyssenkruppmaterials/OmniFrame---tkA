@echo off
REM Wrapper that initializes the MSVC environment (so cl.exe, INCLUDE, LIB,
REM WindowsSdkDir, etc. are populated) and then invokes packaging\build.ps1.
REM
REM Defaults to the ARM64 native toolchain (this VM is ARM64 Windows). Pass
REM the first argument to override -- e.g. `run-build-msvc.cmd x64` for the
REM x86_64-on-ARM64 cross compile.

setlocal

set ARCH=%1
if "%ARCH%"=="" set ARCH=arm64

set VCVARS=
if /i "%ARCH%"=="arm64" set VCVARS=C:\BuildTools\VC\Auxiliary\Build\vcvarsarm64.bat
if /i "%ARCH%"=="x64"   set VCVARS=C:\BuildTools\VC\Auxiliary\Build\vcvarsarm64_amd64.bat
if /i "%ARCH%"=="amd64" set VCVARS=C:\BuildTools\VC\Auxiliary\Build\vcvarsarm64_amd64.bat

if not defined VCVARS (
    echo Unknown arch '%ARCH%'. Use arm64 or x64.
    exit /b 2
)

if not exist "%VCVARS%" (
    echo vcvars script not found: "%VCVARS%"
    exit /b 3
)

echo === Initializing MSVC env via %VCVARS% ===
call "%VCVARS%"
if errorlevel 1 (
    echo vcvars failed with errorlevel %errorlevel%
    exit /b %errorlevel%
)

echo === MSVC env loaded ===
echo VCINSTALLDIR=%VCINSTALLDIR%
echo VCToolsVersion=%VCToolsVersion%
echo WindowsSdkDir=%WindowsSdkDir%
echo WindowsSDKVersion=%WindowsSDKVersion%

REM Persist the cargo / python / pwsh PATH additions even after vcvars stomp
set PATH=%PATH%;C:\Users\jaisingh\.cargo\bin;C:\Users\jaisingh\AppData\Local\Python\bin;C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_arm64__8wekyb3d8bbwe

echo === Invoking build.ps1 ===
pushd C:\dev\omni_agent_v2
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\dev\omni_agent_v2\packaging\build.ps1
set RC=%errorlevel%
popd
echo === build.ps1 exited with %RC% ===
exit /b %RC%
