@echo off
echo Diagnostic logs: open Settings - Diagnostics in the desktop app, or press Ctrl+Shift+L.
title Budget Terminal
cd /d "%~dp0" || exit /b 1
echo Budget Terminal opens in this terminal. Type BT in PowerShell to launch it directly.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-bt.ps1"
if errorlevel 1 goto :failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Tui %*
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal could not start. Press any key to close.
pause >nul
exit /b 1
