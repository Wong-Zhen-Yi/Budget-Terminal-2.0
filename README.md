# Budget Terminal 2.0

A local market-research and portfolio application built with Electron, React and
TypeScript. This repository is the application source of truth. The same services
also support a browser interface served from your computer.

## Setup and launch

Use Node.js 24 or newer and npm 11. From the repository root:

```bash
npm install
npm run dev
```

On Windows, **Budget Terminal Windows Electron.cmd** starts the desktop app;
**Budget Terminal Windows Browser.cmd** starts browser mode. On macOS, use
**Launch Budget Terminal Macos.command** or **Launch Budget Terminal Macos Browser.command**.

Installation and the launchers verify the Electron runtime automatically. To repair
an interrupted Electron download, run:

```bash
npm run ensure:electron
```

For browser development:

```bash
npm run dev:web
```

Open **http://127.0.0.1:3000**. Set `PORT` to select another port. Keep the server
terminal open while using browser mode; Ctrl+C stops it. The server binds only to
loopback and rejects cross-site requests. It is a local, single-user application.

For a built browser version:

```bash
npm run build:web
npm run start:web
```

For desktop bundles, run `npm run build`, then
`npm run preview --workspace budget-terminal-desktop`. The build does not produce
an installer. Browser assets under `apps/desktop/out/web` require the Node server;
they are not a standalone static website.

## Workspaces

All 41 pages, including Settings, are implemented:

| Workspace | Pages |
|---|---|
| Overview | Dashboard, News, Calendar, YouTube, Dictionary |
| Markets | Pre-Market, Heatmap, Up/Down, Trading Volumes, Beta, Market Cap, Price, ETF, S&P500, Forex, Crypto, Gold, Oil |
| Research | Stocks, Fundamentals, Valuation, Institutions |
| Focus | BMNR, Bitcoin |
| Trading | Charts, Options, Day Trading, Quant, Backtest, Roll |
| Macro & events | Global, Economic, Bonds, Money, IPO, Politics |
| My money | Portfolio, Personal Finance, Cards, Projections |

Star pages to pin them to Favorites. Recently viewed pages appear in the sidebar;
Ctrl+K or backtick opens page search with recent pages first. Settings controls page
visibility, order, favorites, privacy and the market clock.

The Research bar carries a ticker into Stocks, Fundamentals, Charts, Options or
Valuation. Clicking a ticker in Portfolio opens Stocks. The bar follows the selected
ticker on research pages; its buttons transfer that ticker explicitly. Options
handoffs open a single-expiration chain. Hidden pages remain hidden.

## Startup and data freshness

Startup prefetch is limited to five eligible pages: the current page, favorites,
then recently viewed pages. Hidden pages are excluded. Heavy screens (Trading
Volumes, Heatmap, Economic, Bonds and ETF) are prefetched only when current or
favorited. Pages without a prefetch task load when opened. Background work yields
to foreground requests and skips fresh cached results.

Settings > Data Health shows startup task timings and the latest observed feed
results. Up to 200 panel records persist in the local renderer profile; older
records are marked **Previous session** and do not count as current health. Clear
removes that history. This report describes observed results, not continuous
monitoring of unopened pages.

Valuation, ETF and Portfolio Metrics show source, freshness, snapshot time and data
issues beside their results. ETF and portfolio history also show coverage. Snapshot
time is not an exchange quote timestamp or a statement's fiscal date. Cached and
partial results remain usable when a provider fails, with their limitations visible.

Market data comes from Yahoo Finance, SEC, fund issuers and other public providers.
Feed availability and coverage can vary. Yahoo requests share a rate gate; the
footer's API bars show app-side request pressure, not a provider-reported quota.

## Saved data and backups

On Windows, browser and desktop mode share data under
`%APPDATA%\BudgetTerminalElectron` and market caches under
`%LOCALAPPDATA%\BudgetTerminalElectron`. Other platforms default to
`~/.budget-terminal/data/BudgetTerminalElectron` and
`~/.budget-terminal/cache/BudgetTerminalElectron`. `APPDATA` and `LOCALAPPDATA`
can override these locations.

Only one desktop process or browser server can own a data folder at a time. Stop
that host before switching modes. A second host reports that the folder is in use.
The operating system releases ownership after a crash; no manual lock-file cleanup
is needed. Multiple browser tabs can use the same running server.

Stores start empty and writes are serialized and atomic. Settings > User Data
exports portfolios, the options tracker, personal finance, Cards and settings in
one JSON backup. Imports replace the corresponding saved data; the confirmation
describes rollback behavior. Clear User Data preserves settings.

A backup reminder appears in Settings when no export has been recorded or the last
export was at least seven days ago. Export time is shared between modes. In browser
mode, verify that the download completed. Keep a copy outside this computer.
Renderer preferences such as recent pages, chart drawings and data-health history
are local to that browser/desktop profile and are not included in the JSON backup.

## Architecture

```
React renderer -> window.api -> Electron IPC or local HTTP -> shared services
                                                        -> public data providers
                                                        -> JSON stores / cache
```

- `apps/desktop/src/pages`: page components.
- `src/components`, `src/charts`, `src/api`, `src/stores`: UI, charts, queries and state.
- `electron/services`: provider access, rate limiting, caching and persistence.
- `electron/shared`: typed contracts and pure calculations.
- `electron/ipc` and `electron/preload.ts`: restricted desktop bridge.
- `web`: local HTTP host for the same service handlers.
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
npm run build:web
npm run probe:web
npm run probe:settings
npm run probe:charts -- --offline
npm run probe:stocks -- --offline
npm run probe:loading --workspace budget-terminal-desktop
npm run probe:session --workspace budget-terminal-desktop
npm run probe:security --workspace budget-terminal-desktop
npm run probe:data-health --workspace budget-terminal-desktop
```

The security probe requires a desktop build and runs the real sandboxed preload in
Electron. Session checks cover cross-process exclusion and recovery after a crash.
Persistence probes use temporary data directories. The loading probe tests cache
coalescing, startup selection, stale fallback and foreground request isolation.

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
