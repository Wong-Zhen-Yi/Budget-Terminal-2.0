/**
 * The IPC contract shared verbatim by the Electron main process and the renderer.
 *
 * Every handler answers with an `Envelope<T>`: the payload plus freshness metadata and
 * the non-fatal errors that came with it. This mirrors `attach_market_data_result` in
 * the PySide6 app (`data_service/results.py`) so a panel whose upstream call failed
 * degrades on its own instead of blanking the page.
 */

import type { ForexRequest, ForexPairRequest, ForexHistoryRequest, ForexQuotesPayload, ForexHistoryPayload, ForexNewsPayload } from './forex.js'

export type Freshness = 'fresh' | 'cached' | 'stale' | 'partial' | 'failed'

export interface EnvelopeMeta {
  source: string
  freshness: Freshness
  fetchedAt: number
  cacheAgeSeconds?: number
  failureReason?: string
}

export interface EnvelopeError {
  source: string
  reason: string
  operation: string
  /**
   * The symbol the failure belongs to — or, on the pages whose panels share one envelope,
   * the block label that panel looks itself up by (`warningOf` on Pre-Market and News).
   */
  symbol?: string
}

export interface Envelope<T> {
  data: T
  meta: EnvelopeMeta
  errors: EnvelopeError[]
}

/* ------------------------------------------------------------------ quotes */

/** One quote derived from the last two daily closes, like `price_payload` in the PySide6 app. */
export interface Quote {
  symbol: string
  price: number
  /** Percent change against the previous close. */
  change: number
  /** Absolute change against the previous close. */
  absChange: number
}

/** The five macro readings across the top of the dashboard, keyed by display name. */
export type MacroQuotes = Record<string, Quote>

export interface QuotesPayload {
  macro: MacroQuotes
  holdings: Record<string, Quote>
  missing: string[]
}

/* --------------------------------------------------------------- portfolio */

export interface Holding {
  ticker: string
  shares: number
  avgPrice: number
  includeInWeight: boolean
}

export interface Portfolio {
  id: string
  name: string
  tickers: string[]
  holdings: Record<string, Holding>
  cashBalance: number
  marginDebt: number
  options: OptionPosition[]
  /** Whether brokerage cash counts toward weight, the summary total and allocation views. */
  includeCashInWeight: boolean
  /** True for the virtual Combined aggregate, which cannot be edited. */
  readOnly: boolean
}

export interface PortfolioPayload {
  portfolios: Portfolio[]
  activeId: string | null
  /** The portfolio treated as "main" — what the Dashboard opens on. */
  mainId: string | null
  /** Absolute path of the store, surfaced in the status bar. */
  sourcePath: string
}

/** The id of the virtual aggregate across every portfolio. */
export const COMBINED_PORTFOLIO_ID = 'combined'
export const MAX_PORTFOLIOS = 5

/**
 * Every write the Portfolio page can make. One channel takes the union and answers with
 * the whole re-read document, so the renderer never guesses at post-write state.
 */
export type PortfolioMutation =
  | { type: 'setActive'; id: string }
  | { type: 'setMain'; id: string }
  | { type: 'create'; name?: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete'; id: string }
  | { type: 'reorder'; order: string[] }
  | { type: 'addPosition'; portfolioId: string; ticker: string }
  | { type: 'removePosition'; portfolioId: string; ticker: string }
  | {
      type: 'setPosition'
      portfolioId: string
      ticker: string
      shares?: number
      avgPrice?: number
      includeInWeight?: boolean
    }
  | { type: 'setCash'; portfolioId: string; cashBalance: number }
  | { type: 'setMargin'; portfolioId: string; marginDebt: number }
  | { type: 'setIncludeCash'; portfolioId: string; includeCashInWeight: boolean }
  | OptionMutation

/* -------------------------------------------------------------------- cards */

export const CARD_INTERVALS = ['1d', '30d', '1y'] as const
export type CardInterval = (typeof CARD_INTERVALS)[number]
export type CardWeighting = 'equal' | 'custom'
export type CardResolvedWeighting = CardWeighting | 'portfolio' | 'equal_fallback'

export interface CustomCard {
  id: string
  name: string
  symbols: string[]
  weighting: CardWeighting
  weights: Record<string, number>
}

/** The Cards page's separate, app-owned strategies document. */
export interface CardsPayload {
  version: number
  starterCardsVersion: number
  customCards: CustomCard[]
  cardOrder: string[]
  hiddenPortfolioIds: string[]
  intervals: Record<string, CardInterval>
  sourcePath: string
}

export type CardsMutation =
  | {
      type: 'add'
      name: string
      symbols: string[]
      weighting: CardWeighting
      weights: Record<string, number>
    }
  | {
      type: 'update'
      id: string
      name: string
      symbols: string[]
      weighting: CardWeighting
      weights: Record<string, number>
    }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; order: string[] }
  | { type: 'setPortfolioVisible'; portfolioId: string; visible: boolean }
  | { type: 'setInterval'; id: string; interval: CardInterval }

export interface CardPerformanceInput {
  id: string
  symbols: string[]
  weighting: CardResolvedWeighting
  weights: Record<string, number>
  shares: Record<string, number>
  cashBalance: number
}

export interface CardPerformance {
  values: number[]
  returnPct: number
  points: number
  includedSymbols: string[]
  missingSymbols: string[]
  weights: Record<string, number>
  weighting: CardResolvedWeighting
  weightingLabel: string
  source: string
  interval: CardInterval
}

/**
 * Every request the startup warm-up in `src/api/prefetch.ts` can issue carries this.
 *
 * A request marked `background` runs in the rate gate's background lane
 * (`electron/services/yahoo/rateGate.ts`), so a page the user opens while the warm-up is
 * still fanning out is served first instead of queueing behind a hundred of its requests.
 * It describes *scheduling*, never the answer, so it must stay out of every main-process
 * cache key — a warmed payload and a user-requested one are the same entry.
 */
export interface BackgroundRequest {
  background?: boolean
}

export interface CardsPerformanceRequest extends BackgroundRequest {
  interval: CardInterval
  cards: CardPerformanceInput[]
  force?: boolean
}

export interface CardsPerformancePayload {
  interval: CardInterval
  results: Record<string, CardPerformance>
}

/* --------------------------------------------------------- option tracker */

export interface OptionPosition {
  rowId: string
  ticker: string
  strategy: string
  expiry: string
  strike: number
  contracts: number
  premium: number
  status: string
  openDate: string
  /** Live values, refreshed from Yahoo rather than stored. */
  currentPrice: number
  volume: number
  openInterest: number
  impliedVolatility: number
}

export type OptionMutation =
  | { type: 'addOption'; portfolioId: string }
  | { type: 'removeOption'; portfolioId: string; rowId: string }
  | { type: 'setOption'; portfolioId: string; rowId: string; patch: Partial<OptionPosition> }

/* ------------------------------------------------------- personal finance */

/**
 * The Personal Finance page's own book, ported from the PySide6 `net_worth` payload.
 *
 * Cash and debt rows are natively SGD; portfolios and brokerage accounts are natively
 * USD. `totalsCurrency` picks the display currency for the aggregate views only — the
 * cash and debt tables always print SGD, exactly as the reference does.
 */
export type FinanceCurrency = 'SGD' | 'USD'
export type BillFrequency = 'monthly' | 'yearly'
export type FinanceCategory = 'cash' | 'debt'

export interface FinanceEntry {
  /** Ours, not the reference's: it addresses rows by table index, which cannot survive
   * React reconciliation or the table's sort freeze. */
  id: string
  desc: string
  /** Always SGD. */
  amount: number
}

export interface RecurringBill {
  id: string
  desc: string
  amount: number
  frequency: BillFrequency
  currency: FinanceCurrency
}

export interface FinanceGoal {
  title: string
  targetAmount: number
  /** Independent of `totalsCurrency`, like the reference's separate goal combo. */
  currency: FinanceCurrency
}

export interface PersonalFinancePayload {
  cash: FinanceEntry[]
  debt: FinanceEntry[]
  recurringBills: RecurringBill[]
  totalsCurrency: FinanceCurrency
  goal: FinanceGoal
  /** Absolute path of the store, surfaced in the status bar. */
  sourcePath: string
}

export const MAX_FINANCE_ROWS = 40
export const MAX_ENTRY_DESC = 80
export const MAX_GOAL_TITLE = 64

/** Every write the Personal Finance page can make, answered with the whole section. */
export type PersonalFinanceMutation =
  | { type: 'addEntry'; category: FinanceCategory }
  | { type: 'setEntry'; category: FinanceCategory; id: string; desc?: string; amount?: number }
  | { type: 'removeEntry'; category: FinanceCategory; id: string }
  | { type: 'addBill' }
  | {
      type: 'setBill'
      id: string
      desc?: string
      amount?: number
      frequency?: BillFrequency
      currency?: FinanceCurrency
    }
  | { type: 'removeBill'; id: string }
  | { type: 'setTotalsCurrency'; currency: FinanceCurrency }
  | { type: 'setGoal'; title?: string; targetAmount?: number; currency?: FinanceCurrency }

/* ----------------------------------------------------------------- YouTube */

export interface YouTubeVideo {
  videoId: string
  ticker: string
  title: string
  channel: string
  viewCount: number | null
  viewCountText: string
  publishedText: string
  publishedDays: number | null
  publishedDaysText: string
  durationText: string
  url: string
  thumbnailUrl: string
  descriptionSnippet: string
}

export interface YouTubePayload {
  items: YouTubeVideo[]
  warnings: string[]
  fetchedAt: number
  fromCacheCount: number
  fetchedCount: number
  tickersTotal: number
}

export interface YouTubeRequest extends BackgroundRequest {
  tickers: string[]
  force?: boolean
}

export interface YouTubeThumbnailRequest {
  videoId: string
  thumbnailUrl: string
}

export interface YouTubeThumbnailPayload {
  dataUri: string
  resolvedUrl: string
}

export interface YouTubePageSettings {
  /** -1 follows the reference's newest-first default; 0-6 address the table columns. */
  sortColumn: number
  sortDescending: boolean
}

/* ----------------------------------------------------------- institutions */

export type InstitutionActivitySide = 'buy' | 'sell'

export interface InstitutionActivityRow {
  period: string
  manager: string
  managerId: string
  symbol: string
  company: string
  activity: string
  action: string
  side: InstitutionActivitySide
  shareChange: string
  shareChangeValue: number
  approxFlow: string
  approxFlowValue: number
  holdPrice: string
  changeToPortfolio: string
  changeToPortfolioPct: number
  sourceUrl: string
  historyUrl: string
}

export interface InstitutionManagerRow {
  manager: string
  managerId: string
  period: string
  buyCount: number
  sellCount: number
  topActivity: string[]
  sourceUrl: string
}

export interface InstitutionActivityPayload {
  periods: string[]
  activePeriod: string
  buyRows: InstitutionActivityRow[]
  sellRows: InstitutionActivityRow[]
  managerRows: InstitutionManagerRow[]
  sourceUrls: { activity: string }
  warnings: string[]
  fetchedAt: string
}

export interface InstitutionTickerActivityPayload {
  symbol: string
  company: string
  sector: string
  periods: string[]
  activePeriod: string
  activityRows: InstitutionActivityRow[]
  sourceUrls: { activity: string }
  warnings: string[]
  fetchedAt: string
}

export interface InstitutionActivityRequest extends BackgroundRequest {
  limit?: number
  quarter?: string
  force?: boolean
}

export interface InstitutionTickerActivityRequest {
  symbol: string
  force?: boolean
}

export interface FxPayload {
  /** SGD per 1 USD, or null when Yahoo gave nothing usable. */
  usdSgd: number | null
  source: string
  /** Epoch milliseconds of the reading. */
  collectedAt: number
}

/* ---------------------------------------------------------------- settings */

/** One top-bar clock market, from `CLOCK_COUNTRY_CHOICES` in the PySide6 `constants.py`. */
export interface ClockCountry {
  code: string
  name: string
  /** IANA zone name, handed straight to `Intl.DateTimeFormat`. */
  zone: string
}

export const CLOCK_COUNTRIES: ReadonlyArray<ClockCountry> = [
  { code: 'US', name: 'United States', zone: 'America/New_York' },
  { code: 'SG', name: 'Singapore', zone: 'Asia/Singapore' },
  { code: 'CA', name: 'Canada', zone: 'America/Toronto' },
  { code: 'GB', name: 'United Kingdom', zone: 'Europe/London' },
  { code: 'DE', name: 'Germany', zone: 'Europe/Berlin' },
  { code: 'FR', name: 'France', zone: 'Europe/Paris' },
  { code: 'CH', name: 'Switzerland', zone: 'Europe/Zurich' },
  { code: 'JP', name: 'Japan', zone: 'Asia/Tokyo' },
  { code: 'HK', name: 'Hong Kong', zone: 'Asia/Hong_Kong' },
  { code: 'AU', name: 'Australia', zone: 'Australia/Sydney' },
  { code: 'NZ', name: 'New Zealand', zone: 'Pacific/Auckland' },
]

export const DEFAULT_CLOCK_COUNTRY = 'US'

/**
 * Settings is the one tab that can never be hidden or obscured, matching
 * `SETTINGS_PAGE_INDEX` in the reference — hiding the page that owns the visibility
 * controls would leave no way back.
 */
export const SETTINGS_TAB_ID = 'settings'

/** `DEFAULT_PRIVACY_SETTINGS` is `{'obscured_pages': [2]}`, and page 2 is Personal Finance. */
export const DEFAULT_OBSCURED_TABS: ReadonlyArray<string> = ['personal-finance']

/**
 * Everything the Settings page owns. Kept in its own file rather than the holdings
 * store, the way the reference keeps `app_config.json` apart from `user_data.json`.
 */
export interface AppSettings {
  /** Market country whose zone the top-bar clock prints. */
  clockCountry: string
  time12h: boolean
  /** Every tab id, in navigation order. */
  tabOrder: string[]
  /** Tab ids kept out of the strip. Never contains `SETTINGS_TAB_ID`. */
  hiddenTabs: string[]
  /** Tab ids the Obscure button blurs and locks. */
  obscuredTabs: string[]
  /** Persisted controls for the standalone Backtest page. */
  backtestPage: BacktestPageSettings
  /** Persisted setup, status and search controls for Day Trading. */
  signalsPage: SignalsPageSettings
  /** Persisted tab/filter/input controls for the Quant workspace. */
  quantPage: QuantPageSettings
  /** Persisted table sort for the portfolio YouTube feed. */
  youtubePage: YouTubePageSettings
  /** Absolute path of the settings file, surfaced on the page. */
  sourcePath: string
}

/** Every write the Settings page can make, answered with the whole re-read document. */
export type AppSettingsMutation =
  | { type: 'setClockCountry'; code: string }
  | { type: 'setTime12h'; value: boolean }
  | { type: 'setTabHidden'; id: string; hidden: boolean }
  | { type: 'moveTab'; id: string; direction: -1 | 1 }
  | { type: 'resetNavigation' }
  | { type: 'setTabObscured'; id: string; obscured: boolean }
  | { type: 'setBacktestPage'; value: BacktestPageSettings }
  | { type: 'setSignalsPage'; value: SignalsPageSettings }
  | { type: 'setQuantPage'; value: QuantPageSettings }
  | { type: 'setYouTubePage'; value: YouTubePageSettings }

/** The four User Data buttons. Each one prompts in the renderer before it is sent. */
export type MaintenanceAction =
  | 'exportUserData'
  | 'importUserData'
  | 'clearUserData'
  | 'resetCache'

export interface MaintenanceResult {
  action: MaintenanceAction
  /** False when the user dismissed the file dialog, so nothing was read or written. */
  performed: boolean
  message: string
  /** The file the action touched, where there was one. */
  path: string
}

/* ------------------------------------------------------------ fundamentals */

/** Per-ticker facts the positions table needs beyond a quote. */
export interface Fundamentals {
  ticker: string
  quoteType: string
  /** Market cap for equities, assets under management for funds. */
  size: number | null
  sizeType: 'marketCap' | 'aum' | null
  targetMeanPrice: number | null
}

export interface FundamentalsPayload {
  fundamentals: Record<string, Fundamentals>
}

/** The fixed statement series behind the migrated Fundamentals workspace. */
export const FUNDAMENTAL_SERIES_KEYS = [
  'revenue',
  'netIncome',
  'operatingCashFlow',
  'freeCashFlow',
  'sharesOutstanding',
  'cashAndBonds',
  'totalDebt',
  'sellingGeneralAdmin',
  'researchDevelopment',
] as const
export type FundamentalSeriesKey = (typeof FUNDAMENTAL_SERIES_KEYS)[number]

export type FundamentalPointSource = 'sec' | 'yahoo' | 'derived'

export interface FundamentalSeriesPoint {
  /** ISO fiscal period end. */
  endDate: string
  /** Calendar label used for chart alignment: YYYY or YYYY-Qn. */
  label: string
  value: number
  source: FundamentalPointSource
}

export type FundamentalSeriesMap = Record<FundamentalSeriesKey, FundamentalSeriesPoint[]>

export interface FundamentalsPageCompany {
  name: string
  exchange: string
  sector: string
  industry: string
  currency: string
  website: string
  irWebsite: string
}

/** Raw inputs for the ten reference headline calculations. */
export interface FundamentalsPageFacts {
  trailingPe: number | null
  forwardPe: number | null
  priceToSales: number | null
  pegRatio: number | null
  earningsGrowth: number | null
  enterpriseValue: number | null
  ebitda: number | null
  marketCap: number | null
  totalRevenue: number | null
  freeCashFlow: number | null
  totalCash: number | null
  totalDebt: number | null
  sharesOutstanding: number | null
  beta: number | null
  currentPrice: number | null
}

export interface SecFiling {
  form: string
  filedDate: string
  reportPeriod: string
  description: string
  items: string
  accessionNumber: string
  documentUrl: string
}

export type SecFreshness = 'fresh' | 'cached' | 'stale' | 'failed' | 'unavailable'

export interface FundamentalsSecMetadata {
  available: boolean
  statementsAvailable: boolean
  cik: string
  freshness: SecFreshness
  statementFreshness: SecFreshness
  cacheAgeSeconds: number
  filings: SecFiling[]
  warnings: string[]
}

export interface FundamentalsPagePayload {
  symbol: string
  company: FundamentalsPageCompany
  facts: FundamentalsPageFacts
  annual: FundamentalSeriesMap
  quarterly: FundamentalSeriesMap
  sec: FundamentalsSecMetadata
  warnings: string[]
  generatedAt: number
}

/* ------------------------------------------------------------------- chart */

export interface Candle {
  /** Seconds since the epoch. lightweight-charts wants seconds, not milliseconds. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ChartStats {
  symbol: string
  price: number
  change: number
  absChange: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  currency: string
  longName: string
}

export interface IndicatorPoint {
  time: number
  value: number
}

export interface ChartPayload {
  symbol: string
  timeframe: TimeframeLabel
  interval: string
  candles: Candle[]
  stats: ChartStats | null
  indicators: {
    ma200: IndicatorPoint[]
    rsi: IndicatorPoint[]
    rsiMa: IndicatorPoint[]
  }
}

/* ------------------------------------------------------------ charts page */

export const CHARTS_INTERVALS = [
  '1 Minute',
  '5 Minutes',
  '15 Minutes',
  '1 Hour',
  '4 Hours',
  '1 Day',
  '1 Week',
  '1 Month',
] as const
export type ChartsInterval = (typeof CHARTS_INTERVALS)[number]

export const CHARTS_RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'Max'] as const
export type ChartsRange = (typeof CHARTS_RANGES)[number]
export type ChartsCompareInterval = '1 Day' | '1 Week'
export type ChartsCompareRange = '5Y' | '3Y' | '1Y' | 'YTD' | '3M' | '1M'
export type ChartsRelationshipRange = '1M' | '3M' | '6M' | '1Y' | '5Y' | 'Max'
export type ChartsRollingWindow = 30 | 60 | 120 | 252

export interface ChartsHistoryRequest {
  symbol: string
  interval: ChartsInterval
  range: ChartsRange
  force?: boolean
}

export interface ChartsHistoryPayload {
  symbol: string
  intervalLabel: ChartsInterval
  rangeLabel: ChartsRange
  interval: string
  candles: Candle[]
  stats: ChartStats | null
  indicators: ChartPayload['indicators']
}

export interface ChartsCompareRequest {
  symbols: string[]
  interval: ChartsCompareInterval
  range: ChartsCompareRange
  force?: boolean
}

export interface ChartsSeriesPoint {
  time: number
  close: number
}

export interface ChartsComparePayload {
  symbols: string[]
  interval: ChartsCompareInterval
  range: ChartsCompareRange
  series: Record<string, ChartsSeriesPoint[]>
  missing: string[]
}

export interface ChartsRelationshipRequest {
  symbols: [string, string]
  range: ChartsRelationshipRange
  rollingWindow: ChartsRollingWindow
  force?: boolean
}

export interface ChartsRelationshipPoint {
  time: number
  date: string
  leftClose: number
  rightClose: number
  leftIndexed: number
  rightIndexed: number
  ratio: number
  leftReturnPct: number | null
  rightReturnPct: number | null
  rollingCorrelation: number | null
  rollingSample: number
}

export interface ChartsRelationshipStats {
  latestRatio: number | null
  latestCorrelation: number | null
  latestCorrelationSample: number
  beta: number | null
  alphaDailyPct: number | null
  r: number | null
  rSquared: number | null
  stdErrorPct: number | null
  observations: number
}

export interface ChartsRelationshipPayload {
  symbols: [string, string]
  range: ChartsRelationshipRange
  rollingWindow: ChartsRollingWindow
  points: ChartsRelationshipPoint[]
  regressionLine: Array<{ x: number; y: number }>
  stats: ChartsRelationshipStats
  missing: string[]
}

/* ----------------------------------------------------------------- options */

export type OptionBucketKey = '0_week' | '2_weeks' | '4_weeks'

export interface OptionRow {
  ticker: string
  type: 'Call' | 'Put'
  strike: number
  expiration: string
  lastPrice: number
  volume: number
  openInterest: number
  impliedVolatility: number
  inTheMoney: boolean
}

export interface OptionBucket {
  key: OptionBucketKey
  label: string
  expiration: string
  rows: OptionRow[]
}

export interface OptionsPayload {
  symbol: string
  buckets: OptionBucket[]
}

/* ----------------------------------------------------------------- targets */

export interface TargetRow {
  ticker: string
  current: number | null
  target: number | null
  /** Percent upside, or null when either side is missing. */
  upside: number | null
  /** Why a target is absent: `etf` never has one, `unavailable` means the provider refused. */
  unavailableReason: '' | 'etf' | 'unavailable'
}

export interface TargetsPayload {
  targets: TargetRow[]
}

/* -------------------------------------------------------------------- news */

export interface NewsItem {
  id: string
  ticker: string
  title: string
  source: string
  publishedAt: number
  url: string
}

/* ------------------------------------------------------------------- stocks */

export const STOCKS_RANGE_PRESETS = ['1M', '3M', '6M', '1Y', '3Y'] as const
export type StocksRangePreset = '' | (typeof STOCKS_RANGE_PRESETS)[number]

export interface StocksMetrics {
  marketCap: string
  revenue: string
  netIncome: string
  eps: string
  grossMargin: string
  operatingMargin: string
  netMargin: string
  sharesOutstanding: string
  pe: string
  forwardPe: string
  dividend: string
  exDividendDate: string
  volume: string
  beta: string
  earningsDate: string
}

export interface StocksTargets {
  low: string
  mean: string
  high: string
  upsideToMean: string
  upsidePct: number | null
  analysts: string
}

export interface StocksCompany {
  name: string
  exchange: string
  sector: string
  industry: string
  description: string
}

export interface StocksNewsRow extends NewsItem {}

export interface StocksInstitutionalRow {
  holder: string
  pctHeld: string
  shares: string
  value: string
  pctChange: string
  reported: string
}

export interface StocksInsiderRow {
  date: string
  insider: string
  title: string
  transaction: string
  shares: string
  value: string
}

export interface StocksChartPayload {
  candles: Candle[]
  stats: ChartStats
  mfi: IndicatorPoint[]
}

export interface StocksPayload {
  symbol: string
  company: StocksCompany
  metrics: StocksMetrics
  targets: StocksTargets
  chart: StocksChartPayload
  news: StocksNewsRow[]
  institutional: StocksInstitutionalRow[]
  insiders: StocksInsiderRow[]
  /** Optional blocks whose live request failed. Empty data is not itself a failure. */
  missing: string[]
  generatedAt: number
}

export interface StocksRequest extends BackgroundRequest {
  symbol: string
  force?: boolean
}

export interface NewsPayload {
  items: NewsItem[]
}

/* --------------------------------------------------------------- news page */

/**
 * The News page's own types. `NewsItem` above stays as it is: the Dashboard panel binds
 * to it, and the two fetch paths agree on almost nothing — `newsCount` 10 vs 8, a two-per
 * -ticker cap vs none, one lane vs three. Widening one shape to cover both would give
 * `NewsPanel` fields it has no column for.
 */
export type NewsCategory = 'portfolio' | 'macro' | 'other' | 'search'

export interface NewsArticle {
  /** `_p34_article_key`: the url when there is one, else title|source|time. Stable across
   *  refetches, so it is both the React key and the selection identity. */
  id: string
  /** `'AAPL'`, `'AAPL, MSFT'` (first three) or `'OTHER'`, as `_parse_rss_item` builds it. */
  ticker: string
  title: string
  source: string
  /** `HH:MM` local, the reference's `time` field. The export prints it. */
  time: string
  url: string
  category: NewsCategory
  /** Epoch **milliseconds**. The reference stores seconds in `_ts`; this contract is
   *  milliseconds everywhere outside `Candle`. 0 when nothing parsed. */
  publishedAt: number
  /** `_trader_score`, or **null** on the Yahoo lanes, which the reference leaves unscored.
   *  Null is not zero: `_p34_filtered_groups` sorts scored articles above unscored ones
   *  under Signal, which only a nullable field can reproduce. */
  score: number | null
  /** `_signal_tags`, already sorted and de-duplicated. */
  signals: string[]
  /** Publisher thumbnail as the feed gave it. The renderer never fetches this — the CSP is
   *  `img-src 'self' data:`, so `news:thumbnail` proxies it into a `data:` URI. */
  imageUrl: string
  /** RSS `description`; the reader pane's fallback body. Empty on the Yahoo lanes. */
  summary: string
}

export type NewsLaneKey = 'portfolio' | 'macro' | 'other'

/** Per-lane coverage, from `_news_fetch_status` and `_news_refresh_meta`. */
export interface NewsLaneStatus {
  lane: NewsLaneKey
  /** Section label the page's `warningOf` looks up, e.g. 'Portfolio Spotlight'. */
  label: string
  fresh: string[]
  stale: string[]
  failed: string[]
}

export interface NewsPagePayload {
  /** portfolio, then macro, then the diverse `other` selection — the merge order is the
   *  dedupe priority, exactly as `_collect_news_page_payload` builds it. */
  articles: NewsArticle[]
  lanes: NewsLaneStatus[]
  counts: { portfolio: number; macro: number; other: number }
  /** Epoch ms; the page prints it beside the source. */
  generatedAt: number
}

export interface NewsPageRequest extends BackgroundRequest {
  tickers: string[]
  force?: boolean
}

export interface NewsTickerSearchPayload {
  queried: string[]
  /** Every article stamped `category: 'search'`, newest first. */
  articles: NewsArticle[]
  empty: string[]
  failed: string[]
}

export interface NewsTickerSearchRequest {
  tickers: string[]
  force?: boolean
}

export interface NewsPreviewPayload {
  url: string
  text: string
  /** 'article' when extraction worked, 'fallback' when it did not. */
  origin: 'article' | 'fallback'
  truncated: boolean
}

export interface NewsPreviewRequest {
  url: string
  title: string
  /** The RSS description, used as the fallback body without a second round trip. */
  summary: string
  force?: boolean
}

export interface NewsThumbnailPayload {
  url: string
  /** `data:image/webp;base64,...`, or '' when nothing usable came back. */
  dataUri: string
  bytes: number
}

export interface NewsThumbnailRequest {
  url: string
}

/* --------------------------------------------------------------- analytics */

/** Timeframes shared by Dip Finder and Momentum Tracker. */
export type ReturnTimeframe = '1mo' | 'ytd' | '1y'

export const RETURN_TIMEFRAMES: ReadonlyArray<{ key: ReturnTimeframe; label: string }> = [
  { key: '1mo', label: '1 Month' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
]

/** Portfolio Heatmap intervals, from `_P4_HEATMAP_INTERVALS`. */
export type HeatmapInterval = 'live' | '1d' | '1w' | '1m' | '3m' | 'ytd' | '1y'

export const HEATMAP_INTERVALS: ReadonlyArray<{ key: HeatmapInterval; label: string }> = [
  { key: 'live', label: 'Live' },
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
]

export type MetricsLookback = '1y' | '3y' | '5y' | 'max'

export const METRICS_LOOKBACKS: ReadonlyArray<{ key: MetricsLookback; label: string }> = [
  { key: '1y', label: '1Y' },
  { key: '3y', label: '3Y' },
  { key: '5y', label: '5Y' },
  { key: 'max', label: 'Max' },
]

export interface ReturnsPayload {
  /** Percent return per ticker over the requested window. */
  returns: Record<string, number>
  missing: string[]
}

export interface MomentumPayload {
  dates: string[]
  /** Portfolio return, in percent, against the first day of the window. */
  returns: number[]
  emaPeriod: number
  ema: number[]
  startDate: string | null
  includedTickers: string[]
  excludedTickers: string[]
  reason: string
}

export interface RiskMetricsPayload {
  beta: number | null
  alpha: number | null
  volatility: number | null
  maxDrawdown: number | null
  sharpe: number | null
  sortino: number | null
  cagr: number | null
  tailRisk: number | null
  skewness: number | null
}

export interface ExposurePayload {
  holdingsCount: number
  valuedHoldingsCount: number
  unvaluedHoldingsCount: number
  coveragePct: number | null
  investedValue: number
  largestPositionTicker: string | null
  largestPositionValue: number | null
  topPositionWeight: number | null
  top3Weight: number | null
  top5Weight: number | null
  concentrationScore: number | null
  effectiveHoldings: number | null
  topPositions: Array<{ ticker: string; value: number; weightPct: number }>
}

export interface AnalyticsPayload {
  metrics: RiskMetricsPayload
  exposure: ExposurePayload
  benchmarkSymbol: string
  lookback: MetricsLookback
  startDate: string | null
  endDate: string | null
  historyPoints: number
  includedTickers: string[]
  excludedTickers: string[]
  note: string
  reason: string
}

export interface PositionInput {
  ticker: string
  shares: number
}

/* ------------------------------------------------------------------ config */

export const MACRO_SYMBOLS: ReadonlyArray<{ symbol: string; label: string }> = [
  { symbol: 'SPY', label: 'SPY' },
  { symbol: 'DX-Y.NYB', label: 'DXY' },
  { symbol: '^VIX', label: 'VIX' },
  { symbol: 'GLD', label: 'GLD' },
  { symbol: 'CL=F', label: 'WTI' },
]

export type TimeframeLabel =
  | '1 Minute'
  | '5 Minutes'
  | '15 Minutes'
  | '1 Hour'
  | '1 Day'
  | '1 Week'
  | '1 Month'

export interface TimeframeSpec {
  label: TimeframeLabel
  /** Compact button caption; the full label stays as the tooltip and accessible name. */
  short: string
  /** Lookback window in days. */
  lookbackDays: number
  interval: '1m' | '5m' | '15m' | '1h' | '1d' | '1wk' | '1mo'
  /** True for sub-daily bars, which cache briefly and need a time-of-day axis. */
  intraday: boolean
}

/** Mirrors `timeframe_options` in the PySide6 `window_setup.py`. */
export const TIMEFRAMES: ReadonlyArray<TimeframeSpec> = [
  { label: '1 Minute', short: '1m', lookbackDays: 7, interval: '1m', intraday: true },
  { label: '5 Minutes', short: '5m', lookbackDays: 60, interval: '5m', intraday: true },
  { label: '15 Minutes', short: '15m', lookbackDays: 60, interval: '15m', intraday: true },
  { label: '1 Hour', short: '1h', lookbackDays: 730, interval: '1h', intraday: true },
  { label: '1 Day', short: '1D', lookbackDays: 1825, interval: '1d', intraday: false },
  { label: '1 Week', short: '1W', lookbackDays: 1825, interval: '1wk', intraday: false },
  { label: '1 Month', short: '1M', lookbackDays: 1825, interval: '1mo', intraday: false },
]

export const DEFAULT_TIMEFRAME: TimeframeLabel = '1 Day'
export const DEFAULT_SYMBOL = 'SPY'

export const OPTION_BUCKETS: ReadonlyArray<{ key: OptionBucketKey; label: string; daysOut: number }> = [
  { key: '0_week', label: '0 Week', daysOut: 0 },
  { key: '2_weeks', label: '2 Weeks', daysOut: 14 },
  { key: '4_weeks', label: '4 Weeks', daysOut: 28 },
]

/**
 * The top-bar tabs, in `DEFAULT_NAVIGATION_PAGE_ORDER` sequence with the labels from
 * `_PAGE_LABELS`. Only Dashboard is implemented; the rest are placeholders for the
 * page-by-page migration.
 */
export const TABS: ReadonlyArray<{ id: string; label: string; implemented: boolean }> = [
  { id: 'dashboard', label: 'Dashboard', implemented: true },
  { id: 'portfolio', label: 'Portfolio', implemented: true },
  { id: 'personal-finance', label: 'Personal Finance', implemented: true },
  { id: 'global', label: 'Global', implemented: true },
  { id: 'news', label: 'News', implemented: true },
  { id: 'calendar', label: 'Calendar', implemented: true },
  { id: 'pre-market', label: 'Pre-Market', implemented: true },
  { id: 'trading-volumes', label: 'Trading Volumes', implemented: true },
  { id: 'heatmap', label: 'Heatmap', implemented: true },
  { id: 'cards', label: 'Cards', implemented: true },
  { id: 'up-down', label: 'Up/Down', implemented: true },
  { id: 'stocks', label: 'Stocks', implemented: true },
  { id: 'fundamentals', label: 'Fundamentals', implemented: true },
  { id: 'charts', label: 'Charts', implemented: true },
  { id: 'valuation', label: 'Valuation', implemented: true },
  { id: 'options', label: 'Options', implemented: true },
  { id: 'signals', label: 'Day Trading', implemented: true },
  { id: 'quant', label: 'Quant', implemented: true },
  { id: 'projections', label: 'Projections', implemented: true },
  { id: 'etf', label: 'ETF', implemented: true },
  { id: 'forex', label: 'Forex', implemented: true },
  { id: 'crypto', label: 'Crypto', implemented: true },
  { id: 'bmnr', label: 'BMNR', implemented: true },
  { id: 'gold', label: 'Gold', implemented: true },
  { id: 'oil', label: 'Oil', implemented: true },
  { id: 'backtest', label: 'Backtest', implemented: true },
  { id: 'roll', label: 'Roll', implemented: true },
  { id: 'ipo', label: 'IPO', implemented: true },
  { id: 'institutions', label: 'Institutions', implemented: true },
  { id: 'politics', label: 'Politics', implemented: true },
  { id: 'youtube', label: 'YouTube', implemented: true },
  { id: 'dictionary', label: 'Dictionary', implemented: true },
  { id: 'bonds', label: 'Bonds', implemented: true },
  { id: 'economic', label: 'Economic', implemented: true },
  { id: 'price', label: 'Price', implemented: true },
  { id: 'market-cap', label: 'Market Cap', implemented: true },
  { id: 'settings', label: 'Settings', implemented: true },
]

/* ---------------------------------------------------------------- economic */

export const ECONOMIC_GROUPS = ['Inflation', 'Labor', 'Growth', 'Rates'] as const
export type EconomicGroup = (typeof ECONOMIC_GROUPS)[number]

export const ECONOMIC_TRANSFORMS = [
  'level',
  'yoy_pct',
  'mom_pct',
  'mom_diff',
  'qoq_saar',
] as const
export type EconomicTransform = (typeof ECONOMIC_TRANSFORMS)[number]

export const ECONOMIC_PROVIDERS = [
  'fred',
  'bls',
  'treasury',
  'treasury_spread',
  'treasury_breakeven',
  'nyfed',
  'umich',
] as const
export type EconomicProvider = (typeof ECONOMIC_PROVIDERS)[number]

/** How often a series is published, which is what the year-ago lookup tolerances scale to. */
export type EconomicFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

/** One `(iso_date, value)` observation. Seconds are never involved: macro data is dated. */
export type EconomicPoint = [string, number]

/** One indicator, resolved. Mirrors `build_row` in `services/economic.py`. */
export interface EconomicRow {
  /** The FRED id, which is this catalog's primary key even where another provider serves it. */
  seriesId: string
  label: string
  group: EconomicGroup
  units: string
  decimals: number
  frequency: EconomicFrequency
  transform: EconomicTransform
  /**
   * Tri-state on purpose: `null` means a move in either direction carries no good/bad
   * meaning, so the change cell stays neutral rather than painting a judgement.
   */
  higherIsBetter: boolean | null
  /** Years to maturity, set only on the tenors that draw the treasury curve. */
  tenorYears: number | null
  note: string
  provider: EconomicProvider
  /** Provider label plus identifier, for the Source column and the row tooltip. */
  source: string
  available: boolean
  latest: number | null
  latestDate: string | null
  prior: number | null
  /** Latest minus prior, in the transformed series' own units. */
  change: number | null
  /** Year-over-year percent change of the *raw* observations, before the transform. */
  yoy: number | null
  rawLatest: number | null
  /** The transformed series, trimmed to `HISTORY_YEARS`. */
  history: EconomicPoint[]
}

export interface EconomicCurveTenor {
  seriesId: string
  label: string
  years: number
  yieldPct: number
  date: string | null
}

export interface EconomicYieldCurve {
  tenors: EconomicCurveTenor[]
  spread10y2y: number | null
  spread10y3m: number | null
  inverted2s10s: boolean
  inverted3m10y: boolean
}

export interface EconomicPayload {
  /** Local ISO stamp of the build, which the freshness line ages against. */
  generatedAt: string
  source: string
  groups: EconomicGroup[]
  rows: EconomicRow[]
  /** Series ids whose provider returned nothing. */
  missing: string[]
  /** Providers that looked unreachable rather than merely short a series. */
  unreachable: EconomicProvider[]
  yieldCurve: EconomicYieldCurve
}

export interface EconomicRequest extends BackgroundRequest {
  /** Ignore the cached payload and re-download every provider. */
  force?: boolean
}

/* --------------------------------------------------------- global markets */

/** The Global page's interval buttons, from `GLOBAL_INTERVALS`. */
export const GLOBAL_INTERVALS = ['1D', '5D', '30D', 'YTD', '1Y', '5Y'] as const
export type GlobalInterval = (typeof GLOBAL_INTERVALS)[number]

/**
 * One index pinned to the Global map.
 *
 * `labelDx`/`labelDy` are the hand-tuned first-choice offsets for the callout box; the
 * map's placement search falls back from there. A zero offset counts as unset and
 * becomes the 12/-18 default, which is what `_label_candidates` does.
 */
export interface GlobalIndexConfig {
  region: string
  country: string
  name: string
  shortName: string
  symbol: string
  lat: number
  lon: number
  labelDx: number
  labelDy: number
}

/** `GLOBAL_MARKET_INDEXES` in the PySide6 `services/global_markets.py`, verbatim. */
export const GLOBAL_MARKET_INDEXES: ReadonlyArray<GlobalIndexConfig> = [
  { region: 'North America', country: 'USA', name: 'S&P 500', shortName: 'S&P 500', symbol: '^GSPC', lat: 39.5, lon: -98.4, labelDx: -94, labelDy: -42 },
  { region: 'North America', country: 'Canada', name: 'S&P/TSX Composite Index', shortName: 'TSX', symbol: '^GSPTSE', lat: 56.1, lon: -106.3, labelDx: -102, labelDy: -18 },
  { region: 'Europe', country: 'UK', name: 'FTSE 100', shortName: 'FTSE', symbol: '^FTSE', lat: 55.4, lon: -3.4, labelDx: -86, labelDy: -44 },
  { region: 'Europe', country: 'Germany', name: 'DAX 40', shortName: 'DAX', symbol: '^GDAXI', lat: 51.2, lon: 10.5, labelDx: 32, labelDy: -44 },
  { region: 'Europe', country: 'France', name: 'CAC 40', shortName: 'CAC', symbol: '^FCHI', lat: 46.2, lon: 2.2, labelDx: -92, labelDy: 8 },
  { region: 'Europe', country: 'Italy', name: 'FTSE MIB', shortName: 'MIB', symbol: 'FTSEMIB.MI', lat: 42.8, lon: 12.5, labelDx: 32, labelDy: 8 },
  { region: 'Europe', country: 'Spain', name: 'IBEX 35', shortName: 'IBEX', symbol: '^IBEX', lat: 40.5, lon: -3.7, labelDx: -92, labelDy: 34 },
  { region: 'Asia-Pacific', country: 'Japan', name: 'Nikkei 225', shortName: 'Nikkei', symbol: '^N225', lat: 36.2, lon: 138.3, labelDx: 38, labelDy: -42 },
  { region: 'Asia-Pacific', country: 'Hong Kong', name: 'Hang Seng Index (HSI)', shortName: 'HSI', symbol: '^HSI', lat: 22.3, lon: 114.2, labelDx: 30, labelDy: 28 },
  { region: 'Asia-Pacific', country: 'China', name: 'CSI 300', shortName: 'CSI 300', symbol: '000300.SS', lat: 39.9, lon: 116.4, labelDx: 36, labelDy: -8 },
  { region: 'Asia-Pacific', country: 'Taiwan', name: 'Taiwan Capitalization Weighted Stock Index', shortName: 'TAIEX', symbol: '^TWII', lat: 23.7, lon: 121.0, labelDx: -112, labelDy: 38 },
  { region: 'Asia-Pacific', country: 'India', name: 'Nifty 50', shortName: 'Nifty', symbol: '^NSEI', lat: 28.6, lon: 77.2, labelDx: -110, labelDy: -18 },
  { region: 'Asia-Pacific', country: 'South Korea', name: 'KOSPI', shortName: 'KOSPI', symbol: '^KS11', lat: 36.5, lon: 127.9, labelDx: 36, labelDy: 20 },
  { region: 'Asia-Pacific', country: 'Singapore', name: 'Straits Times Index (STI)', shortName: 'STI', symbol: '^STI', lat: 1.35, lon: 103.8, labelDx: 36, labelDy: 52 },
  { region: 'Asia-Pacific', country: 'Australia', name: 'S&P/ASX 200', shortName: 'ASX 200', symbol: '^AXJO', lat: -25.3, lon: 133.8, labelDx: 36, labelDy: 18 },
  { region: 'Latin America', country: 'Brazil', name: 'Bovespa (IBOV)', shortName: 'IBOV', symbol: '^BVSP', lat: -14.2, lon: -51.9, labelDx: 30, labelDy: 22 },
  { region: 'Latin America', country: 'Mexico', name: 'S&P/BMV IPC', shortName: 'IPC', symbol: '^MXX', lat: 23.6, lon: -102.6, labelDx: -100, labelDy: 18 },
]

/** One interval's return, or the reason there isn't one. */
export interface IntervalPerformance {
  available: boolean
  interval: GlobalInterval
  startDate: string
  endDate: string
  startClose: number | null
  endClose: number | null
  changePct: number | null
  reason: string
}

/**
 * Trading-session metadata as Yahoo reports it. Epoch **seconds**, like everything else
 * in this contract. The renderer turns these into a session line in the Settings clock
 * timezone, so nothing here is pre-formatted.
 */
export interface MarketTiming {
  symbol: string
  exchangeName: string
  exchangeTimezone: string
  regularStart: number | null
  regularEnd: number | null
  regularMarketTime: number | null
  lastTickTime: number | null
  source: string
}

export interface GlobalIndexRow extends GlobalIndexConfig {
  lastClose: number | null
  lastDate: string
  intervals: Record<GlobalInterval, IntervalPerformance>
  marketTiming: MarketTiming
}

export interface GlobalMarketsPayload {
  generatedAt: string
  source: string
  rows: GlobalIndexRow[]
  /** Symbols Yahoo gave nothing usable for; their rows render as `--`. */
  missing: string[]
}

export interface GlobalMarketsRequest extends BackgroundRequest {
  force?: boolean
}

/* -------------------------------------------------------------- pre-market */

/** `PreMarketWorker._FUTURES_CONTRACTS`, in order. */
export const PRE_MARKET_FUTURES: ReadonlyArray<{ symbol: string; name: string }> = [
  { symbol: 'ES=F', name: 'S&P 500' },
  { symbol: 'NQ=F', name: 'Nasdaq 100' },
  { symbol: 'YM=F', name: 'Dow Jones' },
  { symbol: 'CL=F', name: 'WTI Crude' },
  { symbol: 'ZB=F', name: 'T-Bond' },
]

/**
 * The range buttons on the DXY / 10Y / VIX charts.
 *
 * Not in the reference, which prints those three panels as text only. The service always
 * sends two years of daily closes and the renderer slices, so a range click never
 * refetches.
 */
export const MACRO_RANGES = ['1M', '6M', '1Y', '2Y'] as const
export type MacroRange = (typeof MACRO_RANGES)[number]

export type FuturesDirection = 'Up' | 'Down' | 'Flat'

export interface FuturesRow {
  symbol: string
  name: string
  price: number
  changePct: number
  direction: FuturesDirection
}

/** Daily closes for one macro symbol. `dates` is `YYYY-MM-DD`, ascending. */
export interface MacroSeries {
  dates: string[]
  values: number[]
}

export type DxyTrend = 'Strengthening' | 'Weakening' | 'Flat' | '--'

export interface DxySnapshot {
  level: number
  changePct: number
  trend: DxyTrend
  series: MacroSeries
}

export interface TnxSnapshot {
  yield: number
  changeBps: number
  avg20d: number
  vsAvg: number
  series: MacroSeries
}

export type VixRegime = 'Low Vol' | 'Normal' | 'Elevated' | 'High Vol'

export interface VixSnapshot {
  level: number
  change: number
  regime: VixRegime
  series: MacroSeries
}

export interface FearGreedRow {
  period: string
  score: number | null
  rating: string
}

export interface FearGreedPayload {
  score: number | null
  /** CNN's own rating for the current score, title-cased; the rows compute their own. */
  rating: string
  /** Already formatted in `America/New_York`; empty when CNN sent nothing usable. */
  timestamp: string
  history: FearGreedRow[]
}

/** SPY against its 125-day mean. `ma125` is null for the first 124 bars. */
export interface SpyMomentumPayload {
  dates: string[]
  closes: number[]
  ma125: Array<number | null>
  lastClose: number | null
  lastMa: number | null
}

/**
 * Six independent blocks. Any one of them can be null — the reference fetches each in
 * its own try/except and leaves a dead panel showing its last value rather than taking
 * the page down, and the panels here show their own warning dot instead.
 */
export interface PreMarketPayload {
  futures: FuturesRow[]
  dxy: DxySnapshot | null
  tnx: TnxSnapshot | null
  vix: VixSnapshot | null
  fearGreed: FearGreedPayload | null
  momentum: SpyMomentumPayload | null
  /** Blocks that came back empty, by the label the panel carries. */
  missing: string[]
}

export interface PreMarketRequest extends BackgroundRequest {
  force?: boolean
}

/* --------------------------------------------------------- trading volumes */

/**
 * The six intervals the Trading Volumes page ranks by, from `_P20_DOT_METRICS`.
 * Selecting one re-ranks the table and the dot plot together.
 */
export const TRADING_VOLUME_INTERVALS = ['1d', '5d', '30d', 'ytd', '1y', '3y'] as const
export type TradingVolumeInterval = (typeof TRADING_VOLUME_INTERVALS)[number]

/** One point of the price-based market-cap estimate, from `_market_cap_estimate_history`. */
export interface MarketCapPoint {
  /** `YYYY-MM-DD`. */
  date: string
  value: number
}

/**
 * A screened row. Every figure is nullable because the reference leaves a metric out
 * rather than guessing when the history behind it is too short.
 */
export interface TradingVolumeRow {
  ticker: string
  name: string
  sector: string
  marketCap: number | null

  oneDayDollarVolume: number | null
  fiveDayAvgDollarVolume: number | null
  thirtyDayAvgDollarVolume: number | null
  ytdAvgDollarVolume: number | null
  oneYearAvgDollarVolume: number | null
  threeYearAvgDollarVolume: number | null

  oneDayPriceReturnPct: number | null
  fiveDayPriceReturnPct: number | null
  thirtyDayPriceReturnPct: number | null
  ytdPriceReturnPct: number | null
  oneYearPriceReturnPct: number | null
  threeYearPriceReturnPct: number | null

  /**
   * Daily price-based market-cap estimate over the full three years. Carried so the
   * deferred Replay animation drops in without a contract change; nothing reads it yet.
   */
  marketCapHistory: MarketCapPoint[]
}

export interface TradingVolumesPayload {
  rows: TradingVolumeRow[]
  /** `YYYY-MM-DD HH:mm`, the reference's `as_of`. */
  asOf: string
  source: string
  /** Symbols whose daily history failed, so their ADV columns beyond 1D are blank. */
  missing: string[]
}

export interface TradingVolumesRequest extends BackgroundRequest {
  force?: boolean
}

/* ------------------------------------------------------------------ signals */

export type SignalClass = 'NONE' | 'WATCH' | 'LONG' | 'STRONG_LONG'

export type SignalTradeStatus =
  | 'NONE'
  | 'WATCH'
  | 'VALID_LONG'
  | 'TOO_EXTENDED'
  /** The US session is shut, so the intraday blocks were not scored. Not a feed failure. */
  | 'MARKET_CLOSED'
  | 'STALE_DATA'
  | 'INSUFFICIENT_HISTORY'
  | 'DATA_ERROR'

export type SignalsFilter =
  | 'all'
  | 'strong'
  | 'long'
  | 'watch'
  | 'blocked'
  | 'market_closed'
  | 'stale'
  | 'too_new'
  | 'error'

/** Where the broad market sits, and the class thresholds that follow from it. */
export type SignalRegimeLabel = 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF'

export interface SignalsPageSettings {
  filter: 'all' | DayTradingStatus
  setup: 'all' | DayTradingSetup
  search: string
}

export interface SignalReason {
  name: string
  group: 'trend' | 'momentum' | 'volume' | 'entry' | 'relative' | 'regime'
  passed: boolean
  points: number
  description: string
  value: number | null
  reference: number | null
  weight: number
}

/** The trade plan a signal implies, all in the ticker's own currency. */
export interface SignalRisk {
  entry: number | null
  stop: number | null
  target: number | null
  riskPerShare: number | null
  rewardPerShare: number | null
  rewardToRisk: number | null
  stopDistanceAtr: number | null
  atrPct: number | null
  /** Position value as a share of capital that risks one budget unit on this stop. */
  positionSizePct: number | null
}

export interface SignalRegime {
  label: SignalRegimeLabel
  score: number
  maxScore: number
  fraction: number
  longThreshold: number
  strongThreshold: number
  reasons: SignalReason[]
  indicators: Record<string, number | string | null>
  warnings: string[]
}

export interface SignalBacktestBand {
  band: string
  samples: number
  hitRate: number
  meanForwardReturn: number
  medianForwardReturn: number
}

/** Measured forward returns of the daily sub-model, by score band. */
export interface SignalValidation {
  horizonSessions: number
  tickers: number
  samples: number
  bands: SignalBacktestBand[]
}

export interface SignalTimeframeBar {
  asOf: string | null
  partial: boolean
  dropped: boolean
}

export interface SignalResult {
  ticker: string
  timestamp: string
  price: number | null
  rawScore: number
  maxScore: number
  trendScore: number
  trendMaxScore: number
  momentumScore: number
  momentumMaxScore: number
  volumeScore: number
  volumeMaxScore: number
  entryScore: number
  entryMaxScore: number
  relativeScore: number
  relativeMaxScore: number
  regimeScore: number
  regimeMaxScore: number
  risk: SignalRisk | null
  signal: SignalClass
  tradeStatus: SignalTradeStatus
  /**
   * The US session was shut when this was scored, so the 22 intraday points were
   * unreachable rather than failed. The class is still capped at WATCH and `maxScore` is
   * still 100 — only the displayed denominator narrows, and only for presentation.
   */
  marketClosed: boolean
  reasons: SignalReason[]
  warnings: string[]
  indicators: Record<string, number | string | null>
  timeframeStatus: Record<string, string>
  timeframeBars: Record<string, SignalTimeframeBar>
  error: string
}

export interface SignalCandidate {
  ticker: string
  name: string
  exchange: string
  price: number
  marketCap: number
  /** Price times average daily volume, straight off the screener row. Costs no request. */
  estimatedDollarVolume: number
  medianDollarVolume: number
  /** Fraction of the daily sub-model this name scored during stage one. */
  dailyPreScore: number
  qualityRank: number
  reasons: string[]
}

export interface LegacySignalsPayload {
  candidates: SignalCandidate[]
  results: SignalResult[]
  source: string
  sourcedAt: string
  startedAt: string
  completedAt: string
  sourceCandidateCount: number
  prefilteredCount: number
  confirmedCount: number
  rejectedCandidateCount: number
  passedFilterCount: number
  regime: SignalRegime
  validation: SignalValidation[]
  errors: Record<string, string>
  universeFromCache: boolean
}

export interface SignalsRequest extends BackgroundRequest {
  latestOnly?: boolean
  forceMarketRefresh?: boolean
  forceUniverseRefresh?: boolean
}

export type DayTradingSetup = 'opening_range' | 'vwap_pullback'
export type DayTradingStatus = 'ready' | 'watching' | 'expired' | 'invalidated' | 'market_closed' | 'stale' | 'error'

export interface DayTradingResult {
  id: string
  ticker: string
  setup: DayTradingSetup
  session: string
  status: DayTradingStatus
  confirmedAt: string | null
  invalidatedAt: string | null
  barTime: string | null
  latestPrice: number | null
  entry: number | null
  stop: number | null
  target1: number | null
  target2: number | null
  openingHigh: number | null
  openingLow: number | null
  vwap: number | null
  reasons: string[]
  error: string | null
}

export type DayTradingCandidate = Omit<SignalCandidate, 'dailyPreScore'>

export interface SignalsPayload {
  version: 5
  session: string
  marketOpen: boolean
  candidates: DayTradingCandidate[]
  results: DayTradingResult[]
  source: string
  sourcedAt: string
  startedAt: string
  completedAt: string
  sourceCandidateCount: number
  prefilteredCount: number
  confirmedCount: number
  errors: Record<string, string>
  universeFromCache: boolean
}

/* -------------------------------------------------------------------- price */

/** One major-exchange U.S. equity returned by the Price market screen. */
export interface MarketCapRow {
  rank: number
  ticker: string
  name: string
  marketCap: number
  price: number | null
  exchange: string
  trailingEps: number | null
  trailingPe: number | null
  forwardPe: number | null
}

export interface MarketCapPayload {
  rows: MarketCapRow[]
  source: string
  asOf: string
  candidateCount: number
}

export type MarketCapTier = 'all' | 'mega' | 'large' | 'mid' | 'small' | 'micro' | 'nano'

export interface MarketCapRequest { force?: boolean; tier?: MarketCapTier }

export interface PriceScreenRow {
  ticker: string
  name: string
  exchange: string
  price: number
  marketCap: number
}

export interface PriceScreenPayload {
  rows: PriceScreenRow[]
  source: string
  /** `YYYY-MM-DD HH:mm`, in local time like the PySide6 page. */
  asOf: string
  candidateCount: number
  minimumPrice: number
  maximumPrice: number
}

export interface PriceScreenRequest {
  minimumPrice: number
  maximumPrice: number
}

/* ---------------------------------------------------------------- calendar */

export interface CalendarCompanyEvent {
  date: string
  ticker: string
  event: 'Earnings' | 'Ex-Dividend'
}

export interface EconomicCalendarEvent {
  date: string
  name: string
  importance: string
}

export interface MarketHolidayEvent {
  date: string
  market: string
  event: string
  detail: string
  cellLabel: string
  color: string
}

export interface CalendarMonthPayload {
  companyEvents: CalendarCompanyEvent[]
  economicEvents: EconomicCalendarEvent[]
  marketHolidays: MarketHolidayEvent[]
  generatedAt: number
}

export interface CalendarMonthRequest extends BackgroundRequest {
  tickers: string[]
  year: number
  month: number
  force?: boolean
}

export interface EarningsCalendarRow {
  date: string
  dateDisplay: string
  datetimeUtc: string
  timeDisplay: string
  symbol: string
  company: string
  eventName: string
  timing: string
  epsEstimate: string
  epsEstimateValue: number | null
  reportedEps: string
  reportedEpsValue: number | null
  surprisePct: string
  surprisePctValue: number | null
  marketCap: string
  marketCapValue: number | null
  status: string
  previousDate: string
  previousDatetimeUtc: string
  changedDate: boolean
  eventKey: string
}

export interface EarningsCalendarPayload {
  rows: EarningsCalendarRow[]
  source: string
  sourceUrl: string
  fetchedAt: string
  startDate: string
  endDate: string
  rangeKey: string
  symbolUniverseCount: number
}

export interface EarningsCalendarRequest extends BackgroundRequest {
  startDate: string
  endDate: string
  rangeKey: string
  force?: boolean
}

export interface CalendarExportInput {
  year: number
  month: number
  today: string
  includeEconomic: boolean
  includeCompany: boolean
  includeOptions: boolean
  includeMarketHolidays: boolean
  economicEvents: EconomicCalendarEvent[]
  companyEvents: CalendarCompanyEvent[]
  marketHolidays: MarketHolidayEvent[]
  options: OptionPosition[]
}

export interface EarningsExportInput {
  payload: EarningsCalendarPayload
  rows: EarningsCalendarRow[]
  weekStart: string
  rangeLabel: string
  search: string
  timing: 'all' | 'BMO' | 'AMC' | 'TAS' | 'TBD'
  changedOnly: boolean
  exportedAt: string
}

/* ------------------------------------------------------------------ crypto */

/**
 * One row of the Crypto page's quote map, keyed by the short label (`BTC`, `COIN`).
 *
 * `source` is per row rather than per payload because the coins prefer CoinGecko and
 * fall back to Yahoo field by field (`_fetch_quotes`), so two rows in the same table can
 * genuinely have come from different places.
 */
export interface CryptoQuote {
  label: string
  symbol: string
  name: string
  price: number | null
  changePct: number | null
  volume: number | null
  marketCap: number | null
  source: string
}

/** One cell of the Top 30 grid. */
export interface CryptoHeatmapTile {
  rank: number
  symbol: string
  name: string
  price: number | null
  changePct: number | null
  marketCap: number | null
  volume: number | null
  source: string
}

export interface CryptoHeatmapPayload {
  tiles: CryptoHeatmapTile[]
  coverage: { loaded: number; total: number }
  /** Local ISO stamp to the second; the panel prints its `HH:MM:SS` tail. */
  updatedAt: string
}

/** `_fetch_global_market`: CoinGecko's `/global` block. */
export interface CryptoGlobalMarket {
  marketCap: number | null
  volume24h: number | null
  changePct: number | null
  btcDominance: number | null
}

/** `_fetch_crypto_fear_greed`: alternative.me's index, which is not CNN's. */
export interface CryptoFearGreed {
  value: number | null
  classification: string
  /** Already formatted `Mon DD`, as the reference stores it. */
  timestamp: string
  source: string
}

/** The four independent fetches `CryptoMarketWorker.run` stages. */
export type CryptoStage = 'heatmap' | 'quotes' | 'market' | 'news'
export type CryptoStageStatus = 'loaded' | 'unavailable'

export interface CryptoPayload {
  /** Local ISO stamp to the second, `datetime.now().isoformat(timespec='seconds')`. */
  fetchedAt: string
  heatmap: CryptoHeatmapPayload
  quotes: Record<string, CryptoQuote>
  global: CryptoGlobalMarket | null
  fearGreed: CryptoFearGreed | null
  /** Ranked crypto-native RSS, capped at `CRYPTO_NEWS_LIMIT`. */
  news: NewsArticle[]
  progress: Record<CryptoStage, CryptoStageStatus>
}

export interface CryptoRequest extends BackgroundRequest {
  force?: boolean
}

/* ----------------------------------------------------------- BMNR treasury */

/**
 * The BMNR page — BitMine Immersion Technologies, an Ethereum treasury company.
 *
 * Not a port: the PySide6 app has no equivalent page. The equity is essentially a wrapper
 * around a pile of ETH, so the page answers how much ETH is held, what share of supply
 * that is, what cash and other assets sit beside it, and what the market pays per unit of
 * the treasury.
 *
 * Two sources that disagree by design. CoinGecko's treasury endpoint carries a *live* ETH
 * count updated within days; the last filed 10-Q carries an authoritative count that can be
 * a quarter old. They are never blended. That guarantee is structural rather than a
 * convention: there is no bare `number` anywhere in the live or derived surface below —
 * every figure is a `BmnrValue` carrying its basis, its as-of date and its source, so a
 * renderer physically cannot print one without the label in hand.
 */
export const BMNR_SYMBOL = 'BMNR'
export const BMNR_ETH_SYMBOL = 'ETH-USD'
/** BitMine Immersion Technologies. A CIK never changes and this page's ticker is fixed. */
export const BMNR_CIK = '0001829311'

/**
 * Which of the two irreconcilable counts a figure was computed from.
 *
 * `live` is CoinGecko's ETH count and Yahoo's prices — continuous and unaudited.
 * `filed` is the balance sheet in the last 10-Q — months old and authoritative.
 * `cross` is the few figures that deliberately use one of each. Always labelled, never
 * presented as either.
 */
export type BmnrBasis = 'live' | 'filed' | 'cross'

/** One number that cannot be read honestly without knowing where and when it came from. */
export interface BmnrValue {
  value: number | null
  /** `YYYY-MM-DD` for a filed figure; a local ISO stamp for a live one. */
  asOf: string
  /** `'CoinGecko'`, `'Yahoo Finance'`, `'SEC 10-Q filed 2026-07-14'`, `'derived'`. */
  source: string
  basis: BmnrBasis
  /** Set when the figure needs a caveat — a fallback source was used, say. */
  note?: string
}

/* --------------------------------------------------------------- live block */

export interface BmnrCohort {
  companyCount: number
  /** The endpoint's root `total_holdings`: the sum across listed treasuries, NOT ETH supply. */
  totalHoldings: number | null
  totalValueUsd: number | null
  /** Root `market_cap_dominance` — the cohort's share of ETH market cap, not of supply. */
  marketCapDominancePct: number | null
  /** BMNR's holdings as a percent of the cohort's. */
  bmnrShareOfCohortPct: number | null
}

export interface BmnrLiveTreasury {
  ethHeld: BmnrValue
  /** `percentage_of_total_supply`, already a percent (4.89), not a fraction. */
  supplyPct: BmnrValue
  ethValueUsd: BmnrValue
  /** `total_entry_value_usd`; null when CoinGecko reports its `0` "not disclosed" sentinel. */
  entryValueUsd: BmnrValue
  /** `total_current_value_usd / total_holdings` — CoinGecko's own internal ETH price. */
  impliedEthPrice: BmnrValue
  /** `ethHeld / (supplyPct / 100)` — the supply the percentage was struck against. */
  impliedEthSupply: BmnrValue
  cohort: BmnrCohort
}

/* -------------------------------------------------------------- filed block */

/** One balance-sheet date out of `companyfacts`, amendments already resolved. */
export interface BmnrFiledQuarter {
  endDate: string
  /** `FY2026 Q3 · May 2026`. Fiscal, not calendar — BMNR's year ends 31 August. */
  label: string
  form: string
  fiscalYear: number | null
  fiscalPeriod: string
  filedDate: string
  accession: string
  ethUnits: number | null
  /** Which `units` bucket won — `Integer` or `cryptoAsset`. Surfaced, because it changed. */
  ethUnitsUnit: string
  cryptoFairValue: number | null
  cryptoCost: number | null
  cash: number | null
  totalAssets: number | null
  liabilities: number | null
  stockholdersEquity: number | null
  stockholdersEquityInclNci: number | null
  minorityInterest: number | null
  sharesOutstanding: number | null
  /** Asset lines beyond crypto and cash, keyed by us-gaap tag. Absent tags are omitted. */
  components: Record<string, number>
}

export interface BmnrFiledTreasury {
  cik: string
  /** Ascending by `endDate`. */
  quarters: BmnrFiledQuarter[]
  latest: BmnrFiledQuarter | null
  /**
   * `dei:EntityCommonStockSharesOutstanding` — the 10-Q cover page, dated weeks *after* the
   * balance sheet it ships with. Kept separate on purpose: averaging it against
   * `CommonStockSharesOutstanding` would invent a share count that was never outstanding.
   */
  coverShares: BmnrValue
  freshness: SecFreshness
  cacheAgeSeconds: number
  warnings: string[]
}

/* ------------------------------------------------------------- market block */

export interface BmnrMarket {
  sharePrice: BmnrValue
  shareChangePct: BmnrValue
  marketCap: BmnrValue
  ethPrice: BmnrValue
  ethChangePct: BmnrValue
  /** `marketCap / sharePrice` — a third share count, shown for comparison, never averaged. */
  impliedShares: BmnrValue
}

/* ------------------------------------------------------------ derived block */

export interface BmnrDerived {
  /** The denominator every per-share figure below actually used. */
  shares: BmnrValue
  cryptoValue: BmnrValue
  /** Total assets less the crypto book and cash, per the filed balance sheet. */
  otherAssets: BmnrValue
  nav: BmnrValue
  navBuildUp: BmnrValue
  /** `navBuildUp - nav`; equals `minorityInterest` when the filing tags one. */
  navReconciliationGap: BmnrValue
  navPerShare: BmnrValue
  mnav: BmnrValue
  premiumPct: BmnrValue
  ethPerShare: BmnrValue
  ethPer1000Shares: BmnrValue
  ethValuePerShare: BmnrValue
  /** `CryptoAssetCost / ethUnits`. Cumulative gross purchases per unit, NOT a cost basis. */
  impliedGrossCostPerEth: BmnrValue
  /** `CryptoAssetFairValue / ethUnits`. The honest per-unit carrying value. */
  filedCarryingValuePerEth: BmnrValue
  /** Live ETH price against the filed gross cost. Cross-basis by construction. */
  costVsSpotPct: BmnrValue
  cryptoShareOfAssetsPct: BmnrValue
  cashShareOfAssetsPct: BmnrValue
  otherShareOfAssetsPct: BmnrValue
  /** `live.ethHeld - latest.ethUnits`: ETH accumulated since the last balance-sheet date. */
  unfiledEth: BmnrValue
  unfiledEthPct: BmnrValue
  /** The filed count against the live implied supply. Cross-basis, and labelled so. */
  filedSupplyPct: BmnrValue
  shareCountGap: BmnrValue
  shareCountGapPct: BmnrValue
}

/* ---------------------------------------------------- composition & history */

export interface BmnrHoldingSlice {
  label: string
  value: number
  /** The us-gaap tag it was read from, or `residual`. */
  tag: string
  sharePct: number | null
}

export interface BmnrComposition {
  asOf: string
  totalAssets: number | null
  /** Every slice including crypto, cash and the residual; sums to `totalAssets`. */
  slices: BmnrHoldingSlice[]
  /** The non-crypto, non-cash subset — the "other holdings" table. */
  otherSlices: BmnrHoldingSlice[]
  otherTotal: number | null
  /** True when named components exceeded total assets — a double-count regression. */
  overAllocated: boolean
}

export interface BmnrQuarterPoint {
  endDate: string
  label: string
  shares: number | null
  ethUnits: number | null
  ethUnitsUnit: string
  ethPer1000Shares: number | null
  qoqSharesPct: number | null
  qoqEthPct: number | null
  /** `qoqEthPct - qoqSharesPct`: positive means the raise bought more ETH than it diluted. */
  accretionPct: number | null
  /** Both series rebased to 100 at their own first non-null point, for the overlay chart. */
  sharesIndexed: number | null
  ethPerShareIndexed: number | null
}

export interface BmnrSensitivityRow {
  /** -25, -10, 0, 10, 25. */
  shockPct: number
  ethPrice: number | null
  navPerShare: number | null
  mnav: number | null
  premiumPct: number | null
}

/* ------------------------------------------------------------ page payload */

export const BMNR_BLOCKS = ['treasury', 'filings', 'market'] as const
export type BmnrBlock = (typeof BMNR_BLOCKS)[number]
export type BmnrBlockStatus = 'loaded' | 'unavailable'

export interface BmnrPayload {
  /** Local ISO stamp to the second, as the Crypto page's is. */
  fetchedAt: string
  symbol: string
  companyName: string
  live: BmnrLiveTreasury | null
  filed: BmnrFiledTreasury | null
  market: BmnrMarket
  derived: BmnrDerived
  composition: BmnrComposition
  history: BmnrQuarterPoint[]
  sensitivity: BmnrSensitivityRow[]
  filings: SecFiling[]
  /** The Crypto page's stage-map idiom: an IPC round trip carries no intermediate frames. */
  progress: Record<BmnrBlock, BmnrBlockStatus>
}

export interface BmnrRequest extends BackgroundRequest {
  force?: boolean
}

/* ------------------------------------------------------ Gold fundamentals */

export const GOLD_BLOCKS = ['market', 'demand', 'aboveGround', 'etf', 'mining'] as const
export type GoldBlock = (typeof GOLD_BLOCKS)[number]
export type GoldBlockStatus = 'loaded' | 'unavailable'
export type GoldFrequency = 'live' | 'monthly' | 'quarterly' | 'annual' | 'derived'
export type GoldUnit = 'usd' | 'usdPerOz' | 'tonnes' | 'percent' | 'years'

/** One displayed Gold value, carrying the provenance needed for mixed-frequency data. */
export interface GoldValue {
  value: number | null
  unit: GoldUnit
  asOf: string
  source: string
  frequency: GoldFrequency
  note?: string
}

export interface GoldMarket {
  futuresPrice: GoldValue
  futuresChangePct: GoldValue
  gldPrice: GoldValue
  gldChangePct: GoldValue
}

export interface GoldQuarterPoint {
  period: string
  mineProduction: number | null
  producerHedging: number | null
  recycledGold: number | null
  totalSupply: number | null
  jewellery: number | null
  technology: number | null
  barAndCoin: number | null
  etfDemand: number | null
  centralBanks: number | null
  otcAndOther: number | null
  totalDemand: number | null
  averagePrice: number | null
}

export interface GoldQuarterly {
  asOf: string
  source: string
  sourceUrl: string
  periods: GoldQuarterPoint[]
}

export interface GoldStockSlice {
  label: string
  tonnes: number
  sharePct: number | null
}

export interface GoldAboveGround {
  asOf: string
  source: string
  total: GoldValue
  belowGroundReserves: GoldValue
  belowGroundResources: GoldValue
  slices: GoldStockSlice[]
  reconciliationGap: number | null
}

export interface GoldEtf {
  asOf: string
  source: string
  sourceUrl: string
  holdings: GoldValue
  aum: GoldValue
  monthlyFlowUsd: GoldValue
  monthlyDemand: GoldValue
}

export interface GoldMiningRow {
  country: string
  priorProduction: number
  production: number
  reserves: number
  reserveLifeYears: number | null
  estimated: boolean
}

export interface GoldMining {
  asOf: string
  source: string
  sourceUrl: string
  rows: GoldMiningRow[]
}

export interface GoldDerived {
  latestSupply: GoldValue
  latestDemand: GoldValue
  stockToFlow: GoldValue
}

export interface GoldPayload {
  fetchedAt: string
  market: GoldMarket
  quarterly: GoldQuarterly | null
  aboveGround: GoldAboveGround | null
  etf: GoldEtf | null
  mining: GoldMining | null
  derived: GoldDerived
  progress: Record<GoldBlock, GoldBlockStatus>
}

export interface GoldRequest extends BackgroundRequest {
  force?: boolean
}

/* ------------------------------------------------------- Oil fundamentals */

export const OIL_BLOCKS = ['market', 'curve', 'inventories', 'flows', 'benchmarks'] as const
export type OilBlock = (typeof OIL_BLOCKS)[number]
export type OilBlockStatus = 'loaded' | 'unavailable'
export type OilFrequency = 'live' | 'daily' | 'weekly' | 'derived'
/** `kb` is thousand barrels and `kbd` thousand barrels per day — EIA's own weekly units. */
export type OilUnit = 'usd' | 'usdPerBbl' | 'usdPerGal' | 'kb' | 'kbd' | 'percent' | 'days'

/**
 * One displayed Oil figure with the provenance a mixed-frequency page needs.
 *
 * The page prints a live futures quote beside a weekly EIA survey and a daily OPEC
 * settlement, so a bare number is never enough: `frequency` and `asOf` are what stop a
 * reader treating a five-day-old inventory print as a live one.
 */
export interface OilValue {
  value: number | null
  unit: OilUnit
  asOf: string
  source: string
  frequency: OilFrequency
  note?: string
}

export interface OilMarket {
  wtiPrice: OilValue
  wtiChangePct: OilValue
  brentPrice: OilValue
  brentChangePct: OilValue
  gasolinePrice: OilValue
  gasolineChangePct: OilValue
  dieselPrice: OilValue
  dieselChangePct: OilValue
}

export type OilCurveShape = 'backwardation' | 'contango' | 'flat'

export interface OilCurvePoint {
  symbol: string
  /** Contract month as `MMM YY`, e.g. `Oct 26`. */
  label: string
  monthsOut: number
  price: number
  /** Premium over the front contract, in percent; `null` on the front month itself. */
  premiumPct: number | null
}

export interface OilCurve {
  asOf: string
  source: string
  shape: OilCurveShape
  points: OilCurvePoint[]
  frontPrice: OilValue
  /** Front contract minus the last contract on the strip: positive is backwardation. */
  frontToBackSpread: OilValue
  annualisedRollYield: OilValue
}

export interface OilPoint {
  date: string
  value: number
}

export const OIL_STOCK_KEYS = [
  'crude',
  'spr',
  'cushing',
  'gasoline',
  'distillate',
  'totalPetroleum',
] as const
export const OIL_BENCHMARK_KEYS = [
  'wtiSpot',
  'brentSpot',
  'retailGasoline',
  'retailDiesel',
] as const
export const OIL_FLOW_KEYS = [
  'production',
  'netImports',
  'exports',
  'refinerInput',
  'utilization',
  'productSupplied',
  'gasolineSupplied',
] as const
export type OilStockKey = (typeof OIL_STOCK_KEYS)[number]
export type OilFlowKey = (typeof OIL_FLOW_KEYS)[number]
export type OilBenchmarkKey = (typeof OIL_BENCHMARK_KEYS)[number]
export type OilSeriesKey = OilStockKey | OilFlowKey | OilBenchmarkKey

/** One EIA weekly series, already reduced to the comparisons the page prints. */
export interface OilSeries {
  key: OilSeriesKey
  label: string
  unit: OilUnit
  asOf: string
  latest: number | null
  /** Change against the immediately preceding weekly observation. */
  weekChange: number | null
  yearAgo: number | null
  /** Mean of the same calendar week across the five preceding years. */
  fiveYearAverage: number | null
  /** Latest against that five-year mean, in percent — the headline inventory statistic. */
  deviationPct: number | null
  history: OilPoint[]
}

export interface OilEiaBlock {
  asOf: string
  source: string
  sourceUrl: string
  releaseDate: string | null
  nextReleaseDate: string | null
  series: OilSeries[]
}

export interface OilOpec {
  asOf: string
  source: string
  sourceUrl: string
  basketPrice: OilValue
  dayChange: OilValue
  monthAverage: OilValue
  history: OilPoint[]
}

/**
 * EIA's own weekly price assessments, with the OPEC basket alongside when it is
 * reachable. The basket is optional inside this lane rather than a lane of its own: it is
 * published from behind a WAF that refuses this client, so the panel has to stand up
 * without it.
 */
export interface OilBenchmarks {
  prices: OilEiaBlock
  opec: OilOpec | null
}

export interface OilDerived {
  brentWtiSpread: OilValue
  crackSpread321: OilValue
  daysOfSupply: OilValue
  basketToBrent: OilValue
  spotVsFutures: OilValue
  crudeVsFiveYear: OilValue
}

export interface OilPayload {
  fetchedAt: string
  market: OilMarket
  curve: OilCurve | null
  inventories: OilEiaBlock | null
  flows: OilEiaBlock | null
  benchmarks: OilBenchmarks | null
  derived: OilDerived
  progress: Record<OilBlock, OilBlockStatus>
}

export interface OilRequest extends BackgroundRequest {
  force?: boolean
}

/* ------------------------------------------------------------ heatmap page */

/**
 * The Heatmap page (`mixins/spy_heatmap.py`, page17) — one index ETF's full holdings
 * list, quote-enriched, grouped into sector tiles.
 *
 * The presenters, the interval-return arithmetic and the tile colour ramp live in
 * `shared/heatmap.ts` beside each other, so the page, the main process and the probe
 * cannot disagree about what a tile is worth. The intervals are `HeatmapInterval` —
 * `_P17_INTERVALS` and the Portfolio Heatmap's `_P4_HEATMAP_INTERVALS` are the same
 * seven windows, and the reference shares them too.
 */
export type HeatmapEtfKey = 'SPY' | 'NDX' | 'DJI'

/** `EtfHeatmapHolding`. `weight` is a fraction: 0.0873 prints as 8.73%. */
export interface HeatmapHolding {
  symbol: string
  name: string
  sector: string
  weight: number
  price: number | null
  /**
   * Percent change per interval. A key is *absent* when that window had no usable base,
   * which is what makes the per-interval quote coverage a real number rather than a
   * count of rows.
   */
  changes: Partial<Record<HeatmapInterval, number>>
}

/** Only what the summary strip prints; the reference carries the whole holding. */
export interface HeatmapHoldingSummary {
  symbol: string
  changePct: number
}

/** `EtfHeatmapIntervalSummary`. */
export interface HeatmapIntervalSummary {
  quoteCoverage: number
  weightedMove: number | null
  strongest: HeatmapHoldingSummary | null
  weakest: HeatmapHoldingSummary | null
}

/** `EtfHeatmapResult`. The top-level figures repeat the `live` summary, as it does. */
export interface HeatmapPayload {
  etf: HeatmapEtfKey
  /** The ETF actually fetched — SPY, QQQ or DIA — as opposed to the index label. */
  ticker: string
  fundName: string
  issuer: string
  asOfDate: string
  sourceUrl: string
  holdings: HeatmapHolding[]
  holdingsLoaded: number
  quoteCoverage: number
  weightedDayMove: number | null
  strongest: HeatmapHoldingSummary | null
  weakest: HeatmapHoldingSummary | null
  intervalSummaries: Record<HeatmapInterval, HeatmapIntervalSummary>
  /** Epoch milliseconds; the summary strip prints its clock tail. */
  fetchedAt: number
}

export interface HeatmapRequest extends BackgroundRequest {
  etf: HeatmapEtfKey
  force?: boolean
}

/* ---------------------------------------------------------------- etf page */

/**
 * The ETF page (`mixins/etf_analyser.py`, page13) — any US ETF's full holdings list
 * from its issuer's own published file, with an ETF-versus-basket arbitrage subtab and
 * a left rail ranking the whole US ETF universe by net assets.
 *
 * `EtfHolding` in `etf_holdings.py`; `weight` is a fraction, so `0.0873` prints 8.73%.
 * It stays nullable here because the Yahoo fallback can answer a row without one, and
 * the reference sorts those to the bottom rather than dropping them.
 */
export interface EtfHoldingRow {
  symbol: string
  name: string
  weight: number | null
  sector: string
}

/** One entry of `sector_breakdown`, which is a percentage and not a fraction. */
export interface EtfSectorSlice {
  sector: string
  percent: number
}

/** `EtfHoldingsResult`. The two money fields arrive pre-formatted, as they do there. */
export interface EtfHoldingsPayload {
  ticker: string
  fundName: string
  issuer: string
  asOfDate: string
  /** `'--'` when no source carried one, matching the dataclass default. */
  expenseRatio: string
  netAssets: string
  holdings: EtfHoldingRow[]
  /** Highest first, as `_enrich_with_yfinance` sorts it. */
  sectorBreakdown: EtfSectorSlice[]
  sourceUrl: string
  /** True for the Yahoo fallback, which is a top-holdings list rather than the book. */
  isPartial: boolean
  coverageNote: string
  fetchedAt: number
}

/** One quoted basket component. `weight` is the issuer weight, before normalisation. */
export interface EtfArbitrageRow {
  symbol: string
  name: string
  weight: number
  price: number
  movePct: number
  /** The weight re-based over the holdings that answered, which is what the gap uses. */
  normalizedWeight: number
  contributionPct: number
}

/** `build_etf_arbitrage_snapshot`'s dict. */
export interface EtfArbitragePayload {
  ticker: string
  /** Epoch milliseconds; `generated_at` is an ISO string there. */
  generatedAt: number
  etfPrice: number | null
  etfMovePct: number | null
  basketMovePct: number | null
  gapPctPoints: number | null
  gapBps: number | null
  signal: string
  quoteCoverage: number
  totalHoldings: number
  quotedWeight: number
  loadedWeight: number
  rows: EtfArbitrageRow[]
}

/** One row of the `ETF by AUM` rail. */
export interface EtfAumRow {
  ticker: string
  netAssets: number
}

export interface EtfAumPayload {
  rows: EtfAumRow[]
  /** Yahoo's own `total`, which the loaded rows can fall short of. */
  totalCount: number
  missingCount: number
  fetchedAt: number
}

export interface EtfHoldingsRequest {
  ticker: string
  force?: boolean
}

/**
 * Arbitrage takes only the ticker: the holdings it compares against are the cached ones
 * the main process already loaded, so a five-hundred-row basket does not cross IPC twice
 * just to be quoted.
 */
export interface EtfArbitrageRequest {
  ticker: string
  force?: boolean
}

export interface EtfAumRequest extends BackgroundRequest {
  force?: boolean
}

/* ------------------------------------------------------------ up/down page */

export type UpDownSource = 'portfolio' | 'spy' | 'qqq' | 'custom'
export type UpDownInterval = '1d' | '5d' | '30d' | 'ytd' | '1y'

export interface UpDownRow {
  ticker: string
  name: string
  lastClose: number | null
  intervalReturn: number | null
  tradingDays: number
  daysUp: number
  daysDown: number
  flatDays: number
}

export interface UpDownPayload {
  source: UpDownSource
  interval: UpDownInterval
  rows: UpDownRow[]
  missing: string[]
  /** Local `YYYY-MM-DD HH:mm`, matching the reference page. */
  asOf: string
  dataSource: string
  holdingsSource: string
  /** A forced base refresh also bypasses the analyst-target cache. */
  forceTargets: boolean
}

export interface UpDownRequest extends BackgroundRequest {
  source: UpDownSource
  interval: UpDownInterval
  /** Used by Portfolio and Custom. ETF sources resolve their official holdings in main. */
  symbols?: string[]
  force?: boolean
}

export interface UpDownTargetsRequest {
  tickers: string[]
  force?: boolean
}

export interface UpDownTargetsPayload {
  targets: Record<string, number | null>
  resolved: number
  available: number
}

/* ------------------------------------------------------------ options page */

/**
 * The Options page (`mixins/options_chain.py`, page5) — three subtabs over two loads.
 *
 * The row shapes themselves live in `shared/optionsPage.ts` beside the maths that
 * produces them, so the Greeks, the strategy ranking and the summary tables cannot
 * drift between the main process, the renderer and the probe.
 */
export type {
  OptionsChainRow,
  OptionsExpirationBucket,
  OptionsRawRow,
  OptionsStrategy,
  OptionsTypeFilter,
} from './optionsPage.js'

/** One block of the Options page that could not refresh; the panel shows its own dot. */
export interface OptionsPageFailure {
  /** `Chain`, `Expirations`, or the ISO expiry whose own panel failed. */
  block: string
  reason: string
}

export interface OptionsChainRequest {
  symbol: string
  /** Empty, or an expiry no longer listed, falls back to the nearest live one. */
  expiry?: string
  force?: boolean
}

export interface OptionsChainPayload {
  symbol: string
  /** Every live expiration, with the `YYYY-MM-DD (Nd)` label the dropdown prints. */
  expiries: Array<{ expiry: string; label: string }>
  /** The expiration `rows` belongs to. */
  expiry: string
  spotPrice: number
  /** `_p5_resolve_greek_inputs`: the ^IRX proxy, or the 0.04 config default. */
  riskFreeRate: number
  rateSource: 'market' | 'config'
  dividendYield: number
  dividendSource: 'ticker' | 'default'
  rows: import('./optionsPage.js').OptionsChainRow[]
  generatedAt: number
}

export interface OptionsExpirationsRequest {
  symbol: string
  force?: boolean
}

export interface OptionsExpirationsPayload {
  symbol: string
  spotPrice: number
  /** Yahoo's latest underlying regular-market session, formatted as `YYYY-MM-DD` in New York. */
  marketDate: string
  /** The raw chain for every live expiration, ascending. */
  buckets: import('./optionsPage.js').OptionsExpirationBucket[]
  /** The sorted union of every strike quoted across those chains. */
  strikes: number[]
  generatedAt: number
}

/* -------------------------------------------------------- projections page */

/**
 * The Projections page (`mixins/charts_options_top_volume.py`, page28) — one load that
 * answers with a chart and every live expiration's raw chain.
 *
 * The maths that turns those chains into the three projected paths lives in
 * `shared/projections.ts`, and the renderer runs it: the chains are the expensive part
 * and the summaries are a pure function of them plus the latest chart close, so
 * switching the table between calls and puts repaints what is already loaded.
 */
export type {
  ProjectionAggregate,
  ProjectionModel,
  ProjectionPaths,
  ProjectionPoint,
  ProjectionSide,
  ProjectionSummary,
  ProjectionsTypeFilter,
} from './projections.js'

/** One block of the Projections page that could not load; the panel shows its own dot. */
export interface ProjectionsFailure {
  /** `Chart`, `Expirations`, or the ISO expiry whose own panel failed. */
  block: string
  reason: string
}

export interface ProjectionsRequest {
  symbol: string
  timeframe: ChartsInterval
  force?: boolean
}

export interface ProjectionsPayload {
  symbol: string
  timeframe: ChartsInterval
  /** The interval actually fetched, `4h` included. */
  interval: string
  candles: Candle[]
  stats: ChartStats | null
  /**
   * Why the chart is empty, when it is. A missing chart is not fatal here: the
   * reference keeps the option tables and only drops the projections, which need a
   * close to anchor on.
   */
  chartError: string
  spotPrice: number
  /** Yahoo's latest underlying regular-market session, used to validate last-trade fallbacks. */
  marketDate: string
  /** Every live expiration's raw chain, ascending, as the Options sweep returns it. */
  buckets: import('./optionsPage.js').OptionsExpirationBucket[]
  generatedAt: number
}

/* ---------------------------------------------------------- valuation page */

/**
 * The Valuation page (`mixins/valuation.py`, page23) — a DCF over reported statements.
 *
 * The maths itself lives in `shared/valuation.ts`, beside the derivation that produces the
 * assumptions, because the renderer re-solves the model on every assumption edit and must
 * not be able to disagree with the load. Peer selection lives in `shared/valuationPeers.ts`.
 */
export type {
  ValuationAnalystEstimates,
  ValuationAssumptions,
  ValuationBasisType,
  ValuationComponents,
  ValuationFairValueDetails,
  ValuationMarketContext,
  ValuationMetrics,
  ValuationPeerRow,
  ValuationScenarioRow,
  ValuationScenarios,
  ValuationSuggestionBundle,
  ValuationTerminalMethod,
  ValuationTrends,
} from './valuation.js'

/** Where one valuation input actually came from, for the Sources tab's citations. */
export interface ValuationProvenanceEntry {
  metric: string
  source: string
  basis: string
  period: string
  facts: string[]
}

export interface ValuationPricePoint {
  date: string
  close: number
}

export interface ValuationPayload {
  ticker: string
  metrics: import('./valuation.js').ValuationMetrics
  trends: import('./valuation.js').ValuationTrends
  /** Five years of monthly closes, behind the fair-value band and the P/E curve. */
  priceHistory: ValuationPricePoint[]
  /** Null when every Treasury tier failed; the required return then uses the heuristic. */
  market: import('./valuation.js').ValuationMarketContext | null
  analyst: import('./valuation.js').ValuationAnalystEstimates
  suggestions: import('./valuation.js').ValuationSuggestionBundle
  peerRows: import('./valuation.js').ValuationPeerRow[]
  peerWarnings: string[]
  customPeers: string[]
  statementSource: string
  secBacked: boolean
  provenance: ValuationProvenanceEntry[]
  sources: {
    quote: string
    statements: string
    computed: string
    suggestions: string
  }
  generatedAt: number
}

export interface ValuationRequest {
  symbol: string
  /** Saved per-ticker in the renderer; a change to it re-ranks the peer table. */
  customPeers?: string[]
  force?: boolean
}

/* ---------------------------------------------------------------- channels */

/* ------------------------------------------------------------ backtest page */

export const BACKTEST_INTERVALS = ['1D', '1W'] as const
export type BacktestInterval = (typeof BACKTEST_INTERVALS)[number]
export const BACKTEST_RANGES = ['Max', '5Y', '3Y', '1Y', 'YTD'] as const
export type BacktestRange = (typeof BACKTEST_RANGES)[number]

export interface BacktestRow {
  symbol: string
  weight: number
}

export interface BacktestPageSettings {
  rows: BacktestRow[]
  compareSymbol: string
  interval: BacktestInterval
  range: BacktestRange
  splitterSizes: number[]
}

export interface BacktestPriceSeries {
  dates: string[]
  values: number[]
}

export interface BacktestPoint {
  date: string
  portfolioReturnPct: number
  drawdownPct: number
  compareReturnPct: number | null
}

export interface BacktestStats {
  start: string
  end: string
  totalReturnPct: number
  cagrPct: number
  maxDrawdownPct: number
  finalValue: number
}

export interface BacktestPayload {
  rows: BacktestRow[]
  weights: Record<string, number>
  rawWeightTotal: number
  compareSymbol: string
  compareError: string
  points: BacktestPoint[]
  stats: BacktestStats | null
}

export interface BacktestRequest {
  rows: BacktestRow[]
  compareSymbol: string
  interval: BacktestInterval
  range: BacktestRange
  force?: boolean
}

/* --------------------------------------------------------------- quant page */

export type QuantActiveTab = 'screener' | 'pairs'
export type QuantScreenFilter =
  | 'all'
  | 'top_quartile'
  | 'momentum'
  | 'oversold'
  | 'overbought'
  | 'low_volatility'
export type QuantPairFilter = 'all' | 'stationary' | 'stretched' | 'fast'

export interface QuantPageSettings {
  activeTab: QuantActiveTab
  screenFilter: QuantScreenFilter
  pairFilter: QuantPairFilter
  search: string
  pairLeft: string
  pairRight: string
}

export interface QuantScreenRow {
  ticker: string
  name: string
  exchange: string
  lastPrice: number | null
  marketCap: number | null
  medianDollarVolume: number | null
  momentum1m: number | null
  momentum3m: number | null
  momentum6m: number | null
  momentum12m: number | null
  volatilityPct: number | null
  sharpe: number | null
  maxDrawdownPct: number | null
  zScore: number | null
  rsi: number | null
  composite: number | null
  rank: number
  observations: number
}

export interface QuantPairRow {
  left: string
  right: string
  correlation: number | null
  hedgeRatio: number | null
  spreadZ: number | null
  halfLife: number | null
  hurst: number | null
  dickeyFuller: number | null
  stationaryAt: string
  score: number | null
  rank: number
  observations: number
}

export interface QuantScanPayload {
  rows: QuantScreenRow[]
  pairs: QuantPairRow[]
  source: string
  sourcedAt: string
  startedAt: string
  completedAt: string
  universeSize: number
  errors: Record<string, string>
  universeFromCache: boolean
}

export interface QuantPairPoint {
  date: string
  spreadZ: number | null
  leftIndexed: number
  rightIndexed: number
  rollingCorrelation: number | null
}

export interface QuantPairDetail {
  left: string
  right: string
  hedgeRatio: number | null
  intercept: number | null
  latestZ: number | null
  correlation: number | null
  halfLife: number | null
  dickeyFuller: number | null
  stationaryAt: string
  hurst: number | null
  score: number | null
  observations: number
  points: QuantPairPoint[]
}

export interface QuantScanRequest {
  forceUniverseRefresh?: boolean
  latestOnly?: boolean
}

export interface QuantPairRequest {
  left: string
  right: string
  force?: boolean
}

/* ---------------------------------------------------------------- roll page */

/**
 * The Roll page, ported from `mixins/random_recommender.py` and
 * `workers/random_recommender.py` (page18). The scoring, the six pattern evaluators and
 * the candidate draw all live in `shared/roll.ts`; these are only the shapes that cross
 * IPC.
 */

/** The screener/quote fields the scorer reads. Yahoo returns far more; none of it is used. */
export interface RollQuote {
  symbol?: string
  quoteType?: string
  longName?: string
  shortName?: string
  displayName?: string
  sector?: string
  sectorDisp?: string
  exchange?: string
  fullExchangeName?: string
  currency?: string
  regularMarketPrice?: number
  regularMarketPreviousClose?: number
  regularMarketChange?: number
  regularMarketChangePercent?: number
  fiftyTwoWeekChangePercent?: number
  fiftyTwoWeekLow?: number
  fiftyTwoWeekHigh?: number
  marketCap?: number
  trailingPE?: number
  forwardPE?: number
  epsForward?: number
  beta?: number
  dividendYield?: number
  targetMeanPrice?: number
  averageAnalystRating?: string
  averageDailyVolume3Month?: number
  averageDailyVolume10Day?: number
}

/** `match_tier`: how the candidate earned its place in the pool. */
export type RollMatchTier = 'strict' | 'near' | 'fallback' | 'unavailable'

/** `_compact_candidate`: one row of the Scored Candidates table. */
export interface RollCandidate {
  rank: number
  symbol: string
  name: string
  sector: string
  score: number
  reasons: string[]
  dayChangePct: number | null
  fiftyTwoWeekChangePct: number | null
  averageVolume: number | null
  marketCap: number | null
  matchTier: RollMatchTier
  matchedModes: string[]
  primaryPatternMode: string
  patternMatch: boolean
  patternType: string
  patternScore: number
  patternReasons: string[]
  patternFallbackReason: string
  /** Per-mode `technical_snapshot`, keyed by pattern mode. Drives the Why panel. */
  technicalSnapshot: Record<string, Record<string, number | string | boolean | null>>
}

/** The company facts the left rail prints, merged from `quoteSummary` over the screener quote. */
export interface RollCompanyInfo {
  name: string
  exchange: string
  sector: string
  industry: string
  currency: string
  price: number | null
  previousClose: number | null
  change: number | null
  changePercent: number | null
  marketCap: number | null
  revenue: number | null
  profitMargin: number | null
  trailingPe: number | null
  forwardPe: number | null
  priceToSales: number | null
  beta: number | null
  dividendYield: number | null
  fiftyTwoWeekLow: number | null
  fiftyTwoWeekHigh: number | null
  averageVolume: number | null
  meanTarget: number | null
  website: string
  irUrl: string
}

/** `_chart_payload_from_frame`, as the 1Y snapshot draws it. */
export interface RollChartBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** One row of Top Options By Expiration: the highest-volume contract on that expiry. */
export interface RollTopOption {
  ticker: string
  type: string
  expiration: string
  strike: number | null
  lastPrice: number | null
  volume: number | null
  openInterest: number | null
  impliedVolatility: number | null
}

export interface RollNewsRow {
  ticker: string
  title: string
  source: string
  url: string
  publishedAt: number
}

/** One completed roll. */
export interface RollPayload {
  symbol: string
  info: RollCompanyInfo
  candidatePool: RollCandidate[]
  candidateRank: number
  candidateScore: number
  candidateReasons: string[]
  universeTotal: number
  screeningSummary: string
  patternModes: string[]
  matchTier: RollMatchTier
  matchedModes: string[]
  primaryPatternMode: string
  patternMatch: boolean
  patternType: string
  patternScore: number
  patternReasons: string[]
  patternFallbackReason: string
  technicalSnapshot: Record<string, Record<string, number | string | boolean | null>>
  chart: RollChartBar[]
  chartStatus: string
  topOptions: RollTopOption[]
  topOptionsStatus: string
  news: RollNewsRow[]
  newsStatus: string
  warnings: string[]
  rolledAt: number
}

export interface RollRequest {
  /** Selected pattern checkboxes. Empty means the balanced roll. */
  patternModes?: string[]
  /** Symbols already held, pushed down the ranking so a roll surfaces something new. */
  excludeSymbols?: string[]
  /** Symbols already rolled this session, pushed down less hard. */
  historySymbols?: string[]
  /** Set when re-opening a row of Roll History: skips the screen and loads this name. */
  targetSymbol?: string
  force?: boolean
}

/* --------------------------------------------------------------------- ipo */

/**
 * The IPO page (`mixins/ipo_page.py`, page21) — two independent scrapes of
 * stockanalysis.com: completed IPOs for one year, and every upcoming US IPO through
 * 31 December.
 *
 * Every cell except the date is the scraped text itself. The reference passes those
 * strings straight into its table and never parses a dollar figure, so neither does this:
 * a missing value is the literal `'--'`, not a `null` this app would then have to format.
 * `shared/ipo.ts` owns the windows, the dedupe and the sort keys those strings need.
 */
export interface UpcomingIpoRow {
  /** ISO `YYYY-MM-DD`, which is also what the table sorts the date column on. */
  date: string
  /** `Mmm DD, YYYY`, the reference's `%b %d, %Y`. */
  dateDisplay: string
  symbol: string
  company: string
  exchange: string
  priceRange: string
  sharesOffered: string
  dealSize: string
  marketCap: string
  revenue: string
}

/** `Return` is `returnPct` here only because `return` is a reserved word. */
export interface CompletedIpoRow {
  date: string
  dateDisplay: string
  symbol: string
  company: string
  ipoPrice: string
  currentPrice: string
  returnPct: string
}

interface IpoPayloadBase {
  source: string
  sourceUrl: string
  /** Epoch ms of the fetch behind these rows; 0 when nothing has ever been fetched. */
  fetchedAt: number
  fromCache: boolean
  cacheAgeSeconds: number | null
  /** True when a failed refresh fell back to the cache; `warning` then names the failure. */
  stale: boolean
  warning: string
}

export interface IpoUpcomingPayload extends IpoPayloadBase {
  rows: UpcomingIpoRow[]
  /** The `YYYY-12-31` the window ends on, so the status line need not recompute it. */
  endDate: string
  /** Always true. The reference labels every upcoming date an estimate. */
  estimatedDates: boolean
}

export interface IpoCompletedPayload extends IpoPayloadBase {
  rows: CompletedIpoRow[]
  year: number
}

export interface IpoUpcomingRequest extends BackgroundRequest {
  force?: boolean
}

export interface IpoCompletedRequest extends BackgroundRequest {
  /** Defaults to the current year, which is the only one the reference ever asks for. */
  year?: number
  force?: boolean
}

/* ---------------------------------------------------------------- politics */

export type PoliticsParty = 'Democrat' | 'Republican' | 'Independent' | 'Unknown'

export interface PoliticsTrade {
  politician: string
  chamber: string
  party: PoliticsParty
  ticker: string
  assetDescription: string
  theme: string
  tradeType: string
  amount: string
  amountValue: number
  transactionDate: string
  disclosureDate: string
}

export interface PoliticsPagePayload {
  page: number
  trades: PoliticsTrade[]
  /** Rows on this page as the source returned them; equals `trades.length`. */
  rawCount: number
  /** Trades across every page, from the source's paginator; 0 when it could not be read. */
  totalCount: number
  totalPages: number
  fetchedAt: number
  fromCache: boolean
  cacheAgeSeconds: number | null
  stale: boolean
  warning: string
}

export interface PoliticsExportPayload {
  trades: PoliticsTrade[]
  pagesFetched: number
  /** Pages the source says exist, so a capped export can say what it left behind. */
  totalPages: number
  fetchedAt: number
}

export interface PoliticsPageRequest extends BackgroundRequest {
  page?: number
  force?: boolean
}

export interface PoliticsExportRequest {
  /** The reference export reads pages 1 through 5; the page offers deeper pulls. */
  pages?: number
}

export const CHANNELS = {
  quotes: 'dashboard:quotes',
  chart: 'dashboard:chart',
  options: 'dashboard:options',
  targets: 'dashboard:targets',
  news: 'dashboard:news',
  newsPage: 'news:read',
  newsTickerSearch: 'news:ticker-search',
  newsArticle: 'news:article',
  newsThumbnail: 'news:thumbnail',
  portfolio: 'dashboard:portfolio',
  portfolioMutate: 'portfolio:mutate',
  cards: 'cards:read',
  cardsMutate: 'cards:mutate',
  cardsPerformance: 'cards:performance',
  personalFinance: 'finance:read',
  personalFinanceMutate: 'finance:mutate',
  fx: 'finance:fx',
  globalMarkets: 'global:markets',
  preMarket: 'pre-market:read',
  tradingVolumes: 'trading-volumes:read',
  signals: 'signals:scan',
  marketCapSales: 'market-cap:sales',
  marketCap: 'market-cap:screen',
  priceScreen: 'price:screen',
  calendarMonth: 'calendar:month',
  earningsCalendar: 'calendar:earnings',
  forexQuotes: 'forex:quotes',
  forexHistory: 'forex:history',
  forexNews: 'forex:news',
  crypto: 'crypto:read',
  bmnr: 'bmnr:read',
  gold: 'gold:read',
  oil: 'oil:read',
  heatmap: 'heatmap:read',
  etfHoldings: 'etf:holdings',
  etfArbitrage: 'etf:arbitrage',
  etfAum: 'etf:aum',
  upDown: 'up-down:read',
  upDownTargets: 'up-down:targets',
  stocks: 'stocks:read',
  optionsChain: 'options:chain',
  optionsExpirations: 'options:expirations',
  projections: 'projections:read',
  valuation: 'valuation:read',
  economic: 'economic:read',
  institutionActivity: 'institutions:activity',
  institutionTickerActivity: 'institutions:ticker-activity',
  roll: 'roll:read',
  ipoUpcoming: 'ipo:upcoming',
  ipoCompleted: 'ipo:completed',
  politicsPage: 'politics:page',
  politicsExport: 'politics:export',
  backtest: 'backtest:run',
  quantScan: 'quant:scan',
  quantPair: 'quant:pair',
  youtube: 'youtube:read',
  youtubeThumbnail: 'youtube:thumbnail',
  fundamentals: 'dashboard:fundamentals',
  fundamentalsPage: 'fundamentals:read',
  chartsHistory: 'charts:history',
  chartsCompare: 'charts:compare',
  chartsRelationship: 'charts:relationship',
  returns: 'portfolio:returns',
  momentum: 'portfolio:momentum',
  analytics: 'portfolio:analytics',
  optionQuotes: 'portfolio:option-quotes',
  portfolioChanged: 'dashboard:portfolio-changed',
  settings: 'settings:read',
  settingsMutate: 'settings:mutate',
  maintenance: 'settings:maintenance',
  openExternal: 'shell:openExternal',
  saveText: 'shell:saveText',
  writeClipboard: 'shell:writeClipboard',
  windowControl: 'window:control',
} as const

export interface QuotesRequest extends BackgroundRequest {
  holdings: string[]
}
export interface ChartRequest {
  symbol: string
  timeframe: TimeframeLabel
  force?: boolean
}
export interface OptionsRequest {
  symbol: string
  force?: boolean
}
export interface TargetsRequest extends BackgroundRequest {
  tickers: string[]
  force?: boolean
}
export interface NewsRequest extends BackgroundRequest {
  tickers: string[]
  force?: boolean
}
export interface FundamentalsRequest extends BackgroundRequest {
  tickers: string[]
  force?: boolean
}
export interface FundamentalsPageRequest extends BackgroundRequest {
  symbol: string
  force?: boolean
}
export interface ReturnsRequest {
  tickers: string[]
  window: ReturnTimeframe | HeatmapInterval
  force?: boolean
}
export interface MomentumRequest {
  positions: PositionInput[]
  cashAmount: number
  timeframe: ReturnTimeframe
  force?: boolean
}
export interface AnalyticsRequest {
  positions: PositionInput[]
  cashAmount: number
  currentValues: Record<string, number>
  benchmarkSymbol: string
  lookback: MetricsLookback
  force?: boolean
}
export interface OptionQuotesRequest {
  positions: Array<{ rowId: string; ticker: string; expiry: string; strike: number; strategy: string }>
  force?: boolean
}
export interface OptionQuotesPayload {
  quotes: Record<
    string,
    { currentPrice: number; volume: number; openInterest: number; impliedVolatility: number }
  >
  expiries: Record<string, string[]>
}

export interface FxRequest extends BackgroundRequest {
  force?: boolean
}

export type WindowAction = 'minimize' | 'maximize' | 'close'

export interface DesktopApi {
  quotes(request: QuotesRequest): Promise<Envelope<QuotesPayload>>
  chart(request: ChartRequest): Promise<Envelope<ChartPayload>>
  chartsHistory(request: ChartsHistoryRequest): Promise<Envelope<ChartsHistoryPayload>>
  chartsCompare(request: ChartsCompareRequest): Promise<Envelope<ChartsComparePayload>>
  chartsRelationship(request: ChartsRelationshipRequest): Promise<Envelope<ChartsRelationshipPayload>>
  options(request: OptionsRequest): Promise<Envelope<OptionsPayload>>
  targets(request: TargetsRequest): Promise<Envelope<TargetsPayload>>
  news(request: NewsRequest): Promise<Envelope<NewsPayload>>
  newsPage(request: NewsPageRequest): Promise<Envelope<NewsPagePayload>>
  newsTickerSearch(
    request: NewsTickerSearchRequest,
  ): Promise<Envelope<NewsTickerSearchPayload>>
  newsArticle(request: NewsPreviewRequest): Promise<Envelope<NewsPreviewPayload>>
  newsThumbnail(request: NewsThumbnailRequest): Promise<Envelope<NewsThumbnailPayload>>
  portfolio(): Promise<Envelope<PortfolioPayload>>
  mutatePortfolio(mutation: PortfolioMutation): Promise<Envelope<PortfolioPayload>>
  cards(): Promise<Envelope<CardsPayload>>
  mutateCards(mutation: CardsMutation): Promise<Envelope<CardsPayload>>
  cardsPerformance(
    request: CardsPerformanceRequest,
  ): Promise<Envelope<CardsPerformancePayload>>
  personalFinance(): Promise<Envelope<PersonalFinancePayload>>
  mutatePersonalFinance(
    mutation: PersonalFinanceMutation,
  ): Promise<Envelope<PersonalFinancePayload>>
  fx(request: FxRequest): Promise<Envelope<FxPayload>>
  globalMarkets(request: GlobalMarketsRequest): Promise<Envelope<GlobalMarketsPayload>>
  preMarket(request: PreMarketRequest): Promise<Envelope<PreMarketPayload>>
  tradingVolumes(request: TradingVolumesRequest): Promise<Envelope<TradingVolumesPayload>>
  signals(request: SignalsRequest): Promise<Envelope<SignalsPayload | null>>
  marketCapSales(request: { symbols: string[]; force?: boolean }): Promise<Envelope<Record<string, number | null>>>
  marketCap(request: MarketCapRequest): Promise<Envelope<MarketCapPayload>>
  priceScreen(request: PriceScreenRequest): Promise<Envelope<PriceScreenPayload>>
  calendarMonth(request: CalendarMonthRequest): Promise<Envelope<CalendarMonthPayload>>
  earningsCalendar(
    request: EarningsCalendarRequest,
  ): Promise<Envelope<EarningsCalendarPayload>>
  forexQuotes(request: ForexRequest): Promise<Envelope<ForexQuotesPayload>>
  forexHistory(request: ForexHistoryRequest): Promise<Envelope<ForexHistoryPayload>>
  forexNews(request: ForexPairRequest): Promise<Envelope<ForexNewsPayload>>
  crypto(request: CryptoRequest): Promise<Envelope<CryptoPayload>>
  bmnr(request: BmnrRequest): Promise<Envelope<BmnrPayload>>
  gold(request: GoldRequest): Promise<Envelope<GoldPayload>>
  oil(request: OilRequest): Promise<Envelope<OilPayload>>
  heatmap(request: HeatmapRequest): Promise<Envelope<HeatmapPayload>>
  etfHoldings(request: EtfHoldingsRequest): Promise<Envelope<EtfHoldingsPayload>>
  etfArbitrage(request: EtfArbitrageRequest): Promise<Envelope<EtfArbitragePayload>>
  etfAum(request: EtfAumRequest): Promise<Envelope<EtfAumPayload>>
  upDown(request: UpDownRequest): Promise<Envelope<UpDownPayload>>
  upDownTargets(request: UpDownTargetsRequest): Promise<Envelope<UpDownTargetsPayload>>
  stocks(request: StocksRequest): Promise<Envelope<StocksPayload>>
  optionsChain(request: OptionsChainRequest): Promise<Envelope<OptionsChainPayload>>
  optionsExpirations(
    request: OptionsExpirationsRequest,
  ): Promise<Envelope<OptionsExpirationsPayload>>
  projections(request: ProjectionsRequest): Promise<Envelope<ProjectionsPayload>>
  valuation(request: ValuationRequest): Promise<Envelope<ValuationPayload>>
  economic(request: EconomicRequest): Promise<Envelope<EconomicPayload>>
  institutionActivity(
    request: InstitutionActivityRequest,
  ): Promise<Envelope<InstitutionActivityPayload>>
  institutionTickerActivity(
    request: InstitutionTickerActivityRequest,
  ): Promise<Envelope<InstitutionTickerActivityPayload>>
  roll(request: RollRequest): Promise<Envelope<RollPayload | null>>
  ipoUpcoming(request: IpoUpcomingRequest): Promise<Envelope<IpoUpcomingPayload>>
  ipoCompleted(request: IpoCompletedRequest): Promise<Envelope<IpoCompletedPayload>>
  politicsPage(request: PoliticsPageRequest): Promise<Envelope<PoliticsPagePayload>>
  politicsExport(request: PoliticsExportRequest): Promise<Envelope<PoliticsExportPayload>>
  backtest(request: BacktestRequest): Promise<Envelope<BacktestPayload>>
  quantScan(request: QuantScanRequest): Promise<Envelope<QuantScanPayload | null>>
  quantPair(request: QuantPairRequest): Promise<Envelope<QuantPairDetail | null>>
  youtube(request: YouTubeRequest): Promise<Envelope<YouTubePayload>>
  youtubeThumbnail(
    request: YouTubeThumbnailRequest,
  ): Promise<Envelope<YouTubeThumbnailPayload>>
  fundamentals(request: FundamentalsRequest): Promise<Envelope<FundamentalsPayload>>
  fundamentalsPage(request: FundamentalsPageRequest): Promise<Envelope<FundamentalsPagePayload>>
  returns(request: ReturnsRequest): Promise<Envelope<ReturnsPayload>>
  momentum(request: MomentumRequest): Promise<Envelope<MomentumPayload>>
  analytics(request: AnalyticsRequest): Promise<Envelope<AnalyticsPayload>>
  optionQuotes(request: OptionQuotesRequest): Promise<Envelope<OptionQuotesPayload>>
  settings(): Promise<Envelope<AppSettings>>
  mutateSettings(mutation: AppSettingsMutation): Promise<Envelope<AppSettings>>
  maintenance(action: MaintenanceAction): Promise<Envelope<MaintenanceResult>>
  openExternal(url: string): Promise<void>
  saveText(suggestedName: string, contents: string): Promise<string | null>
  writeClipboard(contents: string): Promise<void>
  windowControl(action: WindowAction): Promise<void>
  onPortfolioChanged(listener: () => void): () => void
}
