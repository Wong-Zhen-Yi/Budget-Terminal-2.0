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
npm run probe:pre-market         # futures, the three macro panels, CNN F&G, SPY momentum
npm run probe:trading-volumes    # the screen, all six ADV columns and the fitted trend line
npm run probe:news               # all three news lanes; --offline, --feeds-only, --preview N, --images
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
ring and the Silos bar chart), the **Settings** page (one scrolling page grouped
Data / General / Workspace) together with the app-wide keyboard shortcuts, and the
**Pre-Market** page (futures table, DXY / 10Y / VIX panels each with a chart, the CNN
Fear & Greed dial and the SPY momentum plot), and the **Trading Volumes** page
(the screened top-100 table beside the log-log market-cap dot plot, including the
Replay animation), and the **News** page (a three-lane card grid with a reader rail,
thumbnails, the signal heuristic and an outside-portfolio ticker search). The remaining
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
  `yfinance` directly". It is a rule about Yahoo, not about the network: the one
  non-Yahoo call in the app (below) deliberately stays outside the gate.
- **The CNN Fear & Greed call is the exception, and it needs its headers.**
  `electron/services/fearGreed.ts` fetches
  `production.dataviz.cnn.io/index/fearandgreed/graphdata` directly — putting an
  unrelated host behind the Yahoo gate would let a CNN hiccup throttle the dashboard.
  The endpoint is unauthenticated but the edge rejects a default agent, so the browser
  `User-Agent` **and** the `Referer` are both required. Only `fear_and_greed` is parsed;
  the component series in the same response are not used. A failure leaves the panel on
  its last value, exactly as the reference does.
- **Futures prior close is resolved against `America/New_York` session dates.** Futures
  trade nearly around the clock, so an 01:00 UTC bar belongs to the *previous* ET
  session; comparing UTC dates picks the wrong bar on most loads and reports an hour's
  move as the day's change. The Pre-Market service reuses `localDateStamper` from
  `yahoo/globalMarkets.ts` for that. It also does *not* drop the synthetic trailing bar
  there — on futures that live bar is the pre-market price the panel exists to show.
- **The three Pre-Market macro panels fetch two years, not the reference's window.**
  `_fetch_dxy`/`_fetch_tnx`/`_fetch_vix` ask for 10d/30d/5d; the panels here also carry a
  chart. Every statistic reads only the tail of the series (`closes[-1]`, `closes[-2]`,
  `closes[-5]`, the mean of the last 20), so the numbers are identical and the range
  buttons slice client-side through `sliceRange` without going back to Yahoo.
- **`LineChart`'s newer props all default to the old behaviour.** `baseline` defaults to
  `'zero'` because the Portfolio Momentum Tracker needs the forced zero line; the
  Pre-Market charts pass `'auto'` or a price series renders as a flat line at the top of
  the frame. `viewBox` and `axisLabels` exist because the chart stretches with
  `preserveAspectRatio="none"`, which distorts tick text in a panel far off the default
  1000x380 ratio. A `null` in a series breaks the path rather than plotting — that is what
  lets the 125-day mean start 124 bars in while staying aligned to the closes.
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

- **The Trading Volumes screen is a hand-rolled POST, and it needs a warm-up first.**
  `yahoo-finance2`'s public `screener()` only takes fifteen predefined saved screens, so
  `electron/services/yahoo/screener.ts` posts the reference's own `EquityQuery` body to
  `v1/finance/screener` through `yahoo._fetch(..., needsCrumb=true)` — 19k candidates
  instead of a few hundred. That crumb fetch fails outright against a cold cookie jar
  ("No set-cookie header present"), so `warmCrumb()` runs one cheap predefined screen
  first. Drop it and the whole page fails on a fresh process. Still inside `paced()`.
- **ADV reads unadjusted `close * volume`.** `fetchCloses` prefers `adjclose` and drops
  volume entirely, so Trading Volumes uses `fetchCloseVolume` in the same file. The two
  must not be merged: adjusted closes would restate every historical dollar volume by the
  split and dividend factors, and the reference passes `auto_adjust=False`.
- **5D/30D ADV are bar counts; YTD/1Y/3Y are calendar windows.** `advMetrics` in
  `shared/tradingVolumes.ts` keeps both conventions because `_dollar_volume_metrics`
  does. A 30-bar mean and a 30-calendar-day mean are different numbers.
- **Trading Volumes has no refresh timer, deliberately.** One load is a twelve-page screen
  plus a hundred daily charts, roughly 30s behind the rate gate. `useTradingVolumes` sets
  `refetchInterval: false`, unlike every other page module — the reference has no timer
  either, and a background refetch would spend a hundred Yahoo requests on a page nobody
  is looking at. Refresh and F5 are the only ways it refetches.
- **The dot plot must not borrow `LineChart`'s `preserveAspectRatio="none"`.** That trick
  is fine for a path but turns every scatter dot into an ellipse, so `DotPlot` measures
  its box with a `ResizeObserver` and draws at real pixel size. Both axes are `log10` of
  the value plotted linearly, with the ticks raising 10 to the power to print dollars
  back — the same thing `_P20CompactCurrencyAxisItem` does.
- **The `#` column is a real column, not `DataTable`'s `showIndex`.** It prints the rank a
  row held *before* the filter sliced the list, which is what makes Exclude Top 5 start
  the table at 6. `showIndex` would print the display position and lose that.
- **Replay pins the y range and the label set before the first frame.** The range comes
  from the min and max of *every* aligned value, so dots move against a still axis
  instead of one rescaling under them (`setYRange` at the top of
  `_p20_replay_market_cap_animation`). The label set is likewise chosen once from the
  resting layout and only repositioned — the reference creates its `TextItem`s in the
  static render and moves them, and recomputing collisions per frame would make labels
  blink as dots drift past each other. The trend line *is* refitted every frame.
- **Playback interpolates in log space, and the last frame is forced to the live cap.**
  `alignMarketCapHistory` resamples each ticker onto the shared timeline log-linearly and
  overwrites the final value, so a five-second replay lands exactly where the static plot
  already is. `npm run probe:trading-volumes` prints that check per ticker.
- **The Replay timeline is a union, so it is longer than the interval's bar count.** 30D
  slices 31 bars per ticker but the shared timeline came out at 44 dates, because tickers
  that halted or listed late contribute their own sessions. That is the reference's
  behaviour and why alignment has to interpolate rather than index.
- **The News page has three lanes, and only two of them are Yahoo.** The portfolio lane is
  `yahoo.search` behind the `relatedTickers` gate and the macro lane reads Yahoo's per-symbol
  headline RSS, both inside `paced()`. The six publisher feeds in `services/news/feeds.ts`,
  the article preview and the thumbnail proxy are deliberately **outside** it, on the
  `fearGreed.ts` precedent — six unrelated hosts behind the Yahoo gate would let one slow
  publisher edge throttle the whole app.
- **`yahoo-finance2@4` has no news module**, so the macro lane is a hand-rolled fetch of
  `feeds.finance.yahoo.com/rss/2.0/headline`. Do not "simplify" it back to `search`: searching
  the literal string `DX-Y.NYB` returns generic retirement listicles, because a macro symbol
  has no company name for the query to match. The probe prints per-symbol counts.
- **The News fetches use `services/news/http.ts`, not `fetch`.** Node's `fetch` is undici,
  whose `maxHeaderSize` is fixed at 16KB; Yahoo answers an article URL with more `Set-Cookie`
  than that and the request dies as an opaque `fetch failed` (cause: `Headers Overflow Error`).
  `node:https` takes `maxHeaderSize` per request, and streaming also lets the body be capped
  mid-download instead of after it.
- **News timestamps are milliseconds, and a bare ISO stamp gets an explicit `Z`.** The
  reference stores seconds in `_ts`, and Python reads a zone-less stamp as UTC where
  JavaScript reads it as local. Without the `Z` in `parseNewsTimestamp`, every affected
  article shifts by the machine's offset and shows up only as slightly wrong ages. The probe
  asserts nothing is dated in the future, which is what catches it.
- **`NewsArticle.score` is `null` on the Yahoo lanes, not `0`.** `_p34_filtered_groups` sorts
  on whether an article carries a score before sorting on its value, so collapsing null to
  zero puts unscored Yahoo articles above genuinely low-scoring RSS ones under Signal sort.
- **Card images are `data:` URIs from the main process.** The renderer CSP is
  `img-src 'self' data:`, so a raw `https://` `<img>` is blocked silently and looks like a
  broken proxy. `services/news/images.ts` fetches and base64-inlines each one, bounded by a
  24MB byte budget rather than an entry count — thumbnail sizes vary by a factor of thirty.
  Relaxing the CSP would turn every feed-supplied URL into a tracking beacon.
- **A feed's stale fallback is capped at 24h in `feeds.ts`, not in `cache.ts`.**
  `resolveWithStaleFallback` has no upper bound on staleness, so without the explicit age
  check a feed that broke last week keeps serving last week's headlines with nothing on
  screen to say so.
- **News has no refresh timer, deliberately** — like Trading Volumes, and like the reference,
  whose `init_page34` creates none. A background refetch would also reshuffle the card grid
  under whoever is mid-article in the reader.
- **Two documented departures from `mixins/news.py`:** the reader is a right rail rather than
  a 190-270px strip above the cards (six thousand characters do not fit in a strip), and the
  highest-scoring story from the last 24 hours is promoted to a hero above the grid. The age
  bound matters — several publisher feeds carry months-old items, and the reference applies no
  age cutoff anywhere.

- **Neither `100%` nor `table-fixed` alone gives Trading Volumes a usable Name column.**
  Under `table-fixed` a `100%` column collapses to nothing; under `auto` it swallows the
  pane and pushes the six ADV columns — the point of the page — out of sight. It is a
  fixed 184px with the pane scrolling horizontally, as the reference's does.

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
| Trading Volumes, all of it | `mixins/overview.py` (worker `workers/overview.py`) |
| News, all of it | `mixins/news.py` (feeds `workers/news_sources.py`, reader `workers/news_preview.py`, dedupe `services/news_analysis.py`) |
| Shortcut wiring, tab picker, Obscure | `mixins/window_setup.py`, `mixins/window_lifecycle.py` |
