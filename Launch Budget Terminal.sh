#!/bin/sh
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
# Windows terminal command: btd restart saves, rebuilds and reopens the app.
# Telegram: natural screenshot requests use MCP and send photos without captions or follow-up text.
# Trading Volumes defaults to a compact YTD table beside the expanded dot plot.
# Crypto prices use Hyperliquid and CoinGecko only; Finnhub remains a stock provider.
# Linux/macOS entry point; shared runtime checks and startup live in scripts/.
# Keep dependency checks and build output visible in this terminal before opening the app.
# Shared launcher presents five numbered stages with measured completion times.
# Incremental charts, indexed live updates and cache checkpoints: docs/performance.md.
# macOS users can double-click Launch Budget Terminal.command; both use this startup path.
# Curated design references live in docs/; output/ is for ignored local captures.

cd "$(dirname "$0")" || exit 1
printf '\n  Preparing Budget Terminal launcher...\n'

# Finder, Dolphin and Steam may not inherit an interactive terminal's PATH.
export PATH="$HOME/.local/bin:$HOME/.local/share/fnm/aliases/default/bin:$HOME/Library/Application Support/fnm/aliases/default/bin:$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if command -v node >/dev/null 2>&1 && node scripts/runtime.cjs >/dev/null 2>&1; then
  exec node scripts/launch.cjs "$@"
fi

# Also check Homebrew LTS, nvm and per-user Steam Deck runtimes without sourcing shell profiles.
for runtime in /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node \
  /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node \
  /opt/homebrew/opt/node@26/bin/node /usr/local/opt/node@26/bin/node \
  "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node \
  "$HOME"/.local/share/budget-terminal/node-*-linux-*/bin/node; do
  if [ -x "$runtime" ] && "$runtime" scripts/runtime.cjs >/dev/null 2>&1; then
    export PATH="$(dirname "$runtime"):$PATH"
    exec "$runtime" scripts/launch.cjs "$@"
  fi
done

echo 'Install Node.js 22.23.4+, 24.22.1+, or 26.12.1+ with npm 10.9.8+, then launch again.' >&2
exit 1
