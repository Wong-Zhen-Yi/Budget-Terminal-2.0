#!/bin/zsh -l

# Finder starts .command files in Terminal; always run from this checkout.
cd -- "${0:A:h}" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

fail() {
  print -r -- ""
  print -r -- "$1"
  read -r "?Press Return to close this window. "
  exit 1
}

command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 ||
  fail "Node.js and npm are required. Install Node.js, then double-click this launcher again."

if [[ ! -d node_modules || ! -d node_modules/electron ]]; then
  print -r -- "Installing Budget Terminal dependencies…"
  npm install || fail "Dependency installation failed. See the error above."
fi

npm run ensure:electron || fail "Electron could not start. Run npm install in this folder and try again."

print -r -- "Starting Budget Terminal. Keep this Terminal window open while using the app."
npm run dev || fail "Budget Terminal stopped with an error. See the details above."
