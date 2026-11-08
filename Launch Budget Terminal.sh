#!/bin/sh
# Controller page switching follows visible workspace/page order, including custom ordering and hidden pages.
# Compact layouts keep Treasury curves, market controls, probability statistics and heatmap details accessible.
# Personal Finance charts keep readable values while Totals and Goal resize to the screen.
# Obscure hides recurring bill names and amounts; Reveal restores editable names.
# Personal Finance: Steam Deck layout keeps recurring bill names readable and the Goal panel visible.
# Controller support: D-pad/left stick focus, A activate, B dismiss, shoulders switch pages, Menu page picker, right stick scroll.
# Steam Deck: centered display bounds in Desktop Mode; native fullscreen in Gaming Mode.

cd "$(dirname "$0")" || exit 1

# Dolphin and Steam do not inherit an interactive terminal's PATH.
export PATH="$HOME/.local/bin:$HOME/.local/share/fnm/aliases/default/bin:$HOME/.volta/bin:$PATH"

if command -v node >/dev/null 2>&1 && node scripts/runtime.cjs >/dev/null 2>&1; then
  exec node scripts/launch.cjs "$@"
fi

# Also support a per-user runtime installed for Budget Terminal on Steam Deck.
for runtime in "$HOME"/.local/share/budget-terminal/node-*-linux-*/bin/node; do
  if [ -x "$runtime" ] && "$runtime" scripts/runtime.cjs >/dev/null 2>&1; then
    export PATH="$(dirname "$runtime"):$PATH"
    exec "$runtime" scripts/launch.cjs "$@"
  fi
done

echo 'Install Node.js 22.23.4+, 24.22.1+, or 26.12.1+ with npm 10.9.8+, then launch again.' >&2
exit 1
