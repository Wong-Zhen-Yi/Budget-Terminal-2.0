# electron (main process)

## Overview
The Electron main process. `main.ts` starts the app. `preload.ts` exposes the `window.api` bridge. IPC, MCP, services, workers, and shared contracts live in child folders.

## Interface
- `main.ts` - application entry point. It has no exports. It calls `configureAutomaticBackup(app.getPath('downloads'))` ([main.ts:configureAutomaticBackup]).
- `preload.ts:createApi` - builds the API with `createApi` and exposes it with `contextBridge.exposeInMainWorld('api', …)` ([preload.ts:exposeInMainWorld]).
- Child packages: [./ipc/EGM.md](./ipc/EGM.md), [./mcp/EGM.md](./mcp/EGM.md), [./services/EGM.md](./services/EGM.md), [./shared/EGM.md](./shared/EGM.md), [./workers/EGM.md](./workers/EGM.md).

## Invariants
- Context isolation is on, the preload is sandboxed, and the renderer has no Node integration ([CLAUDE.md:Main process]).
- IPC is accepted only from the trusted main frame. The check is `isTrustedRendererUrl` ([shared/ipcSecurity.ts:isTrustedRendererUrl]).

## Side Effects
- Reads and writes app data through the services layer. The downloads folder is used as the default backup location ([main.ts:configureAutomaticBackup]).
- Opens Electron windows and shell integrations through the IPC handlers ([ipc/EGM.md](./ipc/EGM.md)).

## Verification
- Run: `npm run typecheck`
- Run: `npm run build`
