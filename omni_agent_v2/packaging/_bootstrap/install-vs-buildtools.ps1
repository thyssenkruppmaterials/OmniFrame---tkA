# Downloads and silently installs Visual Studio Build Tools 2022 with the
# VCTools workload + ARM64 toolchain + Windows 11 SDK so cargo / link.exe
# can produce native binaries on this ARM64 host.
#
# Idempotent: skips download/install if the BuildTools install path already
# contains an MSVC toolset.

param(
    [string]$InstallPath = 'C:\BuildTools',
    [string]$BootstrapUrl = 'https://aka.ms/vs/17/release/vs_BuildTools.exe'
)
$ErrorActionPreference = 'Stop'

$msvcRoot = Join-Path $InstallPath 'VC\Tools\MSVC'
if (Test-Path $msvcRoot) {
    $existing = Get-ChildItem $msvcRoot -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing) {
        Write-Host "BuildTools already present at $InstallPath ($($existing.Name))."
        Write-Host 'SKIP-INSTALL'
        exit 0
    }
}

$tmp = Join-Path $env:TEMP ('vs_BuildTools_' + [Guid]::NewGuid().ToString('N') + '.exe')
Write-Host "Downloading $BootstrapUrl -> $tmp"
Invoke-WebRequest -Uri $BootstrapUrl -OutFile $tmp -UseBasicParsing
Write-Host "Downloaded $((Get-Item $tmp).Length) bytes"

# Workloads/components for the ARM64 host:
# - VCTools workload (compiler, libs, build scripts)
# - VC.Tools.ARM64       : the ARM64 cross-tools (native build)
# - VC.Tools.x86.x64     : x64 cross-tools (so we can later cross-compile
#                          for prod Citrix without re-installing)
# - Windows11SDK.22621   : Win SDK headers/libs
# - VC.CMake.Project     : MS-provided CMake (needed by ring crate)
$args = @(
    '--quiet', '--wait', '--norestart', '--nocache',
    '--installPath', $InstallPath,
    '--add', 'Microsoft.VisualStudio.Workload.VCTools',
    '--add', 'Microsoft.VisualStudio.Component.VC.Tools.ARM64',
    '--add', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '--add', 'Microsoft.VisualStudio.Component.Windows11SDK.22621',
    '--add', 'Microsoft.VisualStudio.Component.VC.CMake.Project',
    '--includeRecommended'
)

Write-Host "Running: $tmp $($args -join ' ')"
$proc = Start-Process -FilePath $tmp -ArgumentList $args -Wait -PassThru -NoNewWindow
$code = $proc.ExitCode
Write-Host "vs_BuildTools.exe exited with $code"

Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# Exit codes:
#   0    -> success
#   3010 -> success, reboot required (we don't reboot here)
#   1602 -> user cancel (shouldn't happen with --quiet)
#   1618 -> another install in progress
if ($code -ne 0 -and $code -ne 3010) {
    Write-Error "BuildTools install failed: exit code $code"
    exit $code
}

if (-not (Test-Path $msvcRoot)) {
    Write-Error "Install reported success but $msvcRoot was not created."
    exit 1
}
$installed = Get-ChildItem $msvcRoot -Directory | Select-Object -First 1
Write-Host "INSTALLED-OK  $($installed.FullName)"
exit 0
