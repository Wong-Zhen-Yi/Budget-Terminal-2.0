@echo off
rem Open the default iPhone 17 model. Choose a model in desktop Settings Labs.
rem Use Settings Labs in the desktop window to copy Tailscale setup commands for a phone.
rem The shared build includes Telegram /restart and the separate Tailscale link command.
rem Build the current iPhone 17 layout with collapsible News filters and tools.
title Budget Terminal Mobile Launcher
cd /d "%~dp0" || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" mobile
if not errorlevel 1 exit /b 0
echo.
echo Budget Terminal Mobile could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
