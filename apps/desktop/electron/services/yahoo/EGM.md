# electron/services/yahoo

## Overview
All Yahoo Finance access. Every request goes through the shared rate gate. Some work runs in a worker thread. Each file serves one page or data domain, such as quotes, charts, options, fundamentals, screeners, or news.

## Interface
- `client.ts:yahoo`, `client.ts:closeYahooWorker`, `client.ts:requestPriority`.
- `rateGate.ts:RateGate`, `rateGate.ts:DEFAULT_RATE_GATE_OPTIONS`, `rateGate.ts:isRateLimitError`.
- `workerClient.ts:createYahooWorkerClient`.
- `quotes.ts:quoteFromChart`, `quotes.ts:QUOTE_BATCH_SIZE`; `bulkQuotes.ts:createBulkQuoteLoader`; `spark.ts:fetchSparkCloses`.
- `series.ts:getYahooSeries`, `history.ts:getDailyBarsBatch`, `history.ts:adjustedDailyBars`, `chart.ts:getChart`.
- `chartsPage.ts:getChartsHistory`, `chartsPage.ts:getChartsCompare`, `chartsPage.ts:getChartsRelationship`.
- `options.ts:getOptions`, `optionsPage.ts:getOptionsChain`, `optionsPage.ts:getOptionsExpirations`, `optionQuotes.ts:getOptionQuotes`.
- `fundamentals.ts:getFundamentals`, `fundamentalsPage.ts:getFundamentalsPage`, `marketCap.ts:getMarketCap`, `marketCapSales.ts:getMarketCapSales`.
- `screener.ts:SCREEN_PAGE_SIZE`, `priceScreen.ts:getPriceScreen`, `technicalScreen.ts:runTechnicalScan`, `discovery.ts:getDiscoverySnapshot`.
- `news.ts:getNews`, `newsPage.ts:searchNews`, `newsPage.ts:fetchPortfolioNews`, `newsPage.ts:fetchHeadlineFeed`.
- `preMarket.ts:getPreMarket`, `globalMarkets.ts:getGlobalMarkets`, `tradingVolumes.ts:getTradingVolumes`, `targets.ts:getTargets`, `valuation.ts:getValuation`, `projections.ts:getProjections`.
- `signals.ts:getLatestSignals`, `quant.ts:getLatestQuant`, `backtest.ts:getBacktest`, `cards.ts:getCardsPerformance`, `stocks.ts:STOCKS_SOURCE`.
- `ipoCalendar.ts:fetchYahooUpcomingIpos`, `ipoCalendar.ts:fetchYahooCompletedIpos`.

## Invariants
- All requests go through `rateGate.ts:RateGate`. A direct call to Yahoo outside the gate violates [CLAUDE.md:Main process].
- Requests are prioritized through `client.ts:requestPriority`.

## Side Effects
- Outbound HTTP to Yahoo endpoints through the gate (`quotes.ts`, `spark.ts`, `news.ts`, `newsPage.ts`, `screener.ts`, `options.ts`, and others).
- Starts and closes a Yahoo worker thread (`client.ts:closeYahooWorker`, `workerClient.ts:createYahooWorkerClient`).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:stocks -- AAPL` (live)
