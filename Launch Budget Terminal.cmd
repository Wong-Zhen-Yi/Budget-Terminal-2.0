@echo off
rem Portfolio LLM and ticker exports copy directly to the native clipboard on Windows, macOS and Linux.
rem Agents chat supports smooth middle-click scrolling in page and embedded views.
rem MCP tools and schemas rebuild from current source on every launch; see docs/local-mcp.md.
rem Gold and Oil pages are in the Focus workspace.
rem Finnhub prioritizes saved portfolio stocks for pre-market/live feeds and REST refreshes; see docs/finnhub-streaming.md.
rem Dependency security refresh: patched Electron and schema-generation dependencies; see docs/dependency-maintenance.md.
rem Focus provider verification: npm run probe:maintenance-live -- --focus
rem Windows terminal command: btd restart saves, rebuilds and reopens the app.
rem Telegram: natural screenshot requests use MCP and send photos without captions or follow-up text.
rem Trading Volumes defaults to a compact YTD table beside the expanded dot plot.
rem Crypto prices use Hyperliquid and CoinGecko only; Finnhub remains a stock provider.
rem Windows double-click entry point; shared setup and startup live in scripts/.
rem Keep dependency checks and build output visible in this terminal before opening the app.
rem Shared launcher presents five numbered stages with measured completion times.
rem Incremental charts, indexed live updates and cache checkpoints: docs/performance.md.
rem macOS: double-click Launch Budget Terminal.command. Linux: Launch Budget Terminal.sh.
rem Curated design references live in docs/; output/ is for ignored local captures.
title Budget Terminal
cd /d "%~dp0" || exit /b 1
echo.
echo   Preparing Budget Terminal launcher...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Attached
if errorlevel 1 goto :launchFailed
exit /b 0

:launchFailed
echo.
echo Budget Terminal could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
