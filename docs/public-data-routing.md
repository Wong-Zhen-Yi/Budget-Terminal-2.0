# Public data routing

Crypto prices use only public, unauthenticated Hyperliquid and CoinGecko endpoints. Finnhub is reserved for supported stock quotes when an encrypted key is configured. Financial Modeling Prep remains inactive.

- Crypto USD pairs (including BTC, ETH, SOL, XRP and BNB) use CoinGecko spot prices, with explicitly labelled Hyperliquid perpetual marks when the spot quote is unavailable. Additional pairs use unique symbols in the ranked CoinGecko response or an exact Hyperliquid market; unsupported pairs fail visibly. The Crypto page and shared quote API follow this policy, even with a Finnhub key saved. Price and percentage change always describe the same instrument.
- CoinGecko supplies top-30 rankings, market capitalization, spot volume and global totals. The heatmap and watchlist share one endpoint cache. A partial heatmap remains partial; unavailable quotes remain unavailable when both providers fail. Coinbase, Binance, Yahoo and Finnhub are not coin-price fallbacks.
- Hyperliquid supplies perpetual candles, marks, funding, open interest and venue volume through the shared stream and public REST fallback. Venue open interest is never treated as global market cap. Perpetual prices remain labelled separately from spot prices.
- Stock/ETF proxies such as COIN and IBIT remain securities and retain their existing stock providers. Yahoo stock volume and market cap use an independent 15-minute metadata cache.
- CoinGecko shares a five-request-per-minute application budget across Crypto and BMNR, endpoint caches, and an enforced 429 cooldown honoring Retry-After. Forced refresh cannot bypass this budget. Hyperliquid retains its shared weighted rate gate, pacing and cooldown.
- Economic uses World Bank annual US CPI inflation and IMF WEO annual US GDP growth. These are separate from monthly CPI and quarterly GDP. IMF observations after LATEST_ACTUAL_ANNUAL_DATA are excluded. The WEO SDMX structure is pinned to version 6.0.0; schema errors fail visibly.

These are conservative application budgets, not guarantees about provider quotas or regional availability. Cached source ages and failures remain visible in Settings. All implemented pages continue loading at startup; no global diagnostics banner is added.

Verification: npm run probe:crypto -- --offline, npm run probe:crypto -- --workspace-live, npm run probe:finnhub, npm run probe:public-providers (legacy public-client and macro contracts), npm run probe:economic -- --offline.
