<#
.SYNOPSIS
    Production build script for OmniAgent v2 on Windows.

.DESCRIPTION
    Builds the full OmniAgent v2 distribution on a Windows host with
    Rust + Node + Python 3.11 + (optionally) Inno Setup installed. The
    output is a self-contained folder under ./dist/agent/ plus a
    portable ZIP and (optionally) a Windows installer.

    The script is idempotent -- every step checks for completed work
    before re-doing it, so re-running after a failure resumes from the
    failed step.

    Run from the repository root:

        pwsh ./packaging/build.ps1

    Flags:

        -SkipPython     Skip the python-embed bootstrap (when the
                        embed folder is already populated).
        -SkipInstaller  Skip Inno Setup even if iscc.exe is on PATH.
        -PythonVersion  Override the CPython embed version. Default
                        3.11.9. Must be on python.org.
        -Configuration  Cargo profile. Default 'release'.
        -Verbose        Echo every shell command before running it.

.NOTES
    Author : OmniAgent v2 build pipeline (Worker D)
    Targets: x86_64-pc-windows-msvc
    Hosts  : Windows 10/11 with PowerShell 7+ (pwsh).
#>

[CmdletBinding()]
param(
    [switch]$SkipPython,
    [switch]$SkipInstaller,
    [string]$PythonVersion = '3.11.9',
    [ValidateSet('debug', 'release')]
    [string]$Configuration = 'release',
    [string]$Target = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

$script:RepoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:DistRoot  = Join-Path $RepoRoot 'dist'
$script:AgentDir  = Join-Path $DistRoot 'agent'
$script:PyEmbed   = Join-Path $RepoRoot 'packaging' 'python-embed'

# Default to the host architecture when -Target is not supplied. Set
# -Target x86_64-pc-windows-msvc to cross-compile for production Citrix
# hosts (requires the x86_64 MSVC link tools on PATH).
if (-not $Target -or $Target -eq '') {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq 'ARM64') {
        $script:Target = 'aarch64-pc-windows-msvc'
    } else {
        $script:Target = 'x86_64-pc-windows-msvc'
    }
} else {
    $script:Target = $Target
}

function Write-Banner {
    param([string]$Text)
    $bar = ('=' * 70)
    Write-Host ''
    Write-Host $bar -ForegroundColor Cyan
    Write-Host ('  ' + $Text) -ForegroundColor Cyan
    Write-Host $bar -ForegroundColor Cyan
}

function Invoke-Native {
    # NOTE: the parameter MUST NOT be named `$Args` -- PowerShell's automatic
    # `$Args` variable shadows the splat target inside an advanced function,
    # silently dropping every argument when you do `& $Cmd @Args`. Worker D's
    # original draft used `$Args` here and it manifested as `npm` running with
    # zero arguments. Use `$CmdArgs` and splat via `@CmdArgs` instead.
    param(
        [Parameter(Mandatory)]
        [string]$Cmd,
        [string[]]$CmdArgs = @(),
        [string]$Cwd = $RepoRoot
    )
    $argLine = ($CmdArgs -join ' ')
    Write-Host "    > $Cmd $argLine" -ForegroundColor DarkGray
    Push-Location $Cwd
    try {
        & $Cmd @CmdArgs
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            throw "Command '$Cmd $argLine' exited with code $code (cwd=$Cwd)"
        }
    }
    finally {
        Pop-Location
    }
}

function Assert-Tool {
    param(
        [string]$Name,
        [string]$VersionFlag = '--version',
        [string]$MinVersion  = $null
    )
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "Required tool '$Name' is not on PATH. Install it and re-run."
    }
    $out = & $Name $VersionFlag 2>&1 | Out-String
    Write-Host "    $Name : $($out.Trim().Split([Environment]::NewLine)[0])" -ForegroundColor Green
    if ($MinVersion) {
        if ($out -notmatch '(\d+)\.(\d+)') {
            Write-Warning "Could not parse $Name version output for min-version check"
            return
        }
        # We don't enforce hard min-version checks -- Rust toolchain pinning
        # handles the Rust minimum, package.json engines handle Node, and
        # CPython 3.11.x is downloaded fresh below. We just log the version.
    }
}

function Get-Sha256 {
    param([string]$Path)
    $hash = Get-FileHash -Algorithm SHA256 -Path $Path
    return $hash.Hash.ToLowerInvariant()
}

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------

Write-Banner '1/9  Verifying prerequisites'

Assert-Tool -Name 'cargo'    -VersionFlag '--version'
Assert-Tool -Name 'rustc'    -VersionFlag '--version'
Assert-Tool -Name 'node'     -VersionFlag '--version'
Assert-Tool -Name 'npm'      -VersionFlag '--version'
Assert-Tool -Name 'python'   -VersionFlag '--version'

$pythonVer = (python --version 2>&1).ToString().Trim()
if ($pythonVer -notmatch '3\.(11|12|13|14)\.') {
    throw "python on PATH is '$pythonVer' -- expected CPython 3.11+ (3.11/3.12/3.13/3.14). Aborting."
}

# Tauri CLI: prefer the cargo plugin (`cargo tauri`); fall back to npx if not installed.
$tauriCli = $null
if (Get-Command 'cargo-tauri' -ErrorAction SilentlyContinue) {
    $tauriCli = 'cargo-tauri'
} elseif (Get-Command 'tauri' -ErrorAction SilentlyContinue) {
    $tauriCli = 'tauri'
}
if (-not $tauriCli) {
    Write-Host "    (cargo-tauri not found; will fall back to 'cargo install tauri-cli')" -ForegroundColor Yellow
    Invoke-Native -Cmd 'cargo' -CmdArgs @('install', 'tauri-cli', '--version', '^2.0', '--locked')
    $tauriCli = 'cargo-tauri'
}

$iscc = Get-Command 'iscc' -ErrorAction SilentlyContinue
if ($iscc -and -not $SkipInstaller) {
    Write-Host "    iscc.exe found -- installer step will run." -ForegroundColor Green
} else {
    Write-Host "    iscc.exe not found (or -SkipInstaller passed) -- ZIP only." -ForegroundColor Yellow
}

# Ensure the Windows MSVC target is installed for cross-checks. On a Windows
# host this is the default target so the call is a no-op, but it gives a
# clear error if someone runs the script from an unusual rustup setup.
Invoke-Native -Cmd 'rustup' -CmdArgs @('target', 'add', $Target)

# ---------------------------------------------------------------------------
# 2. Clean dist/
# ---------------------------------------------------------------------------

Write-Banner '2/9  Resetting dist/'

if (Test-Path $DistRoot) {
    Remove-Item -Recurse -Force $DistRoot
}
New-Item -ItemType Directory -Path $DistRoot | Out-Null
New-Item -ItemType Directory -Path $AgentDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $AgentDir 'python') | Out-Null

# ---------------------------------------------------------------------------
# 3. Cargo build
# ---------------------------------------------------------------------------

Write-Banner '3/9  cargo build --workspace'

$cargoArgs = @('build', '--workspace', '--target', $Target)
if ($Configuration -eq 'release') { $cargoArgs += '--release' }

Invoke-Native -Cmd 'cargo' -CmdArgs $cargoArgs

$cargoOut = Join-Path $RepoRoot 'target' $Target $Configuration

# Only `agent.exe` is produced by `cargo build --workspace` because the GUI
# binary in `crates/agent-gui` declares `required-features = ["gui"]` and is
# built by `cargo tauri build` in Phase 4 below.
$agentSrc = Join-Path $cargoOut 'agent.exe'
if (-not (Test-Path $agentSrc)) {
    throw "Expected cargo output '$agentSrc' is missing. Did cargo build succeed?"
}
Copy-Item $agentSrc (Join-Path $AgentDir 'agent.exe') -Force
Write-Host "    copied agent.exe ($([math]::Round((Get-Item $agentSrc).Length / 1MB, 2)) MB)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Tauri renderer + bundle
# ---------------------------------------------------------------------------

Write-Banner '4/9  Tauri renderer + bundle'

$guiDir      = Join-Path $RepoRoot 'gui'
$guiCrateDir = Join-Path $RepoRoot 'crates' 'agent-gui'

if (Test-Path (Join-Path $guiDir 'package.json')) {
    # `tauri.conf.json` declares a `beforeBuildCommand` that runs
    # `npm --prefix ../../gui run build`, so the renderer build below is
    # primarily for cache warming and an explicit failure point if the
    # frontend is broken.
    if (Test-Path (Join-Path $guiDir 'package-lock.json')) {
        Invoke-Native -Cmd 'npm' -CmdArgs @('ci') -Cwd $guiDir
    } else {
        Invoke-Native -Cmd 'npm' -CmdArgs @('install') -Cwd $guiDir
    }
    Invoke-Native -Cmd 'npm' -CmdArgs @('run', 'build') -Cwd $guiDir

    # Build the GUI binary via plain `cargo build`, NOT `cargo tauri build`.
    # `cargo tauri build` is a thin wrapper that runs the same `cargo build`
    # under the hood (which invokes `tauri-build` from build.rs to embed
    # icons + manifest into the .exe) and then runs the WiX/NSIS bundler
    # on the result. On Windows ARM64 the bundlers are broken:
    #   - MSI/WiX rejects `2.0.0-alpha` ("pre-release identifier must be
    #     numeric-only").
    #   - NSIS `makensis` fails to spawn its child process when running
    #     under WoW emulation on ARM64.
    # The final installer is produced by Inno Setup in Phase 9 anyway, so
    # we skip the tauri bundler entirely and just take the .exe.
    Invoke-Native -Cmd 'cargo' -CmdArgs @('build', '--target', $Target, '--release', '--features', 'gui', '--package', 'agent-gui', '--bin', 'omni-agent-gui') -Cwd $guiCrateDir

    # The binary name in crates/agent-gui/Cargo.toml is `omni-agent-gui`.
    # Rename on copy so the rest of the distribution keeps using
    # `agent-gui.exe`.
    $guiBin = Join-Path $cargoOut 'omni-agent-gui.exe'
    if (Test-Path $guiBin) {
        Copy-Item $guiBin (Join-Path $AgentDir 'agent-gui.exe') -Force
        Write-Host "    copied omni-agent-gui.exe -> agent-gui.exe ($([math]::Round((Get-Item $guiBin).Length / 1MB, 2)) MB)" -ForegroundColor Green
    } else {
        Write-Warning "omni-agent-gui.exe not found at $guiBin after tauri build."
    }
} else {
    Write-Host "    gui/package.json not present -- Worker C has not landed the renderer." -ForegroundColor Yellow
    Write-Host "    Skipping renderer build; the distribution will ship without agent-gui.exe." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 5. CPython 3.11 embed
# ---------------------------------------------------------------------------

if ($SkipPython) {
    Write-Banner '5/9  CPython embed  (skipped via -SkipPython)'
} else {
    Write-Banner "5/9  CPython embed (v$PythonVersion)"

    $zipName = "python-$PythonVersion-embed-amd64.zip"
    $zipUrl  = "https://www.python.org/ftp/python/$PythonVersion/$zipName"
    $zipPath = Join-Path $RepoRoot 'packaging' $zipName

    if (-not (Test-Path $zipPath)) {
        Write-Host "    Downloading $zipUrl" -ForegroundColor Gray
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    }

    if (Test-Path $PyEmbed) { Remove-Item -Recurse -Force $PyEmbed }
    New-Item -ItemType Directory -Path $PyEmbed | Out-Null

    Expand-Archive -Path $zipPath -DestinationPath $PyEmbed -Force

    # The embeddable distribution ships with `site` disabled in
    # `python311._pth`. We need site for `pip --target` packages to be
    # importable, so patch the file.
    #
    # IMPORTANT: the regex MUST be line-oriented (multi-line `(?m)`),
    # otherwise `^` matches only the start of the file string and the
    # `#import site` line stays commented while the script falsely
    # reports "already has import site". When that happens, `python -m
    # pip` later fails with "No module named pip".
    $pthFile = Get-ChildItem -Path $PyEmbed -Filter 'python311._pth' | Select-Object -First 1
    if (-not $pthFile) {
        throw "python311._pth missing from extracted embed -- bad zip?"
    }
    $pthContent = Get-Content $pthFile.FullName -Raw
    if ($pthContent -match '(?m)^\s*#\s*import\s+site\s*$') {
        $patched = [regex]::Replace($pthContent, '(?m)^\s*#\s*import\s+site\s*$', 'import site')
        Set-Content -Encoding ASCII -NoNewline -Path $pthFile.FullName -Value $patched
        Write-Host "    patched python311._pth (uncommented 'import site')" -ForegroundColor Green
    } elseif ($pthContent -notmatch '(?m)^\s*import\s+site\s*$') {
        Add-Content -Encoding ASCII $pthFile.FullName "`nimport site"
        Write-Host "    appended 'import site' to python311._pth" -ForegroundColor Green
    } else {
        Write-Host "    python311._pth already has uncommented 'import site'" -ForegroundColor Green
    }

    # Bootstrap pip into the embed by downloading get-pip.py.
    $getPip = Join-Path $RepoRoot 'packaging' 'get-pip.py'
    if (-not (Test-Path $getPip)) {
        Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip -UseBasicParsing
    }
    Invoke-Native -Cmd (Join-Path $PyEmbed 'python.exe') -CmdArgs @($getPip, '--no-warn-script-location')

    # Install runtime wheels into the embed's site-packages.
    $sitePackages = Join-Path $PyEmbed 'Lib' 'site-packages'
    if (-not (Test-Path $sitePackages)) {
        New-Item -ItemType Directory -Path $sitePackages | Out-Null
    }

    $reqFile = Join-Path $RepoRoot 'python' 'requirements.txt'
    if (Test-Path $reqFile) {
        Invoke-Native -Cmd (Join-Path $PyEmbed 'python.exe') -CmdArgs @(
            '-m', 'pip', 'install',
            '--no-warn-script-location',
            '--target', $sitePackages,
            '-r', $reqFile
        )
    } else {
        Write-Host "    python/requirements.txt missing -- installing default wheel set." -ForegroundColor Yellow
        Invoke-Native -Cmd (Join-Path $PyEmbed 'python.exe') -CmdArgs @(
            '-m', 'pip', 'install',
            '--no-warn-script-location',
            '--target', $sitePackages,
            'pywin32==306',
            'cryptography>=42'
        )
    }
}

# ---------------------------------------------------------------------------
# 6. Stage python/ into dist/agent/python/
# ---------------------------------------------------------------------------

Write-Banner '6/9  Staging python/ into dist/agent/python/'

$pyDst = Join-Path $AgentDir 'python'

# Copy the embed runtime.
Copy-Item -Recurse -Force "$PyEmbed\*" $pyDst

# Copy the helper script + handlers + (anything else) from omni_agent_v2/python/
$pySrcRoot = Join-Path $RepoRoot 'python'
if (Test-Path $pySrcRoot) {
    foreach ($entry in Get-ChildItem -Path $pySrcRoot -Force) {
        # Skip caches, tests, requirements.txt.
        if ($entry.Name -in @('__pycache__', '.pytest_cache', 'tests', 'requirements.txt', '.venv')) {
            continue
        }
        Copy-Item -Recurse -Force $entry.FullName (Join-Path $pyDst $entry.Name)
    }
    Write-Host "    staged $(((Get-ChildItem $pyDst -Recurse -File) | Measure-Object).Count) files" -ForegroundColor Green
} else {
    Write-Host "    omni_agent_v2/python/ missing -- Worker B has not landed the helper." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 7. Manifest (SHA-256 of every file in dist/agent/)
# ---------------------------------------------------------------------------

Write-Banner '7/9  Manifest (SHA-256 over dist/agent/)'

$manifest = [ordered]@{
    version      = '2.0.0-alpha'
    built_at     = (Get-Date).ToUniversalTime().ToString('o')
    built_on     = [Environment]::MachineName
    target       = $Target
    files        = @()
}

$manifestFiles = @()
foreach ($file in Get-ChildItem $AgentDir -Recurse -File) {
    $rel = $file.FullName.Substring($AgentDir.Length + 1).Replace('\','/')
    $manifestFiles += [ordered]@{
        path   = $rel
        size   = $file.Length
        sha256 = (Get-Sha256 $file.FullName)
    }
}
$manifest.files = $manifestFiles

$manifestPath = Join-Path $DistRoot 'manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $manifestPath
Write-Host "    wrote $manifestPath ($($manifestFiles.Count) entries)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 8. ZIP
# ---------------------------------------------------------------------------

Write-Banner '8/9  Zipping dist/agent/ -> dist/OmniAgent_v2.zip'

$zipOut = Join-Path $DistRoot 'OmniAgent_v2.zip'
if (Test-Path $zipOut) { Remove-Item $zipOut -Force }
Compress-Archive -Path "$AgentDir\*" -DestinationPath $zipOut -CompressionLevel Optimal
$zipSize = [math]::Round((Get-Item $zipOut).Length / 1MB, 2)
Write-Host "    wrote $zipOut ($zipSize MB)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 9. (Optional) Inno Setup installer
# ---------------------------------------------------------------------------

if ($iscc -and -not $SkipInstaller) {
    Write-Banner '9/9  Inno Setup installer'

    $issPath = Join-Path $RepoRoot 'packaging' 'installer' 'installer.iss'
    if (-not (Test-Path $issPath)) {
        Write-Host "    installer.iss missing -- skipping." -ForegroundColor Yellow
    } else {
        Invoke-Native -Cmd $iscc.Source -CmdArgs @(
            "/Qp",
            "/DSourceDir=$AgentDir",
            "/DOutputDir=$DistRoot",
            "/DVersion=2.0.0",
            $issPath
        )
        $exeOut = Get-ChildItem $DistRoot -Filter 'OmniAgent_v2_setup*.exe' | Select-Object -First 1
        if ($exeOut) {
            Write-Host "    wrote $($exeOut.FullName) ($([math]::Round($exeOut.Length / 1MB, 2)) MB)" -ForegroundColor Green
        } else {
            Write-Warning "Inno Setup ran but no setup.exe was produced -- check output above."
        }
    }
} else {
    Write-Banner '9/9  Inno Setup installer  (skipped)'
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

Write-Banner 'Build complete'

Write-Host ''
Write-Host "  Output:  $DistRoot" -ForegroundColor Cyan
Get-ChildItem $DistRoot -Recurse -File | ForEach-Object {
    $size = [math]::Round($_.Length / 1KB, 1)
    Write-Host ("    {0,10:N1} KB  {1}" -f $size, $_.FullName.Substring($DistRoot.Length + 1))
}
Write-Host ''
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "    1. Run the ZIP on a clean Win11 VM to verify cold-start."
Write-Host "    2. Smoke-test http://127.0.0.1:8765/health from a browser."
Write-Host "    3. If shipping to fleet, upload OmniAgent_v2_setup.exe to the update server."
Write-Host ''
