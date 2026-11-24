@echo off
rem The shared build adapts mobile layouts to compact, standard, large and landscape phone sizes.
rem The shared build adds /prompts to Telegram for the four Agents quick prompts.
rem Preview the fitted phone viewport with temporary sample data.
rem The shared build includes animated reload progress on desktop and mobile.
rem The shared build includes the Forex currency converter with SGD to USD selected by default.
rem The shared build includes the mobile Workspaces page with grouped page pills.
rem The shared build includes 17 staggered index callouts inside the mobile Global map.
rem The shared build includes compact Portfolio and research toolbars for phone layouts.
rem The shared build includes the mobile Dashboard 2.0 portfolio stack and Agent Chat card.
rem The preview shares the phone viewport profile with the connected mobile window.
rem Use the regular desktop session to copy Tailscale setup commands for a phone.
rem The shared build includes direct Telegram /mobile and /restart handling.
rem Rebuild the portrait layouts with collapsible News filters and tools and the current MCP bundle.
rem Use Launch Budget Terminal Mobile.cmd to connect the mobile UI to desktop data.
title Budget Terminal Mobile Preview
cd /d "%~dp0..\.." || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\launch-windows.ps1" -MobilePreview -Attached
if not errorlevel 1 exit /b 0
echo.
echo Budget Terminal Mobile Preview could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
