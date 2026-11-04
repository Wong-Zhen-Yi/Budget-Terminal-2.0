@echo off
echo MCP upgraded: typed results, research workflows, stable paging, structured errors, durable write recovery and category permissions in Settings. All pages still preload.
echo Settings dashboard: heading removed; real memory, provider latency and automatic backup size charts. Request activity supports partially measured provider queues.
echo Portfolio Momentum Tracker now shows one value candlestick per trading day, using adjusted holding OHLC, a daily value EMA and private-number masking.
echo Settings App dashboard: 18 compact charts show real local metrics; protected data stays hidden and missing telemetry is explicit. All pages still preload.
echo TUI: compact tables and detail panes; Charts supports ticker entry, candles, line, volume and zoom. Arrows navigate; Space selects.
echo Budget Terminal TUI: keyboard workspaces, ticker research and shared local data.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-bt.ps1"
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Tui
if not errorlevel 1 exit /b 0
:failed
pause
