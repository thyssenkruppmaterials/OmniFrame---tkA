# Phase G — post-build smoke check for OmniFrame_AgentMaster.exe (Windows only).
# Run from omni_agent/ after build_exe.bat:
#   powershell -NoProfile -ExecutionPolicy Bypass -File master\build\smoke_check_master_exe.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path (Join-Path $Root "build_exe.bat"))) {
    $Root = Split-Path $PSScriptRoot -Parent
}
$Dist = Join-Path $Root "dist"
$Exe = Join-Path $Dist "OmniFrame_AgentMaster.exe"
$Sidecar = Join-Path $Dist "OmniFrame_AgentMaster.exe.sha256"
$Failures = [System.Collections.Generic.List[string]]::new()

function Add-Fail([string]$Msg) {
    $Failures.Add($Msg) | Out-Null
    Write-Host "FAIL: $Msg" -ForegroundColor Red
}

function Add-Pass([string]$Msg) {
    Write-Host "PASS: $Msg" -ForegroundColor Green
}

Write-Host "=== OmniFrame Agent Master smoke check ===" -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host "Dist: $Dist"

if (-not (Test-Path $Exe)) {
    Add-Fail "Missing $Exe — run build_exe.bat first."
} else {
    Add-Pass "Found OmniFrame_AgentMaster.exe"
}

if (-not (Test-Path $Sidecar)) {
    Add-Fail "Missing $Sidecar"
} else {
    $Expected = (Get-Content $Sidecar -TotalCount 1).Trim().Split(" ", 2)[0]
    $HashOut = & certutil -hashfile $Exe SHA256 2>&1 | Out-String
    $Actual = ($HashOut -split "`n" | Where-Object { $_ -match "^[0-9a-fA-F]{64}$" } | Select-Object -First 1).Trim().ToLower()
    if ($Expected.ToLower() -ne $Actual) {
        Add-Fail "SHA-256 mismatch: sidecar=$Expected recomputed=$Actual"
    } else {
        Add-Pass "SHA-256 sidecar matches certutil -hashfile"
    }
}

$RequiredCaps = @(
    "master-controller-supported",
    "admin-ws-reconnect",
    "admin-job-abort",
    "admin-sap-reattach",
    "health-extended-fields",
    "agent-port-override",
    "agent-self-id-override",
    "agent-sap-pin-env-override"
)

if (Test-Path $Exe) {
    $VersionOut = & $Exe --version 2>&1 | Out-String
    Write-Host "--- --version stdout ---"
    Write-Host $VersionOut

    if ($VersionOut -notmatch "AGENT_VERSION=2\.1\.0") {
        Add-Fail "--version missing AGENT_VERSION=2.1.0"
    } else {
        Add-Pass "AGENT_VERSION=2.1.0 present"
    }

    $capMissing = 0
    foreach ($cap in $RequiredCaps) {
        if ($VersionOut -notmatch [regex]::Escape("capability=$cap")) {
            Add-Fail "--version missing capability=$cap"
            $capMissing++
        }
    }
    if ($capMissing -eq 0 -and ($VersionOut -match "AGENT_VERSION=2\.1\.0")) {
        Add-Pass "All 8 master worker capability lines present"
    }
}

Write-Host ""
if ($Failures.Count -eq 0) {
    Write-Host "=== SMOKE CHECK: PASS ===" -ForegroundColor Green
    exit 0
}

Write-Host "=== SMOKE CHECK: FAIL ($($Failures.Count) issue(s)) ===" -ForegroundColor Red
foreach ($f in $Failures) { Write-Host "  - $f" }
exit 1
