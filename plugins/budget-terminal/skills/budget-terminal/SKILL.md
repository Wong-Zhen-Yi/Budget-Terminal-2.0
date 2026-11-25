---
name: budget-terminal
description: Capture app pages, research markets and read or edit saved portfolios, options records, Cards, personal finance and settings in the running local Budget Terminal app.
---

Use Budget Terminal tools for data owned by the local app. The server also offers the prompts `company_research`, `portfolio_review`, `market_brief` and `page_screenshot` as starting points. Open Budget Terminal before service calls; connection status can diagnose availability. Arguments use a `request` object; pass `{ "request": {} }` for operations without parameters.

For iPhone or iPad access, the configured private Telegram bot answers `/mobile` once Mobile Access is enabled under desktop Settings → Labs. Tailscale Serve is a separate browser endpoint. Keep MCP clients on the local MCP connection.

Read `data.mainPage` from `budget_terminal_settings` for a saved startup choice. Use the settings mutation `setMainPage` with a visible page ID or `null` to restore automatic selection. The preference applies on the next launch.

Read `data.enabledLabs` for opted-in experiments. Dashboard Lite and News Lite must be enabled in Settings → Labs for navigation and screenshots. For a requested settings edit, use `setLabEnabled` with `id: "dashboard-lite"` or `"news-lite"` and `enabled: true` or `false` under the existing settings write permissions. Use the existing News tools for News Lite headlines.

Screenshot page `focus-dashboard` for the Focus directory, topic shortcuts and two cached readings per card.

Use `budget_terminal_eth` for the Ethereum Focus page. Preserve the separate
`asOf` times for ecosystem TPS and mainnet TPS, block interval and median
transaction fees. growthepie history uses trailing seven-day averages for TPS,
gas throughput, user fees, stablecoin supply by layer and L2 settlement fees.
Credit Coin Metrics for completed UTC price, market cap, supply, issuance and
Mainnet active addresses. Credit ultrasound.money for Beacon validator balances
and matched ETH supply, and rolling seven-day ETH fee burn. Preserve the
separate snapshot times and distinguish rolling burn from completed UTC
issuance. Keep partial coverage and stale-data warnings.
Screenshot page `eth`.

`budget_terminal_hood` includes Robinhood's reviewed November 2026 investor
presentation and Q3 2026 earnings deck alongside market, financial and operating
reports. History covers five individual quarters from Q3 2025 through Q3 2026.
Preserve `asOf`, `publishedAt`, `reviewedAt`, `quarterlySource`, source pages and
non-GAAP notes. Revenue, deposits, expenses, EBITDA and diluted EPS are quarterly;
assets are quarter-end and ARPU is annualized.
Provider refresh freshness does not revalidate the dated presentation. The 14
revenue businesses overlap; quarterly annualized revenue is not realized annual
revenue. Screenshot page: `hood`. Reconnect clients after rebuilding its schema.

Use `budget_terminal_screenshot` with `{ "request": {} }` for the current page, `{ "request": { "page": "charts" } }` for a named tab, or `{ "request": { "page": "all" } }` for every available page, including tabs hidden from navigation and enabled Labs pages. It returns PNG image blocks and page/status metadata. The app can be covered, hidden or minimized; capture does not focus or restore its window and restores the selected tab afterward. Screenshots show the current viewport and any loading/failure state; inspect metadata before assuming data is ready. Privacy blur is preserved. Prefer a single page when inspecting a specific issue.

Preserve source, snapshot time, freshness, partial coverage and errors when interpreting results. Prefer existing cached results; request `force` only when a fresh provider fetch is necessary. Calls share the app's provider rate gate.

For Macro Focus, use `budget_terminal_economic` for GDP/CPI momentum and other driver readings. Use `budget_terminal_calendar_month` with an empty `request.tickers` array and the current US Eastern Time year and month for the release watch. Select the next scheduled occurrence of each FOMC, CPI, PCE, jobs and GDP release from today through 60 days ahead. Screenshot page: `macro`.

News tools refresh sources on every call. Portfolio and ticker headlines use keyless
TickerTick with Yahoo fallback; the full news page adds TickerTick market news,
Yahoo macro headlines and RSS. TickerTick batches share a five-per-30-second,
ten-per-minute IP budget with the app. Preserve fallback/cooldown warnings and
publication dates; a new retrieval does not make an older story current.

For current prices and portfolio values, call `budget_terminal_quotes` with
`{ "request": { "holdings": ["AAPL", "NVDA"] } }`. This uses the app's shared live
Hyperliquid stream first and refreshes its quote snapshot even when `force` is
omitted or false. Macro quotes and company sector lookups are skipped for fast
price reads; request `includeMacro: true` or `includeSectors: true` when needed.
Mapped stocks are USD equity-perpetual **mark prices**, and their changes use a
rolling **24-hour** basis. Preserve `market`, `currency`, `priceBasis`, `changeBasis`,
`source`/`priceSource`, `asOf` and `fallbackReason`; never describe a perp mark as an
exchange-traded share price. Do not infer a supported market from a similar symbol.

`chart`, `chartsHistory` and `chartsCompare` prefer covered Hyperliquid equity-perp
candles and identify whole-series Yahoo stock-history fallbacks for longer ranges
or unsupported symbols. Keep candle and mark sources distinct; never splice stock
and perp candles. Fundamental statements, adjusted returns/backtests and
`chartsRelationship` retain stock data. Use the compact quote tool for current
prices separately from cached company research. Field selection, summaries and
size-limited responses retain instrument labels in `response.provenance`; preserve
its omission warnings and disclose stale data, outages and fallbacks.

Read a saved record before editing it and verify the returned record afterward. Portfolio and options edits record holdings and contracts; they never place broker orders. Deletion tools can remove records. If a connection is interrupted during a write, read the record before trying again; the write may have completed.

Bulk import/export, clearing all user data, and cache reset stay in the desktop app. The server has no arbitrary filesystem or shell tools. Local client execution is required; a local stdio package alone does not make this app available to cloud or web tasks.

Use `budget_terminal_anthropic` with `{ "request": {} }` for Anthropic Focus research, including reviewed financial periods, private funding history, completed IPO terms, products, governance, official announcements and SEC filings. The `listing` field includes Nasdaq symbol ANT, the first trade date and a link to the exchange quote. `reviewedAt` dates the research and envelope freshness dates the source checks. Inspect `reviewReasons` and check errors. `operatingMetrics` and `capitalSnapshot` provide dated chart inputs. Customer thresholds are nested lower bounds, available credit is separate from pre-IPO liquidity, and next-12-month commitments are included in the through-2030 subtotal. The screenshot page ID is `anthropic`. Reconnect clients after rebuilding.

Use `budget_terminal_homebuilders` with `{ "request": {} }` for the Homebuilders Focus universe, adjusted histories, corporate valuations, earnings estimates and news. ITB/XHB are broader housing ETF benchmarks; their corporate profiles are omitted. Inspect per-lane timestamps and errors before treating data as current. Screenshots use page `homebuilders`. Reconnect clients after rebuilding the tool catalog.

Use `budget_terminal_nvda` with `{ "request": {} }` for NVIDIA market data, quarterly market-platform revenue, Data Center concentration, GAAP margins and company revenue guidance. Match each quarter's platform amounts to `platformLabels`. The three periods are the latest, previous and year-ago fiscal quarters. Inspect the source links, lane times and freshness before presenting figures. Screenshots use page `nvda`.
