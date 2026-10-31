---
name: budget-terminal
description: Capture app pages, research markets and read or edit saved portfolios, options records, Cards, personal finance and settings in the running local Budget Terminal app.
---

Use Budget Terminal tools for data owned by the local app. Open Budget Terminal before service calls; connection status can diagnose availability. Arguments use a `request` object; pass `{ "request": {} }` for operations without parameters.

Use `budget_terminal_screenshot` with `{ "request": {} }` for the current page, `{ "request": { "page": "charts" } }` for a named tab, or `{ "request": { "page": "all" } }` for every implemented page, including tabs hidden from navigation. It returns PNG image blocks and page/status metadata. The app can be covered, hidden or minimized; capture does not focus or restore its window and restores the selected tab afterward. Screenshots show the current viewport and any loading/failure state; inspect metadata before assuming data is ready. Privacy blur is preserved. Prefer a single page when inspecting a specific issue.

Preserve source, snapshot time, freshness, partial coverage and errors when interpreting results. Prefer existing cached results; request `force` only when a fresh provider fetch is necessary. Calls share the app's provider rate gate.

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
