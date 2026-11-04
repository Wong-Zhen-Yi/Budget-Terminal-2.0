#!/bin/sh
echo "Settings layout: tighter spacing, compact shortcuts and stacked backup controls. Filtered panels use the full content width; all pages still preload."
echo "News refreshes every five minutes while the page is open; news source caches use the same cadence."
echo "Settings redesign: grouped navigation, search, privacy, backups and maintenance. All pages still preload; diagnostics stay in Settings."
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Install supported Node.js and run the main application launcher first." >&2
  exit 1
fi
echo "Opening the independent Budget Terminal Diagnostic Logs viewer. Logs retain up to the last 15 days."
node scripts/launch.cjs --logs
status=$?
if [ "$status" -ne 0 ]; then
  printf "Press Return to close this window. "
  read -r response
fi
exit "$status"
