@echo off
rem The shared build adds /prompts to Telegram for the four Agents quick prompts.
rem Save and close the running desktop before rebuilding and opening the iPhone 17 viewport.
rem The shared build includes animated reload progress on desktop and mobile.
rem The shared build includes the Forex currency converter with SGD to USD selected by default.
rem The shared build includes the mobile Workspaces page with grouped page pills.
rem The shared build includes 17 staggered index callouts inside the mobile Global map.
rem The shared build includes compact Portfolio and research toolbars for phone layouts.
rem The shared build includes the mobile Dashboard 2.0 portfolio stack and Agent Chat card.
rem Use Open iPhone 17 viewport in desktop Settings Labs to open it without a rebuild.
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
