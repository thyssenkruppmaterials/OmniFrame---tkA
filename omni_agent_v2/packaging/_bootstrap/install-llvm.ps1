# Downloads and silently installs the LLVM/Clang Windows-on-ARM64 toolchain
# from llvm.org. Required by `ring` 0.17+ on aarch64-pc-windows-msvc, which
# uses clang for its NEON inline assembly. Also adds the install bin to the
# machine PATH so cargo can find clang.exe.

param(
    [string]$InstallPath = 'C:\Program Files\LLVM',
    [string]$Url = 'https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.5/LLVM-22.1.5-woa64.exe'
)
$ErrorActionPreference = 'Stop'

$clangExe = Join-Path $InstallPath 'bin\clang.exe'
if (Test-Path $clangExe) {
    Write-Host "LLVM already installed at $InstallPath"
    & $clangExe --version
    Write-Host 'SKIP-INSTALL'
    exit 0
}

$tmp = Join-Path $env:TEMP ('LLVM-installer-' + [Guid]::NewGuid().ToString('N') + '.exe')
Write-Host "Downloading $Url -> $tmp"
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
Write-Host ("Downloaded {0:N1} MB" -f ((Get-Item $tmp).Length / 1MB))

Write-Host "Running silent install..."
# /S = silent, /D=path = install dir (no quotes around path per NSIS convention)
$args = @('/S', "/D=$InstallPath")
$proc = Start-Process -FilePath $tmp -ArgumentList $args -Wait -PassThru -NoNewWindow
$code = $proc.ExitCode
Write-Host "LLVM installer exited with $code"
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $clangExe)) {
    Write-Error "LLVM install reported success but $clangExe is missing."
    exit 1
}

# Append LLVM bin to the machine PATH for future prlctl exec invocations.
$llvmBin = Join-Path $InstallPath 'bin'
$cur = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
$parts = $cur -split ';'
if ($parts -notcontains $llvmBin) {
    $cur = $cur.TrimEnd(';') + ';' + $llvmBin
    [System.Environment]::SetEnvironmentVariable('Path', $cur, 'Machine')
    Write-Host "+ $llvmBin"
}

& $clangExe --version
Write-Host "INSTALLED-OK"
exit 0
