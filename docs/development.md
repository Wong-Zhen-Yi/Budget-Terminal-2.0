# Development guide

[Back to the README](../README.md)

## Architecture

```
React renderer -> window.api -> Electron IPC -> shared services
                                               -> public data providers
                                               -> JSON stores / cache
```

- `apps/desktop/src/pages`: page components.
- `src/components`, `src/charts`, `src/api`, `src/stores`: UI, charts, queries and state.
- `electron/services`: provider access, rate limiting, caching and persistence.
- `electron/shared`: typed contracts and pure calculations.
- `electron/ipc` and `electron/preload.ts`: restricted desktop bridge.
- `scripts/probe-*.ts`: standalone verification scripts.
- `out`: generated bundles and probe artifacts, excluded from Git.

Service results use `Envelope<T>` with data, freshness metadata and non-fatal errors.
The Electron renderer uses context isolation, disabled Node integration and process
sandboxing. Its bundled CommonJS preload exposes specific API methods; IPC handlers
accept only the trusted shell's main frame. Navigation is blocked and HTTP(S) links
open externally. Clipboard writes are the only renderer permission allowed.

## Verification

Run from the repository root:

```bash
npm run typecheck
npm run build
npm run probe:launcher
npm run probe:settings
npm run probe:backup --workspace budget-terminal-desktop
npm run probe:charts -- --offline
npm run probe:stocks -- --offline
npm run probe:loading --workspace budget-terminal-desktop
npm run probe:session --workspace budget-terminal-desktop
npm run probe:relaunch --workspace budget-terminal-desktop
npm run probe:security --workspace budget-terminal-desktop
npm run probe:data-health --workspace budget-terminal-desktop
```

The security probe requires a desktop build and runs the real sandboxed preload in
Electron. Session checks cover cross-process exclusion and recovery after a crash.
Persistence probes use temporary data directories. The loading probe tests cache
coalescing, startup selection, stale fallback and foreground request isolation.

For the complete maintenance pass after building, run
`npm run probe:maintenance -- --ui` for offline and Electron UI probes in isolated
profiles. `npm run probe:maintenance-live` checks public feeds separately. These commands save their
results under `apps/desktop/out/maintenance` for inspection; provider failures
remain visible in the live report.

Use the matching offline probe after changing calculations or UI. Use live probes
when changing a provider, for example `npm run probe:stocks -- AAPL`. Live probes
contact external services and depend on their availability. More commands are listed
in `apps/desktop/package.json`; scripts not exposed at the root need the workspace
flag. Validate visible changes in the app as well as with TypeScript.

## Data-layer conventions

- Preserve partial results and distinguish missing values from zero.
- MA200 is calculated from daily bars and aligned to the displayed interval.
- RSI uses Wilder smoothing; Stocks MFI uses a 14-period rolling sum.
- Strip extra partial-period/zero-volume quote rows where the chart service requires it.
- Historical return calculations use adjusted prices and calendar-aware windows.
- Keep Yahoo requests behind the shared rate gate and reuse cached provider results.
- Portfolio and Dashboard weight denominators differ: Dashboard uses stock value;
  Portfolio includes counted cash. Label the basis when comparing results.

Installer packaging and automatic application updates are not configured.
