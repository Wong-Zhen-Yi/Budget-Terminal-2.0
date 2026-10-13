# Data, startup and backups

[Back to the README](../README.md)

## Startup and data freshness

Startup begins loading every implemented page, including hidden and unvisited
pages. The current page, favorites and recent pages help order the work; previously
observed load times also inform ordering. Pages share cached queries where
appropriate, and local-only pages use saved data. Once startup finishes, page
switching uses the prepared content. Startup progress and provider failures remain
visible; failed pages are not treated as ready. Background work yields to foreground
requests and reuses fresh cached results.

Settings > Data Health shows startup task timings and the latest observed feed
results. Up to 200 panel records persist in the local renderer profile; older
records are marked **Previous session** and do not count as current health. Clear
removes that history. This report describes observed startup and subsequent feed
results, not continuous monitoring of every feed.

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
