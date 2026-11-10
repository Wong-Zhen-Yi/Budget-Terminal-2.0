#!/bin/sh
# Convex snapshot writes are restored; record-era cloud tables are retained as an archive.
# Check and install dependencies before opening the desktop app without an interface chooser.
# Database sync restored to 3208321: optional Convex snapshots, GitHub sign-in and complete-copy conflict choices.
# macOS users can double-click Launch Budget Terminal.command; both use this startup path.
# Backup and sync snapshots resolve asynchronous defaults inside function bodies for build compatibility.
# Backup imports recover on failure; Escape cancels edits; public WebSocket resources are supported.
# Shared option chains, single-capture backups, targeted refresh and live status updates. Measurements: docs/efficiency-results.md.
# Settings > Controller controls: game-style diagram, live input display and navigation-safe test mode.
# Controller page switching follows visible workspace/page order, including custom ordering and hidden pages.
# Compact layouts keep Treasury curves, market controls, probability statistics and heatmap details accessible.
# Personal Finance charts keep readable values while Totals and Goal resize to the screen.
# Obscure hides recurring bill names and amounts; Reveal restores editable names.
# Personal Finance: Steam Deck layout keeps recurring bill names readable and the Goal panel visible.
# Controller support: D-pad/left stick focus, A activate, B dismiss, shoulders switch pages, Menu page picker, right stick scroll.
# Steam Deck: centered display bounds in Desktop Mode; native fullscreen in Gaming Mode.

cd "$(dirname "$0")" || exit 1
printf 'Checking Node.js and application dependencies, then opening Budget Terminal...\n'

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
