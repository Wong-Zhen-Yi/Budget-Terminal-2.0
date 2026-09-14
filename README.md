# Budget Terminal (Electron)

A rebuild of Budget Terminal on Electron + React + TypeScript, migrated one page at a
time from the PySide6 app in `../Budget-terminal-pyside6`.

The migrated workspaces currently include Dashboard, Portfolio, Personal Finance,
Cards, Settings, Pre-Market, Trading Volumes, News, Calendar, Stocks, Fundamentals,
Charts, and Crypto.
Unported pages remain visible as placeholders in the top bar.

## Running it

On Windows, double-click **Budget Terminal Windows Browser.cmd** to start the
local server and open your default browser. **Budget Terminal Windows Electron.cmd**
starts the Electron app. On macOS, the separate browser launcher is
**Launch Budget Terminal Macos Browser.command**. Keep the launcher's terminal open
while using browser mode; press Ctrl+C to stop it.

To use the app in a browser, run from the repository root:

```bash
npm install
npm run dev:web
```

Open **http://127.0.0.1:3000** and keep the terminal running. Set `PORT` to use a
different port. The browser version uses a local Node server for market-data requests,
the shared Yahoo rate gate, caching, and saved data. It is a single-user local app;
it binds only to the loopback interface and is not a public hosted service.

For the built browser version:

```bash
npm run build:web
npm run start:web
```

On Windows, browser and desktop mode share the existing app data under `APPDATA`
and `LOCALAPPDATA`. Avoid editing the same data in both modes simultaneously.
On other platforms, defaults live under `~/.budget-terminal/data` and
`~/.budget-terminal/cache`; those environment variables can override the locations.
Exports download through the browser, backup imports use a file picker, and copy
buttons use the browser clipboard permission. Native window controls appear only in
Electron. The generated `out/web` files need the Node server and cannot be used as
a standalone static site.

Run `npm run build:web` followed by `npm run probe:web` for the offline HTTP and
backup checks. The probe uses temporary data directories.

To run the Electron desktop version:

```bash
npm run dev
```

Node 24 and npm 11 were used. If `node_modules/electron/dist/electron.exe` is missing
after an install, npm skipped Electron's postinstall — run `node node_modules/electron/install.js`.

## What the Dashboard shows

| Panel | Data |
|---|---|
| Macro bar | SPY, DXY (`DX-Y.NYB`), VIX (`^VIX`), GLD, WTI (`CL=F`) |
| Holdings | Read-only, from this app's saved portfolio; weight and unrealised gain per row |
| Analyst price targets | `quoteSummary.financialData.targetMeanPrice`; ETFs show `N/A` |
| Live news feed | Yahoo search, filtered to articles that list the ticker, max 2 per holding |
| Chart | Candles, volume and RSI in three panes, plus the 200-day MA |
| Top options | Three expiry buckets (this week, +2 weeks, +4 weeks), top 10 by volume each |

## What the Portfolio page shows

A summary bar (editable cash and margin, stock and options P&L, position count, total), a
portfolio selector with full create/rename/reorder/delete/set-main, and five sub-tabs.

| Sub-tab | Contents |
|---|---|
| Positions | Twelve-column table (Symbol, Shares, Avg Price, Cost, Price, Day's Change, Market Value, Weight, Dollar Gain, Growth, Market Cap / AUM, Analyst PT), the options tracker, plus Dip Finder and Portfolio Weight charts |
| Pie Chart | Allocation donut across weight-included positions and counted cash, with the filtered total |
| Portfolio Heatmap | Sector treemap over seven intervals (Live, 1D, 1W, 1M, 3M, YTD, 1Y), a stat strip and a hover detail bar |
| Momentum Tracker | Portfolio return since the window start against its own EMA (10/20/50-day by timeframe) |
| Portfolio Metrics | Beta, alpha, volatility, max drawdown, Sharpe, Sortino, CAGR, tail risk and skewness against a chosen benchmark and lookback, plus coverage, concentration, diversification and top holdings |

Shares and Avg Price edit in place; the checkbox beside each symbol takes that position
out of Weight and out of the header figures. Columns sort on click, and **Combined** is a
read-only aggregate across every portfolio, cost-weighted per ticker.

The options tracker holds ticker, strategy (long call/put, covered call, cash-secured
put), expiry picked from Yahoo's real expiration list, strike, quantity and premium; it
marks each contract live and derives P&L, return % and annualised %.

Quotes and the macro bar refresh every 60 seconds. Chart, options, targets and news
refetch when the ticker or timeframe changes, or on Reload (F5).

Clicking a holding loads it into the chart while **Auto** is on. The Dashboard's holdings
panel stays read-only; edits happen on the Portfolio page and show up here immediately.

## What the Cards page shows

Cards combines a built-in 100% SPY basket, three starter allocations, user-created
equal- or custom-weight baskets, and one live basket per saved portfolio. Every card has
1 Day, 30D and 1Y performance, a filled return chart, its resolved weighting, and its
own unavailable/partial state. Cards can be reordered by drag, portfolio cards can be
hidden and restored, and custom cards can be created, edited or removed.

The page owns `%APPDATA%\BudgetTerminalElectron\strategies.json`, initialized with
built-in starter cards. Old app files are never imported automatically. Card definitions, order, visibility and intervals are
persisted; market data stays in the runtime cache. Backups, imports and Clear All User
Data include Cards together with holdings and personal finance.

## What the Stocks page shows

Stocks is a resizable three-column research workspace. The left column contains the ticker
loader, company overview, analyst targets, description, four cross-page handoffs, and the
LLM Markdown export. The middle column contains ticker-linked news, institutional holders,
and the newest insider transactions. The right column contains three years of daily
candles with quote/OHLC details, range presets, Auto positioning, and an optional MFI(14)
pane with 80/20 reference levels.

The symbol, chart controls, splitter sizes, and last usable payload are persisted. A saved
snapshot renders immediately at startup while a fresh request runs in the background.
Chart history is required for a new workspace; failures in news or company metadata remain
isolated to their panels, while a total chart failure keeps the previous successful ticker
on screen.

## What the Fundamentals page shows

Fundamentals combines Yahoo company data with SEC company facts into six fixed annual or
quarterly grouped-bar charts. SEC cells take precedence within a seven-day fiscal-date
window and Yahoo fills gaps. The page includes comparison overlays, YoY/QoQ growth,
indexed values, headline valuation metrics, fullscreen charts, and searchable 10-K, 10-Q,
and 8-K filings. Its primary snapshot and presentation controls persist; a comparison
ticker is fetched again after restart.

## What the Charts page shows

Charts is a five-tab workstation: Main, Multi Charts, Compare, Relationship, and a
24-pattern offline Cheat Sheet. Each cheat-sheet pattern draws three synthetic
candlestick examples of its own geometry — textbook, noisy and extended — with its
neckline or boundaries marked and the confirming break flagged; `npm run patterns:png`
exports the same charts to `apps/desktop/docs/chart-patterns/`. Main supports one-minute through monthly history,
including same-session synthetic four-hour candles, three price styles, volume, RSI and
RSI average, daily MA200 alignment, portfolio average price, support/resistance,
Fibonacci levels, replay, polling, focus mode, and persisted SVG drawings. Multi Charts
combines active-portfolio or Charts-watchlist symbols with custom cards; Compare rebases
daily or weekly series to 0% and can show interval changes and a correlation matrix;
Relationship analyzes adjusted daily prices with indexed performance, ratio, rolling
correlation, and return regression.

Only user controls, lists, presets, chart order, Fibonacci configuration, and drawings
are persisted. Market data remains in the shared runtime cache. Failures are isolated per
symbol and a failed refresh leaves the last usable chart or healthy comparison cards on
screen.

## What the Options page shows

One shared ticker across three subtabs, as the reference has it.

**Chain** loads a single expiration into side-by-side CALLS and PUTS tables: strike, last,
bid, ask, change, volume, open interest, implied volatility and the five Greeks. Implied
volatility that Yahoo returns as zero — which is most of the chain outside regular hours —
is solved from the row's own mid, so the Greek columns are populated whenever the page is
open. The Strategy selector ranks the top three Covered Call or Cash Secured Put
candidates, tints those rows, appends `#1`/`#2`/`#3` to their strike and explains each
pick on hover; the status line names the winner and the two Greek inputs with their
sources. Export Chain copies the whole expiry as Markdown.

**Options by Top Volume** and **Options by Strike** both work from every live expiration
at once, one panel per expiry in a grid that narrows with the count. Top Volume shows the
ten highest-volume contracts per expiry under a Both/Calls/Puts filter, with the highest
and lowest price and volume cells tinted (the legend sits in the toolbar); by Strike shows
every contract at one chosen strike, calls before puts. Sorting one panel sorts all of
them. Export Options by Top Volume copies the whole grid as Markdown.

Nothing loads on mount, exactly as `init_page5` fires nothing: every load comes from a
button, because the two summary tabs cost one Yahoo request per listed expiration. A
single expiry that fails puts a warning dot on its own panel and leaves the grid's shape
alone.

## What the Crypto page shows

A six-tile KPI strip (BTC, ETH, SOL, total market cap, Fear & Greed, 24h volume), the
Top 30 cryptocurrencies as a 6x5 heatmap tinted by the 24h move, and a bottom row of
Watchlist / Movers, the crypto news feed and the ETF / equity proxies. Refresh reloads
every stage; Export copies the BTC/ETH/SOL snapshot to the clipboard, as the reference
does.

Four independent stages sit behind it: CoinGecko's top-30 and per-coin markets calls,
CoinGecko's `/global` block, alternative.me's crypto Fear & Greed index (which is not the
CNN equity index the Pre-Market page reads), and four crypto-native RSS feeds. Only the
six equity proxies are Yahoo. A stage that fails puts a warning dot on its own panel and
leaves the rest of the page intact, and a failed heatmap falls back to five tiles built
from the coin quotes.

## What the Heatmap page shows

One index ETF's complete holdings list as a treemap, grouped into GICS sector boxes and
sized by each holding's weight in the fund. Three index buttons — S&P 500 (via SPY),
Nasdaq 100 (via QQQ) and Dow 30 (via DIA) — and seven interval buttons from Live to 1Y.
The strip above the map prints the load time, the holdings count, quote coverage, the
weight-weighted move and the strongest and weakest holding for the selected interval; the
strip below prints the selected tile's sector, weight, price and change.

Scroll to zoom (up to 6x) and drag to pan; zooming magnifies the layout without enlarging
the type, so tiles too small to carry a label at 1x reveal one as you go in. Click selects
a holding, and double-clicking opens it in Charts. Switching interval never goes back to
the network — the payload carries all seven windows for every holding.

The holdings themselves come from the issuers: SSGA's daily xlsx for SPY and DIA, and
Invesco's own API for QQQ, with Yahoo's top-holdings list as a last resort. Sectors that
the issuer file leaves blank are filled from the S&P 500 constituent table. The closes
behind every tile are one year of daily bars from Yahoo's `spark` endpoint, batched twenty
symbols at a time — 26 requests for SPY's 503 names, about seven seconds in total. A
holding Yahoo will not quote is drawn as a dashed outline rather than a neutral tile, so
missing data never reads as a flat move, and the coverage cell turns amber (red past half
the book) to say how many there are.

## What the ETF page shows

Any US ETF's full holdings list, pulled from the issuer's own published file. Type a
ticker and press Enter, or click a fund in the left rail — which ranks the whole US ETF
universe by net assets, about five thousand funds, from one paged Yahoo screener sweep.
The fund summary prints the name, issuer, as-of date, expense ratio, net assets and the
number of holdings loaded, with the sector breakdown on the line below and a link to the
issuer document the numbers came from.

The Holdings subtab is the table beside a breakdown donut: the twelve largest names keep
their own wedge and everything below them folds into Others, along with whatever share of
the fund the loaded rows do not account for — which is why the centre reads coverage
rather than 100%. The filter box narrows the table by ticker or name; the donut always
describes the whole fund. Double-clicking a row opens the holding in Charts.

The Arbitrage subtab compares the ETF's own session move against the weighted move of the
holdings underneath it. The gap is a raw return gap in basis points, not a NAV premium:
positive means the ETF is running rich to its basket. The basket move is weighted over
the holdings that actually returned a quote, so the coverage cell is part of the reading —
a gap computed over half the book is not a signal, and the status line says so.

Seven issuers are tried in order — ARK, iShares, SPDR/State Street, Invesco, Vanguard,
First Trust, ProShares — with Yahoo's top-holdings list underneath them all. A fund that
lands on the Yahoo fallback shows ten rows instead of five hundred and says so rather than
presenting them as the book. As of this writing SPDR, Invesco, ARK and ProShares answer
with full holdings; iShares, Vanguard and First Trust have each changed their pages out
from under the scraper and currently fall through to the fallback, exactly as they do in
the PySide6 app. Nothing on the page refreshes on a timer: Load Holdings, a rail click,
Refresh Arbitrage, Refresh AUM and F5 are the only things that fetch.

### Where holdings live

This app owns its own store at `%APPDATA%\BudgetTerminalElectron\portfolio.json`.
New stores start with one empty portfolio and empty personal-finance entries. Old
PySide6 data is never imported automatically, including when upgrading older stores.
Existing saved portfolios remain in AppData until explicitly changed or cleared.
Use Settings to import a Budget Terminal backup intentionally. Personal runtime files
and backups are excluded from Git. Writes are atomic (temp file plus rename) and queue behind each other, so a
burst of cell edits cannot interleave and lose one.

## Architecture

```
renderer (React)  ──IPC──>  main process  ──>  MarketDataProvider  ──>  yahoo-finance2
                                                      │
                                                      ├──>  portfolio.json (read + write)
                                                      └──>  strategies.json (read + write)
```

- **No API keys.** `yahoo-finance2` hits the same Yahoo endpoints `yfinance` does.
- **`MarketDataProvider`** (`electron/services/provider.ts`) is the seam. When the
  Python-heavy pages get migrated (backtest, signals, quant, valuation), a second
  implementation backed by a FastAPI sidecar can satisfy the same interface without the
  renderer changing.
- **Every Yahoo call is paced** by `electron/services/yahoo/rateGate.ts`, a port of the
  PySide6 `yahoo_rate_limit.py`. One dashboard load fans out into quotes, a chart, three
  option chains, and a target plus a news search per holding; unpaced, Yahoo 429s.
- **Every handler answers with an `Envelope`** — payload, freshness metadata, non-fatal
  errors — mirroring `attach_market_data_result`, so one failed feed degrades its own
  panel instead of blanking the page.
- **Renderer is sandboxed**: `contextIsolation` on, `nodeIntegration` off, a CSP that
  allows only self, and no in-app navigation. News links open in the system browser
  through an explicit IPC channel that accepts http(s) only.

```
apps/desktop/
  electron/
    main.ts preload.ts
    ipc/handlers.ts
    shared/          contract.ts envelope.ts portfolioMath.ts stocks.ts charts.ts
                     analytics.ts sectors.ts                 <- used by both sides
    services/
      provider.ts    portfolioStore.ts cardsStore.ts indicators.ts cache.ts
      yahoo/         client rateGate quotes chart cards chartsPage options targets news stocks
                     fundamentals history optionQuotes
  src/
    App.tsx  pages/DashboardPage.tsx pages/StocksPage.tsx
    api/  charts/  components/  stores/  lib/  styles/
  scripts/           probe.ts probe-portfolio.ts probe-rate.ts probe-store.ts
                     probe-analytics.ts probe-stocks.ts probe-charts.ts probe-cards.ts
```

## Checking the data

The services run headless, so you can compare them against the PySide6 app directly:

```bash
npm run probe -- AAPL "1 Week"
```

Prints the macro quotes, a chart tail with MA200/RSI/RSI-MA, the three option buckets,
targets and news. On the reference screenshot this reproduces AAPL $309.35 +$3.42
(+1.12%), MA200 280.67, RSI(14) 56.48, RSI MA(14) 62.91 exactly.

```bash
npm run probe:portfolio
```

Prints both holdings views as the UI renders them: the Portfolio page's twelve columns
and header figures, and the Dashboard panel's four. Compare each against the matching view
in the PySide6 app.

The two Weight columns legitimately disagree — the Dashboard divides by stock market value
alone, the Portfolio page divides by stock value plus cash. That is what the reference app
does too.

```bash
npm run probe:stocks -- --offline
npm run probe:stocks -- AAPL
```

The offline mode deterministically checks MFI, fallback metrics, holder and insider
ordering, uncapped ownership changes, retained-workspace behavior, and the Markdown export.
The live mode additionally checks Yahoo ordering, three-year coverage, quote calculations,
and panel limits for the requested ticker.

```bash
npm run probe:fundamentals -- --offline
npm run probe:fundamentals -- AAPL
```

The offline mode checks statement merging and derivations, headline calculations,
comparison geometry, filings, provider pacing, and SEC disk-cache behavior. The live mode
also checks all six chart families and official SEC filing URLs.

```bash
npm run probe:charts -- --offline
npm run probe:charts -- AAPL
```

The offline mode checks settings normalization, valid interval/range combinations,
four-hour aggregation, indicators and levels, drawing serialization, comparison and
relationship calculations, cache/error behavior, and all 24 cheat-sheet entries. The
live mode covers a main chart, a small comparison basket, and an adjusted relationship
pair through the shared Yahoo rate gate.

```bash
npm run probe:store
```

Initializes an empty scratch store, checks that legacy data is ignored, and exercises every mutation plus every guard
(duplicate ticker, unknown portfolio, the five-portfolio cap, deleting the last one). It
redirects `APPDATA` and `LOCALAPPDATA` first, so your real store is never touched.

```bash
npm run probe:analytics
```

Prints the Dip Finder, Heatmap, Momentum and Metrics figures for the active portfolio.
Every number has a counterpart on the matching sub-tab of the PySide6 app; they are
expected to agree to the decimal.

```bash
npm run probe:rate
```

Fires 20 symbols at once and fails if any get rate limited.

```bash
npm run typecheck
```

```bash
npm run probe:crypto -- --offline
npm run probe:crypto
```

The offline mode checks the price/money/percent formatting ladders, the tone and heatmap
intensity rules, rank sorting, stage counting and the clipboard snapshot. The live mode
runs all four stages and prints the KPI figures, both tables and the news feed for
side-by-side comparison against the PySide6 page.

```bash
npm run probe:options -- --offline
npm run probe:options -- AAPL
```

The offline mode checks the 16:00-New-York expiry rules, the Black-Scholes Greeks and the
implied-vol solve against numbers produced by the reference's own
`services/options_analysis.py`, the strategy ranking and its rejection rules, both summary
record builders, the cell-highlight ranking and both Markdown exports. The live mode runs
the chain load and the all-expiration sweep and prints the Greek inputs, the ranked
strategy picks, and the per-expiry top contract for side-by-side comparison.

## Things worth knowing before changing the data layer

- **Yahoo appends bars that are not bars.** Weekly and monthly series get an extra row
  for the current partial period on top of the aggregated one, and intraday series get a
  flat zero-volume row at the live quote. Both are stripped in
  `electron/services/yahoo/chart.ts`; leaving either in flattens the header change to
  0.00% and shifts every windowed indicator by one bar.
- **MA200 is always computed from daily bars**, then carried onto the displayed bars with
  a backward join at day granularity. A 200-bar rolling mean of 5-minute candles is a
  different line, and comparing exact timestamps lands a day early because weekly bars are
  stamped at the period open while daily bars are stamped at their own.
- **Intraday lookbacks are capped** (1m: 6d, 5m/15m: 59d, 1h: 729d). Yahoo errors rather
  than truncating when you ask for more.
- **RSI is Wilder-smoothed**, not a rolling mean.
- **Stocks MFI is a 14-period rolling-sum indicator.** Typical price and raw money flow
  are split by the direction of successive typical prices, then the rolling positive and
  negative sums produce the ratio. It is not Wilder-smoothed; zero-negative-flow windows
  read 100 and the pane carries fixed 80/20 reference lines.
- **A Stocks chart is required, but its metadata is not.** Company facts, news, holders,
  and insiders fail independently. Do not replace the last usable workspace when a new
  ticker has no chart, and do not add a timer: startup refresh, Load, and F5 are the only
  data requests.
- **History windows use calendar arithmetic, not day counts.** yfinance reads `period='1y'`
  as the same date a year earlier; approximating that with 365 or 366 days shifts the
  window by one bar and changes every windowed metric. `windowStart` in `history.ts`
  subtracts calendar months and years for exactly that reason.
- **History is auto-adjusted.** A split inside the window would otherwise read as a 50%
  loss in the Dip Finder and drag the risk metrics with it.
- **One `quoteSummary` per ticker serves both pages.** `fundamentals.ts` returns quote
  type, size and analyst target together, because the Portfolio page needs the size and
  the Dashboard needs the target; splitting them would double the slowest request.
- **The type scale is defined once** in `src/styles/theme.css`. The chart's own labels are
  canvas text and carry their own `fontSize`, and the column widths are persisted, so both
  need updating alongside it (see CLAUDE.md).

```bash
npm run probe:heatmap -- --offline
npm run probe:heatmap -- SPY
```

The offline mode checks the seven interval returns against a synthetic close series with a
known shape (including pandas' month-end clamping and YTD's before-January base), the
per-interval coverage and weighted-move arithmetic, the summary and detail builders, the
symbol filter and the tile colour ramp. The live mode loads one index end to end and
prints the issuer file it came from, coverage per interval, the sector split as the map
groups it and the top fifteen holdings.

## Not built yet

The remaining placeholder pages, packaging, and the FastAPI sidecar. `npm run build` and
`electron-builder` are untested — `npm run dev` is the supported entry point for now.
