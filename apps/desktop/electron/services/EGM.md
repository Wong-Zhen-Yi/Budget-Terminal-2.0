# electron/services

## Overview
The data-access and persistence layer of the main process. Each file owns one provider or data domain, such as Yahoo, Hyperliquid, FRED, SEC EDGAR, CoinGecko, Polymarket, or Anthropic. Stores hold saved records (portfolio, cards, articles, settings), and host modules manage the Agents, cloud sync, mobile access, notifications, and diagnostics. Services return `Envelope<T>` ([shared/envelope.ts]).

## Interface
Core and shared infrastructure:
- `cache.ts:TtlCache`, `cache.ts:persistentCachePath`; `cacheControl.ts:getCacheStatus`, `cacheControl.ts:configureCache`; `cacheSettings.ts:readCacheSettings`, `cacheSettings.ts:saveCacheSettings`.
- `provider.ts:yahooProvider`; `hyperliquid.ts:HyperliquidClient`, `hyperliquid.ts:hyperliquidClient`; `hyperliquidEquities.ts:HyperliquidEquities`; `hyperliquidRateGate.ts:HyperliquidRateGate`.
- `sourceHealth.ts:observeSource`, `sourceHealth.ts:captureSources`, `sourceHealth.ts:withSourceEnvelope`; `pageProgress.ts:withPageProgress`, `pageProgress.ts:readPageProgress`.
- `workerRpc.ts:createWorkerRpc`; `quantWorker.ts:discoverPairsInWorker`, `quantWorker.ts:pairDetailInWorker`, `quantWorker.ts:closeQuantWorker`.
- `urls.ts:isSafeExternalUrl`; `userAgent.ts:BROWSER_USER_AGENT`.
- `dataSession.ts:configureDataPaths`, `dataSession.ts:acquireDataSession`.

Saved-record stores:
- `portfolioStore.ts:readPortfolios`; `cardsStore.ts:readCards`, `cardsStore.ts:mutateCards`, `cardsStore.ts:exportCards`; `articlesStore.ts:readArticles`, `articlesStore.ts:mutateArticles`, `articlesStore.ts:replaceArticles`; `settingsStore.ts:settingsSchema`, `settingsStore.ts:resetSettingsCache`.
- `mcpContext.ts:mcpExecution`, `mcpContext.ts:recordRevision`, `mcpContext.ts:RecordRevisionError`.
- `savedDataEvents.ts:publishSavedDataChanged`, `savedDataEvents.ts:subscribeSavedDataChanged`.

Hosts and integrations:
- `agentsHost.ts:startAgents`, `agentsHost.ts:agentsStatus`, `agentsHost.ts:agentsCommand`; `agents.ts:AgentsService`; `piClient.ts:piArguments`; `claudeCodeProvider.ts:CLAUDE_CODE_PROVIDER`.
- `cloudSyncHost.ts:startCloudSync`, `cloudSyncHost.ts:cloudSyncStatus`, `cloudSyncHost.ts:cloudSyncCommand`; `cloudSyncEngine.ts:CloudSyncEngine`; `cloudSyncOAuth.ts:beginOAuthSignIn`; `cloudSyncData.ts:captureSavedData`.
- `mobileHost.ts:startMobileAccess`, `mobileHost.ts:configureMobileAccess`, `mobileHost.ts:mobileAccessStatus`; `mobileRoutes.ts:createMobileRoutes`; `mobileHttp.ts:createMobileHttp`.
- `notificationsHost.ts:configureDesktopNotifications`; `notifications.ts:NotificationCenter`.
- `diagnosticHost.ts:startDiagnostics`; `diagnosticLog.ts:DiagnosticLog`.
- `telegram.ts:TelegramService`; `telegramResearch.ts:telegramHistorySnapshot`.
- `browser.ts:configureBrowserWindow`, `browser.ts:publicRequest`.
- `youtubePlayer.ts:configureYouTubePlayer`.

Market-data providers (each exports a `get*` loader, often with a `*_SOURCE` constant):
- Equities and fundamentals: `amzn.ts:getAmzn`, `avgo.ts:getAvgo`, `googl.ts:getGoogl`, `hims.ts:getHims`, `hood.ts:getHood`, `mu.ts:getMu`, `nvda.ts:getNvda`, `sofi.ts:discoverSofiExhibits`, `vst.ts:getVst`, `bmnr.ts:BMNR_SOURCE`.
- Market and macro: `fred.ts:fetchSeriesCsv`, `economic.ts:clearEconomicCache`, `publicMacro.ts:publicMacro`, `riskFree.ts:fetchRiskFreeSnapshot`, `fearGreed.ts:getFearGreed`, `oil.ts:getOil`, `gold.ts:GOLD_SOURCE`.
- Crypto and prediction markets: `crypto.ts:fetchTopTiles`, `coingecko.ts:coinGeckoClient`, `cryptoCharts.ts:cryptoCharts`, `cryptoQuotes.ts:fetchCoinGeckoQuotes`, `bitcoin.ts:getBitcoin`, `eth.ts:getEth`, `polymarket.ts:getPolymarket`.
- Filings and news: `secEdgar.ts:fetchSecFilingSnapshot`, `secEdgar.ts:fetchSecCompanyBundle`, `finnhubQuotes.ts:finnhubQuotes`, `youtube.ts:YOUTUBE_SOURCE`, `ipo.ts:clearIpoCache`, `politics.ts:fetchPoliticsLivePage`.
- Pages and screens: `forex.ts:getForexQuotes`, `fx.ts:getFxRate`, `heatmap.ts:fetchHeatmap`, `upDown.ts:getUpDown`, `sp500.ts:loadSp500History`, `sp500Constituents.ts:loadConstituents`, `marketCap` lives in `yahoo/marketCap.ts`.

Subdirectories: [./yahoo/EGM.md](./yahoo/EGM.md), [./news/EGM.md](./news/EGM.md), [./etf/EGM.md](./etf/EGM.md), [./defeatbeta/EGM.md](./defeatbeta/EGM.md).

## Invariants
- Partial failures degrade one panel. Services return envelopes through the helpers in [shared/envelope.ts] ([CLAUDE.md:Single contract, three transports]).
- Stores are JSON files that use `meta.revision` for compare-and-swap ([CLAUDE.md:Main process], [mcpContext.ts:recordRevision]).
- Public-address policy: article and thumbnail fetches enforce public addresses only ([CLAUDE.md:Security model], [news/EGM.md](./news/EGM.md)).
- Persistence probes must point `APPDATA` and `LOCALAPPDATA` at temporary directories ([AGENTS.md:Testing Guidelines]).

## Side Effects
- Outbound HTTP to provider endpoints (39 files call `fetch(`, including `yahoo/quotes.ts`, `hyperliquidEquities.ts`, `fred.ts`, `secEdgar.ts`, `polymarket.ts`, `anthropic.ts`, `coingecko.ts`, `calendar.ts`).
- Disk writes under the app data directory: stores, cache, cloud sync data, backups, and diagnostics (35 files use `writeFile`, `appendFile`, or `mkdir`, including `cardsStore.ts`, `articlesStore.ts`, `portfolioStore.ts`, `settingsStore.ts`, `automaticBackup.ts`, `diagnosticLog.ts`, and `marketApiKeys.ts`).
- OS credential storage through Electron `safeStorage` (`cloudSyncHost.ts`, `agentsHost.ts`, `marketApiKeysHost.ts`).
- Reads `app.getPath` for locations (`mobileHost.ts`, `notificationsHost.ts`, `browser.ts`, `agentsHost.ts`, `marketApiKeysHost.ts`, `windowState.ts`).
- Sends IPC events to renderer windows (`diagnosticHost.ts`, `articlePdf.ts`, `youtubePlayer.ts`, `browser.ts`, `mobileWindow.ts`, `rendererCacheShutdown.ts`).
- Starts the mobile HTTP and Tailscale access paths and the Telegram bot.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:stocks -- AAPL` (live) or the matching offline probe.
- Run: `npm run probe:maintenance -- --ui` after a build ([CLAUDE.md:Tests (probes)]).
