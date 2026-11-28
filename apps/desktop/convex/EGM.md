# convex

## Overview
The Convex backend for optional cloud sync and Google sign-in. Auth lives in the `auth*.ts` and `googleAdapter.ts` files. Sync lives in `sync.ts`, with write quotas in `syncLimits.ts`. Generated runtime bindings are in `_generated/`.

## Interface
- `sync.ts:read`, `sync.ts:write`, `sync.ts:account`, `sync.ts:identity`, `sync.ts:authConfiguration`.
- `auth.ts:startSignInWithGoogle`, `auth.ts:completeSignInWithGoogle`, `auth.ts:revokeOtherSessions`.
- `users.ts:createGoogleUser`, `users.ts:updateGoogleProfile`.
- `syncLimits.ts:SYNC_WRITES_PER_MINUTE`, `syncLimits.ts:SYNC_BYTES_PER_DAY`, `syncLimits.ts:consumeSyncWrite`.
- `googleAdapter.ts:start`, `googleAdapter.ts:complete`, `googleAdapter.ts:googleOAuthConfigured`.
- `authCore.ts:authCore`, `authMaintenance.ts:cleanup`, `legacyAuthTables.ts:legacyAuthTables`.
- Default exports: `crons.ts` (scheduled jobs), `http.ts` (HTTP routes), `schema.ts` (table schema), `auth.config.ts`, `convex.config.ts`.
- Subdirectory: [./_generated/EGM.md](./_generated/EGM.md).

## Invariants
- Each accepted sync write is charged atomically with the change. Retries and conflicts consume no quota ([syncLimits.ts:consumeSyncWrite]).
- Limits are 60 writes per minute and 100,000,000 bytes per day ([syncLimits.ts:SYNC_WRITES_PER_MINUTE], [syncLimits.ts:SYNC_BYTES_PER_DAY]).

## Side Effects
- Reads and writes Convex tables through query and mutation contexts (`sync.ts`, `users.ts`).
- Runs the Google OAuth sign-in flow ([googleAdapter.ts:googleOAuthConfigured]).
- Runs scheduled cleanup jobs ([crons.ts], [authMaintenance.ts:cleanup]).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:cloud-sync`
