import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'

import type {
  AnalyticsPayload,
  AnalyticsRequest,
  AppSettings,
  AppSettingsMutation,
  ChartPayload,
  ChartRequest,
  Envelope,
  MaintenanceAction,
  MaintenanceResult,
  FxPayload,
  FxRequest,
  GlobalMarketsPayload,
  GlobalMarketsRequest,
  PreMarketPayload,
  PreMarketRequest,
  TradingVolumesPayload,
  TradingVolumesRequest,
  MomentumPayload,
  MomentumRequest,
  OptionQuotesPayload,
  OptionQuotesRequest,
  ReturnsPayload,
  ReturnsRequest,
  FundamentalsPayload,
  FundamentalsRequest,
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
import { describeError, err, failed, ok, partial } from '../shared/envelope.js'
import { cache } from './cache.js'
import { FX_SOURCE, getFxRate } from './fx.js'
import {
  clearUserData,
  exportUserData,
  importUserData,
  mutatePersonalFinance,
  mutatePortfolios,
  readPersonalFinance,
  readPortfolios,
} from './portfolioStore.js'
import {
  exportSettings,
  mutateSettings,
  readSettings,
  replaceSettings,
  settingsPath,
} from './settingsStore.js'
import { getChart } from './yahoo/chart.js'
import { getFundamentals } from './yahoo/fundamentals.js'
import { getGlobalMarkets } from './yahoo/globalMarkets.js'
import { getPreMarket, PRE_MARKET_SOURCE } from './yahoo/preMarket.js'
import { getTradingVolumes, TRADING_VOLUMES_SOURCE } from './yahoo/tradingVolumes.js'
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
import { getQuotes } from './yahoo/quotes.js'
import { getTargets } from './yahoo/targets.js'

/**
 * The seam the renderer talks to.
 *
 * Everything below is Yahoo-over-Node today. When the Python-heavy pages arrive, a
 * second implementation backed by a FastAPI sidecar can satisfy this same interface
 * and the renderer will not notice.
 */
export interface MarketDataProvider {
  quotes(request: QuotesRequest): Promise<Envelope<QuotesPayload>>
  chart(request: ChartRequest): Promise<Envelope<ChartPayload>>
  options(request: OptionsRequest): Promise<Envelope<OptionsPayload>>
  targets(request: TargetsRequest): Promise<Envelope<TargetsPayload>>
  news(request: NewsRequest): Promise<Envelope<NewsPayload>>
  newsPage(request: NewsPageRequest): Promise<Envelope<NewsPagePayload>>
  newsTickerSearch(request: NewsTickerSearchRequest): Promise<Envelope<NewsTickerSearchPayload>>
  newsArticle(request: NewsPreviewRequest): Promise<Envelope<NewsPreviewPayload>>
  newsThumbnail(request: NewsThumbnailRequest): Promise<Envelope<NewsThumbnailPayload>>
  fundamentals(request: FundamentalsRequest): Promise<Envelope<FundamentalsPayload>>
  returns(request: ReturnsRequest): Promise<Envelope<ReturnsPayload>>
  momentum(request: MomentumRequest): Promise<Envelope<MomentumPayload>>
  analytics(request: AnalyticsRequest): Promise<Envelope<AnalyticsPayload>>
  optionQuotes(request: OptionQuotesRequest): Promise<Envelope<OptionQuotesPayload>>
  portfolio(): Promise<Envelope<PortfolioPayload>>
  mutatePortfolio(mutation: PortfolioMutation): Promise<Envelope<PortfolioPayload>>
  personalFinance(): Promise<Envelope<PersonalFinancePayload>>
  mutatePersonalFinance(
    mutation: PersonalFinanceMutation,
  ): Promise<Envelope<PersonalFinancePayload>>
  fx(request: FxRequest): Promise<Envelope<FxPayload>>
  globalMarkets(request: GlobalMarketsRequest): Promise<Envelope<GlobalMarketsPayload>>
  preMarket(request: PreMarketRequest): Promise<Envelope<PreMarketPayload>>
  tradingVolumes(request: TradingVolumesRequest): Promise<Envelope<TradingVolumesPayload>>
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

const SETTINGS_SOURCE = 'settings store'

/**
 * The backup envelope written by Export and demanded by Import.
 *
 * The reference splits its backup across three files because it has Cards and Virtual
 * Trading to carry; this app has one store and one settings file, so one document holds
 * both. `app` is checked on the way back in so an unrelated JSON file is refused with a
 * sentence rather than half-applied.
 */
const BACKUP_APP_ID = 'budget-terminal-electron'
const BACKUP_VERSION = 1

const backupSchema = z.object({
  app: z.string().catch(''),
  version: z.number().catch(0),
  exportedAt: z.string().catch(''),
  userData: z.unknown(),
  settings: z.unknown().optional(),
})

const emptySettings: AppSettings = {
  clockCountry: DEFAULT_CLOCK_COUNTRY,
  time12h: true,
  tabOrder: TABS.map((tab) => tab.id),
  hiddenTabs: [],
  obscuredTabs: [...DEFAULT_OBSCURED_TABS],
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

export const yahooProvider: MarketDataProvider = {
  async quotes({ holdings }) {
    const macroSymbols = MACRO_SYMBOLS.map((entry) => entry.symbol)
    const batch = await getQuotes([...macroSymbols, ...holdings])

    const macro: QuotesPayload['macro'] = {}
    for (const entry of MACRO_SYMBOLS) {
      const quote = batch.quotes[entry.symbol]
      if (quote) macro[entry.label] = quote
    }
    const holdingQuotes: QuotesPayload['holdings'] = {}
    for (const symbol of holdings.map((s) => s.toUpperCase())) {
      const quote = batch.quotes[symbol]
      if (quote) holdingQuotes[symbol] = quote
    }

    const payload: QuotesPayload = {
      macro,
      holdings: holdingQuotes,
      missing: batch.missing,
    }
    if (!batch.errors.length) return ok(payload, 'yahoo quotes')
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
    const exposure = computeExposure(held.length + (cashAmount > 0 ? 1 : 0), currentValues)
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
      const batch = await getClosesBatch(
        held.map((position) => position.ticker),
        lookback,
        force,
      )
      const { series, included, excluded } = buildPortfolioSeries(held, batch.closes, cashAmount)
      if (series.dates.length < 2) {
        return ok({ ...base, excludedTickers: excluded, reason: 'No common historical window' })
      }
      // The benchmark is optional: without it alpha and beta are omitted and everything
      // else still computes.
      const benchmark = await getCloses(benchmarkSymbol, lookback, force).catch(() => null)
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
      return ok(await getOptionQuotes(request), 'yahoo options')
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
    try {
      return ok(await mutatePortfolios(mutation), 'portfolio store')
    } catch (error) {
      // A rejected edit (duplicate ticker, last portfolio, portfolio cap) is a normal
      // outcome, so return the unchanged document with the reason attached rather than
      // throwing across the IPC boundary.
      const reason = describeError(error)
      const current = await readPortfolios().catch(() => emptyPortfolio)
      return partial(
        current,
        [err('portfolio store', reason, mutation.type)],
        'portfolio store',
        reason,
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
    try {
      return ok(await mutatePersonalFinance(mutation), 'portfolio store')
    } catch (error) {
      // Same contract as the portfolio writes: a refused edit (blank description, row
      // cap, a row someone else already deleted) is a normal outcome, so the unchanged
      // section comes back with the reason attached.
      const reason = describeError(error)
      const current = await readPersonalFinance().catch(() => emptyFinance)
      return partial(
        current,
        [err('portfolio store', reason, mutation.type)],
        'portfolio store',
        reason,
      )
    }
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

  async settings() {
    try {
      return ok(await readSettings(), SETTINGS_SOURCE)
    } catch (error) {
      return failed(emptySettings, describeError(error), SETTINGS_SOURCE)
    }
  },

  async mutateSettings(mutation) {
    try {
      return ok(await mutateSettings(mutation), SETTINGS_SOURCE)
    } catch (error) {
      // Same contract as the portfolio writes: hiding Settings, or moving a tab past
      // the end of the list, comes back as the unchanged document plus a reason.
      const reason = describeError(error)
      const current = await readSettings().catch(() => emptySettings)
      return partial(current, [err(SETTINGS_SOURCE, reason, mutation.type)], SETTINGS_SOURCE, reason)
    }
  },

  async exportUserData(targetPath) {
    try {
      const bundle = {
        app: BACKUP_APP_ID,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        userData: await exportUserData(),
        settings: await exportSettings(),
      }
      await writeFile(targetPath, JSON.stringify(bundle, null, 2), 'utf8')
      return ok(
        {
          action: 'exportUserData' as const,
          performed: true,
          message: `Exported holdings, personal finance and settings to ${targetPath}`,
          path: targetPath,
        },
        SETTINGS_SOURCE,
      )
    } catch (error) {
      return maintenanceFailure('exportUserData', error)
    }
  },

  async importUserData(sourcePath) {
    try {
      const parsed = backupSchema.safeParse(JSON.parse(await readFile(sourcePath, 'utf8')))
      if (!parsed.success || parsed.data.app !== BACKUP_APP_ID) {
        throw new Error('That file is not a Budget Terminal backup.')
      }
      const rollback = await importUserData(parsed.data.userData)
      // Settings are optional: a backup taken before this section existed still restores
      // its holdings rather than being refused outright.
      if (parsed.data.settings) await replaceSettings(parsed.data.settings)
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
  },

  async clearUserData() {
    try {
      const rollback = await clearUserData()
      // Cached market data outlives the book it was fetched for, so drop it too.
      cache.clear()
      return ok(
        {
          action: 'clearUserData' as const,
          performed: true,
          message: rollback
            ? `Cleared all holdings and personal finance. Rollback copy: ${rollback}`
            : 'Cleared all holdings and personal finance.',
          path: rollback,
        },
        SETTINGS_SOURCE,
      )
    } catch (error) {
      return maintenanceFailure('clearUserData', error)
    }
  },

  async resetCache() {
    try {
      cache.clear()
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
