#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

case "$(uname -m)" in
  aarch64|arm64) architecture=arm64; checksum=33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3 ;;
  x86_64|amd64) architecture=x64; checksum=eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c ;;
  *) echo 'Budget Terminal requires a 64-bit x86 or ARM Linux system.' >&2; exit 1 ;;
esac

# Official checksums are published with the Node.js release (SHASUMS256.txt).
version=24.22.1
folder="node-v$version-linux-$architecture"
# launch-posix.sh also searches this folder before bootstrapping.
runtime_root="$HOME/.local/share/budget-terminal"
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
  command -v curl >/dev/null 2>&1 || { echo 'Install curl (sudo apt install curl), then launch again.' >&2; exit 1; }
  echo "Installing Node.js $version for Budget Terminal (no administrator access needed)..."
  mkdir -p "$runtime_root"
  stage=$(mktemp -d "$runtime_root/.install-XXXXXX")
  trap 'rm -rf "$stage"' EXIT
  trap 'exit 1' HUP INT TERM
  archive="$stage/$folder.tar.gz"
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    "https://nodejs.org/dist/v$version/$folder.tar.gz" --output "$archive"
  actual=$(sha256sum "$archive")
  if [ "${actual%% *}" != "$checksum" ]; then
    echo 'Node.js download checksum did not match the official release.' >&2
    exit 1
  fi
  tar -xzf "$archive" -C "$stage"
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
