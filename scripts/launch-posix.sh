#!/bin/sh
# Shared runtime discovery for the macOS and Linux launchers.
cd "$(dirname "$0")/.." || exit 1
printf '\n  Preparing Budget Terminal launcher...\n'

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

if [ "$(uname -s)" = Darwin ]; then
  exec /bin/sh scripts/bootstrap-mac.sh "$@"
fi
if [ "$(uname -s)" = Linux ]; then
  exec /bin/sh scripts/bootstrap-linux.sh "$@"
fi

echo 'Install Node.js 22.23.4+, 24.22.1+, or 26.12.1+ with npm 10.9.8+, then launch again.' >&2
exit 1
