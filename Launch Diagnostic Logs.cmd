@echo off
echo Settings layout: tighter spacing, compact shortcuts and stacked backup controls. Filtered panels use the full content width; all pages still preload.
echo News refreshes every five minutes while the page is open; news source caches use the same cadence.
echo Settings redesign: grouped navigation, search, privacy, backups and maintenance. All pages still preload; diagnostics stay in Settings.
echo Diagnostic logs retain up to the last 15 days.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Logs

if errorlevel 1 pause

