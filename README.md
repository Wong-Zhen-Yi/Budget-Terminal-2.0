# Budget Terminal (Electron)

A rebuild of Budget Terminal on Electron + React + TypeScript, migrated one page at a
time from the PySide6 app in `../Budget-terminal-pyside6`.

**Built so far: the Dashboard and the whole Portfolio page.** The other pages appear as
labels in the top bar and say so when clicked.

## Running it

```bash
npm run dev
```

Node 24 and npm 11 were used. If `node_modules/electron/dist/electron.exe` is missing
after an install, npm skipped Electron's postinstall — run `node node_modules/electron/install.js`.

## What the Dashboard shows

| Panel | Data |
|---|---|
| Macro bar | SPY, DXY (`DX-Y.NYB`), VIX (`^VIX`), GLD, WTI (`CL=F`) |
| Holdings | Read-only, from the PySide6 app's own store; weight and unrealised gain per row |
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

### Where holdings live

This app owns its own store at `%APPDATA%\BudgetTerminalElectron\portfolio.json`. On
first run it is seeded once from the PySide6 app's `user_data.json`, and after that the
two applications keep separate books — editing here does not change the PySide6 app, and
vice versa. Writes are atomic (temp file plus rename) and queue behind each other, so a
burst of cell edits cannot interleave and lose one.

## Architecture

```
renderer (React)  ──IPC──>  main process  ──>  MarketDataProvider  ──>  yahoo-finance2
                                                      │
                                                      └──>  portfolio.json (read + write)
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
    shared/          contract.ts envelope.ts portfolioMath.ts
                     analytics.ts sectors.ts                 <- used by both sides
    services/
      provider.ts    portfolioStore.ts  indicators.ts  cache.ts
      yahoo/         client rateGate quotes chart options targets news
                     fundamentals history optionQuotes
  src/
    App.tsx  pages/DashboardPage.tsx
    api/  charts/  components/  stores/  lib/  styles/
  scripts/           probe.ts probe-portfolio.ts probe-rate.ts probe-store.ts
                     probe-analytics.ts
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
npm run probe:store
```

Seeds a scratch store from your PySide6 file and exercises every mutation plus every guard
(duplicate ticker, unknown portfolio, the five-portfolio cap, deleting the last one). It
redirects `APPDATA` first, so your real store is never touched.

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

## Not built yet

Portfolio editing, the other 30 pages, the Obscure/privacy toggle, packaging, and the
FastAPI sidecar. `npm run build` and `electron-builder` are untested — `npm run dev` is
the supported entry point for now.
