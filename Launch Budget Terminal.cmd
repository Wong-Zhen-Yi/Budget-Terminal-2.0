@echo off
rem Windows double-click entry point; shared setup and startup live in scripts/.
rem Incremental charts, indexed live updates and cache checkpoints: docs/performance.md.
rem macOS: double-click Launch Budget Terminal.command. Linux: Launch Budget Terminal.sh.
rem Curated design references live in docs/; output/ is for ignored local captures.
title Budget Terminal
cd /d "%~dp0" || exit /b 1
echo Checking Node.js and application dependencies, then opening Budget Terminal...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1"
if errorlevel 1 goto :launchFailed
exit /b 0

:launchFailed
echo.
echo Budget Terminal could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
