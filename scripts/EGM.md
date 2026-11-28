# scripts (root)

## Overview
Root-level launch, install, update, and verification scripts. They run the shared install, Electron check, build (including MCP), and verify path before the app opens ([CLAUDE.md:Launchers and repository hygiene]).

## Interface
Root `package.json` entry points ([package.json:scripts]):
- `dev` → `scripts/dev.cjs` - runs the dev build with watch on Windows and Linux.
- `preinstall` → `scripts/runtime.cjs` - prepares the Node runtime.
- `postinstall` / `ensure:electron` → `scripts/ensure-electron.cjs` - verifies or bootstraps Electron.
- `setup:linux` → `scripts/install-linux-launcher.cjs` - installs the desktop and app-menu entry.
- `setup:linux-sandbox` → `scripts/linux-sandbox.cjs`.
- `probe:launcher` → `scripts/probe-launcher.cjs`; `probe:agent-privacy` → `scripts/probe-agent-privacy.cjs`.

Other files:
- `launch.cjs` - production launch and the `--demo` flag ([CLAUDE.md:Launchers and repository hygiene]).
- `launch-windows.ps1`, `install-bt.ps1`, `launch-posix.sh`, `bootstrap-linux.sh`, `bootstrap-mac.sh` - platform launch and install paths.
- `update.cjs` - update flow.
- `verify-desktop-build.cjs` - never opens Electron onto a partial or missing production build ([verify-desktop-build.cjs]).
- `check-private-agent-data.cjs` - blocks Agents data and browser login profiles from commits ([.githooks/pre-commit]).
- `demo-session.cjs`, `capture-demo.cjs` - demo profile and screenshot support.
- `export-branding.cjs` - exports brand assets.
- `probe-windows-launcher.ps1` - Windows launcher probe.

## Invariants
- Windows and Linux stay at 1:1 parity for every command and flag ([CLAUDE.md:Launchers and repository hygiene]).
- Only `launchers/windows/Launch Budget Terminal.cmd` and `launchers/linux/Launch Budget Terminal.sh` are double-click launchers ([AGENTS.md:User notes]).
- The shared build must produce the current MCP bundle before launch ([AGENTS.md:Keep MCP Up to Date]).

## Side Effects
- Installs dependencies, bootstraps Node and Electron, builds the app and MCP bundle, and writes a desktop shortcut or app-menu entry on Linux (`install-linux-launcher.cjs`).
- Demo and phone-preview runs copy `fixtures/demo-user-data.json` into a temporary profile ([CLAUDE.md:Launchers and repository hygiene]).

## Verification
- Run: `npm run probe:launcher`
- Run: `npm run probe:agent-privacy`
- Run: `npm run typecheck`
