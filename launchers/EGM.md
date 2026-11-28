# launchers

## Overview
Double-click launchers. The Windows launcher is a `.cmd` file and the Linux launcher is a `.sh` file. Both run the shared path in `scripts/`. The Windows launcher is not contracted here because it has no code files under the discovery rules.

## Subdirectories & Boundaries
- `linux`: [./linux/EGM.md](./linux/EGM.md) - Linux double-click launcher (`Launch Budget Terminal.sh`).
- `windows` - `Launch Budget Terminal.cmd`, which wraps `scripts/launch-windows.ps1`. It has no code-extension files and no contract ([CLAUDE.md:Launchers and repository hygiene]).
