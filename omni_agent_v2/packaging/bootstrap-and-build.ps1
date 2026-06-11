<#
.SYNOPSIS
    OmniAgent v2 -- Parallels bootstrap + build, one-shot.

.DESCRIPTION
    Installs missing prereqs (Rust toolchain), refreshes PATH in this shell,
    and runs packaging/build.ps1. Idempotent: re-running after a successful
    install just refreshes PATH and proceeds to the build.

    The script is ASCII-only and works in both Windows PowerShell 5.1 and
    PowerShell 7+. All output is mirrored to packaging/bootstrap.log with
    timestamps so the user can paste the log back if anything fails.

.NOTES
    Run this from the repo root in either pwsh (PS 7) or powershell (PS 5.1):

        powershell -ExecutionPolicy Bypass -File .\packaging\bootstrap-and-build.ps1
        pwsh .\packaging\bootstrap-and-build.ps1

    Detected architectures:
        AMD64 -> x86_64-pc-windows-msvc
        ARM64 -> aarch64-pc-windows-msvc

    Production deploys target x86_64 Citrix, so the x86_64 target is always
    added via rustup target add after the toolchain is installed.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Paths + logging
# ---------------------------------------------------------------------------

$script:RepoRoot    = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:PackagingDir = Join-Path $RepoRoot 'packaging'
$script:LogPath     = Join-Path $PackagingDir 'bootstrap.log'
$script:BuildScript = Join-Path $PackagingDir 'build.ps1'

if (-not (Test-Path $PackagingDir)) {
    New-Item -ItemType Directory -Path $PackagingDir | Out-Null
}

# Truncate the log at the start of every run so the user sees a clean trace.
"" | Set-Content -Encoding ASCII $LogPath

function Write-Log {
    param(
        [Parameter(Mandatory)]
        [string]$Message,
        [string]$Color = 'Gray'
    )
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line = "[$ts] $Message"
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $LogPath -Value $line -Encoding ASCII
}

function Write-Section {
    param([string]$Title)
    $bar = ('=' * 70)
    Write-Log ""
    Write-Log $bar 'Cyan'
    Write-Log ("  " + $Title) 'Cyan'
    Write-Log $bar 'Cyan'
}

function Invoke-Logged {
    param(
        [Parameter(Mandatory)]
        [string]$Cmd,
        [string[]]$CmdArgs = @(),
        [string]$Cwd = $RepoRoot
    )
    $argLine = ($CmdArgs -join ' ')
    Write-Log "    > $Cmd $argLine" 'DarkGray'
    Push-Location $Cwd
    try {
        # Capture stdout+stderr line-by-line so the log gets everything.
        & $Cmd @CmdArgs 2>&1 | ForEach-Object {
            $text = $_.ToString()
            Write-Host $text
            Add-Content -Path $LogPath -Value $text -Encoding ASCII
        }
        $code = $LASTEXITCODE
        if ($null -ne $code -and $code -ne 0) {
            throw "Command '$Cmd $argLine' exited with code $code (cwd=$Cwd)"
        }
    }
    finally {
        Pop-Location
    }
}

function Refresh-Path {
    $cargoBin    = Join-Path $env:USERPROFILE '.cargo\bin'
    $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $machinePath) { $machinePath = '' }
    if (-not $userPath)    { $userPath    = '' }
    $env:Path = "$cargoBin;$machinePath;$userPath"
    Write-Log "    PATH refreshed (cargo bin: $cargoBin)" 'DarkGray'
}

# ---------------------------------------------------------------------------
# 1. Architecture detection
# ---------------------------------------------------------------------------

Write-Section '1/5  Detecting host architecture'

$hostArch = $env:PROCESSOR_ARCHITECTURE
Write-Log "    PROCESSOR_ARCHITECTURE = $hostArch" 'Green'

switch ($hostArch) {
    'AMD64' { $rustupArch = 'x86_64-pc-windows-msvc' }
    'ARM64' { $rustupArch = 'aarch64-pc-windows-msvc' }
    default {
        throw "Unsupported host architecture '$hostArch'. Expected AMD64 or ARM64."
    }
}
Write-Log "    Rustup arch slug      = $rustupArch" 'Green'

# ---------------------------------------------------------------------------
# 2. Install / verify Rust toolchain
# ---------------------------------------------------------------------------

Write-Section '2/5  Rust toolchain'

Refresh-Path

$cargoCmd = Get-Command 'cargo' -ErrorAction SilentlyContinue
if ($cargoCmd) {
    Write-Log "    cargo already on PATH: $($cargoCmd.Source)" 'Green'
}
else {
    Write-Log "    cargo not on PATH -- bootstrapping rustup-init for $rustupArch" 'Yellow'

    $rustupUrl  = "https://static.rust-lang.org/rustup/dist/$rustupArch/rustup-init.exe"
    $rustupInit = Join-Path $env:TEMP 'rustup-init.exe'
    if (Test-Path $rustupInit) { Remove-Item -Force $rustupInit }

    Write-Log "    Downloading $rustupUrl" 'Gray'
    try {
        # TLS 1.2 is the safe baseline for both PS 5.1 and PS 7 on older images.
        [Net.ServicePointManager]::SecurityProtocol = `
            [Net.SecurityProtocolType]::Tls12 -bor `
            [Net.SecurityProtocolType]::Tls11 -bor `
            [Net.SecurityProtocolType]::Tls
    } catch {
        # Best-effort: PS 7 may not let us tweak SPM, that's fine.
    }
    Invoke-WebRequest -Uri $rustupUrl -OutFile $rustupInit -UseBasicParsing
    Write-Log "    Saved rustup-init.exe ($([math]::Round((Get-Item $rustupInit).Length / 1KB, 1)) KB)" 'Green'

    Write-Log "    Running rustup-init.exe (non-interactive, stable, minimal profile)" 'Gray'
    Invoke-Logged -Cmd $rustupInit -CmdArgs @(
        '-y',
        '--default-toolchain', 'stable',
        '--profile', 'minimal',
        '--no-modify-path'
    )

    Refresh-Path

    $cargoCmd = Get-Command 'cargo' -ErrorAction SilentlyContinue
    if (-not $cargoCmd) {
        $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
        Write-Log "    cargo STILL not on PATH after install. Dumping $cargoBin :" 'Red'
        if (Test-Path $cargoBin) {
            Get-ChildItem $cargoBin -Force | ForEach-Object {
                Write-Log ("      " + $_.Name) 'Red'
            }
        } else {
            Write-Log "      (directory does not exist)" 'Red'
        }
        throw "rustup-init.exe ran but cargo is not on PATH. See $LogPath."
    }
    Write-Log "    cargo installed at $($cargoCmd.Source)" 'Green'
}

# Print versions.
Invoke-Logged -Cmd 'cargo' -CmdArgs @('--version')
Invoke-Logged -Cmd 'rustc' -CmdArgs @('--version')

# Make sure the x86_64 target is installed so the production build can
# cross-compile from ARM64 hosts and so the build.ps1 'rustup target add'
# step is a no-op.
Write-Log "    Ensuring rustup target $rustupArch + x86_64-pc-windows-msvc is installed" 'Gray'
$installedTargets = (& rustup target list --installed 2>&1) | Out-String
if ($installedTargets -notmatch [regex]::Escape('x86_64-pc-windows-msvc')) {
    Invoke-Logged -Cmd 'rustup' -CmdArgs @('target', 'add', 'x86_64-pc-windows-msvc')
} else {
    Write-Log "    x86_64-pc-windows-msvc target already installed" 'Green'
}

# ---------------------------------------------------------------------------
# 3. Verify other prereqs (node, npm, python)
# ---------------------------------------------------------------------------

Write-Section '3/5  Other prerequisites'

$missing = @()

function Check-Tool {
    param(
        [string]$Name,
        [string]$WingetId,
        [string]$VersionFlag = '--version'
    )
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Log "    MISSING: $Name -- install with 'winget install $WingetId'" 'Red'
        $script:missing += $Name
        return $null
    }
    $ver = (& $Name $VersionFlag 2>&1) | Out-String
    $verLine = $ver.Trim().Split([Environment]::NewLine)[0]
    Write-Log "    OK : $Name ($verLine)" 'Green'
    return $verLine
}

$nodeVer = Check-Tool -Name 'node'   -WingetId 'OpenJS.NodeJS.LTS'
$null    = Check-Tool -Name 'npm'    -WingetId 'OpenJS.NodeJS.LTS'
$null    = Check-Tool -Name 'python' -WingetId 'Python.Python.3.11'

# Node 20+ check (warning only -- build.ps1 will use whatever is here).
if ($nodeVer -and $nodeVer -match 'v(\d+)\.') {
    $major = [int]$Matches[1]
    if ($major -lt 20) {
        Write-Log "    WARNING: Node $major.x detected -- recommend Node 20 LTS or newer." 'Yellow'
    }
}

if ($missing.Count -gt 0) {
    $list = ($missing -join ', ')
    throw "Missing required tools: $list. Install them (see messages above) and re-run."
}

# ---------------------------------------------------------------------------
# 4. Sanity check: build script exists
# ---------------------------------------------------------------------------

Write-Section '4/5  Locating packaging/build.ps1'

if (-not (Test-Path $BuildScript)) {
    throw "Expected build script not found: $BuildScript"
}
Write-Log "    Found $BuildScript" 'Green'

# ---------------------------------------------------------------------------
# 5. Invoke build.ps1
# ---------------------------------------------------------------------------

Write-Section '5/5  Invoking packaging/build.ps1'

$buildExit = 0
try {
    # Run via the same host so PS 5.1 users get PS 5.1 build behaviour and
    # PS 7 users get PS 7 -- the build script is compatible with both.
    Invoke-Logged -Cmd 'powershell' -CmdArgs @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $BuildScript
    )
}
catch {
    $buildExit = 1
    Write-Log "    build.ps1 FAILED: $($_.Exception.Message)" 'Red'
    Write-Log "    See $LogPath for the full trace." 'Red'
}

if ($buildExit -eq 0 -and $LASTEXITCODE) {
    $buildExit = $LASTEXITCODE
}

Write-Section 'Bootstrap complete'
Write-Log "    bootstrap.log : $LogPath" 'Cyan'
Write-Log "    build exit    : $buildExit" 'Cyan'

exit $buildExit
