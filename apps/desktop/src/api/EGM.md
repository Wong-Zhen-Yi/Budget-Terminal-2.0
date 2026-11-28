# src/api (query layer)

## Overview
TanStack Query hooks over `window.api`. Each `*Queries.ts` file wraps one domain. `client.ts` holds `api` and `queryKeys`. `prefetch.ts` and `startupScheduler.ts` run the startup warm-up for every page. The query cache is persisted, so saved content renders at launch ([CLAUDE.md:Renderer data flow]).

## Interface
- `client.ts:api`, `client.ts:queryKeys`.
- Startup and readiness: `prefetch.ts:buildTasks`, `prefetch.ts:useWarmPages`, `prefetch.ts:subscribeStartupRequestInputs`; `startupScheduler.ts:createStartupScheduler`; `startupHealth.ts:recordStartupSnapshot`, `startupHealth.ts:startupRefreshDelay`; `warmQueue.ts:warmStartupQuery`, `warmQueue.ts:assertStartupReady`.
- Persistence and memory: `queryPersistence.ts:configureRendererCache`, `queryPersistence.ts:RENDERER_CACHE_BUSTER`; `queryMemory.ts:readQueryMemoryStats`, `queryMemory.ts:pinStartupQuery`.
- Live data: `equityStream.ts:useEquityMarketStream`, `equityStream.ts:applyEquityMarketUpdate`; `liveStatus.ts:subscribeLiveStatus`; `liveIndicators.ts:liveIndicators`.
- Portfolio, cards, and finance: `queries.ts:usePortfolio`, `queries.ts:useQuotes`; `portfolioQueries.ts:useReturns`, `portfolioQueries.ts:useMomentum`; `cardsQueries.ts:useCards`; `financeQueries.ts:usePersonalFinance`, `financeQueries.ts:useFinanceMutation`; `articlesQueries.ts:useArticles`; `notificationsQueries.ts:useNotifications`.
- Market pages: `stocksQueries.ts:useStocks`, `chartsQueries.ts:useChartsHistory`, `chartsQueries.ts:useChartsCompare`, `newsQueries.ts:useNewsPage`, `cryptoQueries.ts:useCrypto`, `forexQueries.ts:useForex`, `optionsQueries.ts:useOptionsChain`, `heatmapQueries.ts:useHeatmap`, `etfQueries.ts:useEtfHoldings`, `ipoQueries.ts:useUpcomingIpos`, `economicQueries.ts:useEconomic`, `globalQueries.ts:useGlobalMarkets`.
- Company and research pages: `amznQueries.ts:useAmzn`, `avgoQueries.ts:useAvgo`, `googlQueries.ts:useGoogl`, `nvdaQueries.ts:useNvda`, `valuationQueries.ts:useValuation`, `fundamentalsPageQueries.ts:useFundamentalsPage`, `scorecardQueries.ts:useScorecardCompanies`, `semiconductorsQueries.ts:useSemiconductors`.
- Agents and MCP: `agentComposer.ts:useAgentComposer`, `agentsQueries.ts:useAgents`, `mcpChanges.ts:refreshSavedData`, `mcpScreenshot.ts:useMcpScreenshot`.
- Settings: `settingsQueries.ts:useSettings`, `settingsQueries.ts:useSettingsMutation`, `settingsQueries.ts:useMaintenance`, `cloudSyncQueries.ts:cloudSyncPollInterval`.
- Other domains: `dashboardQueries.ts:useMacroCharts`, `defeatbetaQueries.ts:useDefeatBetaSections`, `signalsQueries.ts:useSignalsLatest`, `quantQueries.ts:useQuantScan`, `polymarketQueries.ts:polyKey`, `politicsQueries.ts:usePoliticsPage`, `youtubeQueries.ts:useYouTube`.

## Invariants
- Renderer data access goes through `window.api` ([AGENTS.md:Coding Style]).
- Each page must have a warm task in `prefetch.ts:buildTasks`, and each page's query hooks must be registered. Both are needed for startup readiness ([CLAUDE.md:Renderer data flow]).
- The Page Loading Status banner is not rendered from this layer ([AGENTS.md:No Global Diagnostics Banners]).

## Side Effects
- Calls `window.api` and receives IPC subscription events (about 67 files reference `window.api` or `api.`).
- Persists the query cache to browser storage through `queryPersistence.ts` ([stores/EGM.md](../stores/EGM.md) covers the other browser-storage users).
- Startup warm-up requests run on launch for every implemented page ([startupScheduler.ts:createStartupScheduler]).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:readiness-ui` (after `npm run build`)
