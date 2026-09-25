#!/bin/sh

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 24 or newer, then run this launcher again." >&2
  exit 1
fi

exec node scripts/launch.cjs
