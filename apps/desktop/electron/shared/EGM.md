# electron/shared

## Overview
Contracts, types, and pure calculations shared by the main process, the preload bridge, the renderer, and the mobile client. The folder contains no I/O and no Electron or React imports. It defines the IPC contract, the `Envelope<T>` format, and the per-domain payload types and calculations (about 114 TypeScript files).

## Interface
Contract and transport:
- `contract.ts:CHANNELS`, `contract.ts:Envelope`, `contract.ts:Freshness`, `contract.ts:EnvelopeMeta`, `contract.ts:Quote`, `contract.ts:QuotesPayload`. The `DesktopApi` interface and the `TABS` page registry are also defined here ([CLAUDE.md:Single contract, three transports]).
- `createApi.ts:createApi` - builds a `DesktopApi` from `Invoke` and `Subscribe` functions ([createApi.ts:createApi]).
- `envelope.ts:ok`, `envelope.ts:partial`, `envelope.ts:failed`, `envelope.ts:err`, `envelope.ts:describeError`.
- `navigation.ts:WORKSPACES`, `navigation.ts:FOCUS_WORKSPACE`, `navigation.ts:DEFAULT_TAB_ID`, `navigation.ts:resolveMainPage`, `navigation.ts:workspaceFor`.
- `ipcSecurity.ts:isTrustedRendererUrl`; `certificateSecurity.ts:assertDesktopCertificateSecurity`.
- `freshness.ts:FRESHNESS`, `freshness.ts:CACHE_SCHEMA_VERSION`.

Per-domain payload types and pure calculations (examples; each file exports its own request and payload types):
- Markets: `stocks.ts`, `charts.ts:normalizeSymbols`, `forex.ts:FOREX_PAIRS`, `crypto.ts:CRYPTO_TICKERS`, `heatmap.ts:HEATMAP_ETFS`, `upDown.ts:calculateUpDownRow`, `tradingVolumes.ts:TRADING_VOLUME_METRICS`, `globalMarkets.ts:calculateAllIntervals`, `marketCap.ts:marketCapTier`, `priceScreen.ts:rankPriceScreenRows`, `technicalScreen.ts:evaluateTechnicalBars`.
- Portfolio and personal finance: `portfolioMath.ts:buildPortfolioRows`, `portfolioMath.ts:buildPortfolioAllocation`, `cards.ts:reorderCardIds`, `money.ts:normalizeMoney`, `financeMath.ts:validRate`, `bonds.ts:valueFixedRateBond`, `homebuyerScenario.ts:monthlyMortgage`.
- Analytics: `analytics.ts:RiskMetrics`, `analytics.ts:stdDev`, `backtest.ts:calculateBuyHoldBacktest`, `calendar.ts:CALENDAR_TIMEZONES`, `discovery.ts:analyzeDiscovery`.
- Valuation and fundamentals: `valuation.ts:ValuationAssumptions`, `valuationPeers.ts:normalizePeerSymbols`, `fundamentalsPage.ts:FundamentalsChartModel`, `scorecard.ts:SCORECARD_METRICS`.
- Company research payloads: `amzn.ts:AmznReport`, `avgo.ts:AvgoPayload`, `googl.ts:GooglPayload`, `hims.ts:HimsRequest`, `hood.ts:HoodPayload`, `mu.ts:MuPayload`, `nvda.ts:NvdaPayload`, `sofi.ts:SofiRequest`, `vst.ts:VstPayload`, `bmnr.ts:growthPct`.
- Macro and economics: `economic.ts:ECONOMIC_SERIES`, `macro.ts:macroCompass`, `oil.ts:OIL_STOCK_SPECS`, `gold.ts:parseGoldDemandHtml`, `preMarket.ts:fgRating`, `polymarket.ts:POLYMARKET_ENDPOINTS`, `politics.ts:normalizePoliticsTradeType`.
- Agents and charts: `agents.ts:piProviderPattern`, `agentRuns.ts:AgentRun`, `agentWorkspace.ts:AGENT_HISTORY_DAYS`, `agentCharts.ts:parseAgentPie`, `agentPortfolio.ts:previewAgentPortfolio`, `browser.ts:BrowserRequest`, `chartPatterns.ts:CHART_PATTERN_CATALOG`.
- Sync and integration: `cloudSync.ts:syncDecision`, `cloudSnapshot.ts:parseCloudSnapshot`, `cloudOAuth.ts:googleSignInUrl`, `mobileAccess.ts:MOBILE_HTTP_PORT`, `mcpAccess.ts:McpPolicy`, `marketApiKeys.ts:MARKET_API_PROVIDERS`, `telegram.ts:formatTelegramText`, `notifications.ts:notificationInputSchema`.
- Settings and caching: `cachePolicy.ts:DEFAULT_CACHE_SETTINGS`, `memoryPolicy.ts:createMemoryScaleReader`, `windowSize.ts:parseSavedWindowState`, `dataRetry.ts:retryTransientData`.

Every file in the folder is listed in the directory itself; the names above are examples, not a complete inventory.

## Invariants
- No file in this folder imports `fs`, `child_process`, `net`, `http`, `https`, or `electron`, and none calls `fetch`, `writeFile`, `readFile`, or reads `process.env` ([AGENTS.md:Coding Style]).
- Shared calculations stay free of React and Electron imports ([AGENTS.md:Coding Style]).
- `cloudSnapshot.ts:MAX_CLOUD_SNAPSHOT_BYTES` caps the size of a cloud snapshot ([cloudSnapshot.ts:MAX_CLOUD_SNAPSHOT_BYTES]).
- Provider precedence and labelling follow [docs/public-data-routing.md].

## Side Effects
- None. The folder is pure types and calculations.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:charts -- --offline` for chart calculations.
