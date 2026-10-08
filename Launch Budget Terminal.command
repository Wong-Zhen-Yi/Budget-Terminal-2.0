#!/bin/sh

cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install the latest Node.js 24 LTS, then run this launcher again."
  printf 'Press Return to close this window. '
  read -r response
  exit 1
fi

node scripts/launch.cjs
status=$?
if [ "$status" -ne 0 ]; then
  printf '\nBudget Terminal could not start.\n'
  printf 'Press Return to close this window. '
  read -r response
fi
exit "$status"
