$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Native {
    param(
        [Parameter(Mandatory)]
        [string]$Cmd,
        [string[]]$CmdArgs = @(),
        [string]$Cwd = (Get-Location).Path
    )
    $argLine = ($CmdArgs -join ' ')
    Write-Host "    > $Cmd $argLine"
    Push-Location $Cwd
    try {
        & $Cmd @CmdArgs
        $code = $LASTEXITCODE
        Write-Host "    exit=$code"
        if ($code -ne 0) { throw "Command exited with $code" }
    } finally {
        Pop-Location
    }
}

Write-Host "PS Version : $($PSVersionTable.PSVersion)"
Write-Host "ArgPassing : $PSNativeCommandArgumentPassing"
Write-Host "--- TEST 1: npm --version via Invoke-Native (CmdArgs)"
try { Invoke-Native -Cmd 'npm' -CmdArgs @('--version') } catch { Write-Host "FAIL: $_" }

Write-Host "--- TEST 2: npm ci --dry-run via Invoke-Native (CmdArgs)"
try {
    Invoke-Native -Cmd 'npm' -CmdArgs @('ci', '--ignore-scripts', '--dry-run') -Cwd 'C:\dev\omni_agent_v2\gui'
} catch {
    Write-Host "FAIL: $_"
}
