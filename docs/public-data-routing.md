# Public data routing

Only public, unauthenticated endpoints are enabled. AllTick, Finnhub and Financial Modeling Prep stay inactive, even when encrypted keys have been saved. Data services never read those keys.

- Supported crypto USD spot quotes use Coinbase and Binance. ETH and BNB prefer Binance; BTC, SOL and XRP prefer Coinbase. Binance USDT prices and rolling 24-hour changes are converted using a shared Coinbase USDT/USD rate. A conversion failure rejects that route; USDT is never assumed to equal USD.
- Venue failures, invalid data, timeouts and local budget pressure fall back to another eligible venue, then existing CoinGecko/Yahoo paths. Explicit perpetual symbols and Hyperliquid equity marks retain their existing instrument basis.
- Crypto heatmap and watchlist metadata share a single CoinGecko top-30 request. Market capitalization and global volume retain their CoinGecko attribution instead of being inferred from venue turnover.
- Economic adds World Bank annual US CPI inflation and IMF WEO annual US GDP growth. These are separate rows from monthly CPI and quarterly GDP. IMF observations after `LATEST_ACTUAL_ANNUAL_DATA` are excluded. The verified WEO SDMX structure is pinned to version 6.0.0; schema errors fail visibly instead of guessing a new structure.

Spot responses are shared for 30 seconds, macro responses for 24 hours, including concurrent callers. Forced refreshes respect these upstream caches. The four public providers have independent in-flight limits, rolling minute budgets, session daily budgets, six-second request timeouts and failure cooldowns. `Retry-After` seconds and dates are honored. Redirects and authentication parameters/headers are rejected. Errors contain provider labels, without response bodies or request URLs.

These are conservative application budgets, not guarantees about provider quotas or regional availability. Session daily budgets reset on restart. Existing stale-cache behavior remains the final fallback; stale data is never marked as a fresh venue response. Provider activity and cooldowns are visible in Settings → Diagnostics → API usage. Key-based integrations stay labelled inactive in Settings → Integrations.

Verification: `npm run probe:public-providers` (deterministic), `npm run probe:public-providers -- --live` (four public providers), `npm run probe:crypto -- --offline`, `npm run probe:economic -- --offline`.

Provider contracts: [Coinbase stats](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-stats), [Binance spot market data](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market), [World Bank Indicators](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392), [IMF SDMX](https://data.imf.org/en/Resource-Pages/IMF-API).
