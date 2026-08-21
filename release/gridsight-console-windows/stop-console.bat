@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===============================================================
echo   Stopping GridSight Teacher Console...
echo ===============================================================
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a 2>nul
)
echo [GridSight] Console stopped successfully.
timeout /t 2 >nul
