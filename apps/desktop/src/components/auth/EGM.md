# src/components/auth

## Overview
The sign-in popup for cloud sync.

## Interface
- `AuthPopup` - sign-in popup component.

## Invariants
- None verified in this scan.

## Side Effects
- Starts the sign-in flow through the main process (`cloudSyncHost.ts`, see [electron/services/EGM.md](../../../electron/services/EGM.md)).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:auth-ui` after `npm run build`
