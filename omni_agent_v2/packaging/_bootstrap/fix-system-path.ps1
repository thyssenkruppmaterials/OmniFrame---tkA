# Add cargo, python, and pwsh dirs to the machine PATH so subsequent
# `prlctl exec` invocations (running as NT AUTHORITY\SYSTEM) can find them.
param()
$ErrorActionPreference = 'Stop'

$add = @(
    'C:\Users\jaisingh\.cargo\bin',
    'C:\Windows\System32\config\systemprofile\.cargo\bin',
    'C:\Users\jaisingh\AppData\Local\Python\bin',
    'C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_arm64__8wekyb3d8bbwe',
    'C:\Program Files\LLVM\bin'
)

$cur = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
$parts = $cur -split ';'
$changed = $false
foreach ($p in $add) {
    if ($parts -notcontains $p) {
        $cur = $cur.TrimEnd(';') + ';' + $p
        $changed = $true
        Write-Host "+ $p"
    } else {
        Write-Host "= $p"
    }
}

if ($changed) {
    [System.Environment]::SetEnvironmentVariable('Path', $cur, 'Machine')
    Write-Host 'PATH-UPDATED'
} else {
    Write-Host 'PATH-UNCHANGED'
}
