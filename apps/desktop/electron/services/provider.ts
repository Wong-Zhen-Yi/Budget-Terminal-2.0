import { RecordRevisionError } from './mcpContext.js'
import { getMoney, clearMoneyCache } from './money.js'
import { withSourceEnvelope } from './sourceHealth.js'
import { getHims } from './hims.js'
import { replaceArticles } from './articlesStore.js'
import type { HimsPayload, HimsRequest } from '../shared/hims.js'
import { getHood } from './hood.js'
import { getSofi } from './sofi.js'
import type { SofiPayload, SofiRequest } from '../shared/sofi.js'
import { getAmzn } from './amzn.js'
import type { AmznPayload, AmznRequest } from '../shared/amzn.js'
import { getMu } from './mu.js'
import { getVst } from './vst.js'
import type { VstPayload, VstRequest } from '../shared/vst.js'
import { getAvgo } from './avgo.js'
import { getSemiconductors } from './semiconductors.js'
import type { SemiconductorsPayload, SemiconductorsRequest } from '../shared/semiconductors.js'
import type { AvgoPayload, AvgoRequest } from '../shared/avgo.js'
import type { MuPayload, MuRequest } from '../shared/mu.js'
import type { HoodPayload, HoodRequest } from '../shared/hood.js'
import type { MoneyPayload, MoneyRequest } from '../shared/money.js'
import type { Sp500Request, Sp500Data, Sp500BreadthRequest, Sp500Breadth } from '../shared/sp500.js'
import { getSp500, getSp500Breadth } from './sp500.js'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { automaticBackupStatus, withAutomaticBackup, writeUserDataBackup } from './automaticBackup.js'

import type {
  BacktestPayload,
  BacktestRequest,
  AnalyticsPayload,
  AnalyticsRequest,
  AppSettings,
  AppSettingsMutation,
  CardsMutation,
  CardsPayload,
  CardsPerformancePayload,
  CardsPerformanceRequest,
  ChartPayload,
  ChartRequest,
  ChartsComparePayload,
  ChartsCompareRequest,
  ChartsHistoryPayload,
  ChartsHistoryRequest,
  ChartsRelationshipPayload,
  ChartsRelationshipRequest,
  CalendarMonthPayload,
  CalendarMonthRequest,
  CryptoPayload,
  BmnrPayload,
  BmnrRequest,
  CryptoRequest,
  GoldPayload,
  GoldRequest,
  OilPayload,
  OilRequest,
  HeatmapPayload,
  HeatmapRequest,
  EtfArbitragePayload,
  EtfArbitrageRequest,
  EtfAumPayload,
  EtfAumRequest,
  EtfHoldingsPayload,
  EtfHoldingsRequest,
  EarningsCalendarPayload,
  EarningsCalendarRequest,
  Envelope,
  MaintenanceAction,
  MaintenanceResult,
  FxPayload,
  FxRequest,
  GlobalMarketsPayload,
  GlobalMarketsRequest,
  PreMarketPayload,
  PreMarketRequest,
  MarketCapPayload,
  MarketCapRequest,
  PriceScreenPayload,
  PriceScreenRequest,
  QuantPairDetail,
  QuantPairRequest,
  QuantScanPayload,
  QuantScanRequest,
  TechnicalScanPayload,
  SignalsPayload,
  SignalsRequest,
  TradingVolumesPayload,
  TradingVolumesRequest,
  StocksPayload,
  StocksRequest,
  DiscoveryRequest,
  DiscoverySnapshot,
  DiscoveryUniverse,
  MomentumPayload,
  MomentumRequest,
  OptionQuotesPayload,
  OptionQuotesRequest,
  OptionsChainPayload,
  OptionsChainRequest,
  OptionsExpirationsPayload,
  OptionsExpirationsRequest,
  ProjectionsPayload,
  ProjectionsRequest,
  ReturnsPayload,
  ReturnsRequest,
  FundamentalsPayload,
  FundamentalsRequest,
  FundamentalsPagePayload,
  FundamentalsPageRequest,
  NewsPayload,
  NewsRequest,
  NewsPageRequest,
  NewsPagePayload,
  NewsTickerSearchRequest,
  NewsTickerSearchPayload,
  NewsPreviewRequest,
  NewsPreviewPayload,
  NewsThumbnailRequest,
  NewsThumbnailPayload,
  OptionsPayload,
  OptionsRequest,
  PersonalFinanceMutation,
  PersonalFinancePayload,
  PortfolioMutation,
  PortfolioPayload,
  QuotesPayload,
  QuotesRequest,
  TargetsPayload,
  TargetsRequest,
  UpDownPayload,
  UpDownRequest,
  UpDownTargetsPayload,
  UpDownTargetsRequest,
  ValuationPayload,
  ValuationRequest,
  EconomicPayload,
  EconomicRequest,
  InstitutionActivityPayload,
  InstitutionActivityRequest,
  InstitutionTickerActivityPayload,
  InstitutionTickerActivityRequest,
  IpoCompletedPayload,
  IpoCompletedRequest,
  IpoUpcomingPayload,
  IpoUpcomingRequest,
  PoliticsExportPayload,
  PoliticsExportRequest,
  PoliticsPagePayload,
  PoliticsPageRequest,
  YouTubePayload,
  YouTubeRequest,
  YouTubeThumbnailPayload,
  YouTubeThumbnailRequest,
} from '../shared/contract.js'
import { DEFAULT_CLOCK_COUNTRY, DEFAULT_OBSCURED_TABS, MACRO_SYMBOLS, TABS } from '../shared/contract.js'
import {
  buildPortfolioSeries,
  computeExposure,
  computeRiskMetrics,
  ema,
  emptyRiskMetrics,
  toReturnSeries,
} from '../shared/analytics.js'
import { BMNR_BLOCKS } from '../shared/contract.js'
import { emptyBmnrPayload } from '../shared/bmnr.js'
import { GOLD_BLOCKS } from '../shared/contract.js'
import { emptyGoldPayload } from '../shared/gold.js'
import { OIL_BLOCKS } from '../shared/contract.js'
import { emptyOilPayload } from '../shared/oil.js'
import { CRYPTO_HEATMAP_LIMIT, CRYPTO_STAGES, localIsoSeconds } from '../shared/crypto.js'
import { normalizeEtfKey } from '../shared/heatmap.js'
import { DEFAULT_RISK_FREE_RATE } from '../shared/optionsPage.js'
import { describeError, err, failed, meta, ok, partial } from '../shared/envelope.js'
import { DEFAULT_BACKTEST_PAGE_SETTINGS, emptyBacktestPayload } from '../shared/backtest.js'
import { DEFAULT_QUANT_PAGE_SETTINGS } from '../shared/quant.js'
import { DEFAULT_YOUTUBE_PAGE_SETTINGS } from '../shared/youtube.js'
import { cache } from './cache.js'
import {
  cardsPath,
  clearCards,
  mutateCards,
  readCards,
  replaceCards,
} from './cardsStore.js'
import { BMNR_SOURCE, getBmnr } from './bmnr.js'
import { GOLD_SOURCE, getGold } from './gold.js'
import { OIL_SOURCE, getOil } from './oil.js'
import { CRYPTO_SOURCE, getCrypto } from './crypto.js'
import {
  clearIpoCache,
  emptyCompletedIpoPayload,
  emptyUpcomingIpoPayload,
  getCompletedIpos,
  getUpcomingIpos,
  IPO_COMPLETED_SOURCE,
  IPO_UPCOMING_SOURCE,
} from './ipo.js'
import {
  clearPoliticsCache,
  emptyPoliticsPage,
  getPoliticsExport,
  getPoliticsPage,
  POLITICS_SOURCE,
} from './politics.js'
import { HEATMAP_SOURCE, emptyHeatmapPayload, getHeatmap } from './heatmap.js'
import {
  ETF_ARBITRAGE_SOURCE,
  ETF_AUM_SOURCE,
  ETF_HOLDINGS_SOURCE,
  getEtfArbitrage,
  getEtfAum,
  getEtfHoldingsPage,
  emptyEtfArbitragePayload,
  emptyEtfHoldingsPayload,
} from './etfPage.js'
import {
  UP_DOWN_SOURCE,
  clearUpDownCaches,
  getUpDown,
  getUpDownTargets,
  type UpDownFetchResult,
} from './upDown.js'
import { clearSecCaches } from './secEdgar.js'
import {
  CALENDAR_SOURCE,
  EARNINGS_SOURCE,
  clearCalendarCaches,
  getCalendarMonth,
  getEarningsCalendar,
  type CalendarFetchResult,
} from './calendar.js'
import { FX_SOURCE, getFxRate } from './fx.js'
import {
  clearUserData,
  importUserData,
  mutatePersonalFinance,
  mutatePortfolios,
  readPersonalFinance,
  readPortfolios,
} from './portfolioStore.js'
import {
  recordBackupExport,
  mutateSettings,
  readSettings,
  replaceSettings,
  settingsPath,
} from './settingsStore.js'
import { getChart } from './yahoo/chart.js'
import { CARDS_SOURCE, getCardsPerformance } from './yahoo/cards.js'
import {
  getChartsCompare,
  getChartsHistory,
  getChartsRelationship,
} from './yahoo/chartsPage.js'
import { getFundamentals } from './yahoo/fundamentals.js'
import {
  emptyFundamentalsPagePayload,
  FUNDAMENTALS_PAGE_SOURCE,
  getFundamentalsPage,
} from './yahoo/fundamentalsPage.js'
import { getGlobalMarkets } from './yahoo/globalMarkets.js'
import { getPreMarket, PRE_MARKET_SOURCE } from './yahoo/preMarket.js'
import { getMarketCapSales } from './yahoo/marketCapSales.js'
import { marketCapEnvelope } from './yahoo/marketCap.js'
import { getPriceScreen, PRICE_SCREEN_SOURCE } from './yahoo/priceScreen.js'
import {
  clearLatestSignals,
  getLatestSignals,
  getSignals,
  SIGNALS_SOURCE,
} from './yahoo/signals.js'
import { getTradingVolumes, TRADING_VOLUMES_SOURCE } from './yahoo/tradingVolumes.js'
import { getStocks, STOCKS_SOURCE } from './yahoo/stocks.js'
import { getDiscoverySnapshot, getDiscoveryUniverse } from './yahoo/discovery.js'
import { getCloses, getClosesBatch, periodReturn } from './yahoo/history.js'
import { getOptionQuotes } from './yahoo/optionQuotes.js'
import { getNews } from './yahoo/news.js'
import {
  NEWS_SOURCE,
  getNewsPage,
  getNewsTickerSearch,
} from './news/index.js'
import { getNewsPreview } from './news/preview.js'
import { getNewsThumbnail } from './news/images.js'
import { getOptions } from './yahoo/options.js'
import {
  getOptionsChain,
  getOptionsExpirations,
  OPTIONS_PAGE_SOURCE,
} from './yahoo/optionsPage.js'
import {
  emptyProjections,
  getProjections,
  PROJECTIONS_SOURCE,
} from './yahoo/projections.js'
import {
  clearEconomicCache,
  ECONOMIC_SOURCE,
  economicErrors,
  getEconomic,
  type EconomicFetchResult,
} from './economic.js'
import {
  clearInstitutionCaches,
  getInstitutionActivity,
  getInstitutionTickerActivity,
  INSTITUTIONS_SOURCE,
  type InstitutionFetchResult,
} from './institutions.js'
import { clearRiskFreeCache } from './riskFree.js'
import {
  emptyValuation,
  getValuation,
  VALUATION_SOURCE,
  type ValuationFetchResult,
} from './yahoo/valuation.js'
import { getQuotes } from './yahoo/quotes.js'
import { getHoldingSectors } from './sectors.js'
import { getTargets } from './yahoo/targets.js'
import { BACKTEST_SOURCE, getBacktest } from './yahoo/backtest.js'
import {
  analyzeQuantPair,
  clearLatestQuant,
  getLatestQuant,
  QUANT_SOURCE,
  runQuantScan,
} from './yahoo/quant.js'
import { runTechnicalScan, TECHNICAL_SOURCE } from './yahoo/technicalScreen.js'
import { clearYouTubeCache, getYouTube, YOUTUBE_SOURCE } from './youtube.js'
import { getYouTubeThumbnail } from './youtubeImages.js'

/**
 * The seam the renderer talks to.
 *
 * Everything below is Yahoo-over-Node today. When the Python-heavy pages arrive, a
 * second implementation backed by a FastAPI sidecar can satisfy this same interface
 * and the renderer will not notice.
 */
export interface MarketDataProvider {
  backtest(request: BacktestRequest): Promise<Envelope<BacktestPayload>>
  quantScan(request: QuantScanRequest): Promise<Envelope<QuantScanPayload | null>>
  technicalScan(): Promise<Envelope<TechnicalScanPayload | null>>
  quantPair(request: QuantPairRequest): Promise<Envelope<QuantPairDetail | null>>
  youtube(request: YouTubeRequest): Promise<Envelope<YouTubePayload>>
  youtubeThumbnail(
    request: YouTubeThumbnailRequest,
  ): Promise<Envelope<YouTubeThumbnailPayload>>
  quotes(request: QuotesRequest): Promise<Envelope<QuotesPayload>>
  chart(request: ChartRequest): Promise<Envelope<ChartPayload>>
  chartsHistory(request: ChartsHistoryRequest): Promise<Envelope<ChartsHistoryPayload>>
  chartsCompare(request: ChartsCompareRequest): Promise<Envelope<ChartsComparePayload>>
  chartsRelationship(request: ChartsRelationshipRequest): Promise<Envelope<ChartsRelationshipPayload>>
  options(request: OptionsRequest): Promise<Envelope<OptionsPayload>>
  targets(request: TargetsRequest): Promise<Envelope<TargetsPayload>>
  news(request: NewsRequest): Promise<Envelope<NewsPayload>>
  newsPage(request: NewsPageRequest): Promise<Envelope<NewsPagePayload>>
  newsTickerSearch(request: NewsTickerSearchRequest): Promise<Envelope<NewsTickerSearchPayload>>
  newsArticle(request: NewsPreviewRequest): Promise<Envelope<NewsPreviewPayload>>
  newsThumbnail(request: NewsThumbnailRequest): Promise<Envelope<NewsThumbnailPayload>>
  fundamentals(request: FundamentalsRequest): Promise<Envelope<FundamentalsPayload>>
  fundamentalsPage(request: FundamentalsPageRequest): Promise<Envelope<FundamentalsPagePayload>>
  returns(request: ReturnsRequest): Promise<Envelope<ReturnsPayload>>
  momentum(request: MomentumRequest): Promise<Envelope<MomentumPayload>>
  analytics(request: AnalyticsRequest): Promise<Envelope<AnalyticsPayload>>
  optionQuotes(request: OptionQuotesRequest): Promise<Envelope<OptionQuotesPayload>>
  portfolio(): Promise<Envelope<PortfolioPayload>>
  mutatePortfolio(mutation: PortfolioMutation): Promise<Envelope<PortfolioPayload>>
  cards(): Promise<Envelope<CardsPayload>>
  mutateCards(mutation: CardsMutation): Promise<Envelope<CardsPayload>>
  cardsPerformance(request: CardsPerformanceRequest): Promise<Envelope<CardsPerformancePayload>>
  personalFinance(): Promise<Envelope<PersonalFinancePayload>>
  mutatePersonalFinance(
    mutation: PersonalFinanceMutation,
  ): Promise<Envelope<PersonalFinancePayload>>
  fx(request: FxRequest): Promise<Envelope<FxPayload>>
  globalMarkets(request: GlobalMarketsRequest): Promise<Envelope<GlobalMarketsPayload>>
  preMarket(request: PreMarketRequest): Promise<Envelope<PreMarketPayload>>
  tradingVolumes(request: TradingVolumesRequest): Promise<Envelope<TradingVolumesPayload>>
  marketCapSales(request: { symbols: string[]; force?: boolean }): Promise<Envelope<Record<string, number | null>>>
  marketCap(request: MarketCapRequest): Promise<Envelope<MarketCapPayload>>
  priceScreen(request: PriceScreenRequest): Promise<Envelope<PriceScreenPayload>>
  signals(request: SignalsRequest): Promise<Envelope<SignalsPayload | null>>
  calendarMonth(request: CalendarMonthRequest): Promise<Envelope<CalendarMonthPayload>>
  earningsCalendar(request: EarningsCalendarRequest): Promise<Envelope<EarningsCalendarPayload>>
  crypto(request: CryptoRequest): Promise<Envelope<CryptoPayload>>
  bmnr(request: BmnrRequest): Promise<Envelope<BmnrPayload>>
  hood(request: HoodRequest): Promise<Envelope<HoodPayload>>
  hims(request: HimsRequest): Promise<Envelope<HimsPayload>>
  sofi(request: SofiRequest): Promise<Envelope<SofiPayload>>
  mu(request: MuRequest): Promise<Envelope<MuPayload>>
  amzn(request: AmznRequest): Promise<Envelope<AmznPayload>>
  avgo(request: AvgoRequest): Promise<Envelope<AvgoPayload>>
  semiconductors(request: SemiconductorsRequest): Promise<Envelope<SemiconductorsPayload>>
  vst(request: VstRequest): Promise<Envelope<VstPayload>>
  sp500(request: Sp500Request): Promise<Envelope<Sp500Data>>
  sp500Breadth(request: Sp500BreadthRequest): Promise<Envelope<Sp500Breadth>>
  gold(request: GoldRequest): Promise<Envelope<GoldPayload>>
  oil(request: OilRequest): Promise<Envelope<OilPayload>>
  heatmap(request: HeatmapRequest): Promise<Envelope<HeatmapPayload>>
  etfHoldings(request: EtfHoldingsRequest): Promise<Envelope<EtfHoldingsPayload>>
  etfArbitrage(request: EtfArbitrageRequest): Promise<Envelope<EtfArbitragePayload>>
  etfAum(request: EtfAumRequest): Promise<Envelope<EtfAumPayload>>
  upDown(request: UpDownRequest): Promise<Envelope<UpDownPayload>>
  upDownTargets(request: UpDownTargetsRequest): Promise<Envelope<UpDownTargetsPayload>>
  valuation(request: ValuationRequest): Promise<Envelope<ValuationPayload>>
  money(request: MoneyRequest): Promise<Envelope<MoneyPayload>>
  economic(request: EconomicRequest): Promise<Envelope<EconomicPayload>>
  institutionActivity(
    request: InstitutionActivityRequest,
  ): Promise<Envelope<InstitutionActivityPayload>>
  institutionTickerActivity(
    request: InstitutionTickerActivityRequest,
  ): Promise<Envelope<InstitutionTickerActivityPayload>>
  ipoUpcoming(request: IpoUpcomingRequest): Promise<Envelope<IpoUpcomingPayload>>
  ipoCompleted(request: IpoCompletedRequest): Promise<Envelope<IpoCompletedPayload>>
  politicsPage(request: PoliticsPageRequest): Promise<Envelope<PoliticsPagePayload>>
  politicsExport(request: PoliticsExportRequest): Promise<Envelope<PoliticsExportPayload>>
  stocks(request: StocksRequest): Promise<Envelope<StocksPayload>>
  discoveryUniverse(): Promise<Envelope<DiscoveryUniverse>>
  discovery(request: DiscoveryRequest): Promise<Envelope<DiscoverySnapshot | null>>
  optionsChain(request: OptionsChainRequest): Promise<Envelope<OptionsChainPayload>>
  optionsExpirations(
    request: OptionsExpirationsRequest,
  ): Promise<Envelope<OptionsExpirationsPayload>>
  projections(request: ProjectionsRequest): Promise<Envelope<ProjectionsPayload>>
  settings(): Promise<Envelope<AppSettings>>
  mutateSettings(mutation: AppSettingsMutation): Promise<Envelope<AppSettings>>
  /**
   * The Settings page's User Data buttons. The file dialogs stay in the IPC layer, so
   * these take a resolved path and a sidecar implementation can satisfy them too.
   */
  exportUserData(targetPath: string): Promise<Envelope<MaintenanceResult>>
  importUserData(sourcePath: string): Promise<Envelope<MaintenanceResult>>
  clearUserData(): Promise<Envelope<MaintenanceResult>>
  resetCache(): Promise<Envelope<MaintenanceResult>>
}

/** The all-empty page the Crypto handler falls back to when every stage is unreachable. */
function emptyCryptoPayload(): CryptoPayload {
  const fetchedAt = localIsoSeconds()
  return {
    fetchedAt,
    heatmap: { tiles: [], coverage: { loaded: 0, total: CRYPTO_HEATMAP_LIMIT }, updatedAt: fetchedAt },
    quotes: {},
    global: null,
    fearGreed: null,
    news: [],
    progress: Object.fromEntries(
      CRYPTO_STAGES.map((stage) => [stage, 'unavailable' as const]),
    ) as CryptoPayload['progress'],
  }
}

/** The Options page's Chain tab with nothing loaded, still carrying its Greek defaults. */
function emptyOptionsChain(symbol: string): OptionsChainPayload {
  return {
    symbol,
    expiries: [],
    expiry: '',
    spotPrice: 0,
    riskFreeRate: DEFAULT_RISK_FREE_RATE,
    rateSource: 'config',
    dividendYield: 0,
    dividendSource: 'default',
    rows: [],
    generatedAt: 0,
  }
}

const SETTINGS_SOURCE = 'settings store'

/**
 * The backup envelope written by Export and demanded by Import.
 *
 * The reference splits its backup across three files. This app wraps its portfolio,
 * Cards and settings stores in one portable document instead. `app` is checked on the
 * way back in so an unrelated JSON file is refused with a sentence rather than
 * half-applied.
 */
const BACKUP_APP_ID = 'budget-terminal-electron'

const backupSchema = z.object({
  app: z.string().catch(''),
  version: z.number().catch(0),
  exportedAt: z.string().catch(''),
  userData: z.unknown(),
  settings: z.unknown().optional(),
  cards: z.unknown().optional(),
  articles: z.unknown().optional(),
})

const emptySettings: AppSettings = {
  clockCountry: DEFAULT_CLOCK_COUNTRY,
  time12h: true,
  tabOrder: TABS.map((tab) => tab.id),
  hiddenTabs: [],
  favoriteTabs: ['dashboard', 'portfolio', 'charts'],
  sidebarCollapsed: false,
  obscuredTabs: [...DEFAULT_OBSCURED_TABS],
  backtestPage: DEFAULT_BACKTEST_PAGE_SETTINGS,
  quantPage: DEFAULT_QUANT_PAGE_SETTINGS,
  signalsPage: { filter: 'all', setup: 'all', search: '' },
  youtubePage: DEFAULT_YOUTUBE_PAGE_SETTINGS,
  sourcePath: settingsPath(),
}

/** A refused maintenance action reports itself the way a refused edit does. */
function maintenanceFailure(
  action: MaintenanceAction,
  error: unknown,
): Envelope<MaintenanceResult> {
  const reason = describeError(error)
  return partial(
    { action, performed: false, message: reason, path: '' },
    [err(SETTINGS_SOURCE, reason, action)],
    SETTINGS_SOURCE,
    reason,
  )
}

const emptyPortfolio: PortfolioPayload = {
  portfolios: [],
  activeId: null,
  mainId: null,
  sourcePath: '',
}

const emptyCards: CardsPayload = {
  version: 2,
  starterCardsVersion: 1,
  customCards: [],
  cardOrder: ['builtin:index'],
  hiddenPortfolioIds: [],
  intervals: {},
  sourcePath: cardsPath(),
}

const emptyFinance: PersonalFinancePayload = {
  cash: [],
  debt: [],
  recurringBills: [],
  totalsCurrency: 'SGD',
  goal: { title: 'Net Worth Goal', targetAmount: 0, currency: 'SGD' },
  sourcePath: '',
}

const emptyChart = (symbol: string, timeframe: ChartRequest['timeframe']): ChartPayload => ({
  symbol,
  timeframe,
  interval: '',
  candles: [],
  stats: null,
  indicators: { ma200: [], rsi: [], rsiMa: [] },
})

function calendarEnvelope<T>(result: CalendarFetchResult<T>, source: string): Envelope<T> {
  const failureReason = result.errors.map((entry) => entry.reason).join(' | ')
  return {
    data: result.payload,
    meta: {
      source,
      freshness: result.stale
        ? 'stale'
        : result.errors.length
          ? 'partial'
          : result.fromCache
            ? 'cached'
            : 'fresh',
      fetchedAt: Date.now() - result.cacheAgeSeconds * 1000,
      cacheAgeSeconds: result.cacheAgeSeconds,
      ...(failureReason ? { failureReason } : {}),
    },
    errors: result.errors,
  }
}

/**
 * A Valuation load is `partial`, never `failed`, once it has a quote.
 *
 * A missing risk-free rate or a missing statement block still leaves a usable model — the
 * required return falls back to the heuristic and the derivation says so in its caveats —
 * so the page shows its own warnings rather than blanking. Only a symbol with no quote at
 * all throws, and that lands in the catch below.
 */
function economicEnvelope(result: EconomicFetchResult): Envelope<EconomicPayload> {
  const errors = economicErrors(result.payload)
  const failureReason = errors.map((entry) => entry.reason).join(' | ')
  return {
    data: result.payload,
    meta: meta(
      ECONOMIC_SOURCE,
      result.stale
        ? 'stale'
        : errors.length
          ? 'partial'
          : result.fromCache
            ? 'cached'
            : 'fresh',
      {
        cacheAgeSeconds: result.cacheAgeSeconds,
        ...(failureReason ? { failureReason } : {}),
      },
    ),
    errors,
  }
}

function institutionEnvelope<T extends { warnings: string[] }>(
  result: InstitutionFetchResult<T>,
): Envelope<T> {
  const warnings = [...result.payload.warnings]
  if (result.warning) {
    warnings.push(`Live DATAROMA refresh failed; showing cached data. ${result.warning}`)
  }
  const errors = warnings.map((reason) => err(INSTITUTIONS_SOURCE, reason, 'institutions'))
  const data = { ...result.payload, warnings }
  return {
    data,
    meta: meta(
      INSTITUTIONS_SOURCE,
      result.stale
        ? 'stale'
        : errors.length
          ? 'partial'
          : result.fromCache
            ? 'cached'
            : 'fresh',
      {
        cacheAgeSeconds: result.cacheAgeSeconds,
        ...(errors[0] ? { failureReason: errors[0].reason } : {}),
      },
    ),
    errors,
  }
}

function valuationEnvelope(result: ValuationFetchResult): Envelope<ValuationPayload> {
  const failureReason = result.errors.map((entry) => entry.reason).join(' | ')
  return {
    data: result.payload,
    meta: meta(
      VALUATION_SOURCE,
      result.stale
        ? 'stale'
        : result.errors.length
          ? 'partial'
          : result.fromCache
            ? 'cached'
            : 'fresh',
      {
        cacheAgeSeconds: result.cacheAgeSeconds,
        ...(failureReason ? { failureReason } : {}),
      },
    ),
    errors: result.errors,
  }
}

function upDownEnvelope(result: UpDownFetchResult): Envelope<UpDownPayload> {
  const failureReason = result.errors.map((entry) => entry.reason).join(' | ')
  return {
    data: result.payload,
    meta: meta(
      UP_DOWN_SOURCE,
      result.stale
        ? 'stale'
        : result.errors.length
          ? 'partial'
          : result.fromCache
            ? 'cached'
            : 'fresh',
      {
        cacheAgeSeconds: result.cacheAgeSeconds,
        ...(failureReason ? { failureReason } : {}),
      },
    ),
    errors: result.errors,
  }
}

const providerImplementation: MarketDataProvider = {
  async quotes({ holdings, force }) {
    const macroSymbols = MACRO_SYMBOLS.map((entry) => entry.symbol)
    const [batch, classifications] = await Promise.all([
      getQuotes([...macroSymbols, ...holdings], force),
      getHoldingSectors(holdings),
    ])

    const macro: QuotesPayload['macro'] = {}
    for (const entry of MACRO_SYMBOLS) {
      const quote = batch.quotes[entry.symbol]
      if (quote) macro[entry.label] = quote
    }
    const holdingQuotes: QuotesPayload['holdings'] = {}
    for (const symbol of holdings.map((s) => s.trim().toUpperCase())) {
      const quote = batch.quotes[symbol]
      if (quote) holdingQuotes[symbol] = { ...quote, sector: classifications.sectors[symbol] }
    }

    const payload: QuotesPayload = {
      macro,
      holdings: holdingQuotes,
      missing: batch.missing,
    }
    if (classifications.missing.length) {
      return partial(payload, [
        ...batch.errors.map(entry => err('yahoo quotes', entry.reason, 'quotes', entry.symbol)),
        err('Sector classification', `No classification available for: ${classifications.missing.join(', ')}. These holdings remain Unclassified.`, 'holding_sectors'),
      ], 'yahoo quotes + sectors', `${classifications.missing.length} holding classification(s) unavailable${batch.errors.length ? `; ${batch.errors.length} quote(s) unavailable` : ''}.`)
    }
    if (!batch.errors.length) {
      if (batch.staleCount > 0) {
        return {
          data: payload,
          meta: meta('yahoo quotes', 'stale', { cacheAgeSeconds: batch.cacheAgeSeconds }),
          errors: [],
        }
      }
      return ok(payload, 'yahoo quotes', batch.fromCacheCount === Object.keys(batch.quotes).length
        ? { freshness: 'cached', cacheAgeSeconds: batch.cacheAgeSeconds }
        : {})
    }
    return partial(
      payload,
      batch.errors.map((entry) =>
        err('yahoo quotes', entry.reason, 'quotes', entry.symbol),
      ),
      'yahoo quotes',
      `${batch.errors.length} quote(s) were unavailable.`,
    )
  },

  async chart({ symbol, timeframe, force }) {
    try {
      return ok(await getChart(symbol, timeframe, force), 'yahoo chart')
    } catch (error) {
      return failed(emptyChart(symbol, timeframe), describeError(error), 'yahoo chart')
    }
  },

  async chartsHistory(request) {
    const symbol = request.symbol.trim().toUpperCase()
    try {
      const result = await getChartsHistory({ ...request, symbol })
        if (result.stale) {
        return {
          data: result.payload,
          meta: meta('charts history cache', 'stale', { cacheAgeSeconds: result.cacheAgeSeconds }),
          errors: [err('yahoo chart', 'Live chart refresh failed; showing cached data.', 'charts history', symbol)],
        }
        }
        if (result.fromCache) {
          return {
            data: result.payload,
            meta: meta('charts history cache', 'cached', { cacheAgeSeconds: result.cacheAgeSeconds }),
            errors: [],
          }
        }
        return ok(result.payload, 'yahoo chart')
    } catch (error) {
      return failed({
        symbol,
        intervalLabel: request.interval,
        rangeLabel: request.range,
        interval: '',
        candles: [],
        stats: null,
        indicators: { ma50: [], ma200: [], rsi: [], rsiMa: [] },
      }, describeError(error), 'yahoo chart')
    }
  },

  async chartsCompare(request) {
    try {
      const result = await getChartsCompare(request)
      const errors = result.failures.map((failure) =>
        err('yahoo chart', failure.reason, 'charts compare', failure.symbol),
      )
      if (result.stale && !errors.length) {
        errors.push(err('charts history cache', 'Live comparison refresh failed; showing cached data.', 'charts compare'))
      }
        if (result.stale) {
        return {
          data: result.payload,
          meta: meta('charts history cache', 'stale', { cacheAgeSeconds: result.cacheAgeSeconds }),
          errors,
        }
        }
        if (result.fromCache && !errors.length) {
          return {
            data: result.payload,
            meta: meta('charts history cache', 'cached', { cacheAgeSeconds: result.cacheAgeSeconds }),
            errors: [],
          }
        }
        return errors.length ? partial(result.payload, errors, 'yahoo chart') : ok(result.payload, 'yahoo chart')
    } catch (error) {
      return failed({ symbols: [], interval: request.interval, range: request.range, series: {}, missing: request.symbols }, describeError(error), 'yahoo chart')
    }
  },

  async chartsRelationship(request) {
    try {
      const result = await getChartsRelationship(request)
      const errors = result.failures.map((failure) =>
        err('yahoo adjusted history', failure.reason, 'charts relationship', failure.symbol),
      )
      if (result.stale && !errors.length) {
        errors.push(err('adjusted history cache', 'Live relationship refresh failed; showing cached data.', 'charts relationship'))
      }
        if (result.stale) {
        return {
          data: result.payload,
          meta: meta('adjusted history cache', 'stale', { cacheAgeSeconds: result.cacheAgeSeconds }),
          errors,
        }
        }
        if (result.fromCache && !errors.length) {
          return {
            data: result.payload,
            meta: meta('adjusted history cache', 'cached', { cacheAgeSeconds: result.cacheAgeSeconds }),
            errors: [],
          }
        }
        return errors.length ? partial(result.payload, errors, 'yahoo adjusted history') : ok(result.payload, 'yahoo adjusted history')
    } catch (error) {
      const symbols = request.symbols.map((symbol) => symbol.trim().toUpperCase()) as [string, string]
      return failed({
        symbols,
        range: request.range,
        rollingWindow: request.rollingWindow,
        points: [],
        regressionLine: [],
        stats: {
          latestRatio: null,
          latestCorrelation: null,
          latestCorrelationSample: 0,
          beta: null,
          alphaDailyPct: null,
          r: null,
          rSquared: null,
          stdErrorPct: null,
          observations: 0,
        },
        missing: symbols,
      }, describeError(error), 'yahoo adjusted history')
    }
  },

  async options({ symbol, force }) {
    try {
      const payload = await getOptions(symbol, force)
      const emptyBuckets = payload.buckets.filter((bucket) => !bucket.rows.length)
      if (!emptyBuckets.length) return ok(payload, 'yahoo options')
      return partial(
        payload,
        emptyBuckets.map((bucket) =>
          err('yahoo options', `No contracts for the ${bucket.label} expiry.`, 'options', symbol),
        ),
        'yahoo options',
        `${emptyBuckets.length} option bucket(s) were empty.`,
      )
    } catch (error) {
      return failed({ symbol, buckets: [] }, describeError(error), 'yahoo options')
    }
  },

  async targets({ tickers, force }) {
    try {
      const targets = await getTargets(tickers, force)
      return ok({ targets }, 'yahoo quoteSummary')
    } catch (error) {
      return failed({ targets: [] }, describeError(error), 'yahoo quoteSummary')
    }
  },

  async news({ tickers, force }) {
    try {
      const items = await getNews(tickers, force)
      return ok({ items }, 'yahoo search')
    } catch (error) {
      return failed({ items: [] }, describeError(error), 'yahoo search')
    }
  },

  /**
   * Three lanes, each allowed to fail on its own. A dead feed or an unreachable holding
   * comes back as `partial` carrying the reason, not as a failed page — the section that
   * lost its source shows a dot and the rest of the grid still reads.
   */
  async newsPage({ tickers, force }) {
    try {
      const { payload, errors, unitFailures } = await getNewsPage(tickers, force)
      return errors.length
        ? partial(payload, errors, NEWS_SOURCE, `${unitFailures} news source(s) were unavailable.`)
        : ok(payload, NEWS_SOURCE)
    } catch (error) {
      const empty = { articles: [], lanes: [], counts: { portfolio: 0, macro: 0, other: 0 }, generatedAt: Date.now() }
      return failed(empty, describeError(error), NEWS_SOURCE)
    }
  },

  async newsTickerSearch({ tickers, force }) {
    try {
      const { payload, errors } = await getNewsTickerSearch(tickers, force)
      return errors.length ? partial(payload, errors, NEWS_SOURCE) : ok(payload, NEWS_SOURCE)
    } catch (error) {
      const empty = { queried: tickers, articles: [], empty: [], failed: tickers }
      return failed(empty, describeError(error), NEWS_SOURCE)
    }
  },

  // Both of these answer with a usable payload whatever happens upstream, so neither
  // needs a catch: the fallback text and the blank image are the failure states.
  async newsArticle(request) {
    const { payload, errors } = await getNewsPreview(request)
    return errors.length ? partial(payload, errors, 'news preview') : ok(payload, 'news preview')
  },

  async newsThumbnail({ url }) {
    const { payload, errors } = await getNewsThumbnail(url)
    return errors.length ? partial(payload, errors, 'news image') : ok(payload, 'news image')
  },

  async fundamentals({ tickers, force }) {
    try {
      const facts = await getFundamentals(tickers, force)
      return ok({ fundamentals: facts }, 'yahoo quoteSummary')
    } catch (error) {
      return failed({ fundamentals: {} }, describeError(error), 'yahoo quoteSummary')
    }
  },

  async fundamentalsPage({ symbol, force }) {
    const normalized = symbol.trim().toUpperCase()
    try {
      const result = await getFundamentalsPage(normalized, force)
      const errors = result.failures.map((failure) =>
        err(failure.source, failure.reason, failure.operation, normalized),
      )
      const sec = result.payload.sec
      const source = sec.statementsAvailable
        ? ['cached', 'stale'].includes(sec.statementFreshness)
          ? 'SEC cached + Yahoo Finance'
          : FUNDAMENTALS_PAGE_SOURCE
        : 'Yahoo Finance'
      if (result.stale) {
        return {
          data: result.payload,
          meta: meta(source, 'stale', {
            cacheAgeSeconds: sec.cacheAgeSeconds,
            failureReason: errors[0]?.reason,
          }),
          errors,
        }
      }
      return errors.length ? partial(result.payload, errors, source) : ok(result.payload, source)
    } catch (error) {
      return failed(emptyFundamentalsPagePayload(normalized), describeError(error), FUNDAMENTALS_PAGE_SOURCE)
    }
  },

  async returns({ tickers, window, force }) {
    try {
      const batch = await getClosesBatch(tickers, window, force)
      const returns: Record<string, number> = {}
      for (const [ticker, series] of Object.entries(batch.closes)) {
        const value = periodReturn(series)
        if (value !== null) returns[ticker] = value
      }
      const payload = { returns, missing: batch.missing }
      if (!batch.missing.length) return ok(payload, 'yahoo history')
      return partial(
        payload,
        batch.missing.map((symbol) =>
          err('yahoo history', `No history for ${symbol}.`, 'returns', symbol),
        ),
        'yahoo history',
        `${batch.missing.length} ticker(s) had no history.`,
      )
    } catch (error) {
      return failed({ returns: {}, missing: tickers }, describeError(error), 'yahoo history')
    }
  },

  async momentum({ positions, cashAmount, timeframe, force }) {
    // EMA spans per timeframe, from `_p4_momentum_ema_period`.
    const emaPeriod = timeframe === '1mo' ? 10 : timeframe === '1y' ? 50 : 20
    const emptyMomentum: MomentumPayload = {
      dates: [],
      returns: [],
      emaPeriod,
      ema: [],
      startDate: null,
      includedTickers: [],
      excludedTickers: [],
      reason: '',
    }
    try {
      const held = positions.filter((position) => position.shares > 0)
      const batch = await getClosesBatch(
        held.map((position) => position.ticker),
        timeframe,
        force,
      )
      const { series, included, excluded } = buildPortfolioSeries(held, batch.closes, cashAmount)
      if (series.dates.length < 2) {
        return ok(
          { ...emptyMomentum, excludedTickers: excluded, reason: 'No common historical window' },
          'yahoo history',
        )
      }
      const returns = toReturnSeries(series)
      return ok(
        {
          dates: series.dates,
          returns,
          emaPeriod,
          ema: ema(returns, emaPeriod),
          startDate: series.dates[0],
          includedTickers: included,
          excludedTickers: excluded,
          reason: '',
        },
        'yahoo history',
      )
    } catch (error) {
      return failed(emptyMomentum, describeError(error), 'yahoo history')
    }
  },

  async analytics({ positions, cashAmount, currentValues, benchmarkSymbol, lookback, force }) {
    const held = positions.filter((position) => position.shares > 0)
    const exposure = computeExposure(held.length, currentValues)
    const base: AnalyticsPayload = {
      metrics: emptyRiskMetrics(),
      exposure,
      benchmarkSymbol,
      lookback,
      startDate: null,
      endDate: null,
      historyPoints: 0,
      includedTickers: [],
      excludedTickers: [],
      note: '',
      reason: '',
    }
    try {
      // The benchmark is optional — without it alpha and beta are omitted and everything
      // else still computes — and it is independent of the holdings, so it is requested
      // alongside them rather than after them. The rate gate still decides what runs when.
      const [batch, benchmark] = await Promise.all([
        getClosesBatch(held.map((position) => position.ticker), lookback, force),
        getCloses(benchmarkSymbol, lookback, force).catch(() => null),
      ])
      const { series, included, excluded } = buildPortfolioSeries(held, batch.closes, cashAmount)
      if (series.dates.length < 2) {
        return ok({ ...base, excludedTickers: excluded, reason: 'No common historical window' })
      }
      const { metrics, note } = computeRiskMetrics(series, benchmark)
      return ok(
        {
          ...base,
          metrics,
          startDate: series.dates[0],
          endDate: series.dates[series.dates.length - 1],
          historyPoints: series.dates.length,
          includedTickers: included,
          excludedTickers: excluded,
          note,
        },
        'yahoo history',
      )
    } catch (error) {
      return failed({ ...base, reason: describeError(error) }, describeError(error), 'yahoo history')
    }
  },

  async optionQuotes(request) {
    try {
      const payload = await getOptionQuotes(request)
      const errors = payload.errors ?? []
      if (errors.length && !Object.keys(payload.quotes).length && !Object.keys(payload.expiries).length) {
        return { data: payload, meta: meta('yahoo options', 'failed', { failureReason: 'Option marks and expirations unavailable.' }), errors }
      }
      return partial(payload, errors, 'yahoo options', errors.length ? 'Some option marks or expirations unavailable.' : '')
    } catch (error) {
      return failed({ quotes: {}, expiries: {} }, describeError(error), 'yahoo options')
    }
  },

  async portfolio() {
    try {
      return ok(await readPortfolios(), 'portfolio store')
    } catch (error) {
      return failed(emptyPortfolio, describeError(error), 'portfolio store')
    }
  },

  async mutatePortfolio(mutation) {
    return withAutomaticBackup(async () => {
      try {
        return ok(await mutatePortfolios(mutation), 'portfolio store')
      } catch (error) {
        // A rejected edit (duplicate ticker, last portfolio, portfolio cap) is a normal
        // outcome, so return the unchanged document with the reason attached rather than
        // throwing across the IPC boundary.
        const reason = describeError(error)
        const current = await readPortfolios().catch(() => emptyPortfolio)
        if (error instanceof RecordRevisionError) return failed(current, reason, 'portfolio store')
        return partial(
          current,
          [err('portfolio store', reason, mutation.type)],
          'portfolio store',
          reason,
        )
      }
    })
  },

  async cards() {
    try {
      return ok(await readCards(), 'cards store')
    } catch (error) {
      return failed(emptyCards, describeError(error), 'cards store')
    }
  },

  async mutateCards(mutation) {
    return withAutomaticBackup(async () => {
      try {
        return ok(await mutateCards(mutation), 'cards store')
      } catch (error) {
        const reason = describeError(error)
        const current = await readCards().catch(() => emptyCards)
        if (error instanceof RecordRevisionError) return failed(current, reason, 'cards store')
        return partial(current, [err('cards store', reason, mutation.type)], 'cards store', reason)
      }
    })
  },

  async cardsPerformance(request) {
    try {
      const result = await getCardsPerformance(request)
      return result.errors.length
        ? partial(result.payload, result.errors, CARDS_SOURCE, result.errors[0].reason)
        : ok(result.payload, CARDS_SOURCE)
    } catch (error) {
      return failed(
        { interval: request.interval, results: {} },
        describeError(error),
        CARDS_SOURCE,
      )
    }
  },

  async personalFinance() {
    try {
      return ok(await readPersonalFinance(), 'portfolio store')
    } catch (error) {
      return failed(emptyFinance, describeError(error), 'portfolio store')
    }
  },

  async mutatePersonalFinance(mutation) {
    return withAutomaticBackup(async () => {
      try {
        return ok(await mutatePersonalFinance(mutation), 'portfolio store')
      } catch (error) {
        // Same contract as the portfolio writes: a refused edit (blank description, row
        // cap, a row someone else already deleted) is a normal outcome, so the unchanged
        // section comes back with the reason attached.
        const reason = describeError(error)
        const current = await readPersonalFinance().catch(() => emptyFinance)
        if (error instanceof RecordRevisionError) return failed(current, reason, 'portfolio store')
        return partial(
          current,
          [err('portfolio store', reason, mutation.type)],
          'portfolio store',
          reason,
        )
      }
    })
  },

  async fx({ force }) {
    try {
      return ok(await getFxRate(force), FX_SOURCE)
    } catch (error) {
      // The page prints "FX required" off the null rate rather than blanking itself.
      return failed(
        { usdSgd: null, source: FX_SOURCE, collectedAt: 0 },
        describeError(error),
        FX_SOURCE,
      )
    }
  },

  async globalMarkets({ force }) {
    const empty: GlobalMarketsPayload = {
      generatedAt: '',
      source: 'yahoo chart',
      rows: [],
      missing: [],
    }
    try {
      const payload = await getGlobalMarkets(force)
      if (!payload.missing.length) return ok(payload, 'yahoo chart')
      // A market whose symbol failed still has a row; the page prints `--` for it and
      // says so in the status line rather than losing the other sixteen.
      return partial(
        payload,
        payload.missing.map((symbol) =>
          err('yahoo chart', `No history for ${symbol}.`, 'globalMarkets', symbol),
        ),
        'yahoo chart',
        `${payload.missing.length} symbol(s) were unavailable.`,
      )
    } catch (error) {
      return failed(empty, describeError(error), 'yahoo chart')
    }
  },

  async preMarket({ force }) {
    const empty: PreMarketPayload = {
      futures: [],
      dxy: null,
      tnx: null,
      vix: null,
      fearGreed: null,
      momentum: null,
      missing: [],
    }
    try {
      const payload = await getPreMarket(force)
      if (!payload.missing.length) return ok(payload, PRE_MARKET_SOURCE)
      // Six independent feeds, one of which is not even Yahoo. A dead block leaves its
      // own panel showing a warning dot; the other five still render.
      return partial(
        payload,
        payload.missing.map((block) =>
          err(PRE_MARKET_SOURCE, `No data for ${block}.`, 'preMarket', block),
        ),
        PRE_MARKET_SOURCE,
        `${payload.missing.length} pre-market feed(s) were unavailable.`,
      )
    } catch (error) {
      return failed(empty, describeError(error), PRE_MARKET_SOURCE)
    }
  },

  async tradingVolumes({ force }) {
    const empty: TradingVolumesPayload = { rows: [], asOf: '', source: TRADING_VOLUMES_SOURCE, missing: [] }
    try {
      const payload = await getTradingVolumes(force)
      if (!payload.missing.length) return ok(payload, TRADING_VOLUMES_SOURCE)
      // A symbol whose daily history failed still has its screener row and its 1D
      // figures; only the columns that need history are blank. The page stays up.
      return partial(
        payload,
        payload.missing.map((symbol) =>
          err(TRADING_VOLUMES_SOURCE, 'No daily history.', 'tradingVolumes', symbol),
        ),
        TRADING_VOLUMES_SOURCE,
        `${payload.missing.length} symbol(s) had no daily history.`,
      )
    } catch (error) {
      return failed(empty, describeError(error), TRADING_VOLUMES_SOURCE)
    }
  },

  async signals(request) {
    if (request.latestOnly) return ok(await getLatestSignals(), SIGNALS_SOURCE)
    try {
      const payload = await getSignals(request)
      const issues = { ...payload.errors }
      if (payload.marketOpen) {
        for (const row of payload.results) {
          if (row.status === 'stale' || row.status === 'awaiting_data') {
            issues[row.ticker] ??= row.status === 'stale'
              ? 'Completed candles are delayed; no fresh signal is available.'
              : 'Waiting for completed regular-session candles from Yahoo.'
          }
        }
      }
      if (!Object.keys(issues).length) return ok(payload, SIGNALS_SOURCE)
      return partial(
        payload,
        Object.entries(issues).map(([symbol, message]) =>
          err(SIGNALS_SOURCE, message, 'signals', symbol),
        ),
        SIGNALS_SOURCE,
        `${Object.keys(issues).length} ticker(s) returned delayed or incomplete market data.`,
      )
    } catch (error) {
      return failed(await getLatestSignals(), describeError(error), SIGNALS_SOURCE)
    }
  },

  marketCapSales: (request) => getMarketCapSales(request.symbols, request.force),
  marketCap: (request) => marketCapEnvelope(request?.force, undefined, undefined, request?.tier),

  async priceScreen({ minimumPrice, maximumPrice }) {
    const empty: PriceScreenPayload = {
      rows: [],
      source: PRICE_SCREEN_SOURCE,
      asOf: '',
      candidateCount: 0,
      minimumPrice,
      maximumPrice,
    }
    try {
      return ok(await getPriceScreen(minimumPrice, maximumPrice), PRICE_SCREEN_SOURCE)
    } catch (error) {
      return failed(empty, describeError(error), PRICE_SCREEN_SOURCE)
    }
  },

  async calendarMonth(request) {
    try {
      return calendarEnvelope(await getCalendarMonth(request), CALENDAR_SOURCE)
    } catch (error) {
      const empty: CalendarMonthPayload = {
        companyEvents: [],
        economicEvents: [],
        marketHolidays: [],
        generatedAt: 0,
      }
      return failed(empty, describeError(error), CALENDAR_SOURCE)
    }
  },

  async earningsCalendar(request) {
    try {
      return calendarEnvelope(await getEarningsCalendar(request), EARNINGS_SOURCE)
    } catch (error) {
      const empty: EarningsCalendarPayload = {
        rows: [],
        source: EARNINGS_SOURCE,
        sourceUrl: '',
        fetchedAt: '',
        startDate: request.startDate,
        endDate: request.endDate,
        rangeKey: request.rangeKey,
        symbolUniverseCount: 0,
      }
      return failed(empty, describeError(error), EARNINGS_SOURCE)
    }
  },

  async crypto({ force }) {
    try {
      const { payload, errors } = await getCrypto(force)
      if (!errors.length) return ok(payload, CRYPTO_SOURCE)
      // Four independent feeds across three unrelated hosts. A dead stage leaves its own
      // panel showing a warning dot; the other three still render, exactly as the
      // reference's per-stage `progress` map does.
      const dead = CRYPTO_STAGES.filter((stage) => payload.progress[stage] === 'unavailable')
      return partial(
        payload,
        errors,
        CRYPTO_SOURCE,
        dead.length ? `${dead.length} crypto stage(s) were unavailable.` : '',
      )
    } catch (error) {
      return failed(emptyCryptoPayload(), describeError(error), CRYPTO_SOURCE)
    }
  },

  async bmnr({ force }) {
    try {
      const { payload, errors } = await getBmnr(force)
      if (!errors.length) return ok(payload, BMNR_SOURCE)
      // Three lanes over three unrelated hosts. A dead lane leaves its own panels showing a
      // warning dot and the rest of the page intact — the live ETH count and the filed
      // balance sheet are independently useful, which is the whole reason they are kept
      // apart rather than blended.
      const dead = BMNR_BLOCKS.filter((block) => payload.progress[block] === 'unavailable')
      return partial(
        payload,
        errors,
        BMNR_SOURCE,
        dead.length ? `${dead.length} BMNR data source(s) were unavailable.` : '',
      )
    } catch (error) {
      return failed(emptyBmnrPayload(), describeError(error), BMNR_SOURCE)
    }
  },

  hood: getHood,
  hims: getHims,
  sofi: getSofi,
  mu: getMu,
  amzn: getAmzn,
  avgo: getAvgo,
  semiconductors: getSemiconductors,
  vst: getVst,

  sp500: getSp500,
  sp500Breadth: getSp500Breadth,

  async gold({ force }) {
    try {
      const { payload, errors } = await getGold(force)
      if (!errors.length) return ok(payload, GOLD_SOURCE)
      const dead = GOLD_BLOCKS.filter((block) => payload.progress[block] === 'unavailable')
      return partial(
        payload,
        errors,
        GOLD_SOURCE,
        dead.length ? `${dead.length} Gold data source(s) were unavailable.` : 'Gold refresh used stale source data.',
      )
    } catch (error) {
      return failed(emptyGoldPayload(), describeError(error), GOLD_SOURCE)
    }
  },


  async oil({ force }) {
    try {
      const { payload, errors } = await getOil(force)
      if (!errors.length) return ok(payload, OIL_SOURCE)
      const dead = OIL_BLOCKS.filter((block) => payload.progress[block] === 'unavailable')
      return partial(
        payload,
        errors,
        OIL_SOURCE,
        dead.length ? `${dead.length} Oil data source(s) were unavailable.` : 'Oil refresh used stale source data.',
      )
    } catch (error) {
      return failed(emptyOilPayload(), describeError(error), OIL_SOURCE)
    }
  },
  async heatmap({ etf, force }) {
    const key = normalizeEtfKey(etf)
    try {
      const { payload, errors } = await getHeatmap(key, force)
      if (!errors.length) return ok(payload, HEATMAP_SOURCE, { asOf: Date.parse(payload.priceAsOfDate!) })
      if (!payload.quoteCoverage) return { ...failed(payload, errors.map(error => error.reason).join(' · '), HEATMAP_SOURCE), errors }
      // Missing Yahoo histories render as outlined no-data tiles beside the coverage
      // count; history and holdings failures retain their reasons.
      return partial(
        payload,
        errors,
        HEATMAP_SOURCE,
        errors.map(error => error.reason).join(' · '),
      )
    } catch (error) {
      return failed(emptyHeatmapPayload(key), describeError(error), HEATMAP_SOURCE)
    }
  },

  /**
   * `_p13_handle_loaded_result` / `_p13_handle_error`.
   *
   * A Yahoo top-holdings fallback is a `partial` envelope rather than a failure: the
   * reference renders those rows and says in its status line that they are not the full
   * book, and dropping them would empty a page that has something useful to show.
   */
  async etfHoldings({ ticker, force }) {
    const symbol = String(ticker ?? '').trim().toUpperCase()
    try {
      const { payload, errors } = await getEtfHoldingsPage(symbol, force)
      if (!errors.length) return ok(payload, ETF_HOLDINGS_SOURCE)
      return partial(payload, errors, ETF_HOLDINGS_SOURCE, payload.coverageNote)
    } catch (error) {
      return failed(emptyEtfHoldingsPayload(symbol), describeError(error), ETF_HOLDINGS_SOURCE)
    }
  },

  /**
   * `_p13_apply_arbitrage_result`. Partial quote coverage is normal — a basket of five
   * hundred names nearly always has a few Yahoo will not quote — and the gap is still
   * computed over the ones that answered, with the coverage cell saying how many.
   */
  async etfArbitrage({ ticker, force }) {
    const symbol = String(ticker ?? '').trim().toUpperCase()
    try {
      const { payload, errors } = await getEtfArbitrage(symbol, force)
      if (!errors.length) return ok(payload, ETF_ARBITRAGE_SOURCE)
      return partial(
        payload,
        errors,
        ETF_ARBITRAGE_SOURCE,
        errors.map(error => error.reason).join(' · '),
      )
    } catch (error) {
      return failed(emptyEtfArbitragePayload(symbol), describeError(error), ETF_ARBITRAGE_SOURCE)
    }
  },

  /** `_p13_on_aum_data_ready` / `_p13_on_aum_data_error`: the rail fails on its own. */
  async etfAum({ force }) {
    try {
      return ok(await getEtfAum(force), ETF_AUM_SOURCE)
    } catch (error) {
      return failed(
        { rows: [], totalCount: 0, missingCount: 0, fetchedAt: Date.now() },
        describeError(error),
        ETF_AUM_SOURCE,
      )
    }
  },

  async upDown(request) {
    const empty: UpDownPayload = {
      source: request.source,
      interval: request.interval,
      rows: [],
      missing: [],
      asOf: '',
      dataSource: 'Yahoo Finance',
      holdingsSource: '',
      forceTargets: false,
    }
    try {
      return upDownEnvelope(await getUpDown(request))
    } catch (error) {
      return failed(empty, describeError(error), UP_DOWN_SOURCE)
    }
  },

  async upDownTargets({ tickers, force }) {
    const empty: UpDownTargetsPayload = { targets: {}, resolved: 0, available: 0 }
    try {
      return ok(await getUpDownTargets(tickers, Boolean(force)), UP_DOWN_SOURCE)
    } catch (error) {
      return failed(empty, describeError(error), UP_DOWN_SOURCE)
    }
  },

  money: (request) => getMoney(request),

  /**
   * An Economic load is `partial`, never `failed`, while any provider answered.
   *
   * Five independent hosts feed the catalog, and the page is built to render whichever
   * ones came back — a blocked FRED costs 20 rows, not the page. Only a total blackout with
   * nothing cached reaches the catch below.
   */
  async economic(request) {
    const empty: EconomicPayload = {
      generatedAt: '',
      source: ECONOMIC_SOURCE,
      groups: [],
      rows: [],
      missing: [],
      unreachable: [],
      yieldCurve: {
        tenors: [],
        spread10y2y: null,
        spread10y3m: null,
        inverted2s10s: false,
        inverted3m10y: false,
      },
    }
    try {
      return economicEnvelope(await getEconomic(request))
    } catch (error) {
      return failed(empty, describeError(error), ECONOMIC_SOURCE)
    }
  },

  async institutionActivity(request) {
    const empty: InstitutionActivityPayload = {
      periods: [],
      activePeriod: request.quarter?.trim() ?? '',
      buyRows: [],
      sellRows: [],
      managerRows: [],
      sourceUrls: { activity: '' },
      warnings: [],
      fetchedAt: '',
    }
    try {
      return institutionEnvelope(await getInstitutionActivity(request))
    } catch (error) {
      return failed(empty, describeError(error), INSTITUTIONS_SOURCE)
    }
  },

  async institutionTickerActivity(request) {
    const symbol = request.symbol.toUpperCase().trim()
    const empty: InstitutionTickerActivityPayload = {
      symbol,
      company: '',
      sector: '',
      periods: [],
      activePeriod: '',
      activityRows: [],
      sourceUrls: { activity: '' },
      warnings: [],
      fetchedAt: '',
    }
    try {
      return institutionEnvelope(await getInstitutionTickerActivity(request))
    } catch (error) {
      return failed(empty, describeError(error), INSTITUTIONS_SOURCE)
    }
  },

  /**
   * `_p21_refresh_upcoming_ipo_calendar`. A stale cache standing in for a failed scrape is
   * a `partial` envelope carrying the reason, not a failure: the table still has rows and
   * the status line says where they came from.
   */
  async ipoUpcoming({ force }) {
    try {
      const { payload, errors } = await getUpcomingIpos(Boolean(force))
      if (!errors.length) return ok(payload, IPO_UPCOMING_SOURCE)
      return partial(payload, errors, IPO_UPCOMING_SOURCE, payload.warning)
    } catch (error) {
      return failed(emptyUpcomingIpoPayload(), describeError(error), IPO_UPCOMING_SOURCE)
    }
  },

  /** `_p21_refresh_completed_ipos`, and independent of the upcoming feed by design. */
  async ipoCompleted({ year, force }) {
    const target = Number(year) || new Date().getFullYear()
    try {
      const { payload, errors } = await getCompletedIpos(target, Boolean(force))
      if (!errors.length) return ok(payload, IPO_COMPLETED_SOURCE)
      return partial(payload, errors, IPO_COMPLETED_SOURCE, payload.warning)
    } catch (error) {
      return failed(emptyCompletedIpoPayload(target), describeError(error), IPO_COMPLETED_SOURCE)
    }
  },

  async politicsPage({ page, force }) {
    const target = Math.max(1, Math.trunc(Number(page)) || 1)
    try {
      const { payload, errors } = await getPoliticsPage(target, Boolean(force))
      if (!errors.length) return ok(payload, POLITICS_SOURCE)
      return partial(payload, errors, POLITICS_SOURCE, payload.warning)
    } catch (error) {
      return failed(emptyPoliticsPage(target), describeError(error), POLITICS_SOURCE)
    }
  },

  async politicsExport({ pages }) {
    // 0 means every page, so the usual `|| 5` fallback would silently cap a full export.
    const requested = Number(pages)
    try {
      const { payload, errors } = await getPoliticsExport(Number.isFinite(requested) ? requested : 5)
      if (!errors.length) return ok(payload, POLITICS_SOURCE)
      return partial(payload, errors, POLITICS_SOURCE, errors[0]?.reason)
    } catch (error) {
      return failed(
        { trades: [], pagesFetched: 0, totalPages: 0, fetchedAt: 0 },
        describeError(error),
        POLITICS_SOURCE,
      )
    }
  },

  async valuation({ symbol, customPeers, force }) {
    const normalized = symbol.trim().toUpperCase()
    try {
      return valuationEnvelope(await getValuation(normalized, customPeers ?? [], Boolean(force)))
    } catch (error) {
      return failed(emptyValuation(normalized), describeError(error), VALUATION_SOURCE)
    }
  },

  async stocks({ symbol, force }) {
    const normalized = symbol.trim().toUpperCase() || 'SPY'
    try {
      const { payload, failures } = await getStocks(normalized, force)
      if (!failures.length) return ok(payload, STOCKS_SOURCE)
      return partial(
        payload,
        failures.map((failure) =>
          err(STOCKS_SOURCE, failure.reason, 'stocks', failure.block),
        ),
        STOCKS_SOURCE,
        `${failures.length} Stocks block(s) could not refresh.`,
      )
    } catch (error) {
      const reason = describeError(error)
      const empty = {
        symbol: normalized,
        company: { name: normalized, exchange: '', sector: '', industry: '', description: 'No company description available.' },
        metrics: {
          marketCap: 'N/A', revenue: 'N/A', netIncome: 'N/A', eps: 'N/A',
          grossMargin: 'N/A', operatingMargin: 'N/A', netMargin: 'N/A', sharesOutstanding: 'N/A',
          pe: 'N/A', forwardPe: 'N/A', dividend: 'N/A', exDividendDate: 'N/A',
          volume: 'N/A', beta: 'N/A', earningsDate: 'N/A',
        },
        targets: { low: 'N/A', mean: 'N/A', high: 'N/A', upsideToMean: 'N/A', upsidePct: null, analysts: 'N/A' },
        chart: { candles: [], stats: { symbol: normalized, price: 0, change: 0, absChange: 0, open: 0, high: 0, low: 0, close: 0, volume: 0, currency: 'USD', longName: normalized }, mfi: [] },
        news: [], institutional: [], insiders: [], missing: ['Chart'], generatedAt: 0,
      }
      return failed(empty, reason, STOCKS_SOURCE)
    }
  },

  async discoveryUniverse() {
    try {
      return ok(await getDiscoveryUniverse(), 'NASDAQ Trader directory')
    } catch (error) {
      return failed({ symbols: [], stale: true }, describeError(error), 'NASDAQ Trader directory')
    }
  },

  async discovery({ symbol }) {
    try {
      const snapshot = await getDiscoverySnapshot(symbol)
      return snapshot.stale
        ? partial(snapshot, [err('Yahoo Finance', 'Some quote or company fields could not refresh.', 'discovery', symbol)], 'Yahoo Finance')
        : ok(snapshot, 'Yahoo Finance')
    } catch (error) {
      return failed(null, describeError(error), 'Yahoo Finance')
    }
  },

  async optionsChain({ symbol, expiry = '', force }) {
    const normalized = symbol.trim().toUpperCase()
    if (!normalized) {
      return failed(
        emptyOptionsChain(normalized),
        'Enter a ticker above to view the full options chain.',
        OPTIONS_PAGE_SOURCE,
      )
    }
    try {
      const { payload, failures } = await getOptionsChain(normalized, expiry, Boolean(force))
      if (!failures.length) return ok(payload, OPTIONS_PAGE_SOURCE)
      return partial(
        payload,
        failures.map((failure) =>
          err(OPTIONS_PAGE_SOURCE, failure.reason, 'optionsChain', failure.block),
        ),
        OPTIONS_PAGE_SOURCE,
        failures[0].reason,
      )
    } catch (error) {
      return failed(emptyOptionsChain(normalized), describeError(error), OPTIONS_PAGE_SOURCE)
    }
  },

  async optionsExpirations({ symbol, force }) {
    const normalized = symbol.trim().toUpperCase()
    const empty = {
      symbol: normalized,
      spotPrice: 0,
      marketDate: '',
      buckets: [],
      strikes: [],
      generatedAt: 0,
    }
    if (!normalized) {
      return failed(empty, 'Enter a ticker above to load every expiration.', OPTIONS_PAGE_SOURCE)
    }
    try {
      const { payload, failures } = await getOptionsExpirations(normalized, Boolean(force))
      if (!failures.length) return ok(payload, OPTIONS_PAGE_SOURCE)
      // One dead expiration costs its own grid panel, not the page: the failure carries
      // the expiry as its block label and every other panel still renders.
      return partial(
        payload,
        failures.map((failure) =>
          err(OPTIONS_PAGE_SOURCE, failure.reason, 'optionsExpirations', failure.block),
        ),
        OPTIONS_PAGE_SOURCE,
        `${failures.length} expiration(s) could not be loaded.`,
      )
    } catch (error) {
      return failed(empty, describeError(error), OPTIONS_PAGE_SOURCE)
    }
  },

  /**
   * The Projections page: one chart plus every live expiration's chain.
   *
   * A failed chart is `partial`, not `failed` — the option tables and their per-panel
   * projections still render, exactly as `_p28_update_view` keeps them when only the
   * chart came back empty. Only an empty sweep *and* an empty chart make the page a
   * failure, and that arrives here as an empty payload with both blocks reported.
   */
  async projections({ symbol, timeframe, force }) {
    const normalized = symbol.trim().toUpperCase()
    if (!normalized) {
      return failed(
        emptyProjections(normalized, timeframe),
        'Enter a ticker before loading options top volume.',
        PROJECTIONS_SOURCE,
      )
    }
    try {
      const { payload, failures } = await getProjections(normalized, timeframe, Boolean(force))
      if (!failures.length) return ok(payload, PROJECTIONS_SOURCE)
      if (!payload.candles.length && !payload.buckets.some((bucket) => bucket.rows.length)) {
        return failed(payload, failures[0].reason, PROJECTIONS_SOURCE)
      }
      return partial(
        payload,
        failures.map((failure) =>
          err(PROJECTIONS_SOURCE, failure.reason, 'projections', failure.block),
        ),
        PROJECTIONS_SOURCE,
        failures[0].reason,
      )
    } catch (error) {
      return failed(emptyProjections(normalized, timeframe), describeError(error), PROJECTIONS_SOURCE)
    }
  },

  async backtest(request) {
    const compareSymbol = request.compareSymbol.trim().toUpperCase()
    try {
      const result = await getBacktest(request)
      if (result.stale) {
        return {
          data: result.payload,
          meta: meta(BACKTEST_SOURCE, 'stale', { cacheAgeSeconds: result.cacheAgeSeconds }),
          errors: [
            err(BACKTEST_SOURCE, 'Live backtest refresh failed; showing cached data.', 'backtest'),
          ],
        }
      }
      if (result.fromCache) {
        return {
          data: result.payload,
          meta: meta(BACKTEST_SOURCE, 'cached', { cacheAgeSeconds: result.cacheAgeSeconds }),
          errors: [],
        }
      }
      return ok(result.payload, BACKTEST_SOURCE)
    } catch (error) {
      return failed(emptyBacktestPayload(compareSymbol), describeError(error), BACKTEST_SOURCE)
    }
  },

  async quantScan(request) {
    if (request.latestOnly) return ok(await getLatestQuant(), QUANT_SOURCE)
    try {
      const payload = await runQuantScan(Boolean(request.forceUniverseRefresh))
      const failures = Object.entries(payload.errors)
      if (!failures.length) return ok(payload, QUANT_SOURCE)
      return partial(
        payload,
        failures.map(([symbol, message]) => err(QUANT_SOURCE, message, 'quantScan', symbol)),
        QUANT_SOURCE,
        `${failures.length} ticker(s) returned incomplete daily history.`,
      )
    } catch (error) {
      return failed(await getLatestQuant(), describeError(error), QUANT_SOURCE)
    }
  },

  async technicalScan() {
    try {
      const payload = await runTechnicalScan()
      const failures = Object.entries(payload.errors)
      return failures.length
        ? partial(payload, failures.map(([symbol, reason]) => err(TECHNICAL_SOURCE, reason, 'technicalScan', symbol)), TECHNICAL_SOURCE,
          `${failures.length} ticker(s) returned incomplete daily history.`)
        : ok(payload, TECHNICAL_SOURCE)
    } catch (error) {
      return failed(null, describeError(error), TECHNICAL_SOURCE)
    }
  },

  async quantPair({ left, right, force }) {
    try {
      return ok(await analyzeQuantPair(left, right, Boolean(force)), QUANT_SOURCE)
    } catch (error) {
      return failed(null, describeError(error), QUANT_SOURCE)
    }
  },

  async youtube(request) {
    const empty: YouTubePayload = {
      items: [],
      warnings: [],
      fetchedAt: Date.now(),
      fromCacheCount: 0,
      fetchedCount: 0,
      tickersTotal: request.tickers.length,
    }
    try {
      const result = await getYouTube(request)
      const errors = result.errors.map((reason) =>
        err(YOUTUBE_SOURCE, reason, 'youtube', reason.match(/^([^:]+):/)?.[1]),
      )
      if (errors.length) {
        return partial(result.payload, errors, YOUTUBE_SOURCE, errors[0].reason)
      }
      if (result.payload.fromCacheCount === result.payload.tickersTotal && result.payload.tickersTotal > 0) {
        return {
          data: result.payload,
          meta: meta(YOUTUBE_SOURCE, 'cached', { cacheAgeSeconds: result.cacheAgeSeconds }),
          errors: [],
        }
      }
      return ok(result.payload, YOUTUBE_SOURCE)
    } catch (error) {
      return failed(empty, describeError(error), YOUTUBE_SOURCE)
    }
  },

  async youtubeThumbnail(request) {
    const { payload, errors } = await getYouTubeThumbnail(request)
    return errors.length ? partial(payload, errors, 'YouTube image') : ok(payload, 'YouTube image')
  },

  async settings() {
    try {
      return ok({ ...(await readSettings()), automaticBackup: automaticBackupStatus() }, SETTINGS_SOURCE)
    } catch (error) {
      return failed(emptySettings, describeError(error), SETTINGS_SOURCE)
    }
  },

  async mutateSettings(mutation) {
    const result = await withAutomaticBackup(async () => {
      try {
        return ok(await mutateSettings(mutation), SETTINGS_SOURCE)
      } catch (error) {
        // Same contract as the portfolio writes: hiding Settings, or moving a tab past
        // the end of the list, comes back as the unchanged document plus a reason.
        const reason = describeError(error)
        const current = await readSettings().catch(() => emptySettings)
        if (error instanceof RecordRevisionError) return failed(current, reason, SETTINGS_SOURCE)
        return partial(current, [err(SETTINGS_SOURCE, reason, mutation.type)], SETTINGS_SOURCE, reason)
      }
    })
    return { ...result, data: { ...result.data, automaticBackup: automaticBackupStatus() } }
  },

  async exportUserData(targetPath) {
    try {
      await writeUserDataBackup(targetPath)
      // The export is already usable even if recording its reminder timestamp fails.
      await recordBackupExport().catch((error) => console.warn('Could not record backup time:', error))
      return ok(
        {
          action: 'exportUserData' as const,
          performed: true,
          message: `Exported holdings, personal finance, cards and settings to ${targetPath}`,
          path: targetPath,
        },
        SETTINGS_SOURCE,
      )
    } catch (error) {
      return maintenanceFailure('exportUserData', error)
    }
  },

  async importUserData(sourcePath) {
    return withAutomaticBackup(async () => {
      try {
        const parsed = backupSchema.safeParse(JSON.parse(await readFile(sourcePath, 'utf8')))
        if (!parsed.success || parsed.data.app !== BACKUP_APP_ID) {
          throw new Error('That file is not a Budget Terminal backup.')
        }
        const rollback = await importUserData(parsed.data.userData)
        // Settings are optional: a backup taken before this section existed still restores
        // its holdings rather than being refused outright.
        if (parsed.data.settings) await replaceSettings(parsed.data.settings)
        if (parsed.data.cards) await replaceCards(parsed.data.cards)
        if (parsed.data.articles) await replaceArticles(parsed.data.articles)
        return ok(
          {
            action: 'importUserData' as const,
            performed: true,
            message: rollback
              ? `Imported from ${sourcePath}. Rollback copy: ${rollback}`
              : `Imported from ${sourcePath}.`,
            path: sourcePath,
          },
          SETTINGS_SOURCE,
        )
      } catch (error) {
        return maintenanceFailure('importUserData', error)
      }
    })
  },

  async clearUserData() {
    return withAutomaticBackup(async () => {
      try {
        const rollback = await clearUserData()
        await clearCards()
        // Cached market data outlives the book it was fetched for, so drop it too.
        await cache.clear()
        await clearLatestSignals()
        await clearLatestQuant()
        await clearCalendarCaches()
        await clearSecCaches()
        await clearUpDownCaches()
        await clearRiskFreeCache()
        await clearEconomicCache()
        await clearMoneyCache()
        await clearInstitutionCaches()
        await clearYouTubeCache()
        await clearIpoCache()
        await clearPoliticsCache()
        return ok(
          {
            action: 'clearUserData' as const,
            performed: true,
            message: rollback
              ? `Cleared all holdings, personal finance and cards. Rollback copy: ${rollback}`
              : 'Cleared all holdings, personal finance and cards.',
            path: rollback,
          },
          SETTINGS_SOURCE,
        )
      } catch (error) {
        return maintenanceFailure('clearUserData', error)
      }
    })
  },

  async resetCache() {
    try {
      await cache.clear()
      await clearLatestSignals()
      await clearLatestQuant()
      await clearCalendarCaches()
      await clearSecCaches()
      await clearUpDownCaches()
      await clearRiskFreeCache()
      await clearEconomicCache()
      await clearMoneyCache()
      await clearInstitutionCaches()
      await clearYouTubeCache()
      await clearIpoCache()
      await clearPoliticsCache()
      return ok(
        {
          action: 'resetCache' as const,
          performed: true,
          message: 'Cached market data cleared. Saved user data was not changed.',
          path: '',
        },
        SETTINGS_SOURCE,
      )
    } catch (error) {
      return maintenanceFailure('resetCache', error)
    }
  },
}

/** Preserve source provenance through every provider entrypoint, including nested caches. */
export const yahooProvider: MarketDataProvider = new Proxy(providerImplementation, {
  get(target, property, receiver) {
    const method = Reflect.get(target, property, receiver)
    if (typeof method !== 'function') return method
    return (...args: unknown[]) => withSourceEnvelope(() => method.apply(target, args))
  },
})
