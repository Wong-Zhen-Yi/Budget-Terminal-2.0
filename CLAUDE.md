# CLAUDE.md

Guidance for Claude Code working in this repository.

## Commands

```bash
npm run dev            # Electron + Vite, the supported entry point
npm run typecheck      # tsc --noEmit; run this after touching any .ts/.tsx
npm run probe -- AAPL "1 Week"   # exercise every Yahoo service headless
npm run probe:portfolio          # holdings panel as the UI renders it
npm run probe:rate               # 20-symbol burst; fails on any 429
npm run probe:finance            # every Personal Finance figure, then every write
npm run probe:settings           # settings writes, then export/import/clear/reset-cache
```

There is no test suite. The `scripts/probe*.ts` files are the verification story: they
run the real services without Electron so their output can be compared against the
PySide6 app running side by side. Add to them rather than inventing a parallel harness.

`npm run build` and packaging are untested and out of scope so far.

## What this repo is

A page-by-page rebuild of the PySide6 app at `../Budget-terminal-pyside6`, which is still
the working product. **That app is read-only reference — never edit it.** Its
`CLAUDE.md` explains its own architecture, and its `mixins/` and `services/` are where
the behaviour being ported comes from.

Built so far: the **Dashboard**, the whole **Portfolio** page (summary bar, portfolio
CRUD, and all five sub-tabs: Positions with the options tracker and the Dip Finder and
Weight charts, Pie Chart, Portfolio Heatmap, Momentum Tracker, Portfolio Metrics), the
**Personal Finance** page (Cash, Debt, Recurring Bills, Totals donut, net-worth Goal
ring and the Silos bar chart), and the **Settings** page (one scrolling page grouped
Data / General / Workspace) together with the app-wide keyboard shortcuts. The remaining
tabs are labels in `TABS`
(`electron/shared/contract.ts`) and render a placeholder; `implemented: true` is what
routes a tab to a real page in `App.tsx`.

## Architecture

Three layers, and the boundaries matter:

- `electron/shared/` — types, constants and pure maths imported by **both** the main
  process and the renderer. `contract.ts` is the IPC contract; `portfolioMath.ts` holds
  the weight and gain calculations so the UI and the probe scripts cannot disagree. No
  Electron or React imports here.
- `electron/services/` — all data access, in the main process. `provider.ts` defines
  `MarketDataProvider`, the seam a FastAPI sidecar will implement later for the
  Python-heavy pages. Renderer code must never reach Yahoo directly.
- `src/` — React. Talks only to `window.api` via `src/api/client.ts`.

Every handler returns an `Envelope<T>` (`data`, `meta`, `errors`), mirroring
`attach_market_data_result` in the PySide6 `data_service/results.py`. A panel whose feed
failed shows its own error; it does not take the page down. Keep that property when
adding handlers.

## Rules that are easy to break

- **Reach Yahoo only through `paced()`** in `electron/services/yahoo/client.ts`. A direct
  `yahoo.*` call skips the rate gate, and Yahoo 429s on an unpaced dashboard load. This
  is the same rule as the PySide6 app's "import `yf` from `dependencies`, never
  `yfinance` directly".
- **This app owns its store; the PySide6 file is read once.**
  `electron/services/portfolioStore.ts` writes
  `%APPDATA%\BudgetTerminalElectron\portfolio.json` and reads
  `%LOCALAPPDATA%\BudgetTerminal\user_data.json` only to seed it on first run.
  Never write to the legacy file. Resolve both paths from the environment rather than
  Electron's `app`, so the probe scripts reach the same files.
- **Every write goes through `mutatePortfolios`.** It queues mutations, re-reads, applies
  one, normalises, and persists atomically (temp file plus rename). Returning the whole
  re-read document is deliberate: the renderer writes that straight into the query cache
  instead of guessing at post-write state, so a rejected edit simply renders unchanged.
- **A refused edit is a normal outcome, not an exception.** `provider.mutatePortfolio`
  catches and returns a `partial` envelope carrying the reason. Keep that — duplicate
  tickers, the five-portfolio cap and deleting the last portfolio all land there.
- **Two different Weight formulas, both correct.** The Dashboard panel divides by stock
  market value; the Portfolio page divides by stock value plus cash; the header figures
  count only weight-included positions and only count cash when the portfolio says to.
  All three live in `shared/portfolioMath.ts` and all three match the reference app.
- **The table freezes its sort while a cell has focus** (`DataTable`). Without it, editing
  Shares changes the Market Value the table sorts by and the row moves out from under the
  cursor mid-edit.
- **All portfolio analytics live in `shared/analytics.ts`**, ported from
  `workers/market_metrics.py`. Sample standard deviation is ddof=1, skew carries the sample
  bias correction, downside deviation clips gains to zero rather than dropping them, and
  alpha is annualised by 252. Each detail matters for matching the reference numbers.
- **History windows are calendar-based** (`windowStart` in `yahoo/history.ts`), and history
  is auto-adjusted. Day-count approximations shift the window by a bar and change every
  metric; unadjusted prices turn a split into a 50% loss.
- **The heavy analytics queries only run for the visible sub-tab.** Each one pulls daily
  history for every holding, so `useReturns` / `useMomentum` / `useAnalytics` take an
  `enabled` flag and the page passes whether its tab is on screen. Keep that.
- **The exposure metrics count CASH as a holding** when cash is included in weight; that is
  what makes Holdings 3 rather than 2 for a two-stock book, and it matches the reference.
- **Chart data needs the trailing-bar cleanup.** See `dropSyntheticQuoteBar` and
  `dropPartialTrailingBar` in `electron/services/yahoo/chart.ts` and the notes in
  README.md. Removing either silently corrupts the quote header and every indicator.
- **MA200 comes from daily bars**, aligned backward at day granularity onto whatever
  timeframe is displayed. Not a rolling mean of the displayed bars.
- **Timestamps are seconds**, not milliseconds, everywhere in `Candle` and
  `IndicatorPoint` — that is what lightweight-charts wants.
- **lightweight-charts is v5.** Use `chart.addSeries(SeriesDefinition, options, paneIndex)`;
  v4's `addCandlestickSeries` no longer exists. Panes give the price/volume/RSI stack.
- **Vite is pinned to 7** because electron-vite 5 caps there, which in turn pins
  `@vitejs/plugin-react` to 5. Installing `@vitejs/plugin-react@6` pulls Vite 8 and
  breaks the build with duplicate-Vite type errors.
- **Formatting lives in `src/lib/format.ts`.** Five panels print the same values; do not
  inline `toFixed` in a component.
- **The type scale lives in `src/styles/theme.css`**, as `--text-2xs`/`--text-xs`/`--text-sm`
  in the `@theme` block. Change sizes there, not per component. Three things do not follow
  it automatically and have to move with it: the fixed `h-*` heights on buttons, tab strip,
  panel headers and status bar; the chart's `fontSize` in `PriceChart.tsx`, which is canvas
  text; and the persisted column widths in `stores/dashboard.ts` — bump `STORE_VERSION`
  there or an existing install keeps widths sized for the old text and clips its last
  column.

- **Personal Finance conversion returns zero, not the original number.** `convertAmount`
  in `shared/financeMath.ts` yields `0` when a rate is needed and missing, matching
  `_p6_convert_amount`. Passing the unconverted value through instead silently inflates
  every total the moment Yahoo's `SGD=X` call fails.
- **The Totals currency only applies to the aggregate views** — the donut, the bills
  footer and the silos. Cash and Debt are natively SGD and stay SGD, and the Goal panel
  has its own currency. Three separate scopes, all as the reference has them.
- **Silo bar colours are positional.** `siloBars` cycles `ASSET_COLORS`/`DEBT_COLORS` in
  build order, so the order rows are appended in *is* the colour assignment. The apparent
  green gradient is a side effect of the cash list being amount-sorted, not a value ramp;
  reordering the builder recolours the whole chart.
- **The donut's centre and its legend use different denominators.** The centre nets debts
  off assets and skips margin slices; the legend is each slice's share of the summed
  magnitudes. They do not reconcile, in the reference either.
- **A store document without `personalFinance` is backfilled from the PySide6 file.**
  `loadDocument` only seeds when `portfolio.json` is absent, so a v1 document gets its
  finance section read from the legacy `net_worth` key once and persisted. Drop that and
  the page opens empty for every existing install.
- **The Silos chart defaults to log scale.** A book with one brokerage account and a few
  savings accounts is otherwise one tall bar beside invisible slivers. Session state, not
  persisted — same as the reference.
- **A wrapping table column needs `TextInput`'s `wrap` prop.** Marking a `DataTable`
  column `wrap` only lets the *cell* grow; an `<input>` inside it is single-line whatever
  the cell does, so a long description still clips. `wrap` swaps in a textarea sized to
  its content, and that sizing needs the `ResizeObserver` as well as the layout effect —
  the line count changes when the column narrows even though the text has not.
- **Settings live in their own file, not the holdings store.**
  `electron/services/settingsStore.ts` writes
  `%APPDATA%\BudgetTerminalElectron\settings.json`. Folding them into `portfolio.json`
  would put a navigation change behind a burst of cell edits on the one write queue, and
  would make Clear All User Data reset the tab order — which the reference's Clear
  deliberately does not.
- **Settings is the one tab that can never be hidden or obscured.** `setTabHidden` and
  `setTabObscured` refuse it, and `normalize` strips it back out of either list, the way
  `SETTINGS_PAGE_INDEX` is skipped throughout the reference. Hiding the page that owns
  the visibility controls leaves no way back to them.
- **A tab the settings file has never seen lands in its contract position.** `normalize`
  inserts it by its index in `TABS` rather than appending, so an existing install finds a
  newly migrated page where the default order puts it instead of at the end of the strip.
- **The bare-key shortcuts are guarded by `isTextEntry`.** The backtick picker and the
  arrow keys must not fire while a cell is being edited; Ctrl+Tab and F5 are not guarded,
  matching `_should_handle_main_tab_navigation_keys`. `TabPicker` also calls
  `stopPropagation` on its own backtick and Escape — without it the window-level handler
  sees the same key and reopens the picker in the same tick.
- **Data Health is session-only and fed by the status bar.** `stores/dataHealth.ts`
  records whatever every page already reports through `onStatusChange`, which is what
  lets the Settings page describe feeds whose pages are not mounted. It is never
  persisted, exactly as the reference's view is not.
- **Animations must survive a StrictMode remount.** `useAnimatedProgress` keys its rAF
  loop on a `startedAt` state value so the effect re-arms after the dev double-mount.
  Starting the loop outside an effect leaves the donut and the goal ring pinned at zero.

## Porting behaviour from the PySide6 app

When adding a panel, find the reference first — the numbers are expected to match to the
decimal. Useful starting points:

| Concern | Reference |
|---|---|
| Portfolio rows | `mixins/dashboard_presenters.py` |
| Quote payload | `services/dashboard_payloads.py` |
| Chart and MA200 | `services/chart_data.py` |
| Indicators | `services/technical_analysis.py` |
| Option buckets, macro tickers, news filtering | `workers/data.py` |
| Personal Finance, all of it | `mixins/networth.py` (donut `widgets/pie_chart.py`, bars `widgets/bar_chart.py`) |
| Personal Finance validation | `_normalize_networth_payload` in `persistence.py` |
| Tab labels and order | `mixins/window_setup.py`, `persistence.py` |
| Settings, all of it | `mixins/settings.py` |
| Shortcut wiring, tab picker, Obscure | `mixins/window_setup.py`, `mixins/window_lifecycle.py` |
