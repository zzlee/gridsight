@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GridSight Teacher Console
echo ===============================================================
echo   🚀 GridSight 教師端控制台 (官方簽名 0 防毒誤報 綠色版)
echo ===============================================================
echo   正在啟動控制台服務...
echo   本機網址: http://localhost:3000
echo   提示: 執行「stop-console.bat」即可隨時關閉服務。
echo ===============================================================
start "" "%~dp0bin\node.exe" "%~dp0server\server.cjs"
timeout /t 2 >nul
start http://localhost:3000
