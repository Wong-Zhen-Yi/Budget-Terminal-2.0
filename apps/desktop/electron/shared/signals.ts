import type {
  SignalBacktestBand,
  SignalCandidate,
  SignalClass,
  SignalReason,
  SignalRegime,
  SignalResult,
  SignalRisk,
  SignalsFilter,
  LegacySignalsPayload,
  SignalTimeframeBar,
  SignalValidation,
} from './contract.js'

/**
 * Pure, renderer-safe signal engine.
 *
 * Ported from the PySide6 `services/signal_engine.py` (page 40) and then deliberately
 * extended: the reference's ten checks collapse to about four independent ideas, so the
 * blocks here add trend quality (ADX), beta-adjusted alpha, daily accumulation and a
 * market-regime term, and every block is scored against a fixed 100-point denominator.
 * The Signals section of CLAUDE.md documents each departure.
 */

export interface SignalBar {
  timestamp: number
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
}

export type SignalRole = 'trend' | 'momentum' | 'setup' | 'entry'
export type SignalFrames = Record<SignalRole, SignalBar[]>

export const SIGNAL_EXCHANGES = ['NYQ', 'NMS', 'NGM', 'NCM', 'ASE'] as const

/** The screener is paged rather than taken as one top-100 slice. */
export const SIGNAL_SCREEN_PAGE_SIZE = 250
export const SIGNAL_SCREEN_OFFSETS = [0, 250] as const
export const SIGNAL_SCREEN_TARGET = 400
/** How many names buy a daily history, and how many of those buy intraday history. */
export const SIGNAL_CONFIRM_LIMIT = 60
export const SIGNAL_SHORTLIST_LIMIT = 30
export const SIGNAL_MINIMUM_DOLLAR_VOLUME = 20e6

export const SIGNAL_FILTERS: ReadonlyArray<{ label: string; value: SignalsFilter }> = [
  { label: 'All signals', value: 'all' },
  { label: 'Strong only', value: 'strong' },
  { label: 'Long setups', value: 'long' },
  { label: 'Watch', value: 'watch' },
  { label: 'Blocked (extended)', value: 'blocked' },
  { label: 'Market closed', value: 'market_closed' },
  { label: 'Stale intraday', value: 'stale' },
  { label: 'Too new to score', value: 'too_new' },
  { label: 'Data errors', value: 'error' },
]

export const SIGNAL_ROLE_LABELS: Record<string, string> = {
  trend: 'Trend (daily)',
  momentum: 'Momentum (hourly)',
  setup: 'Setup (5-minute)',
  entry: 'Entry (1-minute)',
  relative: 'Relative strength (vs benchmark)',
  regime: 'Market regime',
}

export const SIGNAL_INDICATOR_FIELDS = [
  ['EMA20', 'ema20', '$'],
  ['EMA50', 'ema50', '$'],
  ['EMA200', 'ema200', '$'],
  ['ADX (14)', 'adx', ''],
  ['RSI', 'rsi', ''],
  ['MACD', 'macd', ''],
  ['MACD signal', 'macd_signal', ''],
  ['MACD histogram', 'macd_histogram', ''],
  ['20-day ROC (ATR units)', 'roc_normalized', 'x'],
  ['VWAP', 'vwap', '$'],
  ['VWAP distance', 'vwap_distance_pct', '%'],
  ['Relative volume (daily)', 'daily_relative_volume', 'x'],
  ['Relative volume (slot)', 'slot_relative_volume', 'x'],
  ['OBV slope (20d)', 'obv_slope', 'x'],
  ['52-week position', 'high_52w_position', 'x'],
  ['Prior 20-bar high', 'breakout_level', '$'],
  ['ATR (daily)', 'atr', '$'],
  ['ATR %', 'atr_pct', '%'],
  ['ATR (setup)', 'atr_setup', '$'],
  ['ATR (entry)', 'atr_entry', '$'],
  ['Beta vs benchmark', 'beta', 'x'],
  ['Alpha 63 sessions', 'alpha_long_pct', '%'],
  ['Alpha 21 sessions', 'alpha_short_pct', '%'],
] as const

export const SIGNAL_SCORE_COMPONENTS = [
  ['Trend', 'trendScore', 'trendMaxScore', 'Daily direction and trend quality'],
  ['Momentum', 'momentumScore', 'momentumMaxScore', 'Hourly structure and daily thrust'],
  ['Volume', 'volumeScore', 'volumeMaxScore', 'Daily participation and accumulation'],
  ['Entry', 'entryScore', 'entryMaxScore', '5-minute breakout and 1-minute VWAP position'],
  ['Relative strength', 'relativeScore', 'relativeMaxScore', 'Beta-adjusted alpha and 52-week position'],
  ['Regime', 'regimeScore', 'regimeMaxScore', 'Broad-market trend and volatility'],
] as const

export const SIGNAL_CONFIG = {
  emaFast: 20,
  emaMedium: 50,
  emaLong: 200,
  rsiPeriod: 14,
  rsiMin: 50,
  rsiMax: 70,
  rsiTaper: 10,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  macdSlopeBars: 3,
  adxPeriod: 14,
  adxFloor: 15,
  adxFull: 30,
  rocLookback: 20,
  rocFull: 1.5,
  volumeLookback: 20,
  dailyRelativeVolumeFloor: 0.9,
  dailyRelativeVolumeFull: 1.5,
  obvLookback: 20,
  obvSlopeFull: 2,
  slotVolumeSessions: 20,
  slotVolumeMinimumSamples: 5,
  relativeVolumeFloor: 1,
  relativeVolumeThreshold: 1.5,
  breakoutLookback: 20,
  atrPeriod: 14,
  highLookback: 252,
  highProximityFloor: 0.85,
  highProximityFull: 1,
  maxVwapExtensionAtr: 2,
  maxVwapExtensionPct: 3,
  trendFastFullAtr: 0.5,
  trendAlignmentFullAtr: 0.5,
  trendLongFullAtr: 2,
  macdSignalFullAtr: 0.25,
  breakoutFullAtr: 0.25,
  vwapRiseAtr: 0.15,
  vwapFullAtr: 0.75,
  vwapFadeAtr: 2,
  betaLookback: 63,
  relativeStrengthLookback: 63,
  relativeStrengthShortLookback: 21,
  alphaLongFullPct: 12,
  alphaShortFullPct: 5,
  /** An intraday frame older than this is not a live read of anything. */
  maxEntryAgeSeconds: 900,
  maxSetupAgeSeconds: 1800,
  /**
   * How long a daily bar is still forming. A daily bar is stamped at its session open, so
   * "age < 86400" calls a completed session partial until the next one opens and drops it
   * for the whole overnight window — the daily blocks then score a session-old bar every
   * time the page is opened outside US hours. A regular session is 6.5 hours; measuring
   * from the bar's own stamp keeps this correct across DST.
   */
  dailyFormingSeconds: 23_400,
  regimeTrendFullAtr: 2,
  regimeAlignmentFullAtr: 1,
  vixLookback: 252,
  vixCalmFloor: 0.3,
  vixCalmFull: 0.7,
  regimeRiskOffFraction: 0.4,
  regimeRiskOnFraction: 0.65,
  watchThreshold: 0.4,
  longThreshold: 0.6,
  strongThreshold: 0.8,
  riskOffLongThreshold: 0.68,
  riskOffStrongThreshold: 0.85,
  stopAtrMultiple: 1.5,
  stopEmaAtrBuffer: 0.25,
  targetAtrMultiple: 3,
  /** A daily ATR past this share of price is a different instrument, not a swing setup. */
  maximumAtrPct: 8,
  riskBudgetPct: 1,
  priceAboveEmaFastWeight: 6,
  emaAlignmentWeight: 6,
  priceAboveEmaLongWeight: 5,
  adxWeight: 5,
  rsiWeight: 6,
  macdHistogramWeight: 4,
  macdSignalWeight: 3,
  rocWeight: 3,
  dailyRelativeVolumeWeight: 6,
  obvSlopeWeight: 4,
  intradayRelativeVolumeWeight: 4,
  breakoutWeight: 10,
  priceAboveVwapWeight: 8,
  alphaLongWeight: 10,
  alphaShortWeight: 6,
  highProximityWeight: 4,
  regimeTrendWeight: 4,
  regimeAlignmentWeight: 3,
  regimeVolatilityWeight: 3,
  minimumTrendFractionForLong: 2 / 3,
  backtestWarmup: 252,
  backtestHorizons: [5, 10, 20],
} as const

const TREND_MAX = 22
const MOMENTUM_MAX = 16
const VOLUME_MAX = 14
const ENTRY_MAX = 18
const RELATIVE_MAX = 20
const REGIME_MAX = 10
export const SIGNAL_MAX_SCORE = TREND_MAX + MOMENTUM_MAX + VOLUME_MAX + ENTRY_MAX + RELATIVE_MAX + REGIME_MAX

/** The part of the score a daily bar alone supports: trend, momentum, daily volume, relative. */
const DAILY_VOLUME_MAX = SIGNAL_CONFIG.dailyRelativeVolumeWeight + SIGNAL_CONFIG.obvSlopeWeight
export const SIGNAL_DAILY_MAX_SCORE = TREND_MAX + MOMENTUM_MAX + DAILY_VOLUME_MAX + RELATIVE_MAX

/**
 * What a scan can reach with the US session shut: everything but the 18 entry points and
 * the intraday leg of the volume block. This is a *display* denominator only. Classification
 * always divides by SIGNAL_MAX_SCORE, because a narrower denominator over the same raw
 * points is exactly the silent promotion the fixed-100 rule exists to prevent — a closed
 * market caps the class at WATCH regardless of what this reads.
 */
export const SIGNAL_CLOSED_MAX_SCORE =
  SIGNAL_MAX_SCORE - ENTRY_MAX - SIGNAL_CONFIG.intradayRelativeVolumeWeight

export interface CalculatedBar extends SignalBar {
  emaFast: number | null
  emaMedium: number | null
  emaLong: number | null
  rsi: number | null
  macd: number | null
  macdSignal: number | null
  macdHistogram: number | null
  adx: number | null
  diPlus: number | null
  diMinus: number | null
  averageVolume: number | null
  relativeVolume: number | null
  slotRelativeVolume: number | null
  obvSlope: number | null
  highPosition: number | null
  roc: number | null
  breakoutLevel: number | null
  atr: number | null
  vwap: number | null
}

interface TimeframeRead {
  row: CalculatedBar | null
  calculated: CalculatedBar[]
  status: string
  kind: 'ok' | 'short' | 'missing' | 'stale'
  provenance: SignalTimeframeBar
}

function finite(value: unknown): number | null {
  // Number(null) and Number('') are both 0, so an absent high or volume would otherwise
  // arrive as a real zero: a null high turns one true range into the whole price.
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function firstPositive(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = finite(value)
    if (numeric !== null && numeric > 0) return numeric
  }
  return null
}

function exchangeLabel(code: string): string {
  return code === 'NYQ'
    ? 'NYSE'
    : ['NMS', 'NGM', 'NCM'].includes(code)
      ? 'Nasdaq'
      : code === 'ASE'
        ? 'NYSE American'
        : code
}

function isoDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/** Regular US session hours in New York, weekends excluded. Exchange holidays are not. */
export function marketOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? ''
  if (['Sat', 'Sun'].includes(part('weekday'))) return false
  const minutes = Number(part('hour')) * 60 + Number(part('minute'))
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}

/* ------------------------------------------------------------------ universe */

export interface SignalQuoteLike {
  symbol?: unknown
  quoteType?: unknown
  exchange?: unknown
  longName?: unknown
  shortName?: unknown
  regularMarketPrice?: unknown
  intradayprice?: unknown
  marketCap?: unknown
  intradaymarketcap?: unknown
  averageDailyVolume3Month?: unknown
  averageDailyVolume10Day?: unknown
  regularMarketVolume?: unknown
}

export type SignalQuoteCandidate = Pick<
  SignalCandidate,
  'ticker' | 'name' | 'exchange' | 'price' | 'marketCap' | 'estimatedDollarVolume'
>

/**
 * The universe's quote-level filters.
 *
 * The dollar-volume estimate comes off the screener row itself, so the whole prefilter
 * costs no requests. The reference spent one daily chart per candidate to learn the same
 * thing, which was most of the scan's request budget.
 */
export function signalCandidateFromQuote(quote: SignalQuoteLike): SignalQuoteCandidate | null {
  if (String(quote.quoteType ?? '').trim().toUpperCase() !== 'EQUITY') return null
  const exchange = String(quote.exchange ?? '').trim().toUpperCase()
  if (!(SIGNAL_EXCHANGES as readonly string[]).includes(exchange)) return null
  const ticker = String(quote.symbol ?? '').trim().toUpperCase()
  const price = firstPositive(quote.regularMarketPrice, quote.intradayprice)
  const marketCap = firstPositive(quote.marketCap, quote.intradaymarketcap)
  if (!ticker || price === null || marketCap === null || price < 5 || marketCap < 2e9) return null
  const averageVolume = firstPositive(
    quote.averageDailyVolume3Month,
    quote.averageDailyVolume10Day,
    quote.regularMarketVolume,
  )
  return {
    ticker,
    name: String(quote.longName ?? quote.shortName ?? ticker).trim() || ticker,
    exchange: exchangeLabel(exchange),
    price,
    marketCap,
    estimatedDollarVolume: averageVolume === null ? 0 : price * averageVolume,
  }
}

/** Median dollar volume of the last 20 fully completed sessions. */
export function completedMedianDollarVolume(
  bars: SignalBar[],
  sessionDate: string,
  lookback = 20,
): number | null {
  const values = bars
    .filter((bar) => isoDay(bar.timestamp) < sessionDate)
    .flatMap((bar) => {
      const volume = finite(bar.volume)
      return volume !== null && volume > 0 && bar.close > 0 ? [bar.close * volume] : []
    })
    .slice(-lookback)
    .sort((left, right) => left - right)
  if (values.length < lookback) return null
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
}

/**
 * Shortlist by setup quality, not by size alone.
 *
 * Every candidate here has already cleared the liquidity floor, so ranking purely on
 * liquidity just reproduces the same mega-cap list every day. The blend keeps liquidity as
 * a tiebreaker while letting the daily sub-model decide which confirmed names are worth
 * buying intraday history for.
 */
export function rankSignalCandidates(candidates: SignalCandidate[]): SignalCandidate[] {
  const liquidity = [...candidates].sort((left, right) => left.medianDollarVolume - right.medianDollarVolume)
  const percentile = new Map(
    liquidity.map((candidate, index) => [
      candidate.ticker,
      liquidity.length > 1 ? index / (liquidity.length - 1) : 1,
    ]),
  )
  const blended = (candidate: SignalCandidate) =>
    0.7 * candidate.dailyPreScore + 0.3 * (percentile.get(candidate.ticker) ?? 0)
  return [...candidates]
    .sort(
      (left, right) =>
        blended(right) - blended(left) ||
        right.medianDollarVolume - left.medianDollarVolume ||
        right.marketCap - left.marketCap ||
        left.ticker.localeCompare(right.ticker),
    )
    .slice(0, SIGNAL_SHORTLIST_LIMIT)
    .map((candidate, index) => ({ ...candidate, qualityRank: index + 1 }))
}

/* ------------------------------------------------------------------- grading */

function ramp(value: unknown, lower: number, upper: number): number {
  const numeric = finite(value)
  if (numeric === null || numeric <= lower) return 0
  if (numeric >= upper) return 1
  return upper <= lower ? 1 : (numeric - lower) / (upper - lower)
}

/**
 * Distance graded in ATR units.
 *
 * A missing ATR scores zero. The reference returned full credit for any positive distance,
 * which let a name whose ATR never warmed up collect every distance check for free while
 * the denominator stayed at 100 — a data-poor ticker could ride that straight to
 * STRONG_LONG.
 */
function atrFraction(distance: unknown, atr: unknown, fullAtr: number): number {
  const numeric = finite(distance)
  if (numeric === null) return 0
  const unit = finite(atr)
  if (unit === null || unit <= 0) return 0
  return ramp(numeric / unit, 0, fullAtr)
}

/** Rises off the reference level, plateaus, then fades — so an extended price is not "better". */
function humpFraction(distance: unknown, atr: unknown, rise: number, full: number, fade: number): number {
  const numeric = finite(distance)
  if (numeric === null) return 0
  const unit = finite(atr)
  if (unit === null || unit <= 0) return 0
  const ratio = numeric / unit
  if (ratio <= 0) return 0
  if (ratio < rise) return ratio / rise
  if (ratio <= full) return 1
  if (ratio >= fade) return 0
  return 1 - (ratio - full) / (fade - full)
}

function rsiFraction(value: unknown): number {
  const numeric = finite(value)
  if (numeric === null) return 0
  if (numeric >= SIGNAL_CONFIG.rsiMin && numeric <= SIGNAL_CONFIG.rsiMax) return 1
  if (numeric < SIGNAL_CONFIG.rsiMin) {
    return ramp(numeric, SIGNAL_CONFIG.rsiMin - SIGNAL_CONFIG.rsiTaper, SIGNAL_CONFIG.rsiMin)
  }
  return 1 - ramp(numeric, SIGNAL_CONFIG.rsiMax, SIGNAL_CONFIG.rsiMax + SIGNAL_CONFIG.rsiTaper)
}

function ema(values: Array<number | null>, period: number, alpha = 2 / (period + 1)): Array<number | null> {
  let current: number | null = null
  let seen = 0
  return values.map((value) => {
    if (value === null) return null
    current = current === null ? value : alpha * value + (1 - alpha) * current
    seen += 1
    return seen >= period ? current : null
  })
}

/* ---------------------------------------------------------------- indicators */

/** Regression slope over the window, expressed in the window's own standard deviations. */
function normalizedSlope(values: number[]): number | null {
  const count = values.length
  if (count < 3) return null
  const meanIndex = (count - 1) / 2
  const mean = values.reduce((sum, value) => sum + value, 0) / count
  let numerator = 0
  let denominator = 0
  let variance = 0
  values.forEach((value, index) => {
    numerator += (index - meanIndex) * (value - mean)
    denominator += (index - meanIndex) ** 2
    variance += (value - mean) ** 2
  })
  if (denominator <= 0) return null
  const deviation = Math.sqrt(variance / (count - 1))
  if (!(deviation > 0)) return null
  return (numerator / denominator) * (count - 1) / deviation
}

export function calculateIndicators(
  input: SignalBar[],
  { vwap: includeVwap = false, slotVolume = false } = {},
): CalculatedBar[] {
  const byTimestamp = new Map<number, SignalBar>()
  for (const bar of input) {
    if (Number.isFinite(bar.timestamp) && Number.isFinite(bar.close)) byTimestamp.set(bar.timestamp, bar)
  }
  const bars = [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp)
  const closes = bars.map((bar) => finite(bar.close))
  const fast = ema(closes, SIGNAL_CONFIG.emaFast)
  const medium = ema(closes, SIGNAL_CONFIG.emaMedium)
  const long = ema(closes, SIGNAL_CONFIG.emaLong)
  const macdFast = ema(closes, SIGNAL_CONFIG.macdFast)
  const macdSlow = ema(closes, SIGNAL_CONFIG.macdSlow)
  const macd = closes.map((_, index) => {
    const left = macdFast[index]
    const right = macdSlow[index]
    return left === null || right === null ? null : left - right
  })
  const macdSignal = ema(macd, SIGNAL_CONFIG.macdSignal)

  const deltas = closes.map((close, index) =>
    index && close !== null && closes[index - 1] !== null ? close - closes[index - 1]! : null,
  )
  const gains = deltas.map((value) => value === null ? null : Math.max(value, 0))
  const losses = deltas.map((value) => value === null ? null : Math.max(-value, 0))
  const averageGain = ema(gains, SIGNAL_CONFIG.rsiPeriod, 1 / SIGNAL_CONFIG.rsiPeriod)
  const averageLoss = ema(losses, SIGNAL_CONFIG.rsiPeriod, 1 / SIGNAL_CONFIG.rsiPeriod)

  const trueRanges = bars.map((bar, index) => {
    const high = finite(bar.high)
    const low = finite(bar.low)
    if (high === null || low === null) return null
    const previous = index ? closes[index - 1] : null
    return Math.max(
      Math.abs(high - low),
      previous === null ? 0 : Math.abs(high - previous),
      previous === null ? 0 : Math.abs(low - previous),
    )
  })
  const atr = ema(trueRanges, SIGNAL_CONFIG.atrPeriod, 1 / SIGNAL_CONFIG.atrPeriod)

  // Wilder's directional movement. This is the one reading that tells a trend from a chop,
  // and every other check in the trend block is blind to the difference.
  const plusMovement: Array<number | null> = []
  const minusMovement: Array<number | null> = []
  bars.forEach((bar, index) => {
    if (!index) {
      plusMovement.push(null)
      minusMovement.push(null)
      return
    }
    const high = finite(bar.high)
    const low = finite(bar.low)
    const priorHigh = finite(bars[index - 1].high)
    const priorLow = finite(bars[index - 1].low)
    if (high === null || low === null || priorHigh === null || priorLow === null) {
      plusMovement.push(null)
      minusMovement.push(null)
      return
    }
    const up = high - priorHigh
    const down = priorLow - low
    plusMovement.push(up > down && up > 0 ? up : 0)
    minusMovement.push(down > up && down > 0 ? down : 0)
  })
  const wilder = 1 / SIGNAL_CONFIG.adxPeriod
  const smoothedPlus = ema(plusMovement, SIGNAL_CONFIG.adxPeriod, wilder)
  const smoothedMinus = ema(minusMovement, SIGNAL_CONFIG.adxPeriod, wilder)
  const smoothedRange = ema(trueRanges, SIGNAL_CONFIG.adxPeriod, wilder)
  const diPlus: Array<number | null> = []
  const diMinus: Array<number | null> = []
  const directionalIndex: Array<number | null> = []
  bars.forEach((_, index) => {
    const range = smoothedRange[index]
    const up = smoothedPlus[index]
    const down = smoothedMinus[index]
    if (range === null || range <= 0 || up === null || down === null) {
      diPlus.push(null)
      diMinus.push(null)
      directionalIndex.push(null)
      return
    }
    const positive = 100 * up / range
    const negative = 100 * down / range
    diPlus.push(positive)
    diMinus.push(negative)
    directionalIndex.push(
      positive + negative > 0 ? 100 * Math.abs(positive - negative) / (positive + negative) : null,
    )
  })
  const adx = ema(directionalIndex, SIGNAL_CONFIG.adxPeriod, wilder)

  // On-balance volume, so the daily frame carries accumulation evidence of its own rather
  // than leaving every volume point to a single five-minute bar.
  let balance = 0
  const obv = bars.map((bar, index) => {
    if (index) {
      const volume = finite(bar.volume) ?? 0
      const previous = bars[index - 1].close
      if (bar.close > previous) balance += volume
      else if (bar.close < previous) balance -= volume
    }
    return balance
  })

  const slotHistory = new Map<string, number[]>()
  let session = ''
  let cumulativeValue = 0
  let cumulativeVolume = 0

  return bars.map((bar, index) => {
    const averageLossValue = averageLoss[index]
    const averageGainValue = averageGain[index]
    let rsi: number | null = null
    if (averageGainValue !== null && averageLossValue !== null) {
      if (averageLossValue === 0 && averageGainValue > 0) rsi = 100
      else if (averageGainValue === 0 && averageLossValue > 0) rsi = 0
      else if (averageLossValue > 0) rsi = 100 - 100 / (1 + averageGainValue / averageLossValue)
    }

    const priorVolumes = bars.slice(Math.max(0, index - SIGNAL_CONFIG.volumeLookback), index)
      .map((item) => finite(item.volume))
    const averageVolume = priorVolumes.length === SIGNAL_CONFIG.volumeLookback && priorVolumes.every((value) => value !== null)
      ? priorVolumes.reduce((sum, value) => sum + value!, 0) / SIGNAL_CONFIG.volumeLookback
      : null
    const volume = finite(bar.volume)
    const relativeVolume = averageVolume && volume !== null ? volume / averageVolume : null

    // Intraday volume is U-shaped, so a flat trailing mean rates every opening bar as
    // "elevated" and every midday bar as quiet, for reasons unrelated to interest.
    // Comparing a bar to the same minute of prior sessions removes that bias.
    let slotRelativeVolume: number | null = null
    if (slotVolume) {
      const slot = new Date(bar.timestamp).toISOString().slice(11, 16)
      const history = slotHistory.get(slot) ?? []
      if (history.length >= SIGNAL_CONFIG.slotVolumeMinimumSamples) {
        const mean = history.reduce((sum, value) => sum + value, 0) / history.length
        if (mean > 0 && volume !== null) slotRelativeVolume = volume / mean
      }
      if (volume !== null && volume > 0) {
        history.push(volume)
        if (history.length > SIGNAL_CONFIG.slotVolumeSessions) history.shift()
        slotHistory.set(slot, history)
      }
    }

    const priorHighs = bars.slice(Math.max(0, index - SIGNAL_CONFIG.breakoutLookback), index)
      .map((item) => finite(item.high))
    const breakoutLevel = priorHighs.length === SIGNAL_CONFIG.breakoutLookback && priorHighs.every((value) => value !== null)
      ? Math.max(...priorHighs as number[])
      : null

    let highPosition: number | null = null
    if (index + 1 >= SIGNAL_CONFIG.highLookback) {
      const window = bars.slice(index + 1 - SIGNAL_CONFIG.highLookback, index + 1)
        .flatMap((item) => {
          const high = finite(item.high)
          return high === null ? [] : [high]
        })
      const peak = window.length ? Math.max(...window) : null
      if (peak !== null && peak > 0) highPosition = bar.close / peak
    }

    let roc: number | null = null
    const priorClose = closes[index - SIGNAL_CONFIG.rocLookback]
    const atrValue = atr[index]
    if (priorClose !== undefined && priorClose !== null && priorClose > 0 && atrValue !== null && atrValue > 0) {
      const change = bar.close / priorClose - 1
      const expected = (atrValue / bar.close) * Math.sqrt(SIGNAL_CONFIG.rocLookback)
      if (expected > 0) roc = change / expected
    }

    const obvSlope = index + 1 >= SIGNAL_CONFIG.obvLookback
      ? normalizedSlope(obv.slice(index + 1 - SIGNAL_CONFIG.obvLookback, index + 1))
      : null

    let vwap: number | null = null
    if (includeVwap) {
      const nextSession = isoDay(bar.timestamp)
      if (nextSession !== session) {
        session = nextSession
        cumulativeValue = 0
        cumulativeVolume = 0
      }
      const high = finite(bar.high)
      const low = finite(bar.low)
      if (high !== null && low !== null && volume !== null && volume >= 0) {
        cumulativeValue += ((high + low + bar.close) / 3) * volume
        cumulativeVolume += volume
        if (cumulativeVolume > 0) vwap = cumulativeValue / cumulativeVolume
      }
    }

    return {
      ...bar,
      emaFast: fast[index],
      emaMedium: medium[index],
      emaLong: long[index],
      rsi,
      macd: macd[index],
      macdSignal: macdSignal[index],
      macdHistogram: macd[index] === null || macdSignal[index] === null
        ? null
        : macd[index]! - macdSignal[index]!,
      adx: adx[index],
      diPlus: diPlus[index],
      diMinus: diMinus[index],
      averageVolume,
      relativeVolume,
      slotRelativeVolume,
      obvSlope,
      highPosition,
      roc,
      breakoutLevel,
      atr: atr[index],
      vwap,
    }
  })
}

/**
 * Is the US extended session running?
 *
 * Pre-market opens at 04:00 ET and the post-market closes at 20:00 ET, and Yahoo's intraday
 * frames carry both, so that window is exactly when an intraday bar can be live. Outside it
 * a stale frame means the market is shut, not that the feed broke — which is the difference
 * between a page worth reading and one that reports nothing but STALE_DATA to anyone whose
 * afternoon is the middle of the US night.
 *
 * No holiday calendar, matching the Roll page's weekday fallback: on the nine or so market
 * holidays a year this says OPEN and every result reports STALE_DATA, which is conservative
 * in the right direction — it never claims a closed market when one is trading.
 */
export function usExtendedSessionOpen(now: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now))
  const field = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const weekday = field('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') return false
  // Intl renders midnight as "24" in some runtimes, so fold it back to 0.
  const hour = Number(field('hour')) % 24
  const minutes = hour * 60 + Number(field('minute'))
  return Number.isFinite(minutes) && minutes >= 4 * 60 && minutes < 20 * 60
}

function timeframeRead(
  bars: SignalBar[],
  minimumBars: number,
  barSeconds: number,
  now: number,
  {
    includeVwap = false,
    dropOpen = true,
    slotVolume = false,
    maximumAgeSeconds = 0,
    formingSeconds = barSeconds,
  } = {},
): TimeframeRead {
  const required = minimumBars + (dropOpen ? 1 : 0)
  const blank: SignalTimeframeBar = { asOf: null, partial: false, dropped: false }
  if (!bars.length) {
    return { row: null, calculated: [], status: 'Unavailable', kind: 'missing', provenance: blank }
  }
  if (bars.length < required) {
    return {
      row: null,
      calculated: [],
      status: `Insufficient history (${bars.length}/${required} bars)`,
      kind: 'short',
      provenance: blank,
    }
  }
  const calculated = calculateIndicators(bars, { vwap: includeVwap, slotVolume })
  if (!calculated.length) {
    return { row: null, calculated: [], status: 'Malformed OHLCV data', kind: 'missing', provenance: blank }
  }
  const last = calculated[calculated.length - 1]
  const elapsed = (now - last.timestamp) / 1000
  const partial = elapsed >= 0 && elapsed < formingSeconds
  const dropped = partial && dropOpen
  const row = dropped ? calculated[calculated.length - 2] : last
  const provenance: SignalTimeframeBar = { asOf: new Date(row.timestamp).toISOString(), partial, dropped }
  // An intraday frame whose newest bar is hours old is a memory, not a live read. Scoring
  // VWAP and a breakout off it is how the page claimed a live setup over a weekend, which
  // is when it is most often open.
  if (maximumAgeSeconds > 0 && elapsed > maximumAgeSeconds) {
    return {
      row: null,
      calculated,
      status: `Stale (newest bar is ${Math.round(elapsed / 60)} minute(s) old)`,
      kind: 'stale',
      provenance,
    }
  }
  return {
    row,
    calculated: dropped ? calculated.slice(0, -1) : calculated,
    status: dropped ? 'Available (last closed bar)' : 'Available',
    kind: 'ok',
    provenance,
  }
}

function reason(
  name: string,
  group: SignalReason['group'],
  fraction: number,
  weight: number,
  description: string,
  value: unknown = null,
  reference: unknown = null,
): SignalReason {
  const share = Math.min(Math.max(finite(fraction) ?? 0, 0), 1)
  return {
    name,
    group,
    passed: share > 0,
    points: weight * share,
    description,
    value: finite(value),
    reference: finite(reference),
    weight,
  }
}

function sumPoints(reasons: SignalReason[]): number {
  return reasons.reduce((sum, item) => sum + item.points, 0)
}

/**
 * Walks back from the scored bar rather than rebuilding the whole histogram series.
 *
 * The walk-forward calls this once per index across 730 bars, so flat-mapping the frame
 * each time made the backtest quadratic in the length of the history.
 */
function macdRisingFractionAt(frame: CalculatedBar[], index: number): number {
  const window: number[] = []
  for (let position = index; position >= 0 && window.length <= SIGNAL_CONFIG.macdSlopeBars; position -= 1) {
    const value = frame[position].macdHistogram
    if (value !== null) window.unshift(value)
  }
  if (window.length < 2) return 0
  let rising = 0
  for (let position = 1; position < window.length; position += 1) {
    if (window[position] > window[position - 1]) rising += 1
  }
  return rising / (window.length - 1)
}

/* --------------------------------------------------------- relative strength */

export interface AlignedBenchmark {
  /** Aligned position for each ticker bar, or -1 where the benchmark had no session. */
  indexes: number[]
  ticker: number[]
  benchmark: number[]
}

export function alignBenchmark(rows: SignalBar[], benchmark: SignalBar[]): AlignedBenchmark {
  const benchmarkByDay = new Map(benchmark.map((bar) => [isoDay(bar.timestamp), bar.close]))
  const indexes: number[] = []
  const ticker: number[] = []
  const benchmarkCloses: number[] = []
  for (const bar of rows) {
    const close = benchmarkByDay.get(isoDay(bar.timestamp))
    if (close === undefined || !(close > 0) || !(bar.close > 0)) {
      indexes.push(-1)
      continue
    }
    indexes.push(ticker.length)
    ticker.push(bar.close)
    benchmarkCloses.push(close)
  }
  return { indexes, ticker, benchmark: benchmarkCloses }
}

export interface RelativeRead {
  beta: number | null
  alphaLong: number | null
  alphaShort: number | null
}

/**
 * Beta-adjusted excess return.
 *
 * The reference scored the raw ratio spread, which mechanically flatters high-beta names in
 * a rising tape — a whole shortlist can score well just for being volatile. Regressing the
 * ticker on the benchmark first leaves only the part that is not the market.
 */
export function relativeReadAt(aligned: AlignedBenchmark, position: number): RelativeRead {
  const empty: RelativeRead = { beta: null, alphaLong: null, alphaShort: null }
  if (position < 0 || position >= aligned.ticker.length) return empty
  const lookback = SIGNAL_CONFIG.betaLookback
  if (position < lookback) return empty

  const tickerReturns: number[] = []
  const benchmarkReturns: number[] = []
  for (let index = position - lookback + 1; index <= position; index += 1) {
    const previousTicker = aligned.ticker[index - 1]
    const previousBenchmark = aligned.benchmark[index - 1]
    if (!(previousTicker > 0) || !(previousBenchmark > 0)) return empty
    tickerReturns.push(aligned.ticker[index] / previousTicker - 1)
    benchmarkReturns.push(aligned.benchmark[index] / previousBenchmark - 1)
  }
  const meanTicker = tickerReturns.reduce((sum, value) => sum + value, 0) / tickerReturns.length
  const meanBenchmark = benchmarkReturns.reduce((sum, value) => sum + value, 0) / benchmarkReturns.length
  let covariance = 0
  let variance = 0
  benchmarkReturns.forEach((value, index) => {
    covariance += (value - meanBenchmark) * (tickerReturns[index] - meanTicker)
    variance += (value - meanBenchmark) ** 2
  })
  const beta = variance > 0 ? covariance / variance : null

  const alphaOver = (window: number): number | null => {
    const start = position - window
    if (start < 0 || beta === null) return null
    const startTicker = aligned.ticker[start]
    const startBenchmark = aligned.benchmark[start]
    if (!(startTicker > 0) || !(startBenchmark > 0)) return null
    const tickerReturn = aligned.ticker[position] / startTicker - 1
    const benchmarkReturn = aligned.benchmark[position] / startBenchmark - 1
    return (tickerReturn - beta * benchmarkReturn) * 100
  }

  return {
    beta,
    alphaLong: alphaOver(SIGNAL_CONFIG.relativeStrengthLookback),
    alphaShort: alphaOver(SIGNAL_CONFIG.relativeStrengthShortLookback),
  }
}

/* --------------------------------------------------------------- daily model */

export interface DailySignalScore {
  score: number
  maxScore: number
  fraction: number
  trendScore: number
  momentumScore: number
  volumeScore: number
  relativeScore: number
  reasons: SignalReason[]
}

function trendReasons(row: CalculatedBar): SignalReason[] {
  const directional = (row.diPlus ?? 0) > (row.diMinus ?? 0)
    ? ramp(row.adx, SIGNAL_CONFIG.adxFloor, SIGNAL_CONFIG.adxFull)
    : 0
  return [
    reason('Price above EMA20', 'trend', atrFraction(row.close - (row.emaFast ?? Number.NaN), row.atr, SIGNAL_CONFIG.trendFastFullAtr), SIGNAL_CONFIG.priceAboveEmaFastWeight, 'Daily close is above the fast trend average; full credit at 0.5 ATR above it.', row.close, row.emaFast),
    reason('EMA20 above EMA50', 'trend', atrFraction((row.emaFast ?? Number.NaN) - (row.emaMedium ?? Number.NaN), row.atr, SIGNAL_CONFIG.trendAlignmentFullAtr), SIGNAL_CONFIG.emaAlignmentWeight, 'Daily fast and medium averages are aligned bullishly; full credit at 0.5 ATR of separation.', row.emaFast, row.emaMedium),
    reason('Price above EMA200', 'trend', atrFraction(row.close - (row.emaLong ?? Number.NaN), row.atr, SIGNAL_CONFIG.trendLongFullAtr), SIGNAL_CONFIG.priceAboveEmaLongWeight, 'Daily close is above the long-term trend average; full credit at 2 ATR above it.', row.close, row.emaLong),
    reason('Directional trend is strong', 'trend', directional, SIGNAL_CONFIG.adxWeight, 'ADX(14) rising through 15 to 30 while +DI leads -DI; this is what separates a trend from a chop.', row.adx, SIGNAL_CONFIG.adxFull),
  ]
}

function momentumReasons(row: CalculatedBar, frame: CalculatedBar[], index: number, label: string): SignalReason[] {
  const rising = macdRisingFractionAt(frame, index)
  return [
    reason('RSI in bullish range', 'momentum', rsiFraction(row.rsi), SIGNAL_CONFIG.rsiWeight, `${label} RSI is between 50 and 70, tapering to zero 10 points outside that band.`, row.rsi, SIGNAL_CONFIG.rsiMin),
    reason('MACD histogram increasing', 'momentum', rising, SIGNAL_CONFIG.macdHistogramWeight, `Share of the last 3 ${label.toLowerCase()} MACD histogram changes that rose.`, row.macdHistogram, null),
    reason('MACD above signal line', 'momentum', atrFraction((row.macd ?? Number.NaN) - (row.macdSignal ?? Number.NaN), row.atr, SIGNAL_CONFIG.macdSignalFullAtr), SIGNAL_CONFIG.macdSignalWeight, `${label} MACD leads its signal line; full credit at 0.25 ATR of separation.`, row.macd, row.macdSignal),
    reason('Volatility-adjusted thrust', 'momentum', ramp(row.roc, 0, SIGNAL_CONFIG.rocFull), SIGNAL_CONFIG.rocWeight, '20-session return divided by the move 20 sessions of ATR would explain; full credit at 1.5x.', row.roc, SIGNAL_CONFIG.rocFull),
  ]
}

function dailyVolumeReasons(row: CalculatedBar): SignalReason[] {
  return [
    reason('Daily participation elevated', 'volume', ramp(row.relativeVolume, SIGNAL_CONFIG.dailyRelativeVolumeFloor, SIGNAL_CONFIG.dailyRelativeVolumeFull), SIGNAL_CONFIG.dailyRelativeVolumeWeight, 'Session volume against its prior 20-session average, scored from 0.9x up to 1.5x.', row.relativeVolume, SIGNAL_CONFIG.dailyRelativeVolumeFull),
    reason('On-balance volume rising', 'volume', ramp(row.obvSlope, 0, SIGNAL_CONFIG.obvSlopeFull), SIGNAL_CONFIG.obvSlopeWeight, 'Slope of 20 sessions of on-balance volume in its own standard deviations: accumulation, not one busy day.', row.obvSlope, SIGNAL_CONFIG.obvSlopeFull),
  ]
}

function relativeReasons(read: RelativeRead, row: CalculatedBar, benchmarkLabel: string): SignalReason[] {
  return [
    reason(`Alpha over ${benchmarkLabel}, 63 sessions`, 'relative', ramp(read.alphaLong, 0, SIGNAL_CONFIG.alphaLongFullPct), SIGNAL_CONFIG.alphaLongWeight, `Return beyond what this name's beta to ${benchmarkLabel} explains; full credit at 12% of alpha.`, read.alphaLong, SIGNAL_CONFIG.alphaLongFullPct),
    reason(`Alpha over ${benchmarkLabel}, 21 sessions`, 'relative', ramp(read.alphaShort, 0, SIGNAL_CONFIG.alphaShortFullPct), SIGNAL_CONFIG.alphaShortWeight, 'Recent beta-adjusted excess return; full credit at 5% of alpha.', read.alphaShort, SIGNAL_CONFIG.alphaShortFullPct),
    reason('Near the 52-week high', 'relative', ramp(row.highPosition, SIGNAL_CONFIG.highProximityFloor, SIGNAL_CONFIG.highProximityFull), SIGNAL_CONFIG.highProximityWeight, 'Close as a share of the highest high of the last 252 sessions; full credit at the high itself.', row.highPosition, SIGNAL_CONFIG.highProximityFull),
  ]
}

/**
 * Score the daily-only part of the model at one index, reading no bar past it.
 *
 * This is the port of the reference's `evaluate_signal_at_index`, which the first pass
 * dropped. Stage one of the universe funnel and the walk-forward validation both run
 * through it, so a candidate is ranked by exactly the model the validation measures.
 */
export function evaluateDailySignalAtIndex(
  rows: CalculatedBar[],
  index: number,
  aligned: AlignedBenchmark | null,
): DailySignalScore {
  const empty: DailySignalScore = {
    score: 0,
    maxScore: SIGNAL_DAILY_MAX_SCORE,
    fraction: 0,
    trendScore: 0,
    momentumScore: 0,
    volumeScore: 0,
    relativeScore: 0,
    reasons: [],
  }
  if (index < 0 || index >= rows.length) return empty
  const row = rows[index]
  const trend = trendReasons(row)
  const momentum = momentumReasons(row, rows, index, 'Daily')
  const volume = dailyVolumeReasons(row)
  const position = aligned ? aligned.indexes[index] ?? -1 : -1
  const read = aligned && position >= 0
    ? relativeReadAt(aligned, position)
    : { beta: null, alphaLong: null, alphaShort: null }
  const relative = relativeReasons(read, row, 'benchmark')
  const trendScore = sumPoints(trend)
  const momentumScore = sumPoints(momentum)
  const volumeScore = sumPoints(volume)
  const relativeScore = sumPoints(relative)
  const score = trendScore + momentumScore + volumeScore + relativeScore
  return {
    score,
    maxScore: SIGNAL_DAILY_MAX_SCORE,
    fraction: score / SIGNAL_DAILY_MAX_SCORE,
    trendScore,
    momentumScore,
    volumeScore,
    relativeScore,
    reasons: [...trend, ...momentum, ...volume, ...relative],
  }
}

/* ------------------------------------------------------------------ backtest */

const BACKTEST_BANDS: ReadonlyArray<{ band: string; lower: number }> = [
  { band: '75-100%', lower: 0.75 },
  { band: '60-75%', lower: 0.6 },
  { band: '45-60%', lower: 0.45 },
  { band: '0-45%', lower: 0 },
]

export interface BacktestSample {
  band: string
  forward: number
}

/**
 * Walk the daily sub-model forward over one ticker's history.
 *
 * Indicators are computed once by the caller and read by index — every array
 * `calculateIndicators` builds is causal, so index `i` sees nothing later. Recomputing them
 * per index would make this quadratic over 30 tickers of 730 bars.
 */
export function signalBacktestSamples(
  rows: CalculatedBar[],
  aligned: AlignedBenchmark | null,
  horizon: number,
): BacktestSample[] {
  const samples: BacktestSample[] = []
  const last = rows.length - horizon - 1
  for (let index = SIGNAL_CONFIG.backtestWarmup; index <= last; index += 1) {
    const entry = rows[index].close
    const exit = rows[index + horizon].close
    if (!(entry > 0) || !(exit > 0)) continue
    const { fraction } = evaluateDailySignalAtIndex(rows, index, aligned)
    const band = BACKTEST_BANDS.find((candidate) => fraction >= candidate.lower)?.band
      ?? BACKTEST_BANDS[BACKTEST_BANDS.length - 1].band
    samples.push({ band, forward: (exit / entry - 1) * 100 })
  }
  return samples
}

export function summarizeBacktestSamples(
  samples: BacktestSample[],
  horizonSessions: number,
  tickers: number,
): SignalValidation {
  const bands = BACKTEST_BANDS.map(({ band }) => {
    const forward = samples
      .flatMap((sample) => sample.band === band ? [sample.forward] : [])
      .sort((left, right) => left - right)
    const count = forward.length
    const middle = Math.floor(count / 2)
    const summary: SignalBacktestBand = {
      band,
      samples: count,
      hitRate: count ? forward.filter((value) => value > 0).length / count : 0,
      meanForwardReturn: count ? forward.reduce((sum, value) => sum + value, 0) / count : 0,
      medianForwardReturn: !count ? 0 : count % 2 ? forward[middle] : (forward[middle - 1] + forward[middle]) / 2,
    }
    return summary
  })
  return { horizonSessions, tickers, samples: samples.length, bands }
}

/* -------------------------------------------------------------------- regime */

export function neutralRegime(message: string): SignalRegime {
  return {
    label: 'NEUTRAL',
    score: 0,
    maxScore: REGIME_MAX,
    fraction: 0,
    longThreshold: SIGNAL_CONFIG.longThreshold,
    strongThreshold: SIGNAL_CONFIG.strongThreshold,
    reasons: [],
    indicators: {},
    warnings: [message],
  }
}

/**
 * Score the tape itself, once per scan.
 *
 * Beyond its ten points the regime moves the class thresholds: in a risk-off market the
 * same setup has to score higher before it is called a long. Without it the engine fires at
 * the same rate in every tape, which is the main reason a fixed-threshold scanner looks
 * accurate in a bull market and useless the rest of the time.
 */
export function scoreRegime(
  benchmark: SignalBar[],
  volatility: SignalBar[],
  benchmarkSymbol = 'SPY',
  now = Date.now(),
): SignalRegime {
  const label = benchmarkSymbol.trim().toUpperCase() || 'SPY'
  const read = timeframeRead(benchmark, SIGNAL_CONFIG.emaLong, 86_400, now, {
    formingSeconds: SIGNAL_CONFIG.dailyFormingSeconds,
  })
  if (!read.row) return neutralRegime(`Market regime was not scored: no usable ${label} history.`)
  const row = read.row
  const warnings: string[] = []
  const indicators: Record<string, number | string | null> = {
    benchmark: label,
    benchmark_close: row.close,
    benchmark_ema50: row.emaMedium,
    benchmark_ema200: row.emaLong,
  }

  const reasons = [
    reason(`${label} above its 200-day average`, 'regime', atrFraction(row.close - (row.emaLong ?? Number.NaN), row.atr, SIGNAL_CONFIG.regimeTrendFullAtr), SIGNAL_CONFIG.regimeTrendWeight, 'The broad market is itself in an uptrend; full credit at 2 ATR above the average.', row.close, row.emaLong),
    reason(`${label} 50-day above its 200-day`, 'regime', atrFraction((row.emaMedium ?? Number.NaN) - (row.emaLong ?? Number.NaN), row.atr, SIGNAL_CONFIG.regimeAlignmentFullAtr), SIGNAL_CONFIG.regimeAlignmentWeight, 'The market’s own trend averages are aligned; full credit at 1 ATR of separation.', row.emaMedium, row.emaLong),
  ]

  const closes = volatility.map((bar) => bar.close).filter((close) => close > 0).slice(-SIGNAL_CONFIG.vixLookback)
  let calm = 0
  if (closes.length >= 60) {
    const latest = closes[closes.length - 1]
    const percentile = closes.filter((close) => close < latest).length / closes.length
    calm = ramp(1 - percentile, SIGNAL_CONFIG.vixCalmFloor, SIGNAL_CONFIG.vixCalmFull)
    Object.assign(indicators, { vix: latest, vix_percentile: percentile })
  } else {
    warnings.push('Volatility percentile was not scored: no usable volatility index history.')
  }
  reasons.push(reason('Volatility is subdued', 'regime', calm, SIGNAL_CONFIG.regimeVolatilityWeight, 'Where the volatility index sits in its own trailing year; full credit below the 30th percentile.', finite(indicators.vix), null))

  const score = sumPoints(reasons)
  const fraction = score / REGIME_MAX
  const riskOff = fraction < SIGNAL_CONFIG.regimeRiskOffFraction
  return {
    label: fraction >= SIGNAL_CONFIG.regimeRiskOnFraction ? 'RISK_ON' : riskOff ? 'RISK_OFF' : 'NEUTRAL',
    score,
    maxScore: REGIME_MAX,
    fraction,
    longThreshold: riskOff ? SIGNAL_CONFIG.riskOffLongThreshold : SIGNAL_CONFIG.longThreshold,
    strongThreshold: riskOff ? SIGNAL_CONFIG.riskOffStrongThreshold : SIGNAL_CONFIG.strongThreshold,
    reasons,
    indicators,
    warnings,
  }
}

/* ---------------------------------------------------------------------- risk */

/**
 * The trade plan the signal implies.
 *
 * A score with no stop is not actionable, and the reference emitted none. The stop is the
 * tighter of the EMA20 shelf and a 1.5 ATR give-back against a 3 ATR objective, which makes
 * reward-to-risk a direct readout of entry quality: a pullback entry sits close to the EMA
 * and reads high, while a price stretched away from it bottoms out around 2.
 *
 * The prior 20-session high is deliberately not used as the stop. A daily 20-session range
 * is routinely three to five ATR, so anchoring there would put every stop further away than
 * the target and make the plan unusable for exactly the trending names the page looks for.
 */
export function buildRisk(entry: number | null, trend: CalculatedBar | null): SignalRisk | null {
  const price = finite(entry)
  const atr = trend ? finite(trend.atr) : null
  if (price === null || price <= 0 || atr === null || atr <= 0) return null
  const emaFast = trend ? finite(trend.emaFast) : null
  const emaStop = emaFast === null ? null : emaFast - SIGNAL_CONFIG.stopEmaAtrBuffer * atr
  const atrStop = price - SIGNAL_CONFIG.stopAtrMultiple * atr
  let stop = emaStop === null ? atrStop : Math.max(emaStop, atrStop)
  // Price under its own EMA20 puts that shelf above the entry, which is not a stop. Fall
  // back to the ATR give-back rather than refusing to plan the trade at all.
  if (stop >= price) stop = atrStop
  if (!(stop < price)) return null
  const target = price + SIGNAL_CONFIG.targetAtrMultiple * atr
  const riskPerShare = price - stop
  const rewardPerShare = target - price
  const stopFraction = riskPerShare / price
  return {
    entry: price,
    stop,
    target,
    riskPerShare,
    rewardPerShare,
    rewardToRisk: riskPerShare > 0 ? rewardPerShare / riskPerShare : null,
    stopDistanceAtr: riskPerShare / atr,
    atrPct: atr / price * 100,
    positionSizePct: stopFraction > 0 ? Math.min(SIGNAL_CONFIG.riskBudgetPct / stopFraction, 100) : null,
  }
}

/* ------------------------------------------------------------ classification */

export function classifySignal(
  score: number,
  trendScore: number,
  maximum = SIGNAL_MAX_SCORE,
  longThreshold: number = SIGNAL_CONFIG.longThreshold,
  strongThreshold: number = SIGNAL_CONFIG.strongThreshold,
): SignalClass {
  const fraction = maximum > 0 ? score / maximum : 0
  let signal: SignalClass = fraction >= strongThreshold
    ? 'STRONG_LONG'
    : fraction >= longThreshold
      ? 'LONG'
      : fraction >= SIGNAL_CONFIG.watchThreshold
        ? 'WATCH'
        : 'NONE'
  if ((signal === 'LONG' || signal === 'STRONG_LONG') && trendScore / TREND_MAX < SIGNAL_CONFIG.minimumTrendFractionForLong) {
    signal = 'WATCH'
  }
  return signal
}

export function dataErrorSignal(ticker: string, message: string): SignalResult {
  const timeframeStatus = { trend: 'Unavailable', momentum: 'Unavailable', setup: 'Unavailable', entry: 'Unavailable' }
  const timeframeBars = Object.fromEntries(
    Object.keys(timeframeStatus).map((role) => [role, { asOf: null, partial: false, dropped: false }]),
  )
  return {
    ticker: ticker.trim().toUpperCase(),
    timestamp: new Date().toISOString(),
    price: null,
    rawScore: 0,
    maxScore: SIGNAL_MAX_SCORE,
    trendScore: 0,
    trendMaxScore: TREND_MAX,
    momentumScore: 0,
    momentumMaxScore: MOMENTUM_MAX,
    volumeScore: 0,
    volumeMaxScore: VOLUME_MAX,
    entryScore: 0,
    entryMaxScore: ENTRY_MAX,
    relativeScore: 0,
    relativeMaxScore: RELATIVE_MAX,
    regimeScore: 0,
    regimeMaxScore: REGIME_MAX,
    risk: null,
    signal: 'NONE',
    tradeStatus: 'DATA_ERROR',
    marketClosed: false,
    reasons: [],
    warnings: [message],
    indicators: {},
    timeframeStatus,
    timeframeBars,
    error: message,
  }
}

/**
 * Daily trend and quality, hourly momentum, daily participation, live entry, beta-adjusted
 * relative strength and the market regime — always out of 100.
 *
 * The denominator never moves. The reference shrank it to 84 when the benchmark was
 * missing, dividing the same raw points by less and silently promoting verdicts; here a
 * block that cannot be scored earns zero and caps the class at WATCH instead.
 */
export function evaluateSignal(
  ticker: string,
  frames: SignalFrames,
  options: {
    benchmark?: SignalBar[]
    benchmarkSymbol?: string
    regime?: SignalRegime
    now?: number
    /** Overrides the clock-derived session state; the scan resolves it once per run. */
    marketOpen?: boolean
  } = {},
): SignalResult {
  const now = options.now ?? Date.now()
  const marketOpen = options.marketOpen ?? usExtendedSessionOpen(now)
  const reads: Record<SignalRole, TimeframeRead> = {
    trend: timeframeRead(frames.trend, SIGNAL_CONFIG.emaLong, 86_400, now, {
      formingSeconds: SIGNAL_CONFIG.dailyFormingSeconds,
    }),
    momentum: timeframeRead(frames.momentum, SIGNAL_CONFIG.macdSlow + SIGNAL_CONFIG.macdSignal, 3_600, now),
    setup: timeframeRead(
      frames.setup,
      Math.max(SIGNAL_CONFIG.volumeLookback, SIGNAL_CONFIG.breakoutLookback) + 1,
      300,
      now,
      { slotVolume: true, maximumAgeSeconds: SIGNAL_CONFIG.maxSetupAgeSeconds },
    ),
    entry: timeframeRead(frames.entry, 2, 60, now, {
      includeVwap: true,
      dropOpen: false,
      maximumAgeSeconds: SIGNAL_CONFIG.maxEntryAgeSeconds,
    }),
  }
  const reasons: SignalReason[] = []
  const warnings: string[] = []
  const indicators: Record<string, number | string | null> = {}

  let trendScore = 0
  let volumeScore = 0
  const trend = reads.trend.row
  if (trend) {
    Object.assign(indicators, {
      ema20: trend.emaFast,
      ema50: trend.emaMedium,
      ema200: trend.emaLong,
      adx: trend.adx,
      atr: trend.atr,
      atr_pct: trend.atr && trend.close > 0 ? trend.atr / trend.close * 100 : null,
      daily_relative_volume: trend.relativeVolume,
      obv_slope: trend.obvSlope,
      high_52w_position: trend.highPosition,
      roc_normalized: trend.roc,
    })
    if (trend.atr === null || trend.atr <= 0) {
      warnings.push('Daily ATR is unavailable, so every distance-graded daily check scored zero.')
    }
    const block = trendReasons(trend)
    const dailyVolume = dailyVolumeReasons(trend)
    reasons.push(...block, ...dailyVolume)
    trendScore = sumPoints(block)
    volumeScore = sumPoints(dailyVolume)
  }

  let momentumScore = 0
  const momentum = reads.momentum.row
  if (momentum) {
    Object.assign(indicators, {
      rsi: momentum.rsi,
      macd: momentum.macd,
      macd_signal: momentum.macdSignal,
      macd_histogram: momentum.macdHistogram,
    })
    const block = momentumReasons(momentum, reads.momentum.calculated, reads.momentum.calculated.length - 1, 'Hourly')
    reasons.push(...block)
    momentumScore = sumPoints(block)
  }

  let entryScore = 0
  const setup = reads.setup.row
  if (setup) {
    Object.assign(indicators, {
      slot_relative_volume: setup.slotRelativeVolume,
      relative_volume: setup.relativeVolume,
      breakout_level: setup.breakoutLevel,
      atr_setup: setup.atr,
    })
    // The flat trailing mean is the fallback only while too few sessions have filled the slot.
    const relative = setup.slotRelativeVolume ?? setup.relativeVolume
    const intraday = reason('Intraday participation elevated', 'volume', ramp(relative, SIGNAL_CONFIG.relativeVolumeFloor, SIGNAL_CONFIG.relativeVolumeThreshold), SIGNAL_CONFIG.intradayRelativeVolumeWeight, 'Setup-bar volume against the same minute of prior sessions, scored from 1x up to 1.5x.', relative, SIGNAL_CONFIG.relativeVolumeThreshold)
    const breakout = reason('Breakout above prior 20-bar high', 'entry', atrFraction(setup.close - (setup.breakoutLevel ?? Number.NaN), setup.atr, SIGNAL_CONFIG.breakoutFullAtr), SIGNAL_CONFIG.breakoutWeight, 'Setup close is above resistance calculated from prior completed bars only; full credit at 0.25 ATR beyond it.', setup.close, setup.breakoutLevel)
    reasons.push(intraday, breakout)
    volumeScore += intraday.points
    entryScore = breakout.points
  }

  let price: number | null = trend ? trend.close : null
  const entry = reads.entry.row
  if (entry) {
    price = entry.close
    const distance = entry.vwap === null ? null : price - entry.vwap
    const distancePct = distance === null || !entry.vwap ? null : distance / entry.vwap * 100
    Object.assign(indicators, { price, vwap: entry.vwap, vwap_distance: distance, vwap_distance_pct: distancePct, atr_entry: entry.atr })
    const vwapReason = reason('Price holding above VWAP', 'entry', humpFraction(distance, entry.atr, SIGNAL_CONFIG.vwapRiseAtr, SIGNAL_CONFIG.vwapFullAtr, SIGNAL_CONFIG.vwapFadeAtr), SIGNAL_CONFIG.priceAboveVwapWeight, 'Entry price above session VWAP: full credit from 0.15 to 0.75 ATR, fading to zero by 2 ATR. An extended price is a worse entry, not a better one.', price, entry.vwap)
    reasons.push(vwapReason)
    entryScore += vwapReason.points
  }

  const benchmarkLabel = (options.benchmarkSymbol ?? 'SPY').trim().toUpperCase() || 'SPY'
  const timeframeStatus: Record<string, string> = Object.fromEntries(
    Object.entries(reads).map(([role, read]) => [role, read.status]),
  )

  let relativeScore = 0
  let benchmarkScored = false
  if (trend && options.benchmark?.length) {
    const aligned = alignBenchmark(reads.trend.calculated, options.benchmark)
    const position = aligned.indexes[reads.trend.calculated.length - 1] ?? -1
    const read = position >= 0
      ? relativeReadAt(aligned, position)
      : { beta: null, alphaLong: null, alphaShort: null }
    if (read.alphaLong !== null && read.alphaShort !== null) {
      benchmarkScored = true
      Object.assign(indicators, {
        benchmark: benchmarkLabel,
        beta: read.beta,
        alpha_long_pct: read.alphaLong,
        alpha_short_pct: read.alphaShort,
      })
      const block = relativeReasons(read, trend, benchmarkLabel)
      reasons.push(...block)
      relativeScore = sumPoints(block)
      timeframeStatus.relative = `Available (vs ${benchmarkLabel})`
    }
  }
  if (!benchmarkScored) {
    timeframeStatus.relative = 'Benchmark history unavailable'
    warnings.push(`Relative strength scored 0 of ${RELATIVE_MAX}: no usable ${benchmarkLabel} history. This result is capped at WATCH.`)
  }

  const regime = options.regime ?? neutralRegime('Market regime was not supplied to this evaluation.')
  reasons.push(...regime.reasons)
  warnings.push(...regime.warnings)
  Object.assign(indicators, regime.indicators)
  timeframeStatus.regime = `${regime.label.replaceAll('_', ' ')} (${regime.score.toFixed(1)}/${regime.maxScore})`

  const risk = buildRisk(price, trend)
  if (risk) {
    Object.assign(indicators, {
      stop: risk.stop,
      target: risk.target,
      reward_to_risk: risk.rewardToRisk,
      position_size_pct: risk.positionSizePct,
    })
  }

  const rawScore = trendScore + momentumScore + volumeScore + entryScore + relativeScore + regime.score
  const missing = (Object.entries(reads) as Array<[SignalRole, TimeframeRead]>).filter(([, read]) => !read.row)
  const context = missing.filter(([role]) => role === 'trend' || role === 'momentum')
  const intraday = missing.filter(([role]) => role === 'setup' || role === 'entry')

  let signal: SignalClass = context.length
    ? 'NONE'
    : classifySignal(rawScore, trendScore, SIGNAL_MAX_SCORE, regime.longThreshold, regime.strongThreshold)

  // A frame that came back empty or short is a broken feed whatever the clock says; only a
  // frame that read fine and is merely old is explained by a closed session.
  const marketClosed = !marketOpen && intraday.length > 0 && intraday.every(([, read]) => read.kind === 'stale')

  const caps: string[] = []
  if (!benchmarkScored) caps.push('the benchmark history is missing')
  if (marketClosed) caps.push('the US market is closed, so the intraday blocks are not scored')
  else if (intraday.length) caps.push('the intraday frames are not live')
  if (!risk) caps.push('no workable stop could be placed under the entry')
  else if (risk.atrPct !== null && risk.atrPct > SIGNAL_CONFIG.maximumAtrPct) {
    caps.push(`the daily ATR is ${risk.atrPct.toFixed(1)}% of price, over the ${SIGNAL_CONFIG.maximumAtrPct}% ceiling for a swing entry`)
  }
  if (caps.length && (signal === 'LONG' || signal === 'STRONG_LONG')) {
    signal = 'WATCH'
    warnings.push(`Capped at WATCH because ${caps.join(', and ')}.`)
  }
  if (!context.length && rawScore >= regime.longThreshold * SIGNAL_MAX_SCORE && trendScore < SIGNAL_CONFIG.minimumTrendFractionForLong * TREND_MAX) {
    warnings.push('Lower-timeframe strength is capped at WATCH because the higher-timeframe trend is not qualified.')
  }

  let tradeStatus: SignalResult['tradeStatus'] = signal === 'WATCH'
    ? 'WATCH'
    : signal === 'LONG' || signal === 'STRONG_LONG'
      ? 'VALID_LONG'
      : 'NONE'
  let error = ''
  if (intraday.length) {
    const messages = intraday.map(([role, read]) => `${role}: ${read.status}`)
    tradeStatus = marketClosed ? 'MARKET_CLOSED' : 'STALE_DATA'
    if (marketClosed) {
      warnings.push(
        `The US market is closed, so the ${ENTRY_MAX + SIGNAL_CONFIG.intradayRelativeVolumeWeight} intraday points were unreachable. ` +
        `This is a daily read scored ${formatSignalScore(rawScore, SIGNAL_CLOSED_MAX_SCORE)}; no live entry is confirmed.`,
      )
    } else {
      warnings.push(...messages)
      if (intraday.some(([, read]) => read.kind === 'missing')) error = messages.join('; ')
    }
  }
  if (context.length) {
    const messages = context.map(([role, read]) => `${role}: ${read.status}`)
    warnings.push(...messages)
    tradeStatus = context.every(([, read]) => read.kind === 'short') ? 'INSUFFICIENT_HISTORY' : 'DATA_ERROR'
    error = messages.join('; ')
  }

  if (tradeStatus === 'VALID_LONG') {
    const distance = finite(indicators.vwap_distance)
    const atr = finite(indicators.atr_entry)
    const extensionPct = finite(indicators.vwap_distance_pct)
    if (distance !== null && atr !== null && atr > 0 && distance / atr > SIGNAL_CONFIG.maxVwapExtensionAtr) {
      tradeStatus = 'TOO_EXTENDED'
      warnings.push(`Price is ${(distance / atr).toFixed(2)} ATR above VWAP; maximum configured extension is 2.00 ATR.`)
    } else if ((atr === null || atr <= 0) && extensionPct !== null && extensionPct > SIGNAL_CONFIG.maxVwapExtensionPct) {
      tradeStatus = 'TOO_EXTENDED'
      warnings.push(`Price is ${extensionPct.toFixed(2)}% above VWAP; maximum configured extension is 3.00% (entry ATR unavailable).`)
    }
  }

  const timestamps = Object.values(reads).flatMap((read) => read.row ? [read.row.timestamp] : [])
  return {
    ticker: ticker.trim().toUpperCase(),
    timestamp: new Date(timestamps.length ? Math.max(...timestamps) : now).toISOString(),
    price,
    rawScore,
    maxScore: SIGNAL_MAX_SCORE,
    trendScore,
    trendMaxScore: TREND_MAX,
    momentumScore,
    momentumMaxScore: MOMENTUM_MAX,
    volumeScore,
    volumeMaxScore: VOLUME_MAX,
    entryScore,
    entryMaxScore: ENTRY_MAX,
    relativeScore,
    relativeMaxScore: RELATIVE_MAX,
    regimeScore: regime.score,
    regimeMaxScore: regime.maxScore,
    risk,
    signal,
    tradeStatus,
    marketClosed,
    reasons,
    warnings,
    indicators,
    timeframeStatus,
    timeframeBars: Object.fromEntries(Object.entries(reads).map(([role, read]) => [role, read.provenance])),
    error,
  }
}

/* -------------------------------------------------------------- presentation */

/**
 * The denominator to print. Narrows to the reachable total when the session was shut, so a
 * strong daily read is legible instead of looking like a 55/100 failure. Classification
 * never sees this.
 */
export function signalDisplayMaxScore(result: SignalResult): number {
  return result.marketClosed ? SIGNAL_CLOSED_MAX_SCORE : result.maxScore
}

export function signalScoreFraction(result: SignalResult): number {
  const maximum = signalDisplayMaxScore(result)
  return maximum > 0 ? result.rawScore / maximum : 0
}

export function signalVisible(result: SignalResult, filter: SignalsFilter, search: string): boolean {
  const query = search.trim().toUpperCase()
  if (query && !result.ticker.includes(query)) return false
  if (filter === 'strong') return result.signal === 'STRONG_LONG' && result.tradeStatus === 'VALID_LONG'
  if (filter === 'long') return result.tradeStatus === 'VALID_LONG'
  if (filter === 'watch') return result.tradeStatus === 'WATCH'
  if (filter === 'blocked') return result.tradeStatus === 'TOO_EXTENDED'
  if (filter === 'market_closed') return result.tradeStatus === 'MARKET_CLOSED'
  if (filter === 'stale') return result.tradeStatus === 'STALE_DATA'
  if (filter === 'too_new') return result.tradeStatus === 'INSUFFICIENT_HISTORY'
  if (filter === 'error') return result.tradeStatus === 'DATA_ERROR'
  return true
}

export function summarizeSignals(results: SignalResult[]): Record<string, number> {
  return {
    total: results.length,
    validLong: results.filter((result) => result.tradeStatus === 'VALID_LONG').length,
    blocked: results.filter((result) => result.tradeStatus === 'TOO_EXTENDED').length,
    watch: results.filter((result) => result.tradeStatus === 'WATCH').length,
    marketClosed: results.filter((result) => result.tradeStatus === 'MARKET_CLOSED').length,
    stale: results.filter((result) => result.tradeStatus === 'STALE_DATA').length,
    tooNew: results.filter((result) => result.tradeStatus === 'INSUFFICIENT_HISTORY').length,
    errors: results.filter((result) => result.tradeStatus === 'DATA_ERROR').length,
  }
}

export function formatSignalPrice(value: unknown): string {
  const numeric = finite(value)
  return numeric === null ? '—' : `$${numeric.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatSignalMoney(value: unknown): string {
  const numeric = finite(value)
  if (numeric === null) return '—'
  if (Math.abs(numeric) >= 1e9) return `$${(numeric / 1e9).toFixed(1)}B`
  if (Math.abs(numeric) >= 1e6) return `$${(numeric / 1e6).toFixed(1)}M`
  return `$${numeric.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function formatSignalScore(score: number, maximum: number): string {
  const display = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `${display(score)}/${display(maximum)}`
}

export function formatSignalRatio(value: unknown, digits = 2): string {
  const numeric = finite(value)
  return numeric === null ? '—' : numeric.toFixed(digits)
}

export function formatSignalPercent(value: unknown, digits = 1): string {
  const numeric = finite(value)
  return numeric === null ? '—' : `${numeric.toFixed(digits)}%`
}

export function formatSignalAge(timestamp: string, now = Date.now()): string {
  const seconds = Math.max(Math.floor((now - Date.parse(timestamp)) / 1000), 0)
  if (!Number.isFinite(seconds) || seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

export function describeSignalsFreshness(payload: LegacySignalsPayload | null, now = Date.now()): { text: string; tone: 'muted' | 'positive' | 'warning' } {
  if (!payload) return { text: 'No scan yet — click Refresh now.', tone: 'muted' }
  const completed = new Date(payload.completedAt)
  const ageMs = Math.max(now - completed.getTime(), 0)
  const counts = summarizeSignals(payload.results)
  const stamp = completed.toLocaleString('en-CA', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')
  let text = `Last scan ${stamp} · ${formatSignalAge(payload.completedAt, now)} · ${payload.results.length} ticker(s) · ${payload.source}`
  if (counts.errors) text += ` · ${counts.errors} data error(s)`
  if (counts.stale) text += ` · ${counts.stale} awaiting live intraday data`
  if (counts.tooNew) text += ` · ${counts.tooNew} too new to score`
  if (ageMs >= 12 * 60 * 60 * 1000) return { text: `${text} · stale`, tone: 'warning' }
  return { text, tone: counts.errors ? 'warning' : 'positive' }
}
