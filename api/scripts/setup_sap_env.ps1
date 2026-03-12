# OmniFrame - SAP Environment Setup Script for Windows
# Run this script to configure SAP NW RFC SDK environment variables

param(
    [string]$SdkPath = "C:\SAP\nwrfcsdk"
)

Write-Host "🔧 OmniFrame - SAP Environment Setup" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# Check if SDK exists at the specified path
if (-not (Test-Path $SdkPath)) {
    Write-Host "❌ SAP NW RFC SDK not found at: $SdkPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please download the SDK from SAP Support Portal and extract it to:"
    Write-Host "  $SdkPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Or specify a different path:"
    Write-Host "  .\setup_sap_env.ps1 -SdkPath 'C:\Path\To\nwrfcsdk'" -ForegroundColor Gray
    exit 1
}

# Verify SDK structure
$libPath = Join-Path $SdkPath "lib"
if (-not (Test-Path $libPath)) {
    Write-Host "❌ Invalid SDK structure - 'lib' folder not found" -ForegroundColor Red
    exit 1
}

Write-Host "✅ SDK found at: $SdkPath" -ForegroundColor Green

# Set SAPNWRFC_HOME
Write-Host "📝 Setting SAPNWRFC_HOME..." -ForegroundColor Yellow
[System.Environment]::SetEnvironmentVariable("SAPNWRFC_HOME", $SdkPath, [System.EnvironmentVariableTarget]::User)
$env:SAPNWRFC_HOME = $SdkPath
Write-Host "   SAPNWRFC_HOME = $SdkPath" -ForegroundColor Gray

# Add lib to PATH
$currentPath = [System.Environment]::GetEnvironmentVariable("PATH", [System.EnvironmentVariableTarget]::User)
if ($currentPath -notlike "*$libPath*") {
    Write-Host "📝 Adding SDK lib to PATH..." -ForegroundColor Yellow
    $newPath = "$currentPath;$libPath"
    [System.Environment]::SetEnvironmentVariable("PATH", $newPath, [System.EnvironmentVariableTarget]::User)
    $env:PATH = "$env:PATH;$libPath"
    Write-Host "   Added: $libPath" -ForegroundColor Gray
} else {
    Write-Host "✅ SDK lib already in PATH" -ForegroundColor Green
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "✅ SAP Environment configured!" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  IMPORTANT: Restart your terminal/IDE for changes to take effect" -ForegroundColor Yellow
Write-Host ""
Write-Host "To verify, run:" -ForegroundColor Cyan
Write-Host '  $env:SAPNWRFC_HOME' -ForegroundColor Gray
Write-Host '  python -c "from pyrfc import Connection; print(''pyrfc loaded successfully!'')"' -ForegroundColor Gray
