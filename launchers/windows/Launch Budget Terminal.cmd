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
rem Open the phone viewport from Settings, Labs, Mobile Access.
rem The shared build includes animated reload progress on desktop and mobile.
rem The shared build includes the Forex currency converter with SGD to USD selected by default.
rem The shared build includes the mobile Workspaces page with grouped page pills.
rem The shared build includes 17 staggered index callouts inside the mobile Global map.
rem The shared build includes compact Portfolio and research toolbars for phone layouts.
rem The shared build includes the mobile Dashboard 2.0 portfolio stack and Agent Chat card.
rem Select a viewport model and launch the connected mobile window from Settings Labs.
rem Mobile Access includes a button to copy the Tailscale setup commands after the shared build.
rem Telegram /mobile retrieves links and /restart relaunches the app without Codex inference.
rem For the mobile News toolbar with collapsible filters and tools, run Launch Budget Terminal Mobile.cmd or btd mobile.
rem The shared build includes the compact phone navigation and touch-friendly page picker.
rem The shared build includes the direct Tailscale link under Settings > Labs.
rem On Windows, double-click Launch Budget Terminal Demo.cmd for temporary sample data.
rem The shared build includes the streamlined Charts workspaces and updated chart rendering.
rem The shared dependency install uses the project's pinned esbuild script approvals.
rem The shared build brings the Dashboard Lite chart layout to Dashboard 1.
rem Use btd for visible startup checks and a desktop app that runs independently of its terminal.
rem The shared build includes search across all Settings categories.
rem The shared build includes the live News Lite layout in Settings Labs.
rem Open docs/design-prototypes/news/news-workspace.html for the standalone News prototype.
rem The shared build includes Dashboard Lite and the experimental controls in Settings Labs.
rem The shared build opens the alphabetical Focus Dashboard with two headline metrics on every card.
rem The shared build includes BMNR's prominent filed cash balance and refined treasury layout.
rem The shared build includes the completed Anthropic IPO and Nasdaq ANT listing.
rem The shared build includes provider fallback fixes and Finnhub-free Heatmap and Semiconductors data.
rem The shared build includes live Finnhub portfolio ticker flashes on both dashboards.
rem The shared build applies source downloaded through Settings or btd update on the next launch.
rem Shared build includes both Ethereum views, the opening page preference, Obscure controls and current MCP schemas.
rem Agents connects when external MCP servers are offline.
rem Projections keeps BMNR chart data available when the options listing fails.
rem Ethereum Focus metrics and growthepie MCP schemas rebuild through the shared launcher.
rem The shared build restores the cloud deployment previously verified with GitHub sign-in.
rem GitHub sign-in uses the shared cloud's OAuth configuration check.
rem GitHub sign-in uses Budget Terminal's shared cloud deployment.
rem The shared build includes faster startup recovery and hides empty portfolio cards.
rem Pre-Market opens from the Overview workspace after the shared build.
rem The shared build includes NVDA Focus and its MCP tool.
rem The shared build includes Macro indicator trends, the Treasury yield curve and release countdowns.
rem Adaptive cache budgets and idle Quant worker cleanup rebuild through the shared launcher.
rem Agents retains Desktop and Telegram history for up to 30 days within storage limits.
rem Agents History rebuilds with Desktop and Telegram filters and a dedicated transcript reader.
rem The shared build keeps heatmaps in place when changing timeframes and removes inline data diagnostics.
rem Macro centers Activity, Prices and Employment beside the compass, release schedule and rates.
rem Macro cycle compass shows nine states and release changes through the shared build path.
rem Agents includes the Summarize macro quick prompt; rebuild current source through the shared launcher.
rem Macro Focus, shared economic startup data and MCP screenshot schemas rebuild through the shared launcher.
rem Heatmap historical replay builds automatically with paced Yahoo batches.
rem The shared build includes the UTF-8 fix for Heatmap historical replay.
rem Anthropic funding, customer depth, compute ratios and capital visualisations rebuild through the shared launcher.
rem HOOD Focus quarterly earnings charts, headline metrics and MCP schemas rebuild through the shared launcher.
rem Anthropic Focus research, source update checks and MCP tools rebuild through the shared launcher.
rem GOOGL Focus, quarterly SEC drivers and MCP schemas rebuild through the shared launch path.
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
rem Maintenance checklist and verification commands: docs/maintenance/Maintainence.md
rem Windows terminal command: btd restart saves, rebuilds and reopens the app.
rem Run btd --help for all Windows terminal commands and options.
rem Telegram: natural screenshot requests use MCP and send photos without captions or follow-up text.
rem Trading Volumes defaults to a compact YTD table beside the expanded dot plot.
rem Crypto bypasses Finnhub for coins, stock proxies and live updates; shared builds refresh app and MCP.
rem Windows double-click entry point; shared setup and startup live in scripts/.
rem Keep dependency checks and build output visible in this terminal before opening the app.
rem Shared launcher presents five numbered stages with measured completion times.
rem Incremental charts, indexed live updates and cache checkpoints: docs/performance.md.
rem macOS and Linux launchers are in launchers/macos and launchers/linux.
rem Curated design references live in docs/; output/ is for ignored local captures.
title Budget Terminal
cd /d "%~dp0..\.." || exit /b 1
echo.
echo   Preparing Budget Terminal launcher...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\launch-windows.ps1" -Attached
if errorlevel 1 goto :launchFailed
exit /b 0

:launchFailed
echo.
echo Budget Terminal could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
