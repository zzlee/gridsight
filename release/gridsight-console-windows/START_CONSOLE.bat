@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GridSight Teacher Console
echo ===============================================================
echo   GridSight Teacher Console (Portable Edition)
echo ===============================================================
echo   Starting GridSight Console server...
echo   Tip: Run stop-console.bat or close this window to stop.
echo ===============================================================
"%~dp0bin\node.exe" "%~dp0server\server.cjs"
