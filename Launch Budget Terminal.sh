#!/bin/sh

cd "$(dirname "$0")" || exit 1

# Dolphin and Steam do not inherit the PATH from an interactive terminal.
export PATH="$HOME/.local/bin:$HOME/.local/share/fnm/aliases/default/bin:$HOME/.volta/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install the latest Node.js 24 LTS, then run this launcher again." >&2
  exit 1
fi

echo "Building and verifying the latest production app, including Yahoo pacing, Trading Volumes hover highlights and the median-centered Beta chart."
echo "All implemented pages preload at startup; progress and failures remain visible. Keep this terminal open."
echo "Settings Page Load Order includes Export for AI for a local startup diagnostic text report. Nothing is uploaded automatically."
echo "Includes bounded 4 MB News images, corrected daily S&P500 holdings freshness and expiry-aware WTI contract selection."
echo "Pre-Market futures recover through daily history when hourly feeds fail or return stale data; genuine outages remain visible."
exec node scripts/launch.cjs
