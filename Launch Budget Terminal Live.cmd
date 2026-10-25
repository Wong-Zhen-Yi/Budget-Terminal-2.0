@echo off
title Budget Terminal - Live Development
cd /d "%~dp0" || exit /b 1
echo Starting live development with a supported Node.js runtime.
echo Close any existing Budget Terminal window first. Keep this terminal open.
echo UI edits update automatically; Electron code edits rebuild and restart or reload the app.
echo All implemented pages preload at startup; progress and failures remain visible.
echo Settings Page Load Order includes Export for AI for a local startup diagnostic text report. Nothing is uploaded automatically.
echo Includes bounded 4 MB News images, corrected daily S^&P500 holdings freshness and expiry-aware WTI contract selection.
echo Includes the latest Yahoo startup pacing, API USAGE footer, Trading Volumes hover highlights and median-centered Beta chart. Shared startup checks report details below.
echo Pre-Market futures now recover through daily history when hourly feeds fail or return stale data; genuine outages remain visible.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Dev
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal live development could not start. Press any key to close.
pause >nul
exit /b 1
