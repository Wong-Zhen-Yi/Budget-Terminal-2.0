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
npm run probe:stocks -- AAPL     # complete Stocks workspace; use --offline for deterministic checks
npm run probe:fundamentals -- AAPL # SEC/Yahoo statements, charts and filings; --offline for fixtures
npm run probe:charts -- AAPL # five-tab Charts workspace; use --offline for deterministic checks
npm run probe:crypto           # all four Crypto stages; --offline for the pure checks
npm run probe:cards            # Cards math, persistence and models; --live adds Yahoo
npm run probe:options -- AAPL  # chain Greeks, strategy ranking, both grids; --offline for the pure checks
npm run probe:heatmap -- SPY   # index holdings, all seven intervals, sector split; --offline for the pure checks
npm run probe:projections -- AAPL # chart, every expiration, the three paths; --offline for the pure checks
npm run probe:up-down -- AAPL  # Up/Down counts and targets; --offline for deterministic math checks
npm run probe:valuation -- NVDA # DCF, CAPM required return, derivation and peers; --offline for the pure checks
npm run probe:economic         # all 49 series across five providers; --offline for the pure checks
npm run probe:roll             # a live roll, then a cached second one; --offline for the six evaluators
                               # pass pattern modes as arguments: `npm run probe:roll -- breakout bullish_flag`
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
**Cards** page (built-in, custom-weight, equal-weight and live portfolio baskets), the
**Personal Finance** page (Cash, Debt, Recurring Bills, Totals donut, net-worth Goal
ring and the Silos bar chart), the **Settings** page (one scrolling page grouped
Data / General / Workspace) together with the app-wide keyboard shortcuts, and the
**Pre-Market** page (futures table, DXY / 10Y / VIX panels each with a chart, the CNN
Fear & Greed dial and the SPY momentum plot), and the **Trading Volumes** page
(the screened top-100 table beside the log-log market-cap dot plot, including the
Replay animation), the **News** page (a three-lane card grid with a reader rail,
thumbnails, the signal heuristic and an outside-portfolio ticker search), and the
**Stocks** page (company facts and targets, news, ownership activity, a three-year daily
candlestick chart, and optional MFI), the **Fundamentals** page (SEC/Yahoo merged
statements, comparison and indexed charts, headline metrics, and SEC filings), the
full **Charts** workspace (Main, Multi Charts, Compare, Relationship, and Cheat Sheet),
the **Crypto** page (KPI strip, Top 30 heatmap, watchlist, crypto news and ETF proxies),
the **Options** page (the Chain tab with Greeks and the two strategy rankings, plus
the Options by Top Volume and Options by Strike grids over every live expiration), and
the **Heatmap** page (the S&P 500 / Nasdaq 100 / Dow 30 holdings treemap over seven
intervals, with the coverage strip and the selected-holding detail bar), and the
**Up/Down** page (Portfolio, SPY, QQQ and Custom sources with progressive analyst targets),
and the **Valuation** page (a DCF over SEC-backed statements with every assumption derived
from history, the 10Y Treasury, analyst estimates and peers; seven tabs over one load), and
the **Economic** page (49 US macro series across five keyless providers, an Overview grid
and four group tabs with a history plot each, plus the treasury curve), and the
**Dictionary** page (390 offline terms across 14 categories with ranked search, formula
and economic-event detail, related navigation, and chart-pattern diagrams), and the
**Roll** page (a weighted dice throw over the liquid US screen, with six technical pattern
filters run over a year of daily bars, a scored-candidate table, a 1Y chart, top options
by expiration, headlines and a roll history).
The remaining tabs are labels in `TABS`
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
  the frame. The chart measures its container and draws at real pixel size, like
  `DotPlot`; it no longer stretches a fixed viewBox with `preserveAspectRatio="none"`,
  which scaled the axis text by the panel's aspect ratio. `viewBox` is now only the
  pre-measurement fallback size, and `axisLabels` still drops the ticks on a chart too
  small to carry them. A `null` in a series breaks the path rather than plotting — that is what
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
- **Cards own a separate store.** `electron/services/cardsStore.ts` writes
  `%APPDATA%\BudgetTerminalElectron\strategies.json` and seeds it once from the PySide6
  Cards file. Definitions, order, hidden portfolio cards and intervals persist there;
  performance remains in the shared runtime cache and every Yahoo history call stays
  behind `paced()`.
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
- **The dot plot draws at real pixel size, and so does `LineChart` now.** Stretching a
  fixed viewBox with `preserveAspectRatio="none"` is fine for a path but turns every
  scatter dot into an ellipse, so `DotPlot` has always measured its box with a
  `ResizeObserver`; `LineChart` does the same, because the same stretch distorted its
  axis text. Both axes are `log10` of
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
- **Stocks treats the chart as the commit boundary.** Quote summary, fundamentals fallback,
  news, institutional holders, and insider transactions are optional blocks. A partial
  response updates the usable workspace; a missing chart leaves the prior successful
  payload intact. Its persisted snapshot renders before the startup background refresh.
- **Stocks MFI matches the reference's rolling sums.** It uses typical price times volume,
  14-period positive and negative flow sums, and fixed 80/20 guides. It is not RSI and is
  not Wilder-smoothed. The institutional change column is a fractional percentage change
  and is deliberately uncapped.
- **Stocks has no refresh timer.** It requests on startup, Load, and F5 only. Range presets
  slice the three-year client-side history; Auto defaults to 120 bars with the newest bar
  at the 85% anchor, while manual pan and zoom persist only when Auto is off.

- **Fundamentals bar labels are placed, not offset.** `placeLabels` in
  `FundamentalsBarChart.tsx` ports `_p2_layout_compact_annotations`: labels sit at their own
  bar's end, lanes come from *horizontal* overlap alone (so they do not move when the y domain
  does), only genuine collisions are displaced outwards, and a displaced label gets a leader
  line back to its bar. Staggering a whole series by its index instead leaves labels floating
  over unrelated bars. Zero-value bars are skipped — their growth reads as a bogus -100%. Past
  `ANNOTATION_LIMIT` (32 bars, the reference's `P2_COMPACT_ANNOTATION_LIMIT`) a compact chart
  drops every label and hover carries the detail; fullscreen always keeps them.
- **The chart's y domain is grown to fit the labels, not padded by a fixed fraction.** The
  headroom needed is only known once the labels are placed, and placing them needs the scale,
  so the layout iterates up to four passes like the reference. That is why the top margin is
  10px rather than the 58px of reserved space it used to be.

- **Crypto talks to three hosts, and only one of them is Yahoo.** CoinGecko (`coins/markets`
  twice and `/global`) and alternative.me's Fear & Greed are fetched directly in
  `services/crypto.ts`, and the four crypto RSS feeds go through the News page's own
  `loadFeed`. All of them stay **outside** `paced()`, on the `fearGreed.ts` precedent —
  putting CoinGecko behind the Yahoo gate would let its free-tier throttling halve the
  dashboard's budget. The six equity proxies (COIN, MSTR, BMNR, IBIT, ETHA, BITQ) *are*
  Yahoo and do go through the gate.
- **Crypto's four stages run concurrently, not in sequence.** `CryptoMarketWorker` emits a
  `partial` signal after each stage so the Qt page fills in progressively; an IPC
  request/response cannot, so all four run at once and the payload carries the same
  `progress` map. Keep the map — the page's status line and every panel's warning dot are
  derived from it, not from the envelope alone.
- **A failed Crypto heatmap falls back to five tiles built from the quotes.**
  `buildHeatmapFromQuotes` mirrors `_build_heatmap_from_quotes` and ranks them 1-5 by
  `CRYPTO_TICKERS` order, not by market cap. Drop it and a CoinGecko top-30 outage empties
  the panel that is most of the page.
- **The Crypto heatmap grid is fixed at 30 cells, not built from the payload.** A short
  response leaves `#n --` placeholders where the missing coins belong, so the panel's shape
  never changes with coverage — the same thing `_p19_build_heatmap` does by creating every
  `QLabel` up front.
- **`_p19_format_money`'s `compact` flag only adds the thousands step.** The T/B/M steps
  apply either way, which is why a market cap and a volume in the same row read alike.
  `cryptoMoney` in `shared/crypto.ts` keeps that; treating `compact` as "abbreviate at all"
  changes every figure in the KPI strip.
- **The Crypto Fear & Greed tile is amber whatever it reads.** The classification text
  already names the direction, so tinting "Extreme Greed" green would report it as good
  news. That is the reference's `'warning'` status, and it is not the CNN index the
  Pre-Market page shows — different source, different scale, and the two routinely disagree.
- **Crypto has no refresh timer**, like Trading Volumes and News, and like `init_page19`.
  Refresh and F5 are the only ways it refetches; CoinGecko's free tier rate-limits by the
  minute.
- **One documented departure from `workers/crypto.py`:** the proxy table's market cap reads
  `totalAssets` as a last fallback, so the column headed "AUM / Mkt Cap" has a number for
  the three spot ETFs instead of the dash `fast_info.market_cap` leaves there.

- **An option expiry dies at 16:00 New York, not at the local date rollover.**
  `isOptionsExpiryClosed` in `shared/optionsPage.ts` ports `is_options_expiry_closed`:
  it compares against the ET date *and* the 16:00 regular close. Comparing against the
  machine's own date leaves today's expiry in the dropdown for a whole evening in Asia,
  and Yahoo answers a dead date with a bare "expiration cannot be found".
- **The Options Greeks are Black-Scholes with dividends, and their scales differ.** Theta
  is per day (the annual figure over 365) and vega and rho are per percentage point (the
  raw sensitivity over 100), which is why a delta of 0.412 sits beside a vega of 0.087.
  `normalCdf` is Hart's rational approximation rather than a short series because the
  implied-vol solve is a Newton iteration on it; `npm run probe:options -- --offline`
  asserts every Greek against numbers taken from the reference's own
  `services/options_analysis.py`.
- **The chain backfills a zero implied volatility from the row's own mid.** Yahoo returns
  `impliedVolatility: 0` for most of a chain outside regular hours, which is when the page
  is most often open; without `enrichChain`'s solve every Greek column is blank. The
  solve's own failure returns 0, which leaves that one cell empty rather than poisoning
  the row.
- **The two summary tabs share one payload, and the reference does not.**
  `_p5_load_top_volume`, `_p5_load_strike_values` and `_p5_load_options_by_strike` each
  sweep every live expiration's chain; here `optionsExpirations` sweeps once and the
  renderer derives the type filter, the strike list and the strike selection from it. That
  makes changing the Both/Calls/Puts filter or the strike instant instead of a reload —
  the reference reloads on both and only its chain cache keeps that cheap.
- **Options has no refresh timer, and nothing loads on mount.** `init_page5` fires no
  request at all: every load is a button. A sweep is one Yahoo request per listed expiry
  (21 for AAPL), so an automatic refetch would be the second most expensive thing in the
  app after Trading Volumes.
- **The summary grid's highlights are ranked before the display sort.** `summaryHighlights`
  ranks the records as loaded, so re-sorting a panel moves rows without repainting which
  one is the highest-volume contract. The low ranks explicitly exclude the rows the top
  ranks claimed, or a two-row table paints the same row as both.
- **Neither `100%` nor `table-fixed` alone gives Trading Volumes a usable Name column.**
  Under `table-fixed` a `100%` column collapses to nothing; under `auto` it swallows the
  pane and pushes the six ADV columns — the point of the page — out of sight. It is a
  fixed 184px with the pane scrolling horizontally, as the reference's does.

- **The Heatmap page's constituent closes come from Yahoo's `spark` endpoint, not `chart`.**
  A five-hundred-name index behind `paced()` one `chart()` call at a time would cost five
  times what Trading Volumes does. `yahoo/spark.ts` posts to `v8/finance/spark`, which
  Yahoo caps at **20 symbols per request** — 26 requests for SPY, and the whole page loads
  in about seven seconds. Still inside `paced()`, still through the client's own `_fetch`;
  spark needs no crumb. One year, not the reference's two, because `1y` is the longest
  window the page offers. The closes are unadjusted, matching `auto_adjust=False`.
- **A failed spark chunk costs twenty tiles, not five hundred**, which is why the
  reference's per-ticker recovery pass (`_fetch_quote_fallback`, `_fallback_budget`) has no
  port. That pass exists because `yf.download` answers for the whole batch or dies; spark's
  chunking already contains a failure, and the symbols in it come back in `missing` and
  render as dashed no-data tiles.
- **Issuer holdings files and Wikipedia stay outside `paced()`**, on the `fearGreed.ts`
  precedent. `services/etf/holdings.ts` reads SSGA's daily xlsx for SPY and DIA and
  Invesco's QQQ JSON API; both are unrelated hosts, and letting one throttle the Yahoo
  budget would be strictly worse than letting this page fail alone. The Yahoo top-holdings
  fallback underneath *is* Yahoo and does go through the gate.
- **`services/etf/xlsx.ts` reads the workbook with `node:zlib` and regexes, deliberately.**
  An xlsx is a zip of XML and the reference reads it with the Python standard library
  alone; one file does not justify a dependency. It ports `_parse_xlsx_rows` — one sheet,
  shared strings, inline strings — and pads gaps from each cell's `r="B7"` reference so a
  row's indexes still line up with its header row.
- **Only two of the reference's seven issuer providers are ported.** The Heatmap page has
  exactly three buttons; ARK, iShares, Vanguard, First Trust and ProShares would be
  unreachable code until the ETF page is migrated.
- **Two documented departures from the reference's page17.** The GICS sector map scraped
  from Wikipedia is applied to *all three* ETFs, not SPY alone: SSGA publishes a literal
  `-` in DIA's Sector column and Invesco's QQQ feed has no `sectorName`, so the reference
  leaves both indexes as a single "Unclassified" rectangle — a treemap with nothing to
  say. The map is fetched once a day either way. And `_p17_on_show` warms all three
  indexes every time the tab is shown; only the selected one is fetched here, because the
  per-index cache already makes a second visit free.
- **A no-quote tile is outlined, not tinted.** `_is_unquoted` matters because the neutral
  fill is also what a genuine 0.00% move gets, so missing data would otherwise read as
  flat. The same distinction drives the coverage cell, which is amber below the holdings
  count and red once more than half the book is unquoted.
- **The Heatmap's zoom magnifies the layout, not the text.** `_visible_rect` scales each
  rectangle and subtracts the pan while the fonts stay fixed, so zooming in *reveals*
  labels on tiles that were too small to carry them. A CSS transform on the container
  would scale the type with it and reveal nothing — which is also why `IndexHeatmap`
  measures its own box and lays out in pixels: every one of the reference's rules
  (header at 58x90, symbol at 34x22, change at 46x40, name at 90x58 past 1.35x) is a pixel
  threshold, and a percentage layout cannot ask.
- **The tile ramp saturates at 4%, the Portfolio Heatmap's at 5%.** `heatmapTileColor`
  ports `_heat_color` exactly — mix the neutral toward up or down by `0.35 + 0.65 *
  min(|change| / 4, 1)` — so the same session reads the same shade in both apps. The
  layout, by contrast, deliberately reuses the app's squarified `Treemap` rather than the
  reference's `_binary_layout`, so a holding of a given weight is the same shape on both
  of this app's treemaps.
- **The interval buttons never go back to the network.** The payload carries all seven
  windows per holding, so Live to 1Y is a re-render, exactly as
  `_p17_render_interval_result` is. The page has no refresh timer either — `init_page17`
  creates none — and its per-index cache holds the reference's own 120 seconds.


- **Projections is page28, and its file is called `charts_options_top_volume.py`.** The
  reference's name predates the page: everything on it is labelled Projections, and the
  options top-volume grid is only the right-hand rail. Grep for `_p28_`, not for the
  page's title.
- **The Projections load is two existing services, not a new fetch path.**
  `services/yahoo/projections.ts` calls `getChartsHistory` and `getOptionsExpirations`
  concurrently — the Options page's sweep is exactly the `bucket_config` loop `_p28_load`
  writes by hand, so the chains are shared and cached between the two pages. Nothing new
  reaches Yahoo, and everything still goes through `paced()` inside those two.
- **A failed chart is `partial` on Projections, not `failed`.** `_p28_update_view` only
  fails the page when the chart *and* every expiration came back empty; a chart failure
  alone keeps the option tables and drops the projections, which have no close to anchor
  on. Turning that into a `failed` envelope empties a page that still has most of its
  data.
- **The projections themselves are computed in the renderer, from the payload.** The
  chains are the expensive part and `buildProjectionSummaries` is a pure function of them
  plus the latest chart close, so switching the tables between Calls and Puts repaints
  what is loaded — `_p28_apply_loaded_type_filter` does the same. The *timeframe* still
  reloads, because a different chart means a different close to anchor on.
- **The anchor is a weighted median, and the weight is three things multiplied.**
  `projectionSideSummary` ports `_p28_projection_side_summary`: sqrt(volume) grown by open
  interest, scaled by spread quality and by moneyness, and the anchor is the weighted
  *percentile at 0.50* rather than the mean — one enormous print must not be able to
  define an expiration. A candidate outside 1.5 expected moves is clamped into the band
  *and* quartered in weight rather than dropped.
- **The combined path's confidence is the weaker side's, not the blend.** The price is
  confidence-and-count weighted between the two sides, but a center built on one strong
  side and one weak one is only as trustworthy as the weak one — and the coverage tile
  counts calls and puts only, because every combined anchor is derived from them.
- **The last trade is deliberately not a price fallback.** `effectiveOptionPrice` needs a
  two-sided quote; a row without one contributes nothing. A stale print is exactly what
  the quality filters exist to keep out, and this is the opposite of the Options page's
  chain, which backfills a zero IV from the row's own mid.
- **One documented departure from `_p28_weekly_x_by_date`.** The reference plots against
  bar *indexes*, so it parks each weekly point on a synthetic slot five indexes past the
  last bar and relabels the axis by hand; `ProjectionsChart` plots the paths at their real
  dates on the candles' own time scale, so an expiration two weeks out sits two weeks out.
  The origin is the exception — it is the latest close, and on an intraday timeframe its
  calendar date is *behind* the last bar's timestamp, so it takes that bar's exact time.
- **Projections' timeframe ranges are one step wider than the reference's periods.**
  `requestStart` in `yahoo/chartsPage.ts` already clamps each interval to the longest
  window Yahoo answers (6d for 1m, 59d for 5m and 15m, 729d for 1h), so `3M` on a 5-minute
  chart resolves to the reference's `60d` rather than to a shorter one. Narrowing them to
  match the period text would cost bars.
- **Projections has no refresh timer, and its tables paint only the top ranks.**
  `init_page28` creates no timer; Load, the timeframe buttons and F5 are the only refetches.
  `_p28_render_option_tables` passes empty tuples for both *low* highlight backgrounds,
  which is why `OptionSummaryTable` takes `lowHighlights` — a ten-row panel carries two
  highlight colours here and four on the Options page.


- **Valuation solves in the renderer; only the inputs are fetched.** The load answers with
  metrics, statements, peers and a full derivation, and `calculateValuationScenarios` then
  runs on whatever the assumption form holds — so editing a growth rate repaints instantly
  and never goes back to the network, exactly as `_valuation_recalculate_from_controls` is
  wired to every spin box and touches no worker. The maths is in `shared/valuation.ts` so
  the probe, the main process and the page cannot disagree.
- **A load always re-derives.** `_valuation_apply_derived_assumptions` never consults the
  saved per-ticker assumptions; they are the first-paint defaults only. Feeding them back
  in would make each load drift from the last, and the Re-derive button would do nothing.
  `terminalMethod` and `projectionYears` are the exception — neither has a derivation rule,
  so they are the user's model choices and survive.
- **`finiteOrNull` guards null before `Number()`.** `Number(null)` is 0 and `Number('')` is
  0, so without the guard every absent Yahoo field arrives as a real zero: a missing free
  cash flow reads as *negative* FCF and adds 1.5pp to the required return, and a missing
  basis fails the model instead of falling back. Python's `float(None)` raises, which is
  why `_safe_float` has no equivalent hazard to document.
- **The derivation order is load-bearing.** The required return sets the terminal-growth
  cap, terminal growth sets the fade target for years 6-N, and the whole derived set is
  priced once to size the margin of safety. Reordering `deriveValuationSuggestions` changes
  every number after the first.
- **Terminal growth is held 2.5pp under the required return, not 1.0.** `inputWarnings`
  blocks below 1.0pp, but the bull case is built with `discountRate - 1.0` and
  `terminalGrowth + 0.5` — narrowing the spread by 1.5. A base spread under 2.5 therefore
  yields an unsolvable *bull* case, which flips `scenariosOrdered` off and drops the whole
  verdict even though the base case looks fine.
- **A currency mismatch withholds the comparison, not the model.** `basisValue` is
  per-share off the statements and `price` is off the quote; for a foreign listing those
  are different currencies. The fair values still come back — the DCF is sound in its own
  unit — but the verdict, upside, the buy/trim band and the band chart are all withheld and
  `priceComparisonValid` goes false. No FX conversion is applied on purpose: that needs a
  rate source and a per-period date convention, and picking one silently would swap a
  visible error for an invisible one.
- **The peer exit multiple is an equity multiple, and EV/EBITDA is deliberately unused.**
  The DCF multiplies a per-share equity flow, so `100 / fcfYield` (a P/FCF) or the peer P/E
  is the only unit that fits. Fewer than three peers inside the 3-50x bounds falls back to
  the 15x default and says so — which is the *common* case on megacap tech, where peer FCF
  yields put P/FCF outside the band.
- **Valuation reuses two existing services rather than fetching statements itself.**
  `getFundamentalsPage` already merges SEC EDGAR XBRL over Yahoo's frames and caches it, so
  the two pages share one statement layer; `riskFree.ts` owns the Treasury curve. The
  reference calls `fetch_company_bundle`/`merge_sec_frames` by hand for exactly the former.
- **The Treasury curve stays outside `paced()`**, on the `fearGreed.ts` precedent —
  home.treasury.gov is not Yahoo, and it answers in 10-20s even when healthy, so putting it
  behind the Yahoo gate would stall the whole app on one slow CSV. Four tiers cover it: a
  15-minute process memo, a 12-hour disk entry, the two CSVs, then a 30-day stale entry.
  Losing every tier costs precision, not correctness: `estimateRequiredReturn` falls back to
  the pre-CAPM heuristic and the derivation names the missing input.
- **A peer candidate costs one Yahoo request, so the candidate list is the request budget.**
  `PEER_CANDIDATE_LIMIT` is 16, matching the reference, and the page has no refresh timer —
  `init_page23` creates none. Load, a peer-list change and F5 are the only refetches.
- **Three documented departures from `mixins/valuation.py`.** The bear-to-bull band is drawn
  as dashed levels rather than a shaded region, because `LineChart` draws paths and not
  regions; the reference's fifth line is also dropped, because `upperScenario` *is* the bull
  case and drawing both painted one over the other and left the legend naming a colour
  nothing on the chart showed. Per-period share counts come from the merged map's
  `sharesOutstanding` rather than a diluted average, which the repo's SEC layer does not
  carry — the approximate flag is still raised the same way. And the Sources citations name
  the source, basis and period rather than the XBRL tag and accession, because this repo's
  SEC normalization keeps the point's source but not its filing.
- **A `LineChart` wrapper must be `flex min-h-0 flex-1 flex-col`.** The chart measures its
  own container, so a plain `min-h-0 flex-1` block sizes to the SVG's 380px fallback instead
  of the space available and the panel clips the bottom of the plot along with its whole x
  axis. Every existing caller wraps it that way; the Valuation charts did not, and the
  Trends tab lost both its date axes until they did.
- **Assumption fields carry their unit in the field, not the label.** `NumberInput` takes a
  `suffix` for exactly this: a form of bare decimals cannot distinguish a 2.5% terminal
  growth from a 15.0x exit multiple, which is why the reference's spin boxes set ` %` and
  ` x`.


- **The Economic page reaches five hosts and none of them is Yahoo, so none of it goes
  through `paced()`** — Treasury, BLS, NY Fed, UMich and FRED, all keyless, on the
  `fearGreed.ts` precedent. This is the slowest load in the app (about 45s cold), and
  putting five unrelated government hosts behind the Yahoo gate would let one of them stall
  every other page.
- **FRED must not get a browser User-Agent.** It sits behind Akamai, which reads a request
  claiming to be Chrome without Chrome's TLS fingerprint as a bot and tarpits it until the
  client times out — losing all 20 FRED-native series. A plain product token answers in
  under a second. Treasury, BLS, NY Fed and UMich were each checked against both and return
  identical responses, so none of them needs one.
- **home.treasury.gov gets its own 45s timeout.** It renders each yearly CSV on demand and
  takes 18-20s even when healthy, so the shared 15s timeout expired on every request and
  lost all 16 treasury-backed series. The ten-year fan-out is still bounded because
  `MAX_WORKERS` years run at once, and the nominal and TIPS curves overlap rather than
  running back to back.
- **The whole treasury block is two downloads, not sixteen.** `resolveTreasury` resolves
  every tenor, every spread and every breakeven out of one nominal curve plus one TIPS
  curve, which is why the three treasury providers share a single resolver group. A TIPS
  failure is swallowed and a nominal failure is not: losing TIPS costs only the breakevens.
- **The FRED fallback probes before it fans out, and gives up when the host looks blocked.**
  Every catalog entry is keyed by its FRED id even where a direct provider serves it, so
  anything a batch left empty is retried there. One short 6s probe is the whole cost of a
  blocked FRED; without it, and without the four-consecutive-failure blackout, a network
  that cannot reach FRED adds minutes of timeouts to every refresh.
- **A provider recovered from FRED is not reported as down.** `unreachable` is filtered to
  the providers that still have an empty series at the end, so the status line names only
  the real gaps rather than every host that hiccuped.
- **`finite()` guards null before `Number()`**, the same hazard as Valuation's
  `finiteOrNull`: `Number(null)` and `Number('')` are both 0, so a missing CPI print would
  render as `0.0%` and colour green instead of showing the em dash that says the provider
  returned nothing. The same guard is why `cell()` rejects `''` and FRED's `.` sentinel
  before coercing — an unauctioned tenor must be skipped, not zeroed.
- **BLS periods are codes, not dates.** `M01`-`M12` are months and `Q01`-`Q04` are quarters,
  but `M13` and `S03` are the annual and semiannual averages, which would otherwise land on
  top of a real observation and corrupt every MoM figure in the labour block.
- **The YoY lookup runs on dates with a tolerance, not on `index - 12`.** Index arithmetic
  breaks the moment a series has a reporting gap or a different frequency; the tolerance is
  half the nominal spacing so a daily series survives a holiday weekend while a monthly one
  cannot pair with the month before its year-ago partner.
- **`higherIsBetter` is tri-state.** `null` means a move in either direction carries no
  good/bad meaning — a participation rate reading, a breakeven — so those change cells stay
  neutral rather than being painted with a misleading judgement.
- **The payload is cached on disk, not in `TtlCache`.** The page paints from it on the first
  frame after a cold start, and an in-memory entry would be gone by the next launch. Six
  hours fresh, seven days stale, with a schema version that drops an entry written by an
  older shape. A total blackout never overwrites a good cached payload with an empty one.
- **Economic has no refresh timer**, like `init_page42`, which creates none. Refresh, Force
  refresh and F5 are the only refetches.
- **One documented departure from `mixins/economic_page.py`:** there is no progress bar.
  `_p42_launch_fetch` drives a `QProgressBar` from the worker's per-provider `progress`
  signal, and an IPC request/response carries no intermediate frames — the same wall the
  Crypto page hit. The busy status line reports the load instead, and the disk cache means
  most visits never see it.


- **Dictionary is renderer-local by design.** The 390-entry catalog and ranked search
  live in `electron/shared/dictionary.ts`; there is no IPC handler, store, worker, or
  network request. The page must remain available when every data provider is down.
- **Dictionary search ranking is user-visible behavior.** Exact terms beat term prefixes,
  which beat exact and prefix aliases, keywords, substring matches, then token matches.
  Category filtering happens before ranking, and an empty query retains alphabetical order.
- **Related terms always clear the active filters.** A related entry may not be reachable
  inside the current query or category, so following one resets both controls before
  selecting it. Chart-pattern entries reuse `shared/chartPatterns.ts` for their diagrams.
- **Dictionary has no persistence or refresh timer.** Search, category and selection are
  session state. F5 has no data to fetch; the catalog probe is the verification boundary.

- **Roll is page18, and its file is called `random_recommender.py`.** Grep for `_p18_`, not
  for the page's title. The worker of the same name holds the screening, the six pattern
  evaluators and the draw; the mixin holds the layout and every display string.
- **Roll fires nothing on mount and has no refresh timer.** `init_page18` creates neither.
  Every load is the Roll button or a Roll History row, which is also why `useRoll` is a
  plain mutation with no query key — a background refetch would spend a screen plus 120
  daily histories *and* silently change the answer under whoever is reading it. The whole
  point of the page is that a roll is a draw.
- **The Roll screen is the only one in `screener.ts` that takes a direction.** Three of its
  six orderings are ascending: the reference deliberately mixes the day's and the year's
  *losers* into the pool, and without them a downtrend or double-bottom search has nothing
  to find but recent winners. Still `postScreen`, still behind `paced()`.
- **The pattern roll is one paced chart request per candidate — 120 of them.** yfinance
  batches this into a single `yf.download`; `yahoo-finance2` has no multi-symbol endpoint
  carrying OHLCV, and `spark` (which the Heatmap page uses) returns closes only, which the
  evaluators cannot read. A cold pattern roll is about 35s, the balanced one about 4s, and
  the ten-minute history cache is what makes the second roll of a session nearly free.
- **`latest()` in `shared/roll.ts` drops nulls before indexing from the end.**
  `_latest_series_value` calls `.dropna()` first, so `latest(rsi, 30)` counts thirty real
  observations back, not thirty rows. Indexing the raw array instead shifts every momentum
  delta on any series with a warm-up window — which is all of them.
- **RSI's warm-up window is the literal number 50, not null.** `_calculate_rsi` ends in
  `.fillna(50.0)`, so the first fourteen entries are real 50s that the long-window deltas
  will read. Leaving them null changes `rsi_change_30` on every short history.
- **The evaluators must be able to disagree.** The six modes are OR-matched, and a filter
  that matched everything would be no filter at all: the probe asserts that a coiling
  series matches consolidation and *not* downtrend, and that a controlled decline matches
  downtrend and not consolidation.
- **A monotonic decline is not a downtrend.** It drives RSI to 0, and `controlled_decline`
  needs RSI at or above 24 while `rsi_bearish` wants 26-52. The page shows orderly declines,
  not collapses — which is why the probe's fixture carries a 2% wobble.
- **Three tiers, and the fallback reasons are different.** Strict matches win; failing that,
  near misses (score over 50/55 and `near_eligible` not false); failing that, the whole
  scored pool. A pool that had history but matched nothing says "No strong technical setup
  found"; a pool whose history never loaded says "Technical pattern history was
  unavailable". Collapsing the two hides a Yahoo outage behind a shrug.
- **`near_eligible: false` means the structure was never there.** It is how an evaluator
  refuses promotion to the near tier regardless of score, and it is why a high-scoring
  `Late Breakout` is not offered as a near match.
- **A structural shape within six points of the top score wins the primary slot.**
  `_primary_pattern_mode` keeps a clean flag from being reported as a "Breakout Setup"
  because breakout scored a point higher; ties then break on an explicit order.
- **The draw is weighted and reaches only the top twelve.** `_ROLL_TOP_COUNT` is 12, so a
  ninetieth-ranked name never surfaces. With patterns on, the pattern score dominates and
  the quote score is worth a quarter of itself — that is what stops a liquid megacap with
  no setup from outdrawing the shape that was asked for.
- **Held and already-rolled names are pushed down, not filtered out.** `-14` for a portfolio
  holding and `-7` for a name in the roll history, against `+8` for a fresh idea. The page
  keeps surfacing something new without ever making a name unreachable.
- **The change percentage is derived, never read from `quoteSummary`.** The screener quote's
  `regularMarketChangePercent` is already a percentage (-2.44) while the summary's price
  module returns the same move as a fraction (-0.0244), so reading the summary through
  renders a 2.4% down day as "-0.02%". It is computed from the change and the previous
  close wherever both exist.
- **Today's bar is dropped before the close.** `_normalize_history_frame` removes a
  still-forming session so a half-day range cannot decide a consolidation or a breakout.
  The reference asks `pandas_market_calendars` and falls back to a weekday 16:00 ET; only
  the fallback is ported, so on an early-close session the last bar is dropped between
  13:00 and 16:00 ET — losing a completed session rather than admitting a partial one.
- **History is re-adjusted, like everywhere else in this app.** The bars come back
  unadjusted with `adjclose` alongside, and the ratio is applied to open/high/low. Drop it
  and a 2:1 split reads as a 50% single-session collapse that matches every downtrend
  filter.
- **A symbol whose history fails stays in the pool as `unavailable`.** Every evaluator
  answers empty for it and it sorts below the fallback rows. Dropping the row instead would
  let the pool silently shrink on a Yahoo hiccup with nothing on screen to say so.
- **Only the last payload is persisted, and its candidates lose their snapshots.**
  `_p18_session_snapshot` keeps the payload, the checkboxes and the history;
  `_p18_full_payloads` (five deep, for instant revisits) is session-only. `P18_CANDIDATE_FIELDS`
  omits `technical_snapshot`, so thirty snapshots of twenty-odd keys do not go to storage —
  only the selected name's copy, which sits at the top level, is ever read.
- **Four documented departures from `mixins/random_recommender.py`.** There are no progress
  or partial frames — `RandomStockWorker` emits both so the Qt page fills in stage by stage,
  and an IPC request/response carries neither, the same wall the Crypto and Economic ports
  hit; the status line reports the load instead. A superseded roll is discarded by request
  id rather than cancelled, because an in-flight `invoke` cannot be interrupted — its Yahoo
  work still lands in the caches. The balanced roll fetches one history rather than handing
  the whole pool to `yf.download` for a single chart. And the left rail lays its metrics out
  one label/value pair per row rather than the reference's two: that panel is a resizable
  splitter pane there and a fixed grid fraction here, and four columns inside it leave
  neither the labels nor the values legible.


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
| Stocks, all of it | `mixins/stocks_page.py` (plus its linked workers, services, persistence and smoke tests) |
| Crypto, all of it | `mixins/crypto.py` (worker `workers/crypto.py`, feeds `workers/news_sources.py`) |
| Options, all of it | `mixins/options_chain.py` (presenters `mixins/options_chain_presenters.py`, Greeks `services/options_analysis.py`, fetching `services/options_data.py`) |
| Projections, all of it | `mixins/charts_options_top_volume.py` (page28; presenters `mixins/options_chain_presenters.py`) |
| Valuation, all of it | `mixins/valuation.py` (page23; maths `services/valuation.py`, fetch and peers `workers/valuation.py`, Treasury `services/risk_free.py`) |
| Economic, all of it | `mixins/economic_page.py` (page42; presenters `mixins/economic_presenters.py`, providers and maths `services/economic.py`, worker `workers/economic.py`) |
| Dictionary, all of it | `mixins/dictionary_page.py` (catalog `services/dictionary_catalog.py`, diagrams `services/chart_pattern_catalog.py`, smoke `scripts/test_dictionary_page.py`) |
| Roll, all of it | `mixins/random_recommender.py` (page18; worker `workers/random_recommender.py`) |
| Heatmap, all of it | `mixins/spy_heatmap.py` (presenters `mixins/spy_heatmap_presenters.py`, worker `workers/etf_heatmap.py`, issuer files `etf_holdings.py`, widget `widgets/etf_heatmap.py`) |
| Fundamentals, all of it | `mixins/fundamentals_setup.py`, `mixins/fundamentals_render.py`, `workers/fundamentals.py`, `services/fundamentals_compare.py`, `services/sec_edgar.py` |
| Shortcut wiring, tab picker, Obscure | `mixins/window_setup.py`, `mixins/window_lifecycle.py` |
