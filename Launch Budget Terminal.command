#!/bin/sh
echo "Agent options: MCP refreshes expirations, chains and contract marks. Top-volume research ranks all loaded live expirations and reports missing coverage."
echo "Portfolio Dip Finder: Entry shows percentage gain or loss versus your average purchase price."
echo "Agent news: MCP news tools refresh sources before returning. Summaries check publication dates and report stale data or refresh failures."
echo "Agent reading: highlighting keeps streamed replies steady. Clear the selection to catch up; scroll to the bottom to follow new text."
echo "Performance updates: Quant pair calculations and SQLite persistence run in workers. Extra query memory is bounded, prepared startup pages stay available, and large tables render visible rows."
echo "Startup dependency fixes: Up/Down price targets preload before page readiness; Cards warms every interval after a partial result; News splits multi-ticker article labels into valid quote requests."
echo "Notifications contains the shared Agent inbox and U.S. market-open alerts."

cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install the latest Node.js 24 LTS, then run this launcher again."
  printf 'Press Return to close this window. '
  read -r response
  exit 1
fi

echo "Building and verifying the latest production app, including Yahoo pacing, Trading Volumes hover highlights and the median-centered Beta chart."
echo "All implemented pages preload at startup; progress and failures remain visible. Keep this terminal open."
echo "Settings Page Load Order includes Export for AI for a local startup diagnostic text report. Nothing is uploaded automatically."
echo "Includes bounded 4 MB News images, corrected daily S&P500 holdings freshness and expiry-aware WTI contract selection."
echo "Pre-Market futures recover through daily history when hourly feeds fail or return stale data; genuine outages remain visible."
node scripts/launch.cjs
status=$?
if [ "$status" -ne 0 ]; then
  printf '\nBudget Terminal could not start.\n'
  printf 'Press Return to close this window. '
  read -r response
fi
exit "$status"
