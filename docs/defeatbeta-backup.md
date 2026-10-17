# Market data provider policy

Yahoo Finance supplies the application's quotes,
charts, historical calculations, financial statements, company summaries,
semiconductor market data and news.
Every Yahoo request passes through the shared rate gate. A failed request is
reported against Yahoo; it does not start a request to DefeatBeta or switch quote
endpoints. Saved data from the same source can remain visible with a stale label
and the failed refresh reason.

Amazon quarterly releases and Micron earnings use SEC EDGAR directly, without
automatic switching between SEC and investor-relations hosts. Micron's separate
memory disclosures continue to use its published investor documents.

The remote cache schema changed so older derivatives containing DefeatBeta data
are rebuilt. Saved portfolios, settings and financial records are unaffected.
Every implemented page still begins its initial load at startup, and startup
failures remain visible.

The Heatmap page uses Yahoo Finance for constituent daily closes and returns.
ETF holdings and weights come from issuer files, with no Yahoo enrichment or fallback.
The page identifies the price date separately from the holdings date and keeps missing
prices and failed refreshes visible. Refresh forces Yahoo history reads. Heatmap service
and renderer cache keys exclude the previous DefeatBeta results.
Its existing startup preload remains enabled.

The dedicated [DefeatBeta Terminal page](defeatbeta-terminal.md) explicitly reads
DefeatBeta published datasets and preloads its research sections at startup.
Other pages retain the Yahoo-only policy above. DefeatBeta is not a fallback for
Yahoo failures. Its client, decoder, normalizers, request gate and usage entry
support the dedicated page and standalone development probes.
Its revision-pinned Parquet reads, range validation, request pacing and decoder
worker remain covered by the standalone probe. There is no automatic provider failover.

Verification commands:

- npm run probe:provider-selection --workspace budget-terminal-desktop
- npm run probe:provider-selection --workspace budget-terminal-desktop -- --live
- npm run probe:defeatbeta --workspace budget-terminal-desktop -- --offline
- npm run probe:heatmap -- --offline
- npm run probe:heatmap -- DJI
- npm run probe:heatmap-ui --workspace budget-terminal-desktop
- npm run typecheck

The Heatmap probe guards all DefeatBeta entry points during successful Yahoo reads
and outages. Its live mode queries Yahoo only.
The provider-selection probe verifies Yahoo-only behavior during both successful
reads and outages, ETF calendar classification, successful empty YouTube searches
and persisted YouTube failures. Its live mode checks the symbols in the reported
data-health errors. Probes use temporary application-data directories.
