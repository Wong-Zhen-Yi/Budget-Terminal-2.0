#!/bin/sh
# Convex snapshot writes are restored; record-era cloud tables are retained as an archive.
# Double-click opens the desktop app directly without an interface chooser.
# Database sync restored to 3208321: optional Convex snapshots, GitHub sign-in and complete-copy conflict choices.
# macOS Finder entry point. Share runtime checks and startup updates with Linux.
cd "$(dirname "$0")" || exit 1

/bin/sh './Launch Budget Terminal.sh' "$@"
status=$?
if [ "$status" -ne 0 ] && [ -t 0 ]; then
  printf '\nBudget Terminal could not open. Fix the error above, then double-click this file to retry.\nPress Enter to close. '
  read -r reply
fi
exit "$status"
