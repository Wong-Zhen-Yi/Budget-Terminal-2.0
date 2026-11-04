#!/bin/sh
echo "News refreshes every five minutes while the page is open; news source caches use the same cadence."
echo "Settings redesign: grouped navigation, search, privacy, backups and maintenance. All pages still preload; diagnostics stay in Settings."
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:$HOME/.local/share/fnm/aliases/default/bin:$HOME/.volta/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Install supported Node.js and run the main application launcher first." >&2
  exit 1
fi
echo "Opening the independent Budget Terminal Diagnostic Logs viewer. Logs retain up to the last 15 days."
exec node scripts/launch.cjs --logs
