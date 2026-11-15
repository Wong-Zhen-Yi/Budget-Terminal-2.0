# HOOD Focus

The default Business model view follows Robinhood's [November 11, 2026 investor presentation](https://investors.robinhood.com/static-files/72febcf6-0d7c-4a95-9c94-bc98c42b8284).
It uses an independent customer-to-assets-to-revenue-to-earnings structure, with
selectable historical columns, customer economics, revenue businesses and a
three-part priority selector. Market & filings retains stock ranges, quarterly
statements, SEC filings and news. Desktop panels fit the viewport; narrow windows
stack or scroll to preserve readability. Diagnostics remain in Settings.

`electron/shared/hoodPresentation.ts` owns reviewed data, source dates, slide
references and definitions. Slides 3, 6, 12, 14 and 17 supply the figures; slides
20–21 reconcile non-GAAP measures. History uses USD, counts and 0–100 percentages.
The final column is LTM through September 2026, while assets are period-end
balances. It is not a full-year forecast. Gold adoption and assets per customer
are calculated from the rounded deck inputs. Retention preserves the deck's
escheatment caveat. The 14 businesses overlap, and the $100M threshold annualizes
a single quarter; their figures must not be summed.

The reviewed snapshot is bundled and available offline. Refresh/F5 updates the
existing market, financial, monthly and quarterly providers; it does **not**
revalidate or restate presentation figures. Updating to a later deck requires
reviewing its dates, metric definitions, charts and source notes together.
The monthly pulse separately labels its report period and source link.
All existing startup preloading and failure reporting remain intact.

The existing read-only `budget_terminal_hood` response adds `presentation` with
these same fields. Requests and permissions are unchanged. Old renderer snapshots
fall back to the reviewed bundle until the next provider load. The envelope
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
