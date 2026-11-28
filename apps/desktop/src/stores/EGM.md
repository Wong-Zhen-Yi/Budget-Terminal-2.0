# src/stores (Zustand UI state)

## Overview
Zustand stores that hold per-page UI selections, such as symbol, timeframe, and filters. Prefetch reads them, so the preloaded request matches what the page will ask for ([CLAUDE.md:Renderer data flow]).

## Interface
- Page selection stores: `stocks.ts:useStocksPage`, `charts.ts:useChartsStore`, `options.ts:useOptionsPage`, `news.ts:useNewsPageStore`, `global.ts:useGlobalPage`, `etf.ts:useEtfPage`, `forex.ts:useForexStore`, `crypto.ts:useCryptoWorkspace`, `calendar.ts:useCalendarPage`, `dictionary.ts:useDictionary`, `ipo.ts:useIpoPage`, `preMarket.ts:usePreMarketPage`, `projections.ts:useProjectionsPage`, `upDown.ts:useUpDownPage`, `tradingVolumes.ts:useTradingVolumesPage`, `valuation.ts:useValuationPage`, `scorecard.ts:useScorecard`, `defeatbeta.ts:useDefeatBetaTerminal`, `youtubePlayer.ts:useYouTubePlayer`, `fundamentals.ts:useFundamentalsStore`, `economic.ts:ECONOMIC_TABS`, `dashboard.ts:useDashboard`, `discovery.ts:useDiscoverySettings`.
- App-level stores: `navigation.ts:useNavigation`, `settingsNavigation.ts:useSettingsNavigation`, `dataHealth.ts:useDataHealth`, `obscureMode.ts:useObscureMode`, `authPrompt.ts:useAuthPrompt`, `agentDraft.ts:useAgentDraft`, `newsLite.ts:useNewsLiteReading`.
- Persistence helper: `profileStorage.ts:profileStorage`.

## Invariants
- Stores hold UI selections only. Saved records are in the main-process stores, not here ([CLAUDE.md:Main process]).
- `charts.ts:normalizeChartsState` and `fundamentals.ts:migrateFundamentalsState` normalize persisted state before use.

## Side Effects
- Writes to browser storage: `profileStorage.ts`, `charts.ts`, and `etf.ts` use `localStorage` or `sessionStorage`. `api/queryPersistence.ts` persists the query cache ([api/EGM.md](../api/EGM.md)).
- Browser storage can be empty or throw in private windows, so reads and writes are wrapped in try/catch ([AGENTS.md:Testing Guidelines]).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:charts -- --offline` (chart workspace state)
