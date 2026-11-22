@echo off
rem The shared build includes the direct Tailscale link. Demo data cannot be shared over Tailscale.
title Budget Terminal Demo
cd /d "%~dp0" || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Demo -Attached
if not errorlevel 1 exit /b 0
echo.
echo Budget Terminal Demo could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
