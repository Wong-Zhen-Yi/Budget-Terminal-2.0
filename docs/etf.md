# ETF Explorer

The ETF page opens on the saved ticker (SPY for new or legacy empty sessions). Startup warms both the fund directory and that fund's holdings, including when the page has not been visited. Directory failure and holdings failure are independent and stay visible in startup/page status.

## Data and request budget

- **Directory:** one public, server-rendered Stock Analysis ETF directory download, not a paginated Yahoo screener sweep. Includes fund names, asset classes and published AUM. Funds without AUM remain discoverable. Search, asset-class filters and pagination are local.
- **Holdings:** common supported tickers route directly to their issuer. Full issuer baskets already loaded by Heatmap are reused. If no full issuer file is available, a public Stock Analysis holdings table is used; it is explicitly labelled partial. One cached, rate-gated Yahoo summary is the final fallback. Ordinary issuer/public loads do not request Yahoo enrichment.
- **Basket analysis:** only the Run basket analysis button requests Yahoo quotes. Opening a fund or the analysis view never triggers a constituent quote fan-out. Quotes use the shared, batched Spark cache without bypassing still-fresh constituent histories. The result is a return comparison, **not** a NAV premium or executable arbitrage signal.

## Caching

| Snapshot | Fresh lifetime | Minimum manual refresh age |
| --- | --- | --- |
| Fund directory | 24 hours | 1 minute |
| Fund holdings / final Yahoo summary | 24 hours | 1 minute |
| Basket analysis | 2 minutes | 2 minutes |

Renderer snapshots persist through the existing IndexedDB query cache; main-process snapshots persist in the existing SQLite service cache. Selecting another fund uses its normal query key, never `force`. Duplicate concurrent requests share one flight. There are no polling timers or focus refetches for the ETF queries.

ETF provider failures back off for five minutes, including across restarts and forced refreshes. A failed refresh retains the last good snapshot and reports stale/error status rather than replacing rows with an empty success. A full cached issuer basket is not replaced by a smaller public fallback during an issuer outage. Refresh age is tracked separately from the age of reused dependencies so an old directory cannot defeat the cooldown.

Missing expense ratios, dates, sectors and AUM are shown as unavailable, not fabricated. Public tables may expose only the largest 25 positions. Coverage is the sum of loaded weights; Others includes smaller loaded positions plus the uncovered remainder. AUM may include other share classes depending on the provider.

## Verification

From the repository root:

```sh
npm run typecheck
npm run build
npm run probe:etf --workspace budget-terminal-desktop -- --offline
npm run probe:etf-ui --workspace budget-terminal-desktop
npm run probe:etf --workspace budget-terminal-desktop -- SPY --no-arbitrage
npm run probe:etf --workspace budget-terminal-desktop -- QQQ --no-arbitrage --no-aum
npm run probe:etf --workspace budget-terminal-desktop -- VOO --no-arbitrage --no-aum
```

The offline probe uses scratch persistence and mocked HTTP to verify parsing, routing, request coalescing, refresh cooldowns, restart recovery, stale attribution, failure backoff and no Yahoo requests for issuer/directory loads. The Electron UI probe verifies local search/pagination, cached ticker switches, explicit-only basket requests, partial coverage, clipboard export, navigation, failed-refresh recovery, directory isolation and responsive width.
