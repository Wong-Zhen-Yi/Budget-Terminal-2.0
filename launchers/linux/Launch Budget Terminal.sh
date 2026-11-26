#!/bin/sh
# Linux double-click launcher. It runs the shared install, build (including MCP) and verify path in scripts/launch-posix.sh.
# The shared build bootstraps a private Node.js runtime on Linux when none is installed.
# The shared build trusts the desktop shortcut on GNOME (Ubuntu) and XFCE and generates the same MCP schemas as Windows.
# The shared build gives Linux the same btd commands as Windows, including restart and mobile.
# The shared build opens one terminal on double-click; the desktop entry no longer asks XFCE for a second one.
# The shared build adds the Claude Code agent provider and stops a fresh device uploading default data to an empty cloud.
# The shared build fixes Agents tool calls on Claude Code that failed with "request must be object".
# The shared build syncs automatically after Google sign-in: no workspace choice, and a new device restores or uploads on its first sync.
here=$(cd "$(dirname "$0")" && pwd) || exit 1
launcher="$here/../../scripts/launch-posix.sh"

# File managers run scripts without a terminal; reopen in one so build progress and errors stay visible.
if [ ! -t 1 ] && [ -z "${BUDGET_TERMINAL_IN_TERMINAL:-}" ]; then
  export BUDGET_TERMINAL_IN_TERMINAL=1
  for terminal in xfce4-terminal gnome-terminal ptyxis konsole kitty alacritty xterm x-terminal-emulator; do
    command -v "$terminal" >/dev/null 2>&1 || continue
    case "$terminal" in
      xfce4-terminal) exec xfce4-terminal -x /bin/sh "$0" ;;
      gnome-terminal|ptyxis) exec "$terminal" -- /bin/sh "$0" ;;
      kitty) exec kitty /bin/sh "$0" ;;
      *) exec "$terminal" -e /bin/sh "$0" ;;
    esac
  done
fi

# Like the Windows .cmd (-Attached), keep the app attached so build output and errors stay visible.
/bin/sh "$launcher" --attached
status=$?
if [ "$status" -ne 0 ] && [ -t 0 ]; then
  printf '\n  Budget Terminal stopped with an error. Press Enter to close this window.'
  read -r _
fi
exit "$status"
