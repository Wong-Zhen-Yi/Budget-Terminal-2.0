@echo off
rem The shared build includes Google sign-in alongside GitHub on the startup popup and in Settings cloud sync.
rem The shared build uses less idle CPU: no hidden API-usage polling, slower settled cloud-sync checks, and cheaper cache saves.
rem The shared build adds QR codes for the existing phone links in Settings Labs.
rem The shared build loads the open mobile page before background preloads for unseen pages, so Polymarket appears promptly.
rem The shared build lets phone pages such as Polymarket, Charts, Valuation, Economic and Dictionary scroll their headers away.
rem GitHub demo screenshots reflect the current app; this launcher rebuilds desktop and MCP source.
rem The shared build includes single-line mobile toolbars and swipeable tab groups.
rem The shared build adapts mobile layouts to compact, standard, large and landscape phone sizes.
rem The shared build adds /prompts to Telegram for the four Agents quick prompts.
rem Save and close the running desktop before rebuilding and opening the phone viewport.
rem The shared build includes animated reload progress on desktop and mobile.
rem The shared build includes the Forex currency converter with SGD to USD selected by default.
rem The shared build includes the mobile Workspaces page with grouped page pills.
rem The shared build includes 17 staggered index callouts inside the mobile Global map.
rem The shared build includes compact Portfolio and research toolbars for phone layouts.
rem The shared build includes the mobile Dashboard 2.0 portfolio stack and Agent Chat card.
rem Use Open phone viewport in desktop Settings Labs to open it without a rebuild.
rem Use Settings Labs in the desktop window to copy Tailscale setup commands for a phone.
rem The shared build includes Telegram /restart and the separate Tailscale link command.
rem Build the current responsive phone layout with collapsible News filters and tools.
title Budget Terminal Mobile Launcher
cd /d "%~dp0..\.." || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\launch-windows.ps1" mobile
if not errorlevel 1 exit /b 0
echo.
echo Budget Terminal Mobile could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
