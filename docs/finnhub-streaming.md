# Finnhub live stock quotes

When a Finnhub key is saved in Settings, the Electron main process opens one
authenticated trade WebSocket for stock symbols requested by the app. Startup
loading still runs for every implemented page. Received trades update the existing
quote cache and renderer subscription, including portfolio prices, company pages,
screen marks and chart price statistics. Historical candles are unchanged.

The REST quote supplies an initial price and the previous-close reference. Before
the next session opens, its current price is the last session's close; this is the
reference for pre-market changes, rather than the older `pc` field. New York dates
handle daylight saving time and gaps between sessions. Periodic REST refreshes
update the reference but cannot overwrite a newer trade with an older close.

Saved stock tickers across every portfolio are loaded before scheduling startup
quotes. Portfolio edits, imports, cloud restores and external store changes refresh
these priorities automatically. Ticker aliases share one priority and subscription;
crypto and unsupported symbols keep their existing providers.

Subscriptions are capped at 50 unique upstream symbols on one socket. Portfolio
symbols stay subscribed continuously when they fit; spare slots rotate through
other requested stocks every 30 seconds. Portfolios larger than 50 unique supported
stocks rotate among themselves before background symbols receive any slots.
Symbols outside the current batch retain their last known stock quote.

Portfolio REST requests jump ahead of queued background requests, and automatic
polling checks due portfolio references first. Two requests per portfolio symbol
per minute are reserved from the shared 60-request budget, up to the full budget;
other pages and MCP reads use the remaining capacity. The overall budget and
provider cooldowns still apply. Cached reads do not postpone reference refreshes.
Other implemented pages continue startup loading through existing fallback sources.
Renderer notifications are coalesced per symbol over 250 milliseconds. Malformed,
future, unsolicited and out-of-order trades are ignored. Reconnects use bounded
backoff and restore subscriptions. Removing or replacing the key closes the old
connection and discards queued updates. Shutdown closes the connection.

Credentials remain in the OS-encrypted store and Electron main process. Finnhub
requires a token in the WebSocket connection URL; that URL, raw errors, and
provider payloads must never be logged or sent to the renderer.

The free key was observed delivering pre-market trades while REST returned the
prior regular-session close. The same ingestion path accepts other session trades
when provided, but live post-market coverage has not been verified. This feature
does not add historical extended-hours access or reconstruct missing candles.
The Pre-Market page's futures and macro panels retain their existing data sources.

Verification:

```sh
npm run typecheck
npm run probe:finnhub
npm run probe:finnhub -- --live --stream
npm run probe:launcher
npm run build
```

The live stream probe uses the saved encrypted key read-only, an isolated temporary
Electron profile, and a 45-second observation window. Run it while trades are
occurring; a quiet session can fail the live observation without implying a lack
of entitlement. It prints symbol names and trade timestamps, never credentials.
