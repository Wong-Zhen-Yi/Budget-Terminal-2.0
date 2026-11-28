# launchers/linux

## Overview
The Linux double-click launcher, `Launch Budget Terminal.sh`. It runs the shared path in `scripts/launch-posix.sh`: install, Electron check, build (including MCP), and verify, then opens the app. It bootstraps Node on Linux when none is installed ([launchers/linux/Launch Budget Terminal.sh]).

## Interface
- `Launch Budget Terminal.sh` - the only Linux launcher. Its header lists the shared-build behaviour it depends on.
- Related command: `npm run setup:linux` installs the desktop and app-menu entry ([package.json:setup:linux]).

## Invariants
- Launch logic stays on the shared build path. Only the `# The shared build ...` comment lines change with user-visible updates ([AGENTS.md:User notes]).
- Linux keeps 1:1 parity with the Windows launcher ([CLAUDE.md:Launchers and repository hygiene]).

## Side Effects
- Bootstraps Node when missing (`scripts/bootstrap-linux.sh`).
- Builds the app and MCP bundle and opens the desktop app.

## Verification
- Run: `npm run probe:launcher`
