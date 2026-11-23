#!/bin/sh
# The shared build includes the Forex currency converter with SGD to USD selected by default.
# The shared build includes the mobile Workspaces page with grouped page pills.
# The shared build includes 17 staggered index callouts inside the mobile Global map.
# The shared build includes compact Portfolio and research toolbars for phone layouts.
# The shared build includes the mobile Dashboard 2.0 portfolio stack and Agent Chat card.
# Settings Labs can launch the connected mobile window on Windows.
# Mobile Access includes a button to copy the Tailscale setup commands after the shared build.
# Telegram /mobile retrieves links and /restart relaunches the app without Codex inference.
# Pass --mobile-preview to try collapsible mobile News filters and tools with sample data.
# The connected mobile window is available through the Windows launcher.
# The shared build includes the direct Tailscale link under Settings > Labs.
# Double-click Launch Budget Terminal Demo.command for temporary sample data.
# The shared launcher can install a private Node.js runtime if needed.
# The shared build includes the streamlined Charts workspaces and updated chart rendering.
# The shared dependency install uses the project's pinned esbuild script approvals.
# The shared build brings the Dashboard Lite chart layout to Dashboard 1.
# Shared startup checks also run visibly for the Windows btd command before it detaches the app.
# The shared build includes search across all Settings categories.
# The shared build includes the live News Lite layout in Settings Labs.
# Open docs/design-prototypes/news/news-workspace.html for the standalone News prototype.
# The shared build includes Dashboard Lite and the experimental controls in Settings Labs.
# The shared build opens the alphabetical Focus Dashboard with two headline metrics on every card.
# The shared build includes BMNR's prominent filed cash balance and refined treasury layout.
# The shared build includes the completed Anthropic IPO and Nasdaq ANT listing.
# The shared build includes provider fallback fixes and Finnhub-free Heatmap and Semiconductors data.
# The shared build includes live Finnhub portfolio ticker flashes on both dashboards.
# Shared build includes both Ethereum views, the opening page preference, Obscure controls and current MCP schemas.
# Agents connects when external MCP servers are offline.
# Projections keeps BMNR chart data available when the options listing fails.
# Ethereum Focus metrics and growthepie MCP schemas rebuild through the shared launcher.
# The shared build restores the cloud deployment previously verified with GitHub sign-in.
# GitHub sign-in uses the shared cloud's OAuth configuration check.
# GitHub sign-in uses Budget Terminal's shared cloud deployment.
# The shared build includes faster startup recovery and hides empty portfolio cards.
# Pre-Market opens from the Overview workspace after the shared build.
# The shared build includes NVDA Focus and its MCP tool.
# The shared build includes Macro indicator trends, the Treasury yield curve and release countdowns.
# Adaptive cache budgets and idle Quant worker cleanup rebuild through the shared launcher.
# Agents retains Desktop and Telegram history for up to 30 days within storage limits.
# Agents History rebuilds with Desktop and Telegram filters and a dedicated transcript reader.
# The shared build keeps heatmaps in place when changing timeframes and removes inline data diagnostics.
# Macro centers Activity, Prices and Employment beside the compass, release schedule and rates.
# Macro cycle compass shows nine states and release changes through the shared build path.
# Agents includes the Summarize macro quick prompt; rebuild current source through the shared launcher.
# Macro Focus, shared economic startup data and MCP screenshot schemas rebuild through the shared launcher.
# Heatmap historical replay builds automatically with paced Yahoo batches.
# The shared build includes the UTF-8 fix for Heatmap historical replay.
# Anthropic funding, customer depth, compute ratios and capital visualisations rebuild through the shared launcher.
# HOOD Focus quarterly earnings charts, headline metrics and MCP schemas rebuild through the shared launcher.
# Anthropic Focus research, source update checks and MCP tools rebuild through the shared launcher.
# GOOGL Focus, quarterly SEC drivers and MCP schemas rebuild through the shared launch path.
# News reader and scoped clipboard exports rebuild through the shared launcher.
# Finnhub streaming-first refresh, visible-stock priorities and idle/session savings rebuild through the shared launcher.
# Settings dashboard keeps the five slowest pages stable during startup updates; rebuilt through the shared launcher.
# Shared snapshot validation, account quotas and typed cloud contracts rebuild through the shared launcher; deploy backend policies separately.
# Live two-device sign-in, rotation and isolated revocation verified; the shared launcher builds current auth source.
# Auth workspace ownership, async credential storage and session controls rebuild through the shared launcher.
# Auth restores saved sign-in and remembers Don't show again; rebuilt through the shared launcher.
# GitHub sign-in requires the exact v2 callback registered in its OAuth App; see docs/convex-sync.md.
# Convex Auth v2 and MCP rebuild through the shared launcher; reconnect cloud sync in Settings after upgrading.
# Homebuilders has an independent housing-economics layout with mortgage scenarios and a builder capital map.
# Homebuilders Focus page and read-only MCP tool rebuild from current source through the shared launcher.
# Crypto panels fit the viewport with bounded data lists; rebuilt through the shared launcher.
# Calendar fits the viewport with responsive month rows and bounded information panels; rebuilt through the shared launcher.
# Agents live status isolates intermittent Telegram failures; rebuilt through the shared launcher.
# Trading Volumes and Beta support pointer-centered scroll zoom and reset; rebuilt through the shared launcher.
# TickerTick news and MCP descriptions rebuild from current source through the shared launcher.
# Scorecard uses a company comparison matrix and focused analysis panel; rebuilt through the shared launcher.
# Price page omits the successful-results source summary; rebuilt through the shared launcher.
# Settings Page Load Order uses stable, readable columns; rebuilt through the shared launcher.
# Portfolio LLM and ticker exports copy directly to the native clipboard on Windows, macOS and Linux.
# Agents chat supports smooth middle-click scrolling in page and embedded views.
# MCP tools and schemas rebuild from current source on every launch; see docs/local-mcp.md.
# Gold and Oil pages are in the Focus workspace.
# Finnhub prioritizes saved portfolio stocks for pre-market/live feeds and REST refreshes; see docs/finnhub-streaming.md.
# Dependency security refresh: patched Electron and schema-generation dependencies; see docs/dependency-maintenance.md.
# Focus provider verification: npm run probe:maintenance-live -- --focus
# Maintenance checklist and verification commands: docs/maintenance/Maintainence.md
# Windows terminal command: btd restart saves, rebuilds and reopens the app.
# Run btd --help on Windows for all terminal commands and options.
# Telegram: natural screenshot requests use MCP and send photos without captions or follow-up text.
# Trading Volumes defaults to a compact YTD table beside the expanded dot plot.
# Crypto bypasses Finnhub for coins, stock proxies and live updates; shared builds refresh app and MCP.
# macOS Finder entry point. Share runtime checks and startup updates with Linux.
# The shared build applies source downloaded through Settings or the launcher update command.
# Keep dependency checks and build output visible in Terminal before opening the app.
# Shared launcher presents five numbered stages with measured completion times.
# Incremental charts, indexed live updates and cache checkpoints: docs/performance.md.
# Curated design references live in docs/; output/ is for ignored local captures.
cd "$(dirname "$0")" || exit 1

/bin/sh './Launch Budget Terminal.sh' "$@"
status=$?
if [ "$status" -ne 0 ] && [ -t 0 ]; then
  printf '\nBudget Terminal could not open. Fix the error above, then double-click this file to retry.\nPress Enter to close. '
  read -r reply
fi
exit "$status"
