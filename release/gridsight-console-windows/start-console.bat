@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GridSight Teacher Console
echo ===============================================================
echo   🚀 GridSight 教師端控制台 (官方簽名 0 防毒誤報 綠色版)
echo ===============================================================
echo   提示: 關閉此視窗或執行「stop-console.bat」即可關閉服務。
echo ===============================================================
"%~dp0bin\node.exe" "%~dp0server\server.cjs"
if %errorlevel% neq 0 (
  pause
)
