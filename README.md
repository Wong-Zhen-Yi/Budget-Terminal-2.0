# Budget Terminal 2.0

A local market-research and portfolio application built with Electron, React and
TypeScript. This repository is the application source of truth.

## Setup and launch

Use Node.js 24 or newer and npm 11. From the repository root:

```bash
npm install
npm run dev
```

To launch from a checkout, use **Launch Budget Terminal.cmd** on Windows,
**Launch Budget Terminal.command** on macOS, or **Launch Budget Terminal.sh**
on Linux. Each launcher installs dependencies, checks the Electron runtime,
and opens the desktop app. Keep its terminal open while using the app.

Installation and the launchers verify the Electron runtime automatically. To repair
an interrupted Electron download, run:

```bash
npm run ensure:electron
```

For desktop bundles, run `npm run build`, then
`npm run preview --workspace budget-terminal-desktop`. The build does not produce
an installer.

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

On Windows, the app saves data under
`%APPDATA%\BudgetTerminalElectron` and market caches under
`%LOCALAPPDATA%\BudgetTerminalElectron`. Other platforms default to
`~/.budget-terminal/data/BudgetTerminalElectron` and
`~/.budget-terminal/cache/BudgetTerminalElectron`. `APPDATA` and `LOCALAPPDATA`
can override these locations.

These data folders are outside the source checkout and are excluded from Git.
On the first launch after upgrading from a version that saved `portfolio.json`
under `apps/desktop/AppData/Roaming/BudgetTerminalElectron`, the desktop app
recovers that older portfolio if the current book is absent or still the empty
default. It keeps a copy of an empty current book before replacement and never
replaces a portfolio with holdings, cash, options, or custom organization.

Only one desktop process can own a data folder at a time. Launching the app again
brings the existing window forward, including when it is hidden or minimized.
A separate process using the same data folder still reports that the folder is
in use. The operating system releases ownership after a crash; no manual
lock-file cleanup is needed.

Stores start empty and writes are serialized and atomic. Settings > User Data
exports portfolios, the options tracker, personal finance, Cards and settings in
one JSON backup. Imports replace the corresponding saved data; the confirmation
describes rollback behavior. Clear User Data preserves settings.

A backup reminder appears in Settings when no export has been recorded or the last
backup was at least seven days ago. Every saved change to portfolios, options,
Personal Finance, Cards or settings also updates `budget-terminal-backup.json` in
Downloads. The app replaces that same file atomically and reports failures without
discarding the local save or the previous backup. Imports and clearing user data
update the file too. Keep a copy outside this computer. Renderer
preferences such as recent pages, chart drawings and data-health history are local
to the Electron profile and are not included in the JSON backup.

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

## Local MCP for ChatGPT and Codex

Budget Terminal exposes 77 MCP tools: all 75 service operations, page screenshots,
and connection status. Research tools use the same caches and provider rate gate as the app.
Write tools edit saved portfolios, options records, Cards, personal finance and
settings through the existing stores and automatic backup. These are local record
edits, not broker orders. Bulk import/export, clear-all, cache reset and shell
operations remain in the desktop UI.

The bridge starts automatically when Budget Terminal opens. Settings > Data >
Local MCP reports readiness or startup failures. MCP discovery works while the
app is closed; service calls then say to open Budget Terminal. Restarting the app
rotates its session token and port; existing MCP clients recover on their next
call. Do not retry a write after a timeout or interrupted response until you have
read the saved record to check whether it completed.

Build and verify from the repository root:

```bash
npm run build
npm run probe:mcp
```

The standalone entrypoint is `apps/desktop/out/mcp/server.mjs` and requires
Node.js 22 or newer. Register it with the installed Codex CLI using absolute
paths (quote each path separately):

```text
codex mcp add budget-terminal --env BUDGET_TERMINAL_DATA_DIR=<absolute-data-folder> -- <absolute-node-executable> <absolute-repository>/apps/desktop/out/mcp/server.mjs
```

Use the full data folder: on Windows this is normally
`%APPDATA%\BudgetTerminalElectron`; macOS/Linux normally use
`~/.budget-terminal/data/BudgetTerminalElectron`. If the app uses an `APPDATA`
override, point the MCP adapter to that same app data folder. Do not put a session
token in client configuration. Do not register an npm command: npm's banners can
corrupt stdio protocol output. `npm run --silent mcp` is available for manual
process startup; configured clients should run Node directly.

For heavy research screens, set `startup_timeout_sec = 15` and
`tool_timeout_sec = 180` inside the server's `[mcp_servers.budget-terminal]`
table in the client's `config.toml`. These values are configured on this machine.

Supported ChatGPT/Codex desktop clients and Codex CLI can share the same local
host configuration. Restart or reload the client's MCP connection after initial
registration. Alternatively, add a STDIO server in desktop Settings > MCP servers
with the same Node command, entrypoint argument, and data-directory environment
variable. Local execution is required; this package alone does not provide a
cloud/web endpoint. See the [official MCP configuration guide](https://learn.chatgpt.com/docs/extend/mcp).

`codex mcp get budget-terminal` and `codex mcp list` inspect registration.
`codex mcp remove budget-terminal` removes it without deleting app data.
Call `budget_terminal_connection_status` first when diagnosing availability.
Tools accept a `request` object; reads with no parameters use
`{ "request": {} }`. The connection-status tool uses `{}` directly. For example:

```json
{ "request": { "symbol": "AAPL" } }
```

Use that input with `budget_terminal_stocks`; sources, timestamps, freshness and
partial-data errors are preserved in structured output and JSON text.

Use `budget_terminal_screenshot` with `{ "request": {} }` to capture the current
page, `{ "request": { "page": "charts" } }` for a specific tab id, or
`{ "request": { "page": "all" } }` for every implemented page, including hidden
tabs. Results contain PNG image blocks with page ids, dimensions, capture times,
privacy and startup-loading status, and the visible footer status. Captures show
the current viewport, including any loading or error state; they do not wait for
provider fetches. Electron captures its rendered content even when the window is
covered, hidden or minimized, without bringing it forward. The selected tab and
background throttling are restored afterward. Screenshots preserve privacy blur.

`npm run build:mcp` also prepares a self-contained local plugin under
`plugins/budget-terminal`, including its generated `server/server.mjs` bundle.
Generated bundles are excluded from Git; rebuild before copying or packaging that
folder. Install either the local plugin or the direct MCP registration to avoid
duplicate tools. The plugin uses Node from PATH; direct registration can use an
absolute executable path. No account upload or public publication is required.

The Electron bridge listens only on IPv4 loopback and requires a random per-session
bearer token. Its runtime descriptor lives in a restricted `.mcp` directory beside
the saved data (owner-only permissions on Unix; current-user ACL on Windows).
Browser-origin requests, invalid schemas, unknown routes and bodies larger than
2 MiB are rejected. Logs do not include tokens or saved records.

Additional verification: `npm run probe:security --workspace budget-terminal-desktop`
checks real Electron IPC and mutation events; `npm run probe:loading-ui --workspace budget-terminal-desktop`
checks the status panel, all-page startup navigation, and PNG capture of all pages
with hidden, minimized and covered windows. The MCP probe uses only
temporary data/cache/backup folders and deterministic provider substitutes for
research routing. Live feed availability is not asserted by those offline probes.
