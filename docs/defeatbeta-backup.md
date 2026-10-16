# DefeatBeta backup feed

Yahoo remains the primary feed. When a covered request fails or returns no usable data,
Budget Terminal automatically tries the public datasets used by
[defeatbeta-api](https://github.com/defeat-beta/defeatbeta-api). No API key, Python
installation, or separate service is required.

Coverage:

- US equity daily OHLCV history, including shared charts, screens and historical calculations.
- Quotes: Yahoo daily chart, then Yahoo quote, then the last two DefeatBeta daily closes.
- Company profiles and reported fundamentals used by Stocks, Fundamentals, Portfolio,
  Discovery, Valuation, semiconductor profiles and market-cap sales multiples.
- Annual and quarterly financial statements, with TTM values used for summary facts.

DefeatBeta publishes periodically, typically daily. It is not a live feed. Fallback
results carry `DefeatBeta (daily backup)` source metadata, the source observation
date, a stale status and a visible warning explaining the Yahoo failure. Those
annotations survive caching and derived results. Failed backup requests retain
both provider errors and allow the existing stale-cache fallback to run.

Intraday/weekly/monthly bars, non-US listings, forex, indices, futures, options,
news, analyst targets, calendar and ownership data are not supplied by this adapter.
Unsupported fields remain unavailable. Daily prices have no separate dividend-adjusted
close; calculations requiring that field remain unavailable or carry the backup
history warning. Market cap is estimated from the latest reported shares and daily
close. Reporting currency is kept separate from USD listing prices, and cross-currency
P/E and sales multiples are not guessed.

The adapter reads Hugging Face Parquet byte ranges, prunes row groups by symbol,
shares metadata and concurrent lookups through the existing cache, decodes data in a
worker to keep the desktop responsive, and pins reads
to an immutable dataset revision. It rejects whole-file responses and oversized
ranges. A change of provider replaces the canonical history rather than mixing
partial series from different feeds. Subsequent refreshes attempt Yahoo again.

Verification:

```bash
npm run probe:defeatbeta -- --offline
npm run probe:defeatbeta -- AAPL
npm run typecheck
```

The live probe forces Yahoo failures so it verifies the actual fallback path,
including quotes, daily history, profiles, statements and cached source metadata.
Probes use temporary application-data directories.
