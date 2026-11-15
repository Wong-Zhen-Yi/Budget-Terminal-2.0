# HOOD Focus

The default Business model view follows Robinhood's [November 11, 2026 investor presentation](https://investors.robinhood.com/static-files/72febcf6-0d7c-4a95-9c94-bc98c42b8284).
It uses an independent customer-to-assets-to-revenue-to-earnings structure, with
selectable historical columns, customer economics, revenue businesses and a
three-part priority selector. Market & filings retains stock ranges, quarterly
statements, SEC filings and news. Desktop panels fit the viewport; narrow windows
stack or scroll to preserve readability. Diagnostics remain in Settings.

`electron/shared/hoodPresentation.ts` owns reviewed data, source dates, slide
references and definitions. The [Q3 2026 earnings presentation](https://investors.robinhood.com/static-files/fd90f575-5b4c-4cde-a16d-d114c920fb6a), published October 27, 2026, supplies five discrete quarters
from Q3 2025 through Q3 2026. Earnings slides 3, 4 and 13 supply customers, assets,
deposits, quarterly revenue mix, expenses, EBITDA, diluted EPS and ARPU; slides
43–44 reconcile non-GAAP measures. Revenue, net deposits, expenses, EBITDA and EPS
cover each individual quarter. Assets are quarter-end balances. ARPU and the
quarterly net deposit growth rate are annualized as reported, not forecasts.
The latest headlines use Q3 2026 revenue of $1.424B, adjusted EBITDA of $808M,
57% adjusted EBITDA margin and $15.7B of quarterly net deposits. Customer economics
shows the selected quarter's annualized ARPU and diluted EPS. Gold adoption and
assets per customer are calculated from rounded quarter-end inputs.

The November investor presentation still owns management priorities and the 14
businesses. Their $100M threshold annualizes a single quarter and their activities
overlap; their figures must not be summed. Annual/LTM snapshots persisted by the
previous build fall back to the current bundled quarterly data on opening.

The reviewed snapshot is bundled and available offline. Refresh/F5 updates the
existing market, financial, monthly and quarterly providers; it does **not**
revalidate or restate presentation figures. Updating to a later deck requires
reviewing its dates, metric definitions, charts and source notes together.
The monthly pulse separately labels its report period and source link.
All existing startup preloading and failure reporting remain intact.

The existing read-only `budget_terminal_hood` response adds `presentation` with
these same fields, including `quarterlySource` and history `basis: "quarter"`.
Requests and permissions are unchanged. Old renderer snapshots
fall back to the quarterly reviewed bundle until the next provider load. The envelope
freshness describes provider lanes, not the age of the presentation.

Validation:

```sh
npm run typecheck
npm run probe:hood --workspace budget-terminal-desktop
npm run build
npm run probe:hood-ui --workspace budget-terminal-desktop
npm run probe:hood-electron --workspace budget-terminal-desktop
npm run build:mcp
npm run probe:mcp
npm run probe:launcher
```

The Windows, macOS and Linux double-click launchers share the current source
build path, which regenerates MCP schemas and the local plugin. Reconnect MCP
clients after rebuilding to load the changed output schema and description.
