#!/bin/sh
# Dependency security refresh: patched Electron and schema-generation dependencies; see docs/dependency-maintenance.md.
# Focus provider verification: npm run probe:maintenance-live -- --focus
# Windows terminal command: btd restart saves, rebuilds and reopens the app.
# Telegram: natural screenshot requests use MCP and send photos without captions or follow-up text.
# Trading Volumes defaults to a compact YTD table beside the expanded dot plot.
# Crypto prices use Hyperliquid and CoinGecko only; Finnhub remains a stock provider.
# macOS Finder entry point. Share runtime checks and startup updates with Linux.
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
