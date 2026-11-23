@echo off
rem The shared build includes direct Telegram /mobile and /restart handling.
rem Rebuild the portrait layouts with collapsible News filters and tools and the current MCP bundle.
rem Use Launch Budget Terminal Mobile.cmd to connect the mobile UI to desktop data.
title Budget Terminal iPhone 17 Preview
cd /d "%~dp0" || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -MobilePreview -Attached
if not errorlevel 1 exit /b 0
echo.
echo Budget Terminal iPhone 17 Preview could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
