# Semiconductors Focus page

The page uses a reviewed catalog, not an automatic screener or an ETF holdings list.
The initial review on October 13, 2026 contains 79 companies across eight supply-chain groups.
`apps/desktop/electron/shared/semiconductorCatalog.ts` is the membership source of truth.

## Review methodology

Each entry records its operating headquarters, U.S. exchange, SEC CIK, primary group,
inclusion rationale, diversification flag, evidence URLs and review date. Annual
10-K/20-F disclosures were checked for the semiconductor business and U.S. offices;
the Nasdaq Trader `nasdaqtraded.txt` company directory was checked for an active
Nasdaq/NYSE/NYSE American listing, excluding ETFs and test issues. Country refers
to operating headquarters rather than incorporation or the registered-agent address.
The catalog links each company's annual report and SEC filings, and company sources
where annual disclosures alone do not establish the latest status.

Specific review decisions:

- GlobalFoundries is headquartered in Malta, **New York**, although incorporated
  in the Cayman Islands. Its company FAQ corroborates inclusion.
- Credo's annual report identifies its operating headquarters in the San Francisco
  Bay Area; its corporate contact page gives San Jose. Its Cayman registered-agent
  address is not treated as operating headquarters.
- IonQ owns SkyWater following the July 31, 2026 acquisition. Include IonQ with a
  diversified flag and foundry rationale; exclude the former SKYT listing.
- Qorvo combined with Skyworks on October 5, 2026. Include SWKS, exclude QRVO.
- Qnity holds the electronics business separated from DuPont. Include Q; do not
  carry forward DuPont solely for its former semiconductor materials business.
- TSM, ASML, ARM, UMC and NXP are outside the U.S.-headquarters policy even when
  they have U.S. listings. OTC companies and semiconductor ETFs are outside the universe.
- Diversified suppliers are included when disclosures establish products supplied
  directly into chip design/fabrication/test. Merely buying or using chips does not qualify.

This is a dated coverage review, not a guarantee that every later IPO, acquisition
or newly disclosed supplier is included. To update membership, check current
disclosures and the listing directory, amend the catalog and update the review date.
Do not add foreign-headquartered issuers based solely on a U.S. exchange or SEC registration.

## Data and readiness

All catalog companies remain in the table during provider failures. Market/history
snapshots have a five-minute TTL, news ten minutes, profiles twelve hours. Each lane
retains its original source timestamp and usable stale data after refresh failures.
Requests pass through the shared Yahoo pacing gate, with at most four stock tasks
running concurrently. The complete page loads during startup, including every
company's adjusted history, profile, earnings estimate and ticker-associated news.
While the page is active, it renews market data every five minutes, reusing profiles
and news until their separate TTLs expire. Returning to a startup-prepared page does
not trigger an initial request. Manual Refresh and global F5 force a refresh.
Partial/stale startup results stay visible as degraded; total failures remain failed.

The table's monthly return uses the last available adjusted close on or before one
calendar month ago (clamped at month end). YTD uses the last available adjusted close
on or before the previous December 31. Insufficient history yields a missing value.
Comparison lines share their first common trading session and leave gaps for absent
observations. Whole-company market caps and financials are used for diversified
suppliers; these are not segment valuations. Revenue growth is the provider's latest
quarterly YoY growth, gross margin/revenue are TTM snapshots, and forward P/E and
earnings dates are estimates. Earnings dates use the New York market calendar.

## Verification

Run from the repository root:

```sh
npm run typecheck
npm run probe:semiconductors --workspace budget-terminal-desktop
npm run probe:semiconductors --workspace budget-terminal-desktop -- --live
npm run probe:semiconductors --workspace budget-terminal-desktop -- --live --all
npm run probe:loading --workspace budget-terminal-desktop
npm run probe:navigation --workspace budget-terminal-desktop
npm run probe:mcp --workspace budget-terminal-desktop
npm run build
npm run probe:semiconductors-ui --workspace budget-terminal-desktop
```

The live probe defaults to one company per group; `--all` checks the entire catalog.
Probes isolate APPDATA/LOCALAPPDATA in temporary directories. The UI probe verifies
startup/revisit behavior, filters, sorting, navigation, comparison limits, chart bounds,
refresh, outages, recovery and narrow layouts. Screenshots use synthetic public-data
fixtures and are generated under the ignored `apps/desktop/out/` directory.
