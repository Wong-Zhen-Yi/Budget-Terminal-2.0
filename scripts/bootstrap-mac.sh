#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

case "$(uname -m)" in
  arm64) architecture=arm64; checksum=89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7 ;;
  x86_64) architecture=x64; checksum=d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035 ;;
  *) echo 'Budget Terminal requires an Apple Silicon or Intel 64-bit Mac.' >&2; exit 1 ;;
esac

# Official checksums are published with the Node.js release.
version=24.22.1
folder="node-v$version-darwin-$architecture"
runtime_root="$HOME/Library/Application Support/BudgetTerminal/runtimes"
runtime="$runtime_root/$folder"

runtime_ready() {
  [ -x "$1/bin/node" ] && [ -x "$1/bin/npm" ] &&
    "$1/bin/node" scripts/runtime.cjs
}

if ! runtime_ready "$runtime"; then
  if [ -e "$runtime" ]; then
    echo "The Budget Terminal runtime at $runtime could not be used. If it is incomplete, move it aside and try again." >&2
    exit 1
  fi
  echo "Installing Node.js $version for Budget Terminal (no administrator access needed)..."
  mkdir -p "$runtime_root"
  stage=$(mktemp -d "$runtime_root/.install-XXXXXX")
  trap 'rm -rf "$stage"' EXIT
  trap 'exit 1' HUP INT TERM
  archive="$stage/$folder.tar.gz"
  /usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    "https://nodejs.org/dist/v$version/$folder.tar.gz" --output "$archive"
  actual=$(/usr/bin/shasum -a 256 "$archive")
  if [ "${actual%% *}" != "$checksum" ]; then
    echo 'Node.js download checksum did not match the official release.' >&2
    exit 1
  fi
  /usr/bin/tar -xzf "$archive" -C "$stage"
  runtime_ready "$stage/$folder"
  # A concurrent launcher may have installed the same runtime while we downloaded it.
  if ! mv "$stage/$folder" "$runtime_root/"; then
    runtime_ready "$runtime" || exit 1
  fi
  rm -rf "$stage"
  trap - EXIT HUP INT TERM
fi

export PATH="$runtime/bin:$PATH"
exec "$runtime/bin/node" scripts/launch.cjs "$@"
