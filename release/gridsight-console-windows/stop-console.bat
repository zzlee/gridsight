@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===============================================================
echo   🛑 正在停止 GridSight 教師端控制台...
echo ===============================================================
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a 2>nul
)
echo [GridSight] ✅ 控制台已成功停止！
timeout /t 2 >nul
