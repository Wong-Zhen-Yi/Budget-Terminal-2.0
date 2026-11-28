# electron/services/news

## Overview
News ingestion for the articles, news, and ticker pages. It reads RSS feeds, TickerTick, and Yahoo news. It extracts article text and thumbnails. Public-network checks protect every outbound article fetch.

## Interface
- `index.ts:NEWS_SOURCE`, `index.ts:PORTFOLIO_SECTION`, `index.ts:MARKET_SECTION`.
- `feeds.ts:getOtherNews`, `feeds.ts:loadFeed`.
- `tickers.ts:getTickerNews`, `tickers.ts:getNews`, `tickers.ts:TICKER_NEWS_SOURCE`.
- `tickerTick.ts:TickerTickRateGate`, `tickerTick.ts:TICKERTICK_SOURCE`, `tickerTick.ts:TICKERTICK_MARKET_FEED`.
- `rss.ts:parseRssItems`, `rss.ts:cleanText`, `rss.ts:decodeEntities`.
- `preview.ts:getNewsPreview`; `extract.ts:extractReadableText`; `images.ts:getNewsThumbnail`.
- `publicNetwork.ts:isPublicAddress`, `publicNetwork.ts:publicNewsUrl`, `publicNetwork.ts:createPublicLookup`.
- `http.ts:httpGet`.

## Invariants
- Article and thumbnail fetches enforce public addresses only ([CLAUDE.md:Security model], [publicNetwork.ts:isPublicAddress]).
- TickerTick requests go through `TickerTickRateGate` ([tickerTick.ts:TickerTickRateGate]).

## Side Effects
- Outbound HTTP to RSS feeds, TickerTick, and article hosts ([feeds.ts:loadFeed], [http.ts:httpGet]).
- Fetches and caches thumbnails and preview text ([images.ts:getNewsThumbnail], [preview.ts:getNewsPreview]).

## Verification
- Run: `npm run typecheck`
