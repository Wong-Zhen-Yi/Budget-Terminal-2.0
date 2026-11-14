@echo off
rem News reader and scoped clipboard exports rebuild through the shared launcher.
rem Finnhub streaming-first refresh, visible-stock priorities and idle/session savings rebuild through the shared launcher.
rem Settings dashboard keeps the five slowest pages stable during startup updates; rebuilt through the shared launcher.
rem Shared snapshot validation, account quotas and typed cloud contracts rebuild through the shared launcher; deploy backend policies separately.
rem Live two-device sign-in, rotation and isolated revocation verified; the shared launcher builds current auth source.
rem Auth workspace ownership, async credential storage and session controls rebuild through the shared launcher.
rem Auth restores saved sign-in and remembers Don't show again; rebuilt through the shared launcher.
rem GitHub sign-in requires the exact v2 callback registered in its OAuth App; see docs/convex-sync.md.
rem Convex Auth v2 and MCP rebuild through the shared launcher; reconnect cloud sync in Settings after upgrading.
rem Homebuilders has an independent housing-economics layout with mortgage scenarios and a builder capital map.
rem Homebuilders Focus page and read-only MCP tool rebuild from current source through the shared launcher.
rem Crypto panels fit the viewport with bounded data lists; rebuilt through the shared launcher.
rem Calendar fits the viewport with responsive month rows and bounded information panels; rebuilt through the shared launcher.
rem Agents live status isolates intermittent Telegram failures; rebuilt through the shared launcher.
rem Trading Volumes and Beta support pointer-centered scroll zoom and reset; rebuilt through the shared launcher.
rem TickerTick news and MCP descriptions rebuild from current source through the shared launcher.
rem Scorecard uses a company comparison matrix and focused analysis panel; rebuilt through the shared launcher.
rem Price page omits the successful-results source summary; rebuilt through the shared launcher.
rem Settings Page Load Order uses stable, readable columns; rebuilt through the shared launcher.
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
rem Crypto bypasses Finnhub for coins, stock proxies and live updates; shared builds refresh app and MCP.
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
