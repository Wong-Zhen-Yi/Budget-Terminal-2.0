#!/bin/sh
# Reinstall workspace dependencies when an incoming revision changed a manifest.
# Sourced by post-merge and post-checkout; $1 is the old revision, $2 the new one.

old_rev="$1"
new_rev="$2"

[ -n "$old_rev" ] && [ -n "$new_rev" ] || exit 0
[ "$old_rev" = "$new_rev" ] && exit 0

changed=$(git diff --name-only "$old_rev" "$new_rev" -- \
  package-lock.json package.json 'apps/*/package.json' 2>/dev/null)

[ -n "$changed" ] || exit 0

echo "[budget-terminal] dependency manifest changed:"
echo "$changed" | sed 's/^/  /'
echo "[budget-terminal] running npm install..."
npm install --no-audit --no-fund
