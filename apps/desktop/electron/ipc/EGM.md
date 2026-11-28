# ipc

## Overview
Connects renderer channels to main-process handlers. `handlers.ts` holds shell-only handlers. `serviceHandlers.ts` registers every data and service channel.

## Interface
- `handlers.ts:registerIpcHandlers` - registers the shell handlers (dialogs, clipboard, shell, and the backup save dialog) ([handlers.ts:registerIpcHandlers]).
- `serviceHandlers.ts:registerServiceHandlers` - registers every data and service channel ([serviceHandlers.ts:registerServiceHandlers]).
- `serviceHandlers.ts:RegisterService` - the type of a registration callback ([serviceHandlers.ts:RegisterService]).

## Invariants
- Each service channel must be classified in `electron/mcp/routes.ts`. `createServiceRoutes` throws at startup if a channel is in neither the MCP allowlist nor `desktopOnlyChannels` ([mcp/routes.ts:createServiceRoutes]).

## Side Effects
- `dialog`, `clipboard`, and `shell` calls. The backup save dialog defaults to `app.getPath('downloads')` ([handlers.ts:140]).
- On teardown, removes every channel handler with `ipcMain.removeHandler` ([handlers.ts:251]).

## Verification
- Run: `npm run typecheck`
