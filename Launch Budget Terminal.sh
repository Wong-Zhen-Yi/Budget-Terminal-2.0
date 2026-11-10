#!/bin/sh
# Linux/macOS entry point; shared runtime checks and startup live in scripts/.
# macOS users can double-click Launch Budget Terminal.command; both use this startup path.
# Curated design references live in docs/; output/ is for ignored local captures.

cd "$(dirname "$0")" || exit 1
printf 'Checking Node.js and application dependencies, then opening Budget Terminal...\n'

# Finder, Dolphin and Steam may not inherit an interactive terminal's PATH.
export PATH="$HOME/.local/bin:$HOME/.local/share/fnm/aliases/default/bin:$HOME/Library/Application Support/fnm/aliases/default/bin:$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if command -v node >/dev/null 2>&1 && node scripts/runtime.cjs >/dev/null 2>&1; then
  exec node scripts/launch.cjs "$@"
fi

# Also check Homebrew LTS, nvm and per-user Steam Deck runtimes without sourcing shell profiles.
for runtime in /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node \
  /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node \
  /opt/homebrew/opt/node@26/bin/node /usr/local/opt/node@26/bin/node \
  "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node \
  "$HOME"/.local/share/budget-terminal/node-*-linux-*/bin/node; do
  if [ -x "$runtime" ] && "$runtime" scripts/runtime.cjs >/dev/null 2>&1; then
    export PATH="$(dirname "$runtime"):$PATH"
    exec "$runtime" scripts/launch.cjs "$@"
  fi
done

echo 'Install Node.js 22.23.4+, 24.22.1+, or 26.12.1+ with npm 10.9.8+, then launch again.' >&2
exit 1
