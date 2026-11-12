#!/bin/sh
# Settings dashboard fits the full provider inventory without overlapping chart titles or notes.
# Finnhub queues portfolio quotes and retains stock prices during cooldowns; perp updates cannot overwrite them.
# macOS Finder entry point. Share runtime checks and startup updates with Linux.
# Keep dependency checks and build output visible in Terminal before opening the app.
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
