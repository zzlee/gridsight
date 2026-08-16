# GridSight Beacon One-Liner Hot-Pull Deployment Script
# Usage: powershell -ExecutionPolicy Bypass -Command "irm https://your-server/get.ps1 | iex"

 = "SilentlyContinue"

 = "https://gridsight.internal/bin/gs-agent.exe"
 = [System.IO.Path]::Combine(:TEMP, "gs-agent.exe")

Write-Host "[GridSight] Fetching gs-agent into Session 1..." -ForegroundColor Cyan

# Stop previous instance if running
Get-Process -Name "gs-agent" -ErrorAction SilentlyContinue | Stop-Process -Force

# Download gs-agent to %TEMP%
Invoke-WebRequest -Uri  -OutFile  -UseBasicParsing

if (Test-Path ) {
    Write-Host "[GridSight] Launching gs-agent in background..." -ForegroundColor Green
    Start-Process -FilePath  -WindowStyle Hidden
    Write-Host "[GridSight] Beacon agent is active." -ForegroundColor Green
} else {
    Write-Host "[GridSight] Download failed." -ForegroundColor Red
}
