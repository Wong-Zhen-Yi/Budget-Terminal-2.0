@echo off
rem The shared build includes Telegram /restart and the separate Tailscale link command.
rem Build the current app and open the connected iPhone 17 layout on Windows.
title Budget Terminal Mobile Launcher
cd /d "%~dp0" || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" mobile
if not errorlevel 1 exit /b 0
echo.
echo Budget Terminal Mobile could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
