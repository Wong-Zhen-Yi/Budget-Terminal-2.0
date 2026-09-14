#!/bin/zsh -l

cd -- "${0:A:h}" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

fail() {
  print -r -- "$1"
  read -r "?Press Return to close this window. "
  exit 1
}

command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 ||
  fail "Node.js and npm are required. Install Node.js, then run this launcher again."

npm install --no-audit --no-fund || fail "Dependency installation failed. See the error above."
print -r -- "Starting Budget Terminal in your browser. Keep this Terminal window open."
npm run dev:web --workspace budget-terminal-desktop -- --open ||
  fail "Budget Terminal Browser stopped with an error. See the details above."
