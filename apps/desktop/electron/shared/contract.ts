/**
 * The IPC contract shared verbatim by the Electron main process and the renderer.
 *
 * Every handler answers with an `Envelope<T>`: the payload plus freshness metadata and
 * the non-fatal errors that came with it. This mirrors `attach_market_data_result` in
 * the PySide6 app (`data_service/results.py`) so a panel whose upstream call failed
 * degrades on its own instead of blanking the page.
 */

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

export interface NewsPayload {
  items: NewsItem[]
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
  { id: 'global', label: 'Global', implemented: false },
  { id: 'portfolio', label: 'Portfolio', implemented: true },
  { id: 'cards', label: 'Cards', implemented: false },
  { id: 'personal-finance', label: 'Personal Finance', implemented: true },
  { id: 'pre-market', label: 'Pre-Market', implemented: false },
  { id: 'up-down', label: 'Up/Down', implemented: false },
  { id: 'trading-volumes', label: 'Trading Volumes', implemented: false },
  { id: 'signals', label: 'Signals', implemented: false },
  { id: 'price', label: 'Price', implemented: false },
  { id: 'heatmap', label: 'Heatmap', implemented: false },
  { id: 'news', label: 'News', implemented: false },
  { id: 'calendar', label: 'Calendar', implemented: false },
  { id: 'stocks', label: 'Stocks', implemented: false },
  { id: 'fundamentals', label: 'Fundamentals', implemented: false },
  { id: 'valuation', label: 'Valuation', implemented: false },
  { id: 'charts', label: 'Charts', implemented: false },
  { id: 'projections', label: 'Projections', implemented: false },
  { id: 'options', label: 'Options', implemented: false },
  { id: 'etf', label: 'ETF', implemented: false },
  { id: 'crypto', label: 'Crypto', implemented: false },
  { id: 'backtest', label: 'Backtest', implemented: false },
  { id: 'roll', label: 'Roll', implemented: false },
  { id: 'ipo', label: 'IPO', implemented: false },
  { id: 'institutions', label: 'Institutions', implemented: false },
  { id: 'politics', label: 'Politics', implemented: false },
  { id: 'youtube', label: 'YouTube', implemented: false },
  { id: 'dictionary', label: 'Dictionary', implemented: false },
  { id: 'quant', label: 'Quant', implemented: false },
  { id: 'economic', label: 'Economic', implemented: false },
  { id: 'settings', label: 'Settings', implemented: true },
]

/* ---------------------------------------------------------------- channels */

export const CHANNELS = {
  quotes: 'dashboard:quotes',
  chart: 'dashboard:chart',
  options: 'dashboard:options',
  targets: 'dashboard:targets',
  news: 'dashboard:news',
  portfolio: 'dashboard:portfolio',
  portfolioMutate: 'portfolio:mutate',
  personalFinance: 'finance:read',
  personalFinanceMutate: 'finance:mutate',
  fx: 'finance:fx',
  fundamentals: 'dashboard:fundamentals',
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
  windowControl: 'window:control',
} as const

export interface QuotesRequest {
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
export interface TargetsRequest {
  tickers: string[]
  force?: boolean
}
export interface NewsRequest {
  tickers: string[]
  force?: boolean
}
export interface FundamentalsRequest {
  tickers: string[]
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

export interface FxRequest {
  force?: boolean
}

export type WindowAction = 'minimize' | 'maximize' | 'close'

export interface DesktopApi {
  quotes(request: QuotesRequest): Promise<Envelope<QuotesPayload>>
  chart(request: ChartRequest): Promise<Envelope<ChartPayload>>
  options(request: OptionsRequest): Promise<Envelope<OptionsPayload>>
  targets(request: TargetsRequest): Promise<Envelope<TargetsPayload>>
  news(request: NewsRequest): Promise<Envelope<NewsPayload>>
  portfolio(): Promise<Envelope<PortfolioPayload>>
  mutatePortfolio(mutation: PortfolioMutation): Promise<Envelope<PortfolioPayload>>
  personalFinance(): Promise<Envelope<PersonalFinancePayload>>
  mutatePersonalFinance(
    mutation: PersonalFinanceMutation,
  ): Promise<Envelope<PersonalFinancePayload>>
  fx(request: FxRequest): Promise<Envelope<FxPayload>>
  fundamentals(request: FundamentalsRequest): Promise<Envelope<FundamentalsPayload>>
  returns(request: ReturnsRequest): Promise<Envelope<ReturnsPayload>>
  momentum(request: MomentumRequest): Promise<Envelope<MomentumPayload>>
  analytics(request: AnalyticsRequest): Promise<Envelope<AnalyticsPayload>>
  optionQuotes(request: OptionQuotesRequest): Promise<Envelope<OptionQuotesPayload>>
  settings(): Promise<Envelope<AppSettings>>
  mutateSettings(mutation: AppSettingsMutation): Promise<Envelope<AppSettings>>
  maintenance(action: MaintenanceAction): Promise<Envelope<MaintenanceResult>>
  openExternal(url: string): Promise<void>
  saveText(suggestedName: string, contents: string): Promise<string | null>
  windowControl(action: WindowAction): Promise<void>
  onPortfolioChanged(listener: () => void): () => void
}
