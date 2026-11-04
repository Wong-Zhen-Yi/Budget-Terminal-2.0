@echo off
echo MCP upgraded: typed results, research workflows, stable paging, structured errors, durable write recovery and category permissions in Settings. All pages still preload.
echo Settings dashboard: heading removed; real memory, provider latency and automatic backup size charts. Request activity supports partially measured provider queues.
echo Portfolio Momentum Tracker now shows one value candlestick per trading day, using adjusted holding OHLC, a daily value EMA and private-number masking.
echo Settings App dashboard: 18 compact charts show real local metrics; protected data stays hidden and missing telemetry is explicit. All pages still preload.
echo TUI: compact tables and detail panes; Charts supports ticker entry, candles, line, volume and zoom. Arrows navigate; Space selects.
echo Terminal UI available: open Launch Budget Terminal TUI.cmd once, then type BT in a new PowerShell window.
echo YouTube: videos play in the thumbnail area. Picture in picture keeps playback running while you navigate; return and close controls stay available.
echo Diagnostic Logs now opens a visible separate window with software rendering; repeat launches focus the existing viewer.
echo Settings layout: tighter spacing, compact shortcuts and stacked backup controls. Filtered panels use the full content width; all pages still preload.
echo News refreshes every five minutes while the page is open; news source caches use the same cadence.
echo Settings redesign: grouped navigation, search, privacy, backups and maintenance. All pages still preload; diagnostics stay in Settings.
echo Diagnostic logs retain up to the last 15 days.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Logs

if errorlevel 1 pause

