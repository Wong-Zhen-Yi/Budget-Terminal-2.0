@echo off
rem The shared build adapts mobile layouts to compact, standard, large and landscape phone sizes.
rem The shared build adds /prompts to Telegram for the four Agents quick prompts.
rem The shared build includes the one-click phone viewport in desktop Settings.
rem The shared build includes animated reload progress on desktop and mobile.
rem The shared build includes the Forex currency converter with SGD to USD selected by default.
rem The shared build includes the mobile Workspaces page with grouped page pills.
rem The shared build includes 17 staggered index callouts inside the mobile Global map.
rem The shared build includes compact Portfolio and research toolbars for phone layouts.
rem The shared build includes the mobile Dashboard 2.0 portfolio stack and Agent Chat card.
rem The connected mobile launcher in Settings Labs is available in the regular Windows desktop session.
rem Tailscale setup commands are available in the regular desktop session.
rem The shared build includes direct Telegram /mobile and /restart handling.
rem For collapsible News filters and tools with sample data, run Launch Budget Terminal Mobile Preview.cmd.
rem Launch Budget Terminal Mobile.cmd opens the regular workspace in the Windows mobile window.
rem The shared build includes the direct Tailscale link. Demo data cannot be shared over Tailscale.
rem On macOS, use Launch Budget Terminal Demo.command in launchers/macos.
title Budget Terminal Demo
cd /d "%~dp0..\.." || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\launch-windows.ps1" -Demo -Attached
if not errorlevel 1 exit /b 0
echo.
echo Budget Terminal Demo could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
