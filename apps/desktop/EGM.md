# budget-terminal-desktop

## Overview
The Electron + React application package. Its direct files are the build and workspace configuration. Source code lives in the child folders.

## Interface
- `electron.vite.config.ts` - electron-vite build configuration. Its outputs go to `out/` ([CLAUDE.md:Commands]).
- `package.json:scripts` - `typecheck` (`tsc --noEmit`), `build`, `build:mcp`, and the `probe:*` family ([apps/desktop/package.json:scripts]).
- Path aliases: `@shared/*` → `electron/shared/*` and `@/*` → `src/*` ([CLAUDE.md:Renderer data flow]).
- Child packages: [./convex/EGM.md](./convex/EGM.md), [./electron/EGM.md](./electron/EGM.md), [./mcp/EGM.md](./mcp/EGM.md), [./resources/EGM.md](./resources/EGM.md), [./scripts/EGM.md](./scripts/EGM.md), [./src/EGM.md](./src/EGM.md).

## Invariants
- This is the only npm workspace in the repository ([CLAUDE.md:Commands]).

## Side Effects
- `npm run build` writes bundles to `apps/desktop/out/`. It does not create an installer ([CLAUDE.md:Commands]).

## Verification
- Run: `npm run typecheck`
