# DefeatBeta Terminal page

Open **Research → DefeatBeta Terminal**. This native React page adapts the ten-tab
workflow of [defeat-beta/defeatbeta-terminal](https://github.com/defeat-beta/defeatbeta-terminal),
whose original UI runs in a terminal. It uses Budget Terminal's existing DefeatBeta
Parquet reader; Python, Bun and a separate terminal installation are unnecessary.

Enter a US equity ticker (default AAPL), or press `/` to focus ticker search.
Keys `1` through `9`, then `0`, select Overview, Profile, Financials, Valuation,
Growth, Profitability, DCF, News, SEC Filings and Breakdown. Shortcuts are active
only while this page is visible and focus is outside a text field.

- Overview shows daily OHLC candlesticks across the full chart width, with a
  separate volume pane and MA10/50/200 overlays. Hover to inspect OHLC, volume
  and moving averages, scroll to zoom, or drag to pan. Range presets and Reset
  view restore a chosen period; clicking an MA legend entry toggles its overlay.
  All chart interactions reuse the loaded history. Incomplete OHLC remains a
  gap rather than an invented candle. Event tables appear below the chart.
- Financials switches income statement, balance sheet and cash flow, with annual
  and quarterly periods. Clicking a metric charts it. Growth uses fiscal YoY;
  Profitability divides each metric by revenue in the same reporting period.
- Valuation derives multiples from reported statements and the latest published
  close. Market capitalization uses the latest reported shares before that close.
  Cross-currency multiples require USD reporting; missing inputs remain blank.
- DCF has editable growth assumptions for years 1–5 and 6–10, discount rate and
  perpetual terminal growth. It values reported FCF as an equity cash-flow proxy,
  without a separate cash/debt adjustment. Positive FCF and shares are required.
- News includes a full earnings-transcript reader. SEC Filings supports important
  forms or all forms, with source links. Breakdown retains source currencies and
  value types and offers quarterly or trailing periods.

Every section starts loading at application startup, even if this page is hidden
or unvisited. All ten subtabs use those warmed queries. The last ticker is saved
per profile. Refresh rechecks the dataset manifest and keeps the revision-pinned
row cache when the publication has not changed. Failed refreshes retain existing
rows and expose the failure in the section status and footer.

These are published snapshots, not live quotes. Section status identifies the
dataset publication date, while rows retain their own reporting dates. Publications
older than seven days are marked stale. This page does not include the upstream
industry overlays or its exact DCF model. It does not change the Yahoo-only data
policy on other pages or introduce automatic provider failover.

Validation:

```powershell
npm run typecheck
npm run build
npm run probe:defeatbeta-terminal --workspace budget-terminal-desktop
npm run probe:defeatbeta-terminal --workspace budget-terminal-desktop -- --live
npm run probe:defeatbeta-terminal-ui --workspace budget-terminal-desktop
npm run probe:loading --workspace budget-terminal-desktop
npm run probe:navigation --workspace budget-terminal-desktop
npm run probe:mcp --workspace budget-terminal-desktop
```

Probes isolate application data in temporary directories. The UI probe uses
synthetic data and saves a screenshot under `output/playwright/`.
