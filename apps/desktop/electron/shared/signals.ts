import type {
  SignalCandidate,
  SignalClass,
  SignalReason,
  SignalResult,
  SignalsFilter,
  SignalsPayload,
  SignalTimeframeBar,
} from './contract.js'

/** Pure, renderer-safe port of the PySide6 trend-breakout signal engine. */

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
export const SIGNAL_SOURCE_LIMIT = 100
export const SIGNAL_SHORTLIST_LIMIT = 25

export const SIGNAL_FILTERS: ReadonlyArray<{ label: string; value: SignalsFilter }> = [
  { label: 'All signals', value: 'all' },
  { label: 'Strong only', value: 'strong' },
  { label: 'Long setups', value: 'long' },
  { label: 'Watch', value: 'watch' },
  { label: 'Blocked (extended)', value: 'blocked' },
  { label: 'Too new to score', value: 'too_new' },
  { label: 'Data errors', value: 'error' },
]

export const SIGNAL_ROLE_LABELS: Record<string, string> = {
  trend: 'Trend (daily)',
  momentum: 'Momentum (hourly)',
  setup: 'Setup (5-minute)',
  entry: 'Entry (1-minute)',
  relative: 'Relative strength (vs benchmark)',
}

export const SIGNAL_INDICATOR_FIELDS = [
  ['EMA20', 'ema20', '$'],
  ['EMA50', 'ema50', '$'],
  ['EMA200', 'ema200', '$'],
  ['RSI', 'rsi', ''],
  ['MACD', 'macd', ''],
  ['MACD signal', 'macd_signal', ''],
  ['MACD histogram', 'macd_histogram', ''],
  ['VWAP', 'vwap', '$'],
  ['VWAP distance', 'vwap_distance_pct', '%'],
  ['Relative volume', 'relative_volume', 'x'],
  ['Prior 20-bar high', 'breakout_level', '$'],
  ['ATR (daily)', 'atr', '$'],
  ['ATR (setup)', 'atr_setup', '$'],
  ['ATR (entry)', 'atr_entry', '$'],
  ['Relative strength (long)', 'relative_strength_long_pct', '%'],
  ['Relative strength (short)', 'relative_strength_short_pct', '%'],
] as const

export const SIGNAL_SCORE_COMPONENTS = [
  ['Trend', 'trendScore', 'trendMaxScore', 'Daily direction'],
  ['Momentum', 'momentumScore', 'momentumMaxScore', 'Hourly structure'],
  ['Volume', 'volumeScore', 'volumeMaxScore', '5-minute confirmation'],
  ['Entry', 'entryScore', 'entryMaxScore', '5-minute breakout + 1-minute VWAP'],
  ['Relative strength', 'relativeScore', 'relativeMaxScore', 'Daily excess return vs benchmark'],
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
  volumeLookback: 20,
  relativeVolumeFloor: 1,
  relativeVolumeThreshold: 1.5,
  breakoutLookback: 20,
  atrPeriod: 14,
  maxVwapExtensionAtr: 2,
  maxVwapExtensionPct: 3,
  trendFastFullAtr: 0.5,
  trendAlignmentFullAtr: 0.5,
  trendLongFullAtr: 2,
  macdSignalFullAtr: 0.25,
  breakoutFullAtr: 0.25,
  vwapFullAtr: 0.5,
  relativeStrengthLookback: 63,
  relativeStrengthShortLookback: 21,
  relativeStrengthFullExcessPct: 15,
  relativeStrengthShortFullExcessPct: 6,
  priceAboveEmaFastWeight: 8,
  emaAlignmentWeight: 8,
  priceAboveEmaLongWeight: 8,
  rsiWeight: 9,
  macdHistogramWeight: 5,
  macdSignalWeight: 4,
  relativeVolumeWeight: 16,
  priceAboveVwapWeight: 9,
  breakoutWeight: 17,
  relativeStrengthWeight: 10,
  relativeStrengthShortWeight: 6,
  minimumTrendFractionForLong: 2 / 3,
} as const

const TREND_MAX = 24
const MOMENTUM_MAX = 18
const VOLUME_MAX = 16
const ENTRY_MAX = 26
const RELATIVE_MAX = 16

interface CalculatedBar extends SignalBar {
  emaFast: number | null
  emaMedium: number | null
  emaLong: number | null
  rsi: number | null
  macd: number | null
  macdSignal: number | null
  macdHistogram: number | null
  averageVolume: number | null
  relativeVolume: number | null
  breakoutLevel: number | null
  atr: number | null
  vwap: number | null
}

interface TimeframeRead {
  row: CalculatedBar | null
  calculated: CalculatedBar[]
  status: string
  kind: 'ok' | 'short' | 'missing'
  provenance: SignalTimeframeBar
}

function finite(value: unknown): number | null {
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
}

/** The automatic universe's quote-level filters, before liquidity history is applied. */
export function signalCandidateFromQuote(quote: SignalQuoteLike): Omit<SignalCandidate, 'medianDollarVolume' | 'qualityRank' | 'reasons'> | null {
  if (String(quote.quoteType ?? '').trim().toUpperCase() !== 'EQUITY') return null
  const exchange = String(quote.exchange ?? '').trim().toUpperCase()
  if (!(SIGNAL_EXCHANGES as readonly string[]).includes(exchange)) return null
  const ticker = String(quote.symbol ?? '').trim().toUpperCase()
  const price = firstPositive(quote.regularMarketPrice, quote.intradayprice)
  const marketCap = firstPositive(quote.marketCap, quote.intradaymarketcap)
  if (!ticker || price === null || marketCap === null || price < 5 || marketCap < 2e9) return null
  return {
    ticker,
    name: String(quote.longName ?? quote.shortName ?? ticker).trim() || ticker,
    exchange: exchangeLabel(exchange),
    price,
    marketCap,
  }
}

/** Median dollar volume of the last 20 fully completed sessions. */
export function completedMedianDollarVolume(
  bars: SignalBar[],
  sessionDate: string,
  lookback = 20,
): number | null {
  const values = bars
    .filter((bar) => new Date(bar.timestamp).toISOString().slice(0, 10) < sessionDate)
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

export function rankSignalCandidates(candidates: SignalCandidate[]): SignalCandidate[] {
  return [...candidates]
    .sort(
      (left, right) =>
        right.medianDollarVolume - left.medianDollarVolume ||
        right.marketCap - left.marketCap ||
        left.ticker.localeCompare(right.ticker),
    )
    .slice(0, SIGNAL_SHORTLIST_LIMIT)
    .map((candidate, index) => ({ ...candidate, qualityRank: index + 1 }))
}

function ramp(value: unknown, lower: number, upper: number): number {
  const numeric = finite(value)
  if (numeric === null || numeric <= lower) return 0
  if (numeric >= upper) return 1
  return upper <= lower ? 1 : (numeric - lower) / (upper - lower)
}

function atrFraction(distance: unknown, atr: unknown, fullAtr: number): number {
  const numeric = finite(distance)
  if (numeric === null) return 0
  const unit = finite(atr)
  if (unit === null || unit <= 0) return numeric > 0 ? 1 : 0
  return ramp(numeric / unit, 0, fullAtr)
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

function calculateIndicators(input: SignalBar[], includeVwap: boolean): CalculatedBar[] {
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

    const priorHighs = bars.slice(Math.max(0, index - SIGNAL_CONFIG.breakoutLookback), index)
      .map((item) => finite(item.high))
    const breakoutLevel = priorHighs.length === SIGNAL_CONFIG.breakoutLookback && priorHighs.every((value) => value !== null)
      ? Math.max(...priorHighs as number[])
      : null

    let vwap: number | null = null
    if (includeVwap) {
      const nextSession = new Date(bar.timestamp).toISOString().slice(0, 10)
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
      averageVolume,
      relativeVolume,
      breakoutLevel,
      atr: atr[index],
      vwap,
    }
  })
}

function timeframeRead(
  bars: SignalBar[],
  minimumBars: number,
  barSeconds: number,
  now: number,
  { includeVwap = false, dropOpen = true } = {},
): TimeframeRead {
  const required = minimumBars + (dropOpen ? 1 : 0)
  if (!bars.length) {
    return {
      row: null,
      calculated: [],
      status: 'Unavailable',
      kind: 'missing',
      provenance: { asOf: null, partial: false, dropped: false },
    }
  }
  if (bars.length < required) {
    return {
      row: null,
      calculated: [],
      status: `Insufficient history (${bars.length}/${required} bars)`,
      kind: 'short',
      provenance: { asOf: null, partial: false, dropped: false },
    }
  }
  const calculated = calculateIndicators(bars, includeVwap)
  if (!calculated.length) {
    return {
      row: null,
      calculated: [],
      status: 'Malformed OHLCV data',
      kind: 'missing',
      provenance: { asOf: null, partial: false, dropped: false },
    }
  }
  const last = calculated[calculated.length - 1]
  const elapsed = (now - last.timestamp) / 1000
  const partial = elapsed >= 0 && elapsed < barSeconds
  const dropped = partial && dropOpen
  const row = dropped ? calculated[calculated.length - 2] : last
  return {
    row,
    calculated: dropped ? calculated.slice(0, -1) : calculated,
    status: dropped ? 'Available (last closed bar)' : 'Available',
    kind: 'ok',
    provenance: { asOf: new Date(row.timestamp).toISOString(), partial, dropped },
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

function macdRisingFraction(frame: CalculatedBar[]): number {
  const values = frame.flatMap((bar) => bar.macdHistogram === null ? [] : [bar.macdHistogram])
  const window = values.slice(-(SIGNAL_CONFIG.macdSlopeBars + 1))
  if (window.length < 2) return 0
  let rising = 0
  for (let index = 1; index < window.length; index += 1) {
    if (window[index] > window[index - 1]) rising += 1
  }
  return rising / (window.length - 1)
}

function relativeStrengthExcess(
  ticker: CalculatedBar[],
  benchmark: SignalBar[],
  lookback: number,
): number | null {
  const tickerByDay = new Map(ticker.map((bar) => [new Date(bar.timestamp).toISOString().slice(0, 10), bar.close]))
  const aligned = benchmark.flatMap((bar) => {
    const close = tickerByDay.get(new Date(bar.timestamp).toISOString().slice(0, 10))
    return close === undefined ? [] : [[close, bar.close] as const]
  })
  if (aligned.length < lookback + 1) return null
  const start = aligned[aligned.length - 1 - lookback]
  const end = aligned[aligned.length - 1]
  if (start[0] <= 0 || start[1] <= 0) return null
  return ((end[0] / start[0]) - (end[1] / start[1])) * 100
}

export function classifySignal(score: number, trendScore: number, maximum = 100): SignalClass {
  const fraction = maximum > 0 ? score / maximum : 0
  let signal: SignalClass = fraction >= 0.8
    ? 'STRONG_LONG'
    : fraction >= 0.6
      ? 'LONG'
      : fraction >= 0.4
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
    maxScore: 84,
    trendScore: 0,
    trendMaxScore: TREND_MAX,
    momentumScore: 0,
    momentumMaxScore: MOMENTUM_MAX,
    volumeScore: 0,
    volumeMaxScore: VOLUME_MAX,
    entryScore: 0,
    entryMaxScore: ENTRY_MAX,
    relativeScore: 0,
    relativeMaxScore: 0,
    signal: 'NONE',
    tradeStatus: 'DATA_ERROR',
    reasons: [],
    warnings: [message],
    indicators: {},
    timeframeStatus,
    timeframeBars,
    error: message,
  }
}

/** Daily trend + hourly momentum + setup volume/breakout + live entry VWAP. */
export function evaluateSignal(
  ticker: string,
  frames: SignalFrames,
  options: { benchmark?: SignalBar[]; benchmarkSymbol?: string; now?: number } = {},
): SignalResult {
  const now = options.now ?? Date.now()
  const reads: Record<SignalRole, TimeframeRead> = {
    trend: timeframeRead(frames.trend, SIGNAL_CONFIG.emaLong, 86_400, now),
    momentum: timeframeRead(frames.momentum, SIGNAL_CONFIG.macdSlow + SIGNAL_CONFIG.macdSignal, 3_600, now),
    setup: timeframeRead(frames.setup, Math.max(SIGNAL_CONFIG.volumeLookback, SIGNAL_CONFIG.breakoutLookback) + 1, 300, now),
    entry: timeframeRead(frames.entry, 2, 60, now, { includeVwap: true, dropOpen: false }),
  }
  const reasons: SignalReason[] = []
  const warnings: string[] = []
  const indicators: Record<string, number | string | null> = {}

  let trendScore = 0
  const trend = reads.trend.row
  if (trend) {
    Object.assign(indicators, { ema20: trend.emaFast, ema50: trend.emaMedium, ema200: trend.emaLong, atr: trend.atr })
    const trendReasons = [
      reason('Price above EMA20', 'trend', atrFraction(trend.close - (trend.emaFast ?? Number.NaN), trend.atr, SIGNAL_CONFIG.trendFastFullAtr), SIGNAL_CONFIG.priceAboveEmaFastWeight, 'Daily close is above the fast trend average; full credit at 0.5 ATR above it.', trend.close, trend.emaFast),
      reason('EMA20 above EMA50', 'trend', atrFraction((trend.emaFast ?? Number.NaN) - (trend.emaMedium ?? Number.NaN), trend.atr, SIGNAL_CONFIG.trendAlignmentFullAtr), SIGNAL_CONFIG.emaAlignmentWeight, 'Daily fast and medium averages are aligned bullishly; full credit at 0.5 ATR of separation.', trend.emaFast, trend.emaMedium),
      reason('Price above EMA200', 'trend', atrFraction(trend.close - (trend.emaLong ?? Number.NaN), trend.atr, SIGNAL_CONFIG.trendLongFullAtr), SIGNAL_CONFIG.priceAboveEmaLongWeight, 'Daily close is above the long-term trend average; full credit at 2 ATR above it.', trend.close, trend.emaLong),
    ]
    reasons.push(...trendReasons)
    trendScore = trendReasons.reduce((sum, item) => sum + item.points, 0)
  }

  let momentumScore = 0
  const momentum = reads.momentum.row
  if (momentum) {
    const rising = macdRisingFraction(reads.momentum.calculated)
    const histograms = reads.momentum.calculated.flatMap((bar) => bar.macdHistogram === null ? [] : [bar.macdHistogram])
    const previous = histograms.length >= 2 ? histograms[histograms.length - 2] : null
    Object.assign(indicators, {
      rsi: momentum.rsi,
      macd: momentum.macd,
      macd_signal: momentum.macdSignal,
      macd_histogram: momentum.macdHistogram,
      macd_histogram_previous: previous,
      macd_rising_fraction: rising,
    })
    const momentumReasons = [
      reason('RSI in bullish range', 'momentum', rsiFraction(momentum.rsi), SIGNAL_CONFIG.rsiWeight, 'Hourly RSI is between 50 and 70, tapering to zero 10 points outside that band.', momentum.rsi, SIGNAL_CONFIG.rsiMin),
      reason('MACD histogram increasing', 'momentum', rising, SIGNAL_CONFIG.macdHistogramWeight, 'Share of the last 3 hourly MACD histogram changes that rose.', momentum.macdHistogram, previous),
      reason('MACD above signal line', 'momentum', atrFraction((momentum.macd ?? Number.NaN) - (momentum.macdSignal ?? Number.NaN), momentum.atr, SIGNAL_CONFIG.macdSignalFullAtr), SIGNAL_CONFIG.macdSignalWeight, 'Hourly MACD leads its signal line; full credit at 0.25 ATR of separation.', momentum.macd, momentum.macdSignal),
    ]
    reasons.push(...momentumReasons)
    momentumScore = momentumReasons.reduce((sum, item) => sum + item.points, 0)
  }

  let volumeScore = 0
  let entryScore = 0
  const setup = reads.setup.row
  if (setup) {
    Object.assign(indicators, {
      relative_volume: setup.relativeVolume,
      average_volume: setup.averageVolume,
      breakout_level: setup.breakoutLevel,
      atr_setup: setup.atr,
    })
    const volumeReason = reason('Relative volume elevated', 'volume', ramp(setup.relativeVolume, SIGNAL_CONFIG.relativeVolumeFloor, SIGNAL_CONFIG.relativeVolumeThreshold), SIGNAL_CONFIG.relativeVolumeWeight, 'Setup-bar volume against its prior 20-bar average, scored from 1x up to 1.5x.', setup.relativeVolume, SIGNAL_CONFIG.relativeVolumeThreshold)
    const breakoutReason = reason('Breakout above prior 20-bar high', 'entry', atrFraction(setup.close - (setup.breakoutLevel ?? Number.NaN), setup.atr, SIGNAL_CONFIG.breakoutFullAtr), SIGNAL_CONFIG.breakoutWeight, 'Setup close is above resistance calculated from prior completed bars only; full credit at 0.25 ATR beyond it.', setup.close, setup.breakoutLevel)
    reasons.push(volumeReason, breakoutReason)
    volumeScore = volumeReason.points
    entryScore = breakoutReason.points
  }

  let price: number | null = null
  const entry = reads.entry.row
  if (entry) {
    price = entry.close
    const distance = entry.vwap === null ? null : price - entry.vwap
    const distancePct = distance === null || !entry.vwap ? null : distance / entry.vwap * 100
    Object.assign(indicators, { price, vwap: entry.vwap, vwap_distance: distance, vwap_distance_pct: distancePct, atr_entry: entry.atr })
    const vwapReason = reason('Price above VWAP', 'entry', atrFraction(distance, entry.atr, SIGNAL_CONFIG.vwapFullAtr), SIGNAL_CONFIG.priceAboveVwapWeight, 'Entry-timeframe price is above session VWAP; full credit at 0.5 ATR above it.', price, entry.vwap)
    reasons.push(vwapReason)
    entryScore += vwapReason.points
  }

  const benchmarkLabel = (options.benchmarkSymbol ?? 'SPY').trim().toUpperCase() || 'SPY'
  const longExcess = relativeStrengthExcess(reads.trend.calculated, options.benchmark ?? [], SIGNAL_CONFIG.relativeStrengthLookback)
  const shortExcess = relativeStrengthExcess(reads.trend.calculated, options.benchmark ?? [], SIGNAL_CONFIG.relativeStrengthShortLookback)
  let relativeScore = 0
  let relativeMaxScore = 0
  const timeframeStatus: Record<string, string> = Object.fromEntries(
    Object.entries(reads).map(([role, read]) => [role, read.status]),
  )
  if (longExcess !== null && shortExcess !== null) {
    relativeMaxScore = RELATIVE_MAX
    Object.assign(indicators, { benchmark: benchmarkLabel, relative_strength_long_pct: longExcess, relative_strength_short_pct: shortExcess })
    const relativeReasons = [
      reason(`Outperforming ${benchmarkLabel} over 63 days`, 'relative', ramp(longExcess, 0, SIGNAL_CONFIG.relativeStrengthFullExcessPct), SIGNAL_CONFIG.relativeStrengthWeight, `Excess return against ${benchmarkLabel}; full credit at 15% ahead.`, longExcess, SIGNAL_CONFIG.relativeStrengthFullExcessPct),
      reason(`Outperforming ${benchmarkLabel} over 21 days`, 'relative', ramp(shortExcess, 0, SIGNAL_CONFIG.relativeStrengthShortFullExcessPct), SIGNAL_CONFIG.relativeStrengthShortWeight, `Recent excess return against ${benchmarkLabel}; full credit at 6% ahead.`, shortExcess, SIGNAL_CONFIG.relativeStrengthShortFullExcessPct),
    ]
    reasons.push(...relativeReasons)
    relativeScore = relativeReasons.reduce((sum, item) => sum + item.points, 0)
    timeframeStatus.relative = `Available (vs ${benchmarkLabel})`
  } else {
    timeframeStatus.relative = 'Benchmark history unavailable'
    warnings.push(`Relative strength was not scored: no usable ${benchmarkLabel} history. This result is scored out of 84.`)
  }

  const missing = Object.entries(reads).filter(([, read]) => !read.row)
  const rawScore = trendScore + momentumScore + volumeScore + entryScore + relativeScore
  const maxScore = TREND_MAX + MOMENTUM_MAX + VOLUME_MAX + ENTRY_MAX + relativeMaxScore
  const signal = missing.length ? 'NONE' : classifySignal(rawScore, trendScore, maxScore)
  if (!missing.length && rawScore >= 0.6 * maxScore && trendScore < SIGNAL_CONFIG.minimumTrendFractionForLong * TREND_MAX) {
    warnings.push('Lower-timeframe strength is capped at WATCH because the higher-timeframe trend is not qualified.')
  }
  let tradeStatus: SignalResult['tradeStatus'] = signal === 'WATCH'
    ? 'WATCH'
    : signal === 'LONG' || signal === 'STRONG_LONG'
      ? 'VALID_LONG'
      : 'NONE'
  let error = ''
  if (missing.length) {
    const messages = missing.map(([role, read]) => `${role}: ${read.status}`)
    warnings.push(...messages)
    tradeStatus = missing.every(([, read]) => read.kind === 'short') ? 'INSUFFICIENT_HISTORY' : 'DATA_ERROR'
    error = messages.join('; ')
  }

  if ((signal === 'LONG' || signal === 'STRONG_LONG') && tradeStatus !== 'DATA_ERROR') {
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
    maxScore,
    trendScore,
    trendMaxScore: TREND_MAX,
    momentumScore,
    momentumMaxScore: MOMENTUM_MAX,
    volumeScore,
    volumeMaxScore: VOLUME_MAX,
    entryScore,
    entryMaxScore: ENTRY_MAX,
    relativeScore,
    relativeMaxScore,
    signal,
    tradeStatus,
    reasons,
    warnings,
    indicators,
    timeframeStatus,
    timeframeBars: Object.fromEntries(Object.entries(reads).map(([role, read]) => [role, read.provenance])),
    error,
  }
}

export function signalScoreFraction(result: SignalResult): number {
  return result.maxScore > 0 ? result.rawScore / result.maxScore : 0
}

export function signalVisible(result: SignalResult, filter: SignalsFilter, search: string): boolean {
  const query = search.trim().toUpperCase()
  if (query && !result.ticker.includes(query)) return false
  if (filter === 'strong') return result.signal === 'STRONG_LONG' && result.tradeStatus === 'VALID_LONG'
  if (filter === 'long') return result.tradeStatus === 'VALID_LONG'
  if (filter === 'watch') return result.tradeStatus === 'WATCH'
  if (filter === 'blocked') return result.tradeStatus === 'TOO_EXTENDED'
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

export function describeSignalsFreshness(payload: SignalsPayload | null, now = Date.now()): { text: string; tone: 'muted' | 'positive' | 'warning' } {
  if (!payload) return { text: 'No scan yet — click Refresh now.', tone: 'muted' }
  const completed = new Date(payload.completedAt)
  const ageMs = Math.max(now - completed.getTime(), 0)
  const counts = summarizeSignals(payload.results)
  const stamp = completed.toLocaleString('en-CA', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')
  let text = `Last scan ${stamp} · ${formatSignalAge(payload.completedAt, now)} · ${payload.results.length} ticker(s) · ${payload.source}`
  if (counts.errors) text += ` · ${counts.errors} data error(s)`
  if (counts.tooNew) text += ` · ${counts.tooNew} too new to score`
  if (ageMs >= 12 * 60 * 60 * 1000) return { text: `${text} · stale`, tone: 'warning' }
  return { text, tone: counts.errors ? 'warning' : 'positive' }
}
