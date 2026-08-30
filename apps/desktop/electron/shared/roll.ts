/**
 * The Roll page's maths, ported from `workers/random_recommender.py` (page18).
 *
 * Pure and renderer-safe: the main process runs it over freshly downloaded history, the
 * probe runs it over the same bars headless, and the renderer re-reads the snapshots the
 * evaluators leave behind. Nothing here reaches Yahoo.
 *
 * Every threshold, weight and reason string is the reference's. A pandas `Series` becomes
 * `Array<number | null>` here, and the two places that behaviour actually shows are
 * documented where they occur: `latest()` drops nulls before indexing from the end, the
 * way `_latest_series_value` calls `.dropna()` first, and `rollingMean`/`ewmMean` honour
 * `min_periods` so a warm-up window stays null instead of averaging a short window.
 */

import type { RollCandidate, RollMatchTier, RollPayload, RollQuote } from './contract.js'

export interface RollBar {
  /** `YYYY-MM-DD`, the session date in the exchange's own calendar. */
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export const ROLL_PATTERN_MODES = [
  'breakout',
  'consolidation',
  'downtrend',
  'double_bottom',
  'bullish_flag',
  'bullish_rsi_divergence',
] as const
export type RollPatternMode = (typeof ROLL_PATTERN_MODES)[number]

/** `P18_PATTERN_MODE_LABELS`. */
export const ROLL_PATTERN_LABELS: Record<RollPatternMode, string> = {
  breakout: 'Breakout',
  consolidation: 'Consolidation',
  downtrend: 'Downtrend',
  double_bottom: 'Double Bottom',
  bullish_flag: 'Bullish Flag',
  bullish_rsi_divergence: 'Bullish RSI Divergence',
}

/** `P18_PATTERN_TOOLTIPS`, shown on each checkbox. */
export const ROLL_PATTERN_TOOLTIPS: Record<RollPatternMode, string> = {
  breakout:
    'Finds pre-breakout or fresh-breakout setups near 55-day resistance, confirmed by price support, momentum, volume, and multiple timeframes.',
  consolidation:
    'Finds stocks inside a tight 20-day range with low directional drift, contracting ATR, and orderly volume.',
  downtrend:
    'Finds controlled declines below daily moving averages with bearish price structure and momentum, volume, and multi-timeframe confirmation.',
  double_bottom:
    'Finds two comparable lows followed by a rebound toward or through the neckline, with momentum, volume, and multi-timeframe confirmation.',
  bullish_flag:
    'Finds a sharp, recent advance followed by an orderly pullback near or through flag resistance, with momentum, volume, and multi-timeframe confirmation.',
  bullish_rsi_divergence:
    'Finds a lower price low with a higher RSI low, then checks the rebound, price trigger, and supporting confirmation.',
}

/** The phrase each mode contributes to the screening summary. */
export const ROLL_MODE_PHRASES: Record<RollPatternMode, string> = {
  breakout: 'breakout',
  consolidation: 'consolidation',
  downtrend: 'downtrend',
  double_bottom: 'double bottom',
  bullish_flag: 'bullish flag',
  bullish_rsi_divergence: 'bullish RSI divergence',
}

/** `required_rows` in `_apply_pattern_analysis`: the shortest history each mode can read. */
export const ROLL_REQUIRED_ROWS: Record<RollPatternMode, number> = {
  breakout: 70,
  consolidation: 70,
  downtrend: 70,
  double_bottom: 90,
  bullish_flag: 90,
  bullish_rsi_divergence: 90,
}

export type RollSnapshotValue = number | string | boolean | null
export type RollSnapshot = Record<string, RollSnapshotValue>

export interface RollPatternResult {
  matched: boolean
  score: number
  reasons: string[]
  snapshot: RollSnapshot
}

const EMPTY_RESULT: RollPatternResult = { matched: false, score: 0, reasons: [], snapshot: {} }

/* -------------------------------------------------------------- series helpers */

type Series = Array<number | null>

/**
 * `_latest_series_value`. The reference drops NaN *before* indexing from the end, so a
 * moving average whose warm-up has not completed answers with its last real value rather
 * than with nothing — and `latest(series, 30)` counts thirty real observations back, not
 * thirty rows. Indexing the raw array instead silently shifts every momentum delta.
 */
function latest(series: Series, offset = 0): number | null {
  let seen = 0
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index]
    if (value === null || !Number.isFinite(value)) continue
    if (seen === offset) return value
    seen += 1
  }
  return null
}

/** `_series_change`: the latest value less the one `periods` real observations back. */
function changeOver(series: Series, periods: number): number | null {
  const current = latest(series)
  const prior = latest(series, periods)
  if (current === null || prior === null) return null
  return current - prior
}

/** `Series.rolling(window, min_periods).mean()`, skipping nulls in both sum and count. */
function rollingMean(values: Series, window: number, minPeriods: number): Series {
  const out: Series = new Array<number | null>(values.length).fill(null)
  for (let index = 0; index < values.length; index += 1) {
    let sum = 0
    let count = 0
    for (let step = Math.max(0, index - window + 1); step <= index; step += 1) {
      const value = values[step]
      if (value === null || !Number.isFinite(value)) continue
      sum += value
      count += 1
    }
    out[index] = count >= minPeriods ? sum / count : null
  }
  return out
}

/**
 * `Series.ewm(alpha=..., adjust=False, min_periods=...).mean()`.
 *
 * Only leading nulls occur in this file's inputs (`close.diff()` and the MACD line's
 * warm-up), so the recursion simply skips them; pandas' `ignore_na` weighting for
 * *interior* gaps never comes into play.
 */
function ewmMean(values: Series, alpha: number, minPeriods: number): Series {
  const out: Series = new Array<number | null>(values.length).fill(null)
  let previous: number | null = null
  let count = 0
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value !== null && Number.isFinite(value)) {
      count += 1
      previous = previous === null ? value : alpha * value + (1 - alpha) * previous
    }
    out[index] = count >= minPeriods ? previous : null
  }
  return out
}

function ewmSpan(values: Series, span: number, minPeriods: number): Series {
  return ewmMean(values, 2 / (span + 1), minPeriods)
}

function sliceMax(values: Series, from: number, to: number): number | null {
  let best: number | null = null
  for (let index = Math.max(0, from); index < Math.min(values.length, to); index += 1) {
    const value = values[index]
    if (value === null || !Number.isFinite(value)) continue
    if (best === null || value > best) best = value
  }
  return best
}

function sliceMin(values: Series, from: number, to: number): number | null {
  let best: number | null = null
  for (let index = Math.max(0, from); index < Math.min(values.length, to); index += 1) {
    const value = values[index]
    if (value === null || !Number.isFinite(value)) continue
    if (best === null || value < best) best = value
  }
  return best
}

function sliceMean(values: Series, from: number, to: number): number | null {
  let sum = 0
  let count = 0
  for (let index = Math.max(0, from); index < Math.min(values.length, to); index += 1) {
    const value = values[index]
    if (value === null || !Number.isFinite(value)) continue
    sum += value
    count += 1
  }
  return count ? sum / count : null
}

/** `_pattern_snapshot_value`: round for display, or null when the input is not finite. */
function snap(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score))
}

function countTrue(...values: boolean[]): number {
  return values.filter(Boolean).length
}

/* ------------------------------------------------------------------ indicators */

/**
 * `_calculate_rsi`. Note the tail: pandas fills the warm-up window with **50**, not with
 * nothing, so the first fourteen entries are real 50s that `latest(rsi, 30)` will read.
 * Leaving them null instead changes every long-window RSI delta on a short history.
 */
export function rollRsi(close: number[], period = 14): number[] {
  const delta: Series = close.map((value, index) => (index === 0 ? null : value - close[index - 1]))
  const gains: Series = delta.map((value) => (value === null ? null : Math.max(value, 0)))
  const losses: Series = delta.map((value) => (value === null ? null : Math.max(-value, 0)))
  const avgGain = ewmMean(gains, 1 / period, period)
  const avgLoss = ewmMean(losses, 1 / period, period)
  return close.map((_value, index) => {
    const gain = avgGain[index]
    const loss = avgLoss[index]
    if (gain === null || loss === null) return 50
    if (gain === 0 && loss === 0) return 50
    if (loss === 0) return 100
    const value = 100 - 100 / (1 + gain / loss)
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50))
  })
}

/** `_calculate_macd`: 12/26 EMAs, a 9-period signal, and their difference. */
export function rollMacd(close: number[]): { line: Series; signal: Series; histogram: Series } {
  const ema12 = ewmSpan(close, 12, 12)
  const ema26 = ewmSpan(close, 26, 26)
  const line: Series = close.map((_value, index) => {
    const fast = ema12[index]
    const slow = ema26[index]
    return fast === null || slow === null ? null : fast - slow
  })
  const signal = ewmSpan(line, 9, 9)
  const histogram: Series = line.map((value, index) => {
    const reference = signal[index]
    return value === null || reference === null ? null : value - reference
  })
  return { line, signal, histogram }
}

/** `calculate_true_range`: the first bar has no previous close, so it is |high - low|. */
function trueRange(bars: RollBar[]): Series {
  return bars.map((bar, index) => {
    const candidates = [Math.abs(bar.high - bar.low)]
    if (index > 0) {
      const previousClose = bars[index - 1].close
      candidates.push(Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose))
    }
    return Math.max(...candidates)
  })
}

/* -------------------------------------------------------------- shared context */

export interface RollPatternContext {
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  volume: number[]
  sma20: Series
  sma50: Series
  sma200: Series
  ema8: Series
  ema21: Series
  volume20: Series
  volume50: Series
  volume60: Series
  volume120: Series
  rsi: number[]
  rsiMa10: Series
  macdLine: Series
  macdSignal: Series
  macdHistogram: Series
  atr20: Series
  atr60: Series
  swingLowIndexes: number[]
  swingHighIndexes: number[]
}

/**
 * `_shared_pattern_context`. Every selected evaluator reads the same indicators off one
 * history, which is why the reference caches it per frame — a six-mode roll over 120
 * candidates would otherwise recompute 200-day means seven hundred times.
 */
export function rollPatternContext(bars: RollBar[]): RollPatternContext {
  const open = bars.map((bar) => bar.open)
  const high = bars.map((bar) => bar.high)
  const low = bars.map((bar) => bar.low)
  const close = bars.map((bar) => bar.close)
  const volume = bars.map((bar) => bar.volume)
  const rsi = rollRsi(close)
  const macd = rollMacd(close)
  const range = trueRange(bars)

  // A swing point is the extreme of its own seven-bar window, with the 0.3% tolerance the
  // reference allows so a near-equal double print still marks both bars.
  const swingLowIndexes: number[] = []
  const swingHighIndexes: number[] = []
  for (let index = 3; index < Math.max(3, close.length - 3); index += 1) {
    const lowWindow = low.slice(index - 3, index + 4)
    const highWindow = high.slice(index - 3, index + 4)
    if (low[index] > 0 && lowWindow.length >= 5 && low[index] <= Math.min(...lowWindow) * 1.003) {
      swingLowIndexes.push(index)
    }
    if (high[index] > 0 && highWindow.length >= 5 && high[index] >= Math.max(...highWindow) * 0.997) {
      swingHighIndexes.push(index)
    }
  }

  return {
    open,
    high,
    low,
    close,
    volume,
    sma20: rollingMean(close, 20, 20),
    sma50: rollingMean(close, 50, 50),
    sma200: rollingMean(close, 200, 180),
    ema8: ewmSpan(close, 8, 8),
    ema21: ewmSpan(close, 21, 21),
    volume20: rollingMean(volume, 20, 10),
    volume50: rollingMean(volume, 50, 20),
    volume60: rollingMean(volume, 60, 30),
    volume120: rollingMean(volume, 120, 60),
    rsi,
    rsiMa10: rollingMean(rsi, 10, 5),
    macdLine: macd.line,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,
    atr20: rollingMean(range, 20, 15),
    atr60: rollingMean(range, 60, 40),
    swingLowIndexes,
    swingHighIndexes,
  }
}

/**
 * `_distinct_trough_indexes`. Adjacent swing marks describe one trough, not several, so a
 * four-bar base would otherwise pair with itself and report a double bottom fifteen bars
 * wide that never happened.
 */
function distinctTroughIndexes(indexes: number[], low: number[], maxAdjacentGap = 4): number[] {
  const ordered = [...new Set(indexes.filter((index) => index >= 0))].sort((left, right) => left - right)
  if (!ordered.length) return []
  const zones: number[][] = [[ordered[0]]]
  for (const index of ordered.slice(1)) {
    const zone = zones[zones.length - 1]
    if (index - zone[zone.length - 1] <= maxAdjacentGap) zone.push(index)
    else zones.push([index])
  }
  const representatives: number[] = []
  for (const zone of zones) {
    const valid = zone
      .filter((index) => index < low.length && low[index] > 0 && Number.isFinite(low[index]))
      .map((index) => ({ index, value: low[index] }))
    if (!valid.length) continue
    const minimum = Math.min(...valid.map((entry) => entry.value))
    const nearMinimum = valid
      .filter((entry) => entry.value <= minimum * 1.001)
      .map((entry) => entry.index)
    representatives.push(nearMinimum[Math.floor(nearMinimum.length / 2)])
  }
  return representatives
}

/** Average volume of up bars and of down bars from `from` to the end, as the evaluators split them. */
function directionalVolume(bars: RollBar[], from: number): { up: number | null; down: number | null } {
  let upSum = 0
  let upCount = 0
  let downSum = 0
  let downCount = 0
  for (let index = Math.max(0, from); index < bars.length; index += 1) {
    const bar = bars[index]
    if (!Number.isFinite(bar.volume)) continue
    if (bar.close < bar.open) {
      downSum += bar.volume
      downCount += 1
    } else {
      upSum += bar.volume
      upCount += 1
    }
  }
  return { up: upCount ? upSum / upCount : null, down: downCount ? downSum / downCount : null }
}

/* ------------------------------------------------------------------ evaluators */

/**
 * `_evaluate_breakout_pattern`.
 *
 * Resistance is the highest high of the 55 bars ending five sessions back, so the bars
 * that would *be* the breakout cannot raise the level they are breaking.
 */
export function evaluateBreakout(bars: RollBar[]): RollPatternResult {
  if (bars.length < 70) return EMPTY_RESULT
  const context = rollPatternContext(bars)
  const { high, close, volume } = context

  const lastClose = close[close.length - 1]
  const resistanceEnd = close.length - 5
  const priorHigh = sliceMax(high, Math.max(0, resistanceEnd - 55), resistanceEnd)
  const sma20 = latest(context.sma20)
  const sma50 = latest(context.sma50)
  const sma200 = latest(context.sma200)
  const ema8 = latest(context.ema8)
  const ema21 = latest(context.ema21)
  const vol20 = latest(context.volume20)
  const vol50 = latest(context.volume50)
  const vol120 = latest(context.volume120)
  const latestVolume = latest(volume)
  const rsi = latest(context.rsi)
  const rsiMa = latest(context.rsiMa10)
  const macdLine = latest(context.macdLine)
  const macdSignal = latest(context.macdSignal)
  const macdHist = latest(context.macdHistogram)
  if (
    !Number.isFinite(lastClose) ||
    priorHigh === null ||
    sma20 === null ||
    sma50 === null ||
    ema21 === null ||
    !priorHigh
  ) {
    return EMPTY_RESULT
  }

  const distanceToResistance = (lastClose - priorHigh) / priorHigh
  const breakoutCloses5 = close.slice(-5).filter((value) => value > priorHigh * 1.002).length
  const breakoutCloses10 = close.slice(-10).filter((value) => value > priorHigh * 1.002).length
  const recentHigh = sliceMax(high, high.length - 10, high.length)
  const preBreakout = distanceToResistance >= -0.05 && distanceToResistance <= 0.002
  const freshBreakout =
    distanceToResistance > 0.002 &&
    distanceToResistance <= 0.012 &&
    breakoutCloses5 <= 2 &&
    breakoutCloses10 <= 4
  const lateBreakout = distanceToResistance > 0.012 || breakoutCloses5 > 2 || breakoutCloses10 > 4

  const aboveDailySupport = lastClose >= Math.min(sma20, ema21) * 0.995
  let maStackAligned = sma20 >= sma50 * 0.98
  if (sma200 !== null) maStackAligned = maStackAligned && sma50 >= sma200 * 0.97
  const fastMaAligned = ema8 !== null && ema8 >= ema21 * 0.995
  const distanceToSma20 = sma20 ? (lastClose - sma20) / sma20 : 1
  const distanceToEma21 = ema21 ? (lastClose - ema21) / ema21 : 1
  const notOverextended =
    distanceToSma20 <= 0.06 &&
    distanceToEma21 <= 0.08 &&
    (recentHigh === null || recentHigh <= priorHigh * 1.05)

  const rsiChange5 = changeOver(context.rsi, 5)
  const rsiMaChange10 = changeOver(context.rsiMa10, 10)
  const rsiChange30 = changeOver(context.rsi, 30)
  const rsiAboveMa = rsi !== null && rsiMa !== null && rsi >= rsiMa
  const rsiHealthy = rsi !== null && rsi >= 45 && rsi <= 74
  const rsiShortOk = rsiAboveMa && (rsiChange5 === null || rsiChange5 >= -1.5)
  const rsiIntermediateOk = rsi !== null && rsi >= 50 && (rsiMaChange10 === null || rsiMaChange10 >= -1)
  const rsiLongOk = rsi !== null && rsi >= 45 && (rsiChange30 === null || rsiChange30 >= -6)
  const rsiOk = rsiAboveMa && rsiHealthy && (rsiShortOk || rsiIntermediateOk)

  const macdHistChange5 = changeOver(context.macdHistogram, 5)
  const macdLineChange20 = changeOver(context.macdLine, 20)
  const macdAboveSignal = macdLine !== null && macdSignal !== null && macdLine >= macdSignal
  const macdTurningUp = macdHist !== null && (macdHistChange5 === null || macdHistChange5 > 0)
  const macdShortOk = macdTurningUp && (macdHist === null || macdHist > -Math.abs(lastClose) * 0.004)
  const macdIntermediateOk = macdAboveSignal || (macdHist !== null && macdHist > 0)
  const macdLongOk =
    macdLine !== null && (macdLine >= 0 || (macdLineChange20 !== null && macdLineChange20 > 0))
  const macdOk = macdShortOk && (macdIntermediateOk || macdLongOk)

  let volumeOk: boolean | null = null
  if (vol20 !== null && vol20 > 0 && vol50 !== null && vol50 > 0) volumeOk = vol20 >= vol50 * 0.85
  if (latestVolume !== null && latestVolume > 0 && vol20 !== null && vol20 > 0) {
    const latestVolumeOk = latestVolume >= vol20 * 0.9 && latestVolume <= vol20 * 2.8
    volumeOk = volumeOk === null ? latestVolumeOk : volumeOk || latestVolumeOk
    if (latestVolume > vol20 * 2.8) volumeOk = false
  }
  const volumeShortAvailable = latestVolume !== null && latestVolume > 0 && vol20 !== null && vol20 > 0
  const volumeIntermediateAvailable = vol20 !== null && vol20 > 0 && vol50 !== null && vol50 > 0
  const volumeLongAvailable = vol50 !== null && vol50 > 0 && vol120 !== null && vol120 > 0
  const volumeShortNotAdverse =
    !volumeShortAvailable || (latestVolume as number) >= (vol20 as number) * 0.75
  const volumeIntermediateNotAdverse =
    !volumeIntermediateAvailable || (vol20 as number) >= (vol50 as number) * 0.85
  const volumeLongNotAdverse = !volumeLongAvailable || (vol50 as number) >= (vol120 as number) * 0.75
  const volumeAccumulation =
    (vol20 !== null && vol50 !== null && vol50 > 0 && vol20 >= vol50 * 0.95) ||
    (latestVolume !== null && vol20 !== null && vol20 > 0 && latestVolume >= vol20 * 1.05)

  const shortTimeframeOk = (rsiShortOk || macdShortOk) && volumeShortNotAdverse
  const intermediateTimeframeOk = (rsiIntermediateOk || macdIntermediateOk) && volumeIntermediateNotAdverse
  const longTimeframeOk = (rsiLongOk || macdLongOk) && volumeLongNotAdverse
  const timeframeAgreementCount = countTrue(shortTimeframeOk, intermediateTimeframeOk, longTimeframeOk)
  const indicatorConfirmations = countTrue(
    rsiOk,
    macdOk,
    volumeOk === true,
    timeframeAgreementCount >= 2,
    maStackAligned && fastMaAligned,
  )

  const timingOk = preBreakout || freshBreakout
  const setupStage = preBreakout
    ? 'Pre-Breakout'
    : freshBreakout
      ? 'Fresh Breakout'
      : lateBreakout
        ? 'Late Breakout'
        : 'No Breakout'

  let score = 0
  const reasons: string[] = []
  if (preBreakout) {
    score += 28
    reasons.push(distanceToResistance >= -0.02 ? 'near resistance' : 'coiling below resistance')
  } else if (freshBreakout) {
    score += 20
    reasons.push('fresh breakout')
  }
  if (breakoutCloses5 <= 2 && breakoutCloses10 <= 4) {
    score += 6
    reasons.push('few breakout closes')
  }
  if (aboveDailySupport) {
    score += 8
    reasons.push('above daily support')
  }
  if (maStackAligned && fastMaAligned) {
    score += 14
    reasons.push('daily MA stack aligned')
  } else if (maStackAligned || fastMaAligned) {
    score += 8
    reasons.push('daily MAs improving')
  }
  if (notOverextended) {
    score += 10
    reasons.push('not overextended')
  }
  if (rsiAboveMa) {
    score += 8
    reasons.push('RSI above RSI MA')
  }
  if (rsiHealthy) {
    score += 5
    reasons.push('RSI constructive')
  }
  if (macdTurningUp) {
    score += 8
    reasons.push('MACD turning up')
  }
  if (macdAboveSignal) {
    score += 5
    reasons.push('MACD above signal')
  }
  if (volumeAccumulation) {
    score += 8
    reasons.push('volume accumulation')
  }
  if (volumeOk === true) {
    score += 4
    reasons.push('volume controlled')
  }
  if (timeframeAgreementCount >= 2) {
    score += 10
    reasons.push('multi-timeframe confirmation')
  } else if (timeframeAgreementCount === 1) {
    score += 4
  }
  if (lateBreakout) score -= 18
  if (!notOverextended) score -= 12
  if (rsi !== null && rsi > 76) score -= 8
  if (latestVolume !== null && vol20 !== null && vol20 > 0 && latestVolume > vol20 * 2.8) score -= 10

  const snapshot: RollSnapshot = {
    close: snap(lastClose),
    setup_stage: setupStage,
    resistance_55d: snap(priorHigh),
    distance_to_resistance_pct: snap(distanceToResistance * 100),
    breakout_closes_5d: breakoutCloses5,
    breakout_closes_10d: breakoutCloses10,
    sma20: snap(sma20),
    sma50: snap(sma50),
    sma200: snap(sma200),
    ema8: snap(ema8),
    ema21: snap(ema21),
    distance_to_sma20_pct: snap(distanceToSma20 * 100),
    daily_ma_stack:
      maStackAligned && fastMaAligned ? 'aligned' : maStackAligned || fastMaAligned ? 'improving' : 'mixed',
    rsi14: snap(rsi),
    rsi_ma10: snap(rsiMa),
    rsi_state: rsiAboveMa ? 'above RSI MA' : 'below RSI MA',
    macd_line: snap(macdLine),
    macd_signal: snap(macdSignal),
    macd_histogram: snap(macdHist),
    macd_state: macdTurningUp ? 'turning up' : macdAboveSignal ? 'above signal' : 'mixed',
    volume20: snap(vol20, 0),
    volume50: snap(vol50, 0),
    volume120: snap(vol120, 0),
    volume_state: volumeAccumulation
      ? 'accumulation'
      : volumeOk === true
        ? 'controlled'
        : volumeOk === false
          ? 'weak or disorderly'
          : 'unavailable',
    short_timeframe_confirmed: shortTimeframeOk,
    intermediate_timeframe_confirmed: intermediateTimeframeOk,
    long_timeframe_confirmed: longTimeframeOk,
    timeframe_agreement: `${timeframeAgreementCount}/3`,
  }
  const matched =
    timingOk &&
    !lateBreakout &&
    aboveDailySupport &&
    notOverextended &&
    indicatorConfirmations >= 2 &&
    timeframeAgreementCount >= 2 &&
    score >= 58
  return { matched, score: clampScore(score), reasons: reasons.slice(0, 8), snapshot }
}

/** `_evaluate_downtrend_pattern`: a controlled decline, not a collapse. */
export function evaluateDowntrend(bars: RollBar[]): RollPatternResult {
  if (bars.length < 70) return EMPTY_RESULT
  const context = rollPatternContext(bars)
  const { high, low, close, volume } = context

  const lastClose = close[close.length - 1]
  const sma20 = latest(context.sma20)
  const sma50 = latest(context.sma50)
  const sma200 = latest(context.sma200)
  const ema8 = latest(context.ema8)
  const ema21 = latest(context.ema21)
  const vol20 = latest(context.volume20)
  const vol50 = latest(context.volume50)
  const vol120 = latest(context.volume120)
  const latestVolume = latest(volume)
  if (!Number.isFinite(lastClose) || sma20 === null || sma50 === null || ema21 === null || !lastClose) {
    return EMPTY_RESULT
  }

  const rsi = latest(context.rsi)
  const rsiMa = latest(context.rsiMa10)
  const rsiChange5 = changeOver(context.rsi, 5)
  const rsiMaChange10 = changeOver(context.rsiMa10, 10)
  const rsiChange30 = changeOver(context.rsi, 30)
  const macdLine = latest(context.macdLine)
  const macdSignal = latest(context.macdSignal)
  const macdHist = latest(context.macdHistogram)
  const macdHistChange5 = changeOver(context.macdHistogram, 5)
  const macdLineChange20 = changeOver(context.macdLine, 20)

  const prior20Close = latest(close, 20)
  const prior60Close = latest(close, 60)
  const decline20 = prior20Close ? (lastClose - prior20Close) / prior20Close : 0
  const decline60 = prior60Close ? (lastClose - prior60Close) / prior60Close : 0
  const negativeTrendEvidence = decline20 <= -0.015 || decline60 <= -0.03
  const recent20High = sliceMax(high, high.length - 20, high.length)
  const previous20High = high.length >= 40 ? sliceMax(high, high.length - 40, high.length - 20) : null
  const recent20Low = sliceMin(low, low.length - 20, low.length)
  const previous20Low = low.length >= 40 ? sliceMin(low, low.length - 40, low.length - 20) : null
  const lowerHighs = previous20High !== null && recent20High !== null && recent20High <= previous20High * 0.995
  const lowerLows = previous20Low !== null && recent20Low !== null && recent20Low <= previous20Low * 0.995
  const belowDailyMas = lastClose <= Math.min(sma20, ema21) * 1.01 && lastClose <= sma50 * 1.02
  let bearishStack = sma20 <= sma50 * 1.02 && (ema8 === null || ema8 <= ema21 * 1.01)
  if (sma200 !== null) bearishStack = bearishStack && sma50 <= sma200 * 1.03
  const distanceToSma20 = sma20 ? (lastClose - sma20) / sma20 : 0
  const distanceToSma50 = sma50 ? (lastClose - sma50) / sma50 : 0
  const controlledDecline = distanceToSma20 >= -0.18 && (rsi === null || rsi >= 24)

  const rsiBelowMa = rsi !== null && rsiMa !== null && rsi <= rsiMa
  const rsiBearish = rsi !== null && rsi >= 26 && rsi <= 52
  const rsiShortOk = rsiBelowMa && (rsiChange5 === null || rsiChange5 <= 2)
  const rsiIntermediateOk = rsi !== null && rsi <= 50 && (rsiMaChange10 === null || rsiMaChange10 <= 1)
  const rsiLongOk = rsi !== null && rsi <= 55 && (rsiChange30 === null || rsiChange30 <= 6)
  const rsiOk = rsiBelowMa && rsiBearish && (rsiShortOk || rsiIntermediateOk)

  const macdBelowSignal = macdLine !== null && macdSignal !== null && macdLine <= macdSignal
  const macdNegative = macdLine !== null && macdLine <= 0
  const macdWeakening = macdHist !== null && (macdHistChange5 === null || macdHistChange5 < 0)
  const macdShortOk = macdBelowSignal || macdWeakening
  const macdIntermediateOk = macdNegative || (macdHist !== null && macdHist < 0)
  const macdLongOk =
    macdLine !== null && (macdLine <= 0 || (macdLineChange20 !== null && macdLineChange20 < 0))
  const macdOk = macdShortOk && (macdIntermediateOk || macdLongOk)

  const recent = directionalVolume(bars, bars.length - 20)
  const latestOpen = latest(context.open)
  const latestDownBar = latestOpen !== null && lastClose < latestOpen
  const downsideVolume =
    (recent.down !== null && recent.down > 0 && recent.up !== null && recent.up > 0 && recent.down >= recent.up * 0.9) ||
    (latestDownBar &&
      latestVolume !== null &&
      latestVolume > 0 &&
      vol20 !== null &&
      vol20 > 0 &&
      latestVolume >= vol20 * 0.85)
  let volumeControlled: boolean | null = null
  if (latestVolume !== null && latestVolume > 0 && vol20 !== null && vol20 > 0) {
    volumeControlled = latestVolume <= vol20 * 3.2
  }
  const volumeShortAvailable = latestVolume !== null && latestVolume > 0 && vol20 !== null && vol20 > 0
  const volumeIntermediateAvailable = vol20 !== null && vol20 > 0 && vol50 !== null && vol50 > 0
  const volumeLongAvailable = vol50 !== null && vol50 > 0 && vol120 !== null && vol120 > 0
  const volumeShortNotAdverse = !volumeShortAvailable || (latestVolume as number) >= (vol20 as number) * 0.75
  const volumeIntermediateNotAdverse = !volumeIntermediateAvailable || (vol20 as number) >= (vol50 as number) * 0.75
  const volumeLongNotAdverse = !volumeLongAvailable || (vol50 as number) >= (vol120 as number) * 0.65

  const priceShortOk = lastClose <= sma20 * 1.01 || decline20 <= -0.02
  const priceIntermediateOk = lastClose <= sma50 * 1.02 || decline60 <= -0.04
  const priceLongOk = (sma200 !== null && lastClose <= sma200 * 1.03) || decline60 <= -0.06
  const shortTimeframeOk = (priceShortOk || rsiShortOk || macdShortOk) && volumeShortNotAdverse
  const intermediateTimeframeOk =
    (priceIntermediateOk || rsiIntermediateOk || macdIntermediateOk) && volumeIntermediateNotAdverse
  const longTimeframeOk = (priceLongOk || rsiLongOk || macdLongOk) && volumeLongNotAdverse
  const timeframeAgreementCount = countTrue(shortTimeframeOk, intermediateTimeframeOk, longTimeframeOk)
  const indicatorConfirmations = countTrue(
    rsiOk,
    macdOk,
    downsideVolume,
    timeframeAgreementCount >= 2,
    negativeTrendEvidence && (bearishStack || lowerHighs || lowerLows),
  )

  let score = 0
  const reasons: string[] = []
  if (belowDailyMas) {
    score += 18
    reasons.push('below daily MAs')
  }
  if (bearishStack) {
    score += 16
    reasons.push('bearish MA stack')
  }
  if (lowerHighs) {
    score += 12
    reasons.push('lower highs')
  }
  if (lowerLows) {
    score += 10
    reasons.push('lower lows')
  }
  if (decline20 <= -0.03 || decline60 <= -0.06) {
    score += 10
    reasons.push('negative price trend')
  }
  if (rsiBelowMa) {
    score += 8
    reasons.push('RSI below RSI MA')
  }
  if (rsiBearish) {
    score += 6
    reasons.push('RSI bearish')
  }
  if (macdBelowSignal) {
    score += 8
    reasons.push('MACD below signal')
  }
  if (macdNegative || macdWeakening) {
    score += 6
    reasons.push('MACD weakening')
  }
  if (downsideVolume) {
    score += 8
    reasons.push('downside volume')
  }
  if (volumeControlled === true) {
    score += 4
    reasons.push('volume controlled')
  }
  if (timeframeAgreementCount >= 2) {
    score += 10
    reasons.push('multi-timeframe downtrend')
  } else if (timeframeAgreementCount === 1) {
    score += 4
  }
  if (!controlledDecline) score -= 12
  if (latestVolume !== null && vol20 !== null && vol20 > 0 && latestVolume > vol20 * 3.2) score -= 8

  const snapshot: RollSnapshot = {
    close: snap(lastClose),
    setup_stage: 'Downtrend',
    decline_20d_pct: snap(decline20 * 100),
    decline_60d_pct: snap(decline60 * 100),
    negative_trend_evidence: negativeTrendEvidence,
    distance_to_sma20_pct: snap(distanceToSma20 * 100),
    distance_to_sma50_pct: snap(distanceToSma50 * 100),
    sma20: snap(sma20),
    sma50: snap(sma50),
    sma200: snap(sma200),
    ema8: snap(ema8),
    ema21: snap(ema21),
    daily_ma_stack: bearishStack ? 'bearish' : belowDailyMas ? 'below MAs' : 'mixed',
    lower_highs: lowerHighs,
    lower_lows: lowerLows,
    rsi14: snap(rsi),
    rsi_ma10: snap(rsiMa),
    rsi_state: rsiBelowMa ? 'below RSI MA' : 'above RSI MA',
    macd_line: snap(macdLine),
    macd_signal: snap(macdSignal),
    macd_histogram: snap(macdHist),
    macd_state: macdBelowSignal ? 'below signal' : macdWeakening ? 'weakening' : 'mixed',
    volume20: snap(vol20, 0),
    volume50: snap(vol50, 0),
    volume120: snap(vol120, 0),
    volume_state: downsideVolume
      ? 'downside participation'
      : volumeControlled === true
        ? 'controlled'
        : volumeControlled === false
          ? 'disorderly'
          : 'unavailable',
    short_timeframe_confirmed: shortTimeframeOk,
    intermediate_timeframe_confirmed: intermediateTimeframeOk,
    long_timeframe_confirmed: longTimeframeOk,
    timeframe_agreement: `${timeframeAgreementCount}/3`,
    near_eligible: negativeTrendEvidence,
  }
  const matched =
    negativeTrendEvidence &&
    belowDailyMas &&
    (bearishStack || lowerHighs || lowerLows) &&
    controlledDecline &&
    indicatorConfirmations >= 2 &&
    timeframeAgreementCount >= 2 &&
    score >= 58
  return { matched, score: clampScore(score), reasons: reasons.slice(0, 8), snapshot }
}

/** `_evaluate_consolidation_pattern`: a tight range with contracting volatility. */
export function evaluateConsolidation(bars: RollBar[]): RollPatternResult {
  if (bars.length < 70) return EMPTY_RESULT
  const context = rollPatternContext(bars)
  const { high, low, close } = context

  const lastClose = close[close.length - 1]
  const rangeHigh = sliceMax(high, high.length - 20, high.length)
  const rangeLow = sliceMin(low, low.length - 20, low.length)
  const atr20 = latest(context.atr20)
  const atr60 = latest(context.atr60)
  const vol20 = latest(context.volume20)
  const vol60 = latest(context.volume60)
  if (
    !Number.isFinite(lastClose) ||
    rangeHigh === null ||
    rangeLow === null ||
    atr20 === null ||
    atr60 === null ||
    !lastClose ||
    !atr60
  ) {
    return EMPTY_RESULT
  }

  const rangePct = lastClose ? (rangeHigh - rangeLow) / lastClose : 1
  const atrContracting = atr20 <= atr60 * 0.85
  const tightRange = rangePct <= 0.14
  const insideRange = lastClose >= rangeLow * 1.01 && lastClose <= rangeHigh * 0.99
  const recentCloses = close.slice(-20)
  let netDrift = 1
  let directionalEfficiency = 1
  if (recentCloses.length >= 10) {
    const firstClose = recentCloses[0]
    const lastRecentClose = recentCloses[recentCloses.length - 1]
    let pathLength = 0
    for (let index = 1; index < recentCloses.length; index += 1) {
      pathLength += Math.abs(recentCloses[index] - recentCloses[index - 1])
    }
    if (firstClose > 0) {
      const netChange = lastRecentClose - firstClose
      netDrift = Math.abs(netChange) / firstClose
      directionalEfficiency = pathLength > 0 ? Math.abs(netChange) / pathLength : 0
    }
  }
  const lowDirectionalDrift = netDrift <= 0.04 && directionalEfficiency <= 0.35
  let orderlyVolume: boolean | null = null
  if (vol20 !== null && vol20 > 0 && vol60 !== null && vol60 > 0) orderlyVolume = vol20 <= vol60 * 1.25
  const volumeDisorderly = orderlyVolume === false

  let score = 0
  const reasons: string[] = []
  if (tightRange) {
    score += 30
    reasons.push('tight 20D range')
  }
  if (atrContracting) {
    score += 25
    reasons.push('volatility contracted')
  }
  if (lowDirectionalDrift) {
    score += 25
    reasons.push('low directional drift')
  }
  if (insideRange) {
    score += 10
    reasons.push('inside range')
  }
  if (orderlyVolume === true) {
    score += 10
    reasons.push('orderly volume')
  }

  const snapshot: RollSnapshot = {
    close: snap(lastClose),
    setup_stage: 'Consolidation',
    range_20d_high: snap(rangeHigh),
    range_20d_low: snap(rangeLow),
    range_pct: snap(rangePct * 100),
    net_drift_pct: snap(netDrift * 100),
    directional_efficiency: snap(directionalEfficiency, 3),
    atr20: snap(atr20),
    atr60: snap(atr60),
    volume20: snap(vol20, 0),
    volume60: snap(vol60, 0),
    volume_state: orderlyVolume === true ? 'orderly' : volumeDisorderly ? 'disorderly' : 'unavailable',
    near_eligible: lowDirectionalDrift && !volumeDisorderly,
  }
  const matched = tightRange && atrContracting && insideRange && lowDirectionalDrift && !volumeDisorderly
  // The reference clamps this one at 100 without a floor: every term here is additive.
  return { matched, score: Math.min(100, score), reasons, snapshot }
}

/**
 * `_evaluate_double_bottom_pattern`.
 *
 * Every distinct trough pair inside the last 120 bars is tested and the best-scoring one
 * wins, with a strict match always beating an unmatched higher score — that is what the
 * reference's four-way `best_*` comparison encodes.
 */
export function evaluateDoubleBottom(bars: RollBar[]): RollPatternResult {
  if (bars.length < 90) return EMPTY_RESULT
  const context = rollPatternContext(bars)
  const { high, low, close, volume } = context

  const lastClose = close[close.length - 1]
  if (!Number.isFinite(lastClose) || lastClose <= 0) return EMPTY_RESULT

  const sma20 = latest(context.sma20)
  const sma50 = latest(context.sma50)
  const sma200 = latest(context.sma200)
  const ema21 = latest(context.ema21)
  const vol20 = latest(context.volume20)
  const vol50 = latest(context.volume50)
  const vol120 = latest(context.volume120)
  const latestVolume = latest(volume)

  const rsi = latest(context.rsi)
  const rsiMa = latest(context.rsiMa10)
  const rsiChange5 = changeOver(context.rsi, 5)
  const rsiChange20 = changeOver(context.rsi, 20)
  const macdLine = latest(context.macdLine)
  const macdSignal = latest(context.macdSignal)
  const macdHist = latest(context.macdHistogram)
  const macdHistChange5 = changeOver(context.macdHistogram, 5)
  const macdLineChange20 = changeOver(context.macdLine, 20)

  const lookbackStart = Math.max(0, low.length - 120)
  const swingLows = distinctTroughIndexes(
    context.swingLowIndexes.filter((index) => index >= lookbackStart),
    low,
  )
  const troughZoneCount = swingLows.length

  let bestScore = 0
  let bestReasons: string[] = []
  let bestSnapshot: RollSnapshot | null = null
  let bestMatched = false

  for (const firstIndex of swingLows) {
    for (const secondIndex of swingLows) {
      if (secondIndex <= firstIndex) continue
      const separation = secondIndex - firstIndex
      const daysSinceSecond = low.length - 1 - secondIndex
      if (separation < 15 || separation > 80 || daysSinceSecond < 3 || daysSinceSecond > 45) continue
      const firstBottom = low[firstIndex]
      const secondBottom = low[secondIndex]
      if (!(firstBottom > 0) || !(secondBottom > 0)) continue
      const averageBottom = (firstBottom + secondBottom) / 2
      const bottomGap = averageBottom ? Math.abs(firstBottom - secondBottom) / averageBottom : 1
      if (bottomGap > 0.05) continue
      const neckline = sliceMax(high, firstIndex, secondIndex + 1)
      if (neckline === null || neckline <= 0) continue
      const necklineHeight = averageBottom ? (neckline - averageBottom) / averageBottom : 0
      if (necklineHeight < 0.06) continue
      const postSecondLow = secondIndex + 1 < low.length ? sliceMin(low, secondIndex + 1, low.length) : null
      if (postSecondLow !== null && postSecondLow < Math.min(firstBottom, secondBottom) * 0.985) continue

      const priorHigh = firstIndex > 0 ? sliceMax(high, Math.max(0, firstIndex - 45), firstIndex) : null
      const firstClose = close[firstIndex]
      const priorClose = firstIndex >= 30 ? close[firstIndex - 30] : null
      let priorDecline: number | null = null
      let priorWeakness = false
      if (priorHigh !== null && priorHigh > 0) {
        priorDecline = (averageBottom - priorHigh) / priorHigh
        priorWeakness = priorDecline <= -0.08
      }
      if (!priorWeakness && priorClose !== null && priorClose > 0 && Number.isFinite(firstClose)) {
        priorDecline = (firstClose - priorClose) / priorClose
        priorWeakness = priorDecline <= -0.06
      }
      if (!priorWeakness) continue

      const distanceToNeckline = (lastClose - neckline) / neckline
      const reboundFromSecond = (lastClose - secondBottom) / secondBottom
      if (distanceToNeckline < -0.08 || distanceToNeckline > 0.06 || reboundFromSecond < 0.04) continue

      const recent = directionalVolume(bars, secondIndex)
      const latestOpen = latest(context.open)
      const latestUpBar = latestOpen !== null && lastClose >= latestOpen
      const constructiveVolume =
        (recent.up !== null && recent.down !== null && recent.down > 0 && recent.up >= recent.down * 0.9) ||
        (latestUpBar &&
          latestVolume !== null &&
          latestVolume > 0 &&
          vol20 !== null &&
          vol20 > 0 &&
          latestVolume >= vol20 * 0.85)
      let volumeControlled: boolean | null = null
      if (latestVolume !== null && latestVolume > 0 && vol20 !== null && vol20 > 0) {
        volumeControlled = latestVolume <= vol20 * 3
      }
      const volumeShortOk =
        latestVolume !== null && latestVolume > 0 && vol20 !== null && vol20 > 0 && latestVolume >= vol20 * 0.65
      const volumeIntermediateOk = vol20 !== null && vol20 > 0 && vol50 !== null && vol50 > 0 && vol20 >= vol50 * 0.7
      const volumeLongOk = vol50 !== null && vol50 > 0 && vol120 !== null && vol120 > 0 && vol50 >= vol120 * 0.6
      const volumeOk = constructiveVolume && volumeControlled !== false

      const rsiAboveMa = rsi !== null && rsiMa !== null && rsi >= rsiMa
      const rsiRecovering =
        rsi !== null &&
        rsi >= 38 &&
        rsi <= 70 &&
        (rsiAboveMa || (rsiChange5 !== null && rsiChange5 >= 0) || (rsiChange20 !== null && rsiChange20 >= 4))
      const rsiShortOk = rsiAboveMa || (rsiChange5 !== null && rsiChange5 >= -1)
      const rsiIntermediateOk = rsi !== null && rsi >= 42 && (rsiChange20 === null || rsiChange20 >= -2)
      const rsiLongOk = rsi !== null && rsi >= 38

      const macdAboveSignal = macdLine !== null && macdSignal !== null && macdLine >= macdSignal
      const macdTurningUp = macdHist !== null && (macdHistChange5 === null || macdHistChange5 > 0)
      const macdRecovering = macdLineChange20 !== null && macdLineChange20 > 0
      const macdOk =
        (macdAboveSignal || macdTurningUp) &&
        (macdRecovering || macdHist === null || macdHist > -Math.abs(lastClose) * 0.004)
      const macdShortOk = macdAboveSignal || macdTurningUp
      const macdIntermediateOk = macdRecovering || (macdHist !== null && macdHist >= 0)
      const macdLongOk =
        macdLine === null || macdLineChange20 === null || macdLineChange20 >= -Math.abs(lastClose) * 0.002

      const priceShortOk = reboundFromSecond >= 0.06 && distanceToNeckline >= -0.08
      const priceIntermediateOk = distanceToNeckline >= -0.06 || (sma20 !== null && lastClose >= sma20 * 0.97)
      const priceLongOk = sma50 === null || lastClose >= sma50 * 0.9 || distanceToNeckline >= -0.04
      const shortTimeframeOk = priceShortOk && (rsiShortOk || macdShortOk || volumeShortOk)
      const intermediateTimeframeOk =
        priceIntermediateOk && (rsiIntermediateOk || macdIntermediateOk || volumeIntermediateOk)
      const longTimeframeOk = priceLongOk && (rsiLongOk || macdLongOk || volumeLongOk)
      const timeframeAgreementCount = countTrue(shortTimeframeOk, intermediateTimeframeOk, longTimeframeOk)
      const indicatorConfirmations = countTrue(
        rsiRecovering,
        macdOk,
        volumeOk,
        timeframeAgreementCount >= 2,
      )

      const necklineBreakout = lastClose >= neckline * 1.002
      const setupStage = necklineBreakout ? 'Double Bottom Breakout' : 'Double Bottom Rebound'
      let score = 0
      const reasons: string[] = []
      if (bottomGap <= 0.03) {
        score += 18
        reasons.push('similar bottoms')
      } else {
        score += 12
        reasons.push('bottoms within 5%')
      }
      if (necklineHeight >= 0.1) {
        score += 18
        reasons.push('clear neckline')
      } else {
        score += 12
        reasons.push('meaningful neckline')
      }
      if (necklineBreakout) {
        score += 20
        reasons.push('neckline breakout')
      } else {
        score += 16
        reasons.push('rebounding toward neckline')
      }
      if (reboundFromSecond >= 0.08) {
        score += 8
        reasons.push('strong second-bottom rebound')
      } else {
        score += 4
        reasons.push('second-bottom rebound')
      }
      if (priorWeakness) {
        score += 10
        reasons.push('prior downtrend')
      }
      if (daysSinceSecond <= 25) {
        score += 8
        reasons.push('recent second bottom')
      } else {
        score += 4
      }
      if (rsiRecovering) {
        score += 10
        reasons.push('RSI recovering')
      } else if (rsi !== null && rsi >= 38) {
        score += 4
      }
      if (macdOk) {
        score += 10
        reasons.push('MACD improving')
      } else if (macdTurningUp) {
        score += 5
        reasons.push('MACD turning up')
      }
      if (constructiveVolume) {
        score += 8
        reasons.push('constructive volume')
      }
      if (volumeControlled === true) {
        score += 4
        reasons.push('volume controlled')
      }
      if (timeframeAgreementCount >= 2) {
        score += 10
        reasons.push('multi-timeframe confirmation')
      } else if (timeframeAgreementCount === 1) {
        score += 4
      }
      if (distanceToNeckline > 0.04) score -= 6
      if (latestVolume !== null && vol20 !== null && vol20 > 0 && latestVolume > vol20 * 3) score -= 8

      const snapshot: RollSnapshot = {
        close: snap(lastClose),
        setup_stage: setupStage,
        first_bottom: snap(firstBottom),
        second_bottom: snap(secondBottom),
        neckline: snap(neckline),
        bottom_gap_pct: snap(bottomGap * 100),
        neckline_height_pct: snap(necklineHeight * 100),
        distance_to_neckline_pct: snap(distanceToNeckline * 100),
        rebound_from_second_pct: snap(reboundFromSecond * 100),
        prior_decline_pct: priorDecline === null ? null : snap(priorDecline * 100),
        days_between_bottoms: separation,
        days_since_second_bottom: daysSinceSecond,
        trough_zone_count: troughZoneCount,
        sma20: snap(sma20),
        sma50: snap(sma50),
        sma200: snap(sma200),
        ema21: snap(ema21),
        rsi14: snap(rsi),
        rsi_ma10: snap(rsiMa),
        rsi_state: rsiRecovering ? 'recovering' : rsiAboveMa ? 'above RSI MA' : 'mixed',
        macd_line: snap(macdLine),
        macd_signal: snap(macdSignal),
        macd_histogram: snap(macdHist),
        macd_state: macdOk ? 'improving' : macdTurningUp ? 'turning up' : 'mixed',
        volume20: snap(vol20, 0),
        volume50: snap(vol50, 0),
        volume120: snap(vol120, 0),
        volume_state: constructiveVolume
          ? 'constructive'
          : volumeControlled === true
            ? 'controlled'
            : volumeControlled === false
              ? 'disorderly'
              : 'unavailable',
        short_timeframe_confirmed: shortTimeframeOk,
        intermediate_timeframe_confirmed: intermediateTimeframeOk,
        long_timeframe_confirmed: longTimeframeOk,
        timeframe_agreement: `${timeframeAgreementCount}/3`,
        near_eligible: troughZoneCount >= 2,
      }
      const matched = indicatorConfirmations >= 2 && timeframeAgreementCount >= 2 && score >= 62
      const boundedScore = clampScore(score)
      if (
        (matched && (!bestMatched || boundedScore > bestScore)) ||
        (!bestMatched && !matched && boundedScore > bestScore)
      ) {
        bestScore = boundedScore
        bestReasons = reasons.slice(0, 8)
        bestSnapshot = snapshot
        bestMatched = matched
      }
    }
  }

  if (!bestSnapshot) return EMPTY_RESULT
  return { matched: bestMatched, score: bestScore, reasons: bestReasons, snapshot: bestSnapshot }
}

/**
 * `_evaluate_bullish_flag_pattern`: a sharp pole, then an orderly drift that holds a third
 * of it, with price back at the flag's own resistance.
 */
export function evaluateBullishFlag(bars: RollBar[]): RollPatternResult {
  if (bars.length < 90) return EMPTY_RESULT
  const context = rollPatternContext(bars)
  const { high, low, close, volume } = context

  const lastClose = close[close.length - 1]
  if (!Number.isFinite(lastClose) || lastClose <= 0) return EMPTY_RESULT

  const sma20 = latest(context.sma20)
  const sma50 = latest(context.sma50)
  const sma200 = latest(context.sma200)
  const ema21 = latest(context.ema21)
  const vol20 = latest(context.volume20)
  const vol50 = latest(context.volume50)
  const vol120 = latest(context.volume120)
  const latestVolume = latest(volume)

  const rsi = latest(context.rsi)
  const rsiMa = latest(context.rsiMa10)
  const rsiChange5 = changeOver(context.rsi, 5)
  const rsiChange20 = changeOver(context.rsi, 20)
  const macdLine = latest(context.macdLine)
  const macdSignal = latest(context.macdSignal)
  const macdHist = latest(context.macdHistogram)
  const macdHistChange5 = changeOver(context.macdHistogram, 5)
  const macdLineChange20 = changeOver(context.macdLine, 20)

  let bestScore = 0
  let bestReasons: string[] = []
  let bestSnapshot: RollSnapshot | null = null
  let bestMatched = false

  for (
    let poleHighIndex = Math.max(35, high.length - 26);
    poleHighIndex < Math.max(35, high.length - 5);
    poleHighIndex += 1
  ) {
    const flagDays = high.length - 1 - poleHighIndex
    if (flagDays < 5 || flagDays > 25) continue
    const poleHigh = high[poleHighIndex]
    const localPeak = sliceMax(high, Math.max(0, poleHighIndex - 3), Math.min(high.length, poleHighIndex + 4))
    if (!Number.isFinite(poleHigh) || localPeak === null || poleHigh < localPeak * 0.997) continue
    const poleWindowStart = Math.max(0, poleHighIndex - 32)
    const poleWindowEnd = Math.max(poleWindowStart, poleHighIndex - 4)
    const poleLow = sliceMin(low, poleWindowStart, poleWindowEnd)
    if (poleLow === null || poleHigh <= 0 || poleLow <= 0) continue
    // `idxmin` returns the *first* minimum, which is what pandas does here.
    let poleLowIndex = -1
    for (let index = poleWindowStart; index < poleWindowEnd; index += 1) {
      if (low[index] === poleLow) {
        poleLowIndex = index
        break
      }
    }
    if (poleLowIndex < 0) continue
    const poleDays = poleHighIndex - poleLowIndex
    if (poleDays < 5 || poleDays > 32) continue
    const flagpoleGain = (poleHigh - poleLow) / poleLow
    if (flagpoleGain < 0.12) continue
    const recentImpulseIndex = Math.max(poleLowIndex, poleHighIndex - 15)
    const recentImpulseBase = close[recentImpulseIndex]
    const recentImpulseGain =
      Number.isFinite(recentImpulseBase) && recentImpulseBase > 0
        ? (poleHigh - recentImpulseBase) / recentImpulseBase
        : 0
    const poleDailyGain = flagpoleGain / Math.max(poleDays, 1)
    const impulseConfirmed = poleDailyGain >= 0.005 || recentImpulseGain >= 0.08
    if (!impulseConfirmed) continue

    const flagHighFrom = poleHighIndex + 1
    const flagHighTo = high.length - 1
    if (flagHighTo - flagHighFrom < 4 || low.length - flagHighFrom < 4) continue
    const flagResistance = sliceMax(high, flagHighFrom, flagHighTo)
    const flagLow = sliceMin(low, flagHighFrom, low.length)
    if (flagResistance === null || flagLow === null || flagResistance <= 0 || flagLow <= 0) continue
    const pullback = (poleHigh - flagLow) / poleHigh
    if (pullback < 0.03 || pullback > 0.18) continue
    if (flagLow < poleLow + (poleHigh - poleLow) * 0.35) continue
    if (flagResistance > poleHigh * 1.025) continue

    const distanceToFlagResistance = (lastClose - flagResistance) / flagResistance
    if (distanceToFlagResistance < -0.05 || distanceToFlagResistance > 0.04) continue
    const breakout = lastClose >= flagResistance * 1.002
    const flagVolAvg = sliceMean(volume, flagHighFrom, flagHighTo)
    const poleVolAvg = sliceMean(volume, poleLowIndex, poleHighIndex + 1)
    let orderlyVolume: boolean | null = null
    if (flagVolAvg !== null && flagVolAvg > 0 && poleVolAvg !== null && poleVolAvg > 0) {
      orderlyVolume = flagVolAvg <= poleVolAvg * 1.25
    }
    let volumeControlled: boolean | null = null
    if (latestVolume !== null && latestVolume > 0 && vol20 !== null && vol20 > 0) {
      volumeControlled = latestVolume <= vol20 * 2.7
    }
    const volumeShortOk =
      latestVolume !== null && latestVolume > 0 && vol20 !== null && vol20 > 0 && latestVolume >= vol20 * 0.6
    const volumeIntermediateOk = vol20 !== null && vol20 > 0 && vol50 !== null && vol50 > 0 && vol20 >= vol50 * 0.7
    const volumeLongOk = vol50 !== null && vol50 > 0 && vol120 !== null && vol120 > 0 && vol50 >= vol120 * 0.65
    const volumeOk = orderlyVolume === true && volumeControlled !== false

    const flagHighLength = flagHighTo - flagHighFrom
    const halfSpan = Math.max(2, Math.floor(flagHighLength / 2))
    const firstFlagHigh = sliceMax(high, flagHighFrom, flagHighFrom + halfSpan)
    const secondFlagHigh = sliceMax(high, Math.max(flagHighFrom, flagHighTo - halfSpan), flagHighTo)
    const controlledFlag =
      firstFlagHigh === null || secondFlagHigh === null || secondFlagHigh <= firstFlagHigh * 1.025
    const flagCloseLow = sliceMin(close, flagHighFrom, close.length)
    const stillSupported =
      flagCloseLow === null || sma50 === null || flagCloseLow >= sma50 * 0.94 || flagCloseLow >= poleHigh * 0.82

    let uptrendStack = sma20 !== null && sma50 !== null && sma20 >= sma50 * 0.98
    if (sma200 !== null && sma50 !== null) uptrendStack = uptrendStack && sma50 >= sma200 * 0.95
    const priceAboveSupport =
      (sma20 === null || lastClose >= sma20 * 0.96) &&
      (ema21 === null || lastClose >= ema21 * 0.96) &&
      (sma50 === null || lastClose >= sma50 * 0.94)

    const rsiAboveMa = rsi !== null && rsiMa !== null && rsi >= rsiMa
    const rsiConstructive =
      rsi !== null && rsi >= 44 && rsi <= 74 && (rsiAboveMa || rsiChange5 === null || rsiChange5 >= -2)
    const rsiShortOk = rsiConstructive || (rsiChange5 !== null && rsiChange5 >= -1.5)
    const rsiIntermediateOk = rsi !== null && rsi >= 45 && (rsiChange20 === null || rsiChange20 >= -5)
    const rsiLongOk = rsi !== null && rsi >= 42

    const macdAboveSignal = macdLine !== null && macdSignal !== null && macdLine >= macdSignal
    const macdTurningUp =
      macdHist !== null && (macdHistChange5 === null || macdHistChange5 >= -Math.abs(lastClose) * 0.001)
    const macdRecovering = macdLineChange20 !== null && macdLineChange20 >= -Math.abs(lastClose) * 0.001
    const macdOk = macdAboveSignal || (macdTurningUp && macdRecovering)
    const macdShortOk = macdAboveSignal || macdTurningUp
    const macdIntermediateOk = macdOk || (macdHist !== null && macdHist >= -Math.abs(lastClose) * 0.003)
    const macdLongOk = macdLine === null || macdLine >= -Math.abs(lastClose) * 0.02 || macdRecovering

    const priceShortOk = distanceToFlagResistance >= -0.05
    const priceIntermediateOk = priceAboveSupport && stillSupported
    const priceLongOk = uptrendStack || flagpoleGain >= 0.18
    const shortTimeframeOk = priceShortOk && (rsiShortOk || macdShortOk || volumeShortOk)
    const intermediateTimeframeOk =
      priceIntermediateOk && (rsiIntermediateOk || macdIntermediateOk || volumeIntermediateOk)
    const longTimeframeOk = priceLongOk && (rsiLongOk || macdLongOk || volumeLongOk)
    const timeframeAgreementCount = countTrue(shortTimeframeOk, intermediateTimeframeOk, longTimeframeOk)
    const indicatorConfirmations = countTrue(rsiConstructive, macdOk, volumeOk, timeframeAgreementCount >= 2)

    const setupStage = breakout ? 'Bullish Flag Breakout' : 'Bullish Flag Setup'
    let score = 0
    const reasons: string[] = []
    if (flagpoleGain >= 0.2) {
      score += 20
      reasons.push('strong flagpole')
    } else {
      score += 14
      reasons.push('bullish flagpole')
    }
    if (pullback >= 0.05 && pullback <= 0.14) {
      score += 18
      reasons.push('controlled pullback')
    } else {
      score += 10
      reasons.push('acceptable pullback')
    }
    if (controlledFlag && stillSupported) {
      score += 14
      reasons.push('orderly flag')
    } else if (controlledFlag || stillSupported) {
      score += 8
    }
    if (breakout) {
      score += 18
      reasons.push('flag breakout')
    } else {
      score += 14
      reasons.push('near flag resistance')
    }
    if (uptrendStack) {
      score += 10
      reasons.push('uptrend MA structure')
    }
    if (rsiConstructive) {
      score += 8
      reasons.push('RSI constructive')
    }
    if (macdOk) {
      score += 8
      reasons.push('MACD supportive')
    }
    if (orderlyVolume === true) {
      score += 6
      reasons.push('orderly volume')
    }
    if (volumeControlled === true) {
      score += 4
      reasons.push('volume controlled')
    }
    if (timeframeAgreementCount >= 2) {
      score += 10
      reasons.push('multi-timeframe confirmation')
    } else if (timeframeAgreementCount === 1) {
      score += 4
    }
    if (latestVolume !== null && vol20 !== null && vol20 > 0 && latestVolume > vol20 * 2.7) score -= 8
    if (rsi !== null && rsi > 76) score -= 8

    const snapshot: RollSnapshot = {
      close: snap(lastClose),
      setup_stage: setupStage,
      flagpole_gain_pct: snap(flagpoleGain * 100),
      pullback_pct: snap(pullback * 100),
      distance_to_flag_resistance_pct: snap(distanceToFlagResistance * 100),
      flag_resistance: snap(flagResistance),
      flag_days: flagDays,
      pole_days: poleDays,
      pole_daily_gain_pct: snap(poleDailyGain * 100, 3),
      recent_impulse_gain_pct: snap(recentImpulseGain * 100),
      impulse_confirmed: impulseConfirmed,
      sma20: snap(sma20),
      sma50: snap(sma50),
      sma200: snap(sma200),
      ema21: snap(ema21),
      rsi14: snap(rsi),
      rsi_ma10: snap(rsiMa),
      rsi_state: rsiConstructive ? 'constructive' : rsiAboveMa ? 'above RSI MA' : 'mixed',
      macd_line: snap(macdLine),
      macd_signal: snap(macdSignal),
      macd_histogram: snap(macdHist),
      macd_state: macdOk ? 'supportive' : macdTurningUp ? 'turning up' : 'mixed',
      volume20: snap(vol20, 0),
      volume50: snap(vol50, 0),
      volume120: snap(vol120, 0),
      volume_state:
        orderlyVolume === true
          ? 'orderly'
          : volumeControlled === true
            ? 'controlled'
            : orderlyVolume === false || volumeControlled === false
              ? 'disorderly'
              : 'unavailable',
      short_timeframe_confirmed: shortTimeframeOk,
      intermediate_timeframe_confirmed: intermediateTimeframeOk,
      long_timeframe_confirmed: longTimeframeOk,
      timeframe_agreement: `${timeframeAgreementCount}/3`,
      near_eligible: impulseConfirmed && controlledFlag && stillSupported,
    }
    const matched =
      priceShortOk &&
      priceIntermediateOk &&
      indicatorConfirmations >= 2 &&
      timeframeAgreementCount >= 2 &&
      score >= 62
    const boundedScore = clampScore(score)
    if (
      (matched && (!bestMatched || boundedScore > bestScore)) ||
      (!bestMatched && !matched && boundedScore > bestScore)
    ) {
      bestScore = boundedScore
      bestReasons = reasons.slice(0, 8)
      bestSnapshot = snapshot
      bestMatched = matched
    }
  }

  if (!bestSnapshot) return EMPTY_RESULT
  return { matched: bestMatched, score: bestScore, reasons: bestReasons, snapshot: bestSnapshot }
}

/**
 * `_evaluate_bullish_rsi_divergence_pattern`: a lower price low against a higher RSI low,
 * then the rebound and the trigger the reference checks before calling it a setup.
 */
export function evaluateBullishRsiDivergence(bars: RollBar[]): RollPatternResult {
  if (bars.length < 90) return EMPTY_RESULT
  const context = rollPatternContext(bars)
  const { high, low, close, volume } = context

  const lastClose = close[close.length - 1]
  if (!Number.isFinite(lastClose) || lastClose <= 0) return EMPTY_RESULT

  const sma20 = latest(context.sma20)
  const sma50 = latest(context.sma50)
  const sma200 = latest(context.sma200)
  const ema21 = latest(context.ema21)
  const vol20 = latest(context.volume20)
  const vol50 = latest(context.volume50)
  const vol120 = latest(context.volume120)
  const latestVolume = latest(volume)

  const rsi = latest(context.rsi)
  const rsiMa = latest(context.rsiMa10)
  const rsiChange5 = changeOver(context.rsi, 5)
  const macdLine = latest(context.macdLine)
  const macdSignal = latest(context.macdSignal)
  const macdHist = latest(context.macdHistogram)
  const macdHistChange5 = changeOver(context.macdHistogram, 5)
  const macdLineChange20 = changeOver(context.macdLine, 20)

  const lookbackStart = Math.max(0, low.length - 110)
  const swingLows = distinctTroughIndexes(
    context.swingLowIndexes.filter((index) => index >= lookbackStart),
    low,
  )
  const troughZoneCount = swingLows.length

  let bestScore = 0
  let bestReasons: string[] = []
  let bestSnapshot: RollSnapshot | null = null
  let bestMatched = false

  for (const firstIndex of swingLows) {
    for (const secondIndex of swingLows) {
      if (secondIndex <= firstIndex) continue
      const separation = secondIndex - firstIndex
      const daysSinceSecond = low.length - 1 - secondIndex
      if (separation < 10 || separation > 70 || daysSinceSecond < 3 || daysSinceSecond > 40) continue
      const firstLow = low[firstIndex]
      const secondLow = low[secondIndex]
      const firstRsi = context.rsi[firstIndex]
      const secondRsi = context.rsi[secondIndex]
      if (!firstLow || !secondLow || !Number.isFinite(firstRsi) || !Number.isFinite(secondRsi)) continue
      const priceLowChange = (secondLow - firstLow) / firstLow
      const rsiDivergencePoints = secondRsi - firstRsi
      if (priceLowChange > -0.005 || priceLowChange < -0.18 || rsiDivergencePoints < 4) continue
      const postSecondLow = secondIndex + 1 < low.length ? sliceMin(low, secondIndex + 1, low.length) : null
      if (postSecondLow !== null && postSecondLow < secondLow * 0.985) continue
      const reboundFromSecond = (lastClose - secondLow) / secondLow
      if (reboundFromSecond < 0.035) continue

      const triggerCandidates: number[] = []
      for (const value of [sma20, ema21]) {
        if (value !== null && value > 0) triggerCandidates.push(value)
      }
      const recentTrigger =
        secondIndex + 1 < high.length ? sliceMax(high, Math.max(secondIndex + 1, high.length - 12), high.length) : null
      if (recentTrigger !== null && recentTrigger > 0) triggerCandidates.push(recentTrigger)
      if (!triggerCandidates.length) continue
      let trigger = triggerCandidates[0]
      for (const candidate of triggerCandidates) {
        if (
          Math.abs((lastClose - candidate) / candidate) < Math.abs((lastClose - trigger) / trigger)
        ) {
          trigger = candidate
        }
      }
      const triggerDistance = (lastClose - trigger) / trigger
      if (triggerDistance < -0.045 || triggerDistance > 0.09) continue

      const recent = directionalVolume(bars, secondIndex)
      let volumeControlled: boolean | null = null
      if (latestVolume !== null && latestVolume > 0 && vol20 !== null && vol20 > 0) {
        volumeControlled = latestVolume <= vol20 * 3
      }
      const selloffDisorderly =
        latestVolume !== null &&
        vol20 !== null &&
        vol20 > 0 &&
        latestVolume > vol20 * 3 &&
        lastClose < close[close.length - 2]
      const constructiveVolume =
        recent.up !== null && recent.down !== null && recent.down > 0 && recent.up >= recent.down * 0.8
      const volumeShortOk = volumeControlled === true
      const volumeIntermediateOk = vol20 !== null && vol20 > 0 && vol50 !== null && vol50 > 0 && vol20 >= vol50 * 0.6
      const volumeLongOk = vol50 !== null && vol50 > 0 && vol120 !== null && vol120 > 0 && vol50 >= vol120 * 0.55

      const rsiAboveMa = rsi !== null && rsiMa !== null && rsi >= rsiMa
      const rsiTurning =
        rsi !== null && rsi >= 34 && rsi <= 68 && (rsiAboveMa || rsiChange5 === null || rsiChange5 >= 0)
      const macdAboveSignal = macdLine !== null && macdSignal !== null && macdLine >= macdSignal
      const macdTurningUp = macdHist !== null && (macdHistChange5 === null || macdHistChange5 > 0)
      const macdRecovering = macdLineChange20 !== null && macdLineChange20 > 0
      const macdOk = macdAboveSignal || macdTurningUp || macdRecovering

      const priceShortOk = reboundFromSecond >= 0.05 && triggerDistance >= -0.045
      const priceIntermediateOk = triggerDistance >= -0.03 || (sma20 !== null && lastClose >= sma20 * 0.97)
      const priceLongOk = sma50 === null || lastClose >= sma50 * 0.85 || triggerDistance >= 0
      const shortTimeframeOk = priceShortOk && (rsiTurning || macdTurningUp || volumeShortOk)
      const intermediateTimeframeOk = priceIntermediateOk && (rsiAboveMa || macdOk || volumeIntermediateOk)
      const longTimeframeOk = priceLongOk && (rsi === null || rsi >= 34 || macdRecovering || volumeLongOk)
      const timeframeAgreementCount = countTrue(shortTimeframeOk, intermediateTimeframeOk, longTimeframeOk)
      const indicatorConfirmations = countTrue(
        rsiTurning,
        macdOk,
        constructiveVolume,
        timeframeAgreementCount >= 2,
      )

      const triggerReclaimed = triggerDistance >= 0
      const setupStage = triggerReclaimed
        ? 'Bullish RSI Divergence Triggered'
        : 'Bullish RSI Divergence'
      let score = 0
      const reasons: string[] = []
      if (priceLowChange <= 0) {
        score += 18
        reasons.push('lower price low')
      } else {
        score += 12
        reasons.push('similar price low')
      }
      if (rsiDivergencePoints >= 7.5) {
        score += 20
        reasons.push('strong RSI divergence')
      } else {
        score += 14
        reasons.push('RSI higher low')
      }
      if (triggerReclaimed) {
        score += 18
        reasons.push('trigger reclaimed')
      } else {
        score += 12
        reasons.push('near trigger')
      }
      if (reboundFromSecond >= 0.07) {
        score += 10
        reasons.push('price rebound')
      } else {
        score += 5
      }
      if (daysSinceSecond <= 25) {
        score += 8
        reasons.push('fresh divergence')
      } else if (daysSinceSecond <= 35) {
        score += 6
        reasons.push('recent divergence')
      } else {
        score += 4
      }
      if (rsiTurning) {
        score += 10
        reasons.push('RSI turning up')
      }
      if (macdOk) {
        score += 8
        reasons.push('MACD improving')
      }
      if (constructiveVolume) {
        score += 6
        reasons.push('volume stabilizing')
      }
      if (volumeControlled === true) {
        score += 4
        reasons.push('volume controlled')
      }
      if (timeframeAgreementCount >= 2) {
        score += 10
        reasons.push('multi-timeframe confirmation')
      } else if (timeframeAgreementCount === 1) {
        score += 4
      }
      if (selloffDisorderly) score -= 14

      const snapshot: RollSnapshot = {
        close: snap(lastClose),
        setup_stage: setupStage,
        first_low: snap(firstLow),
        second_low: snap(secondLow),
        price_low_change_pct: snap(priceLowChange * 100),
        first_rsi: snap(firstRsi),
        second_rsi: snap(secondRsi),
        rsi_divergence_points: snap(rsiDivergencePoints),
        trigger: snap(trigger),
        trigger_distance_pct: snap(triggerDistance * 100),
        rebound_from_second_pct: snap(reboundFromSecond * 100),
        days_between_lows: separation,
        days_since_second_low: daysSinceSecond,
        trough_zone_count: troughZoneCount,
        sma20: snap(sma20),
        sma50: snap(sma50),
        sma200: snap(sma200),
        ema21: snap(ema21),
        rsi14: snap(rsi),
        rsi_ma10: snap(rsiMa),
        rsi_state: rsiTurning ? 'turning up' : rsiAboveMa ? 'above RSI MA' : 'mixed',
        macd_line: snap(macdLine),
        macd_signal: snap(macdSignal),
        macd_histogram: snap(macdHist),
        macd_state: macdOk ? 'improving' : 'mixed',
        volume20: snap(vol20, 0),
        volume50: snap(vol50, 0),
        volume120: snap(vol120, 0),
        volume_state: constructiveVolume
          ? 'stabilizing'
          : volumeControlled === true
            ? 'controlled'
            : volumeControlled === false
              ? 'disorderly'
              : 'unavailable',
        short_timeframe_confirmed: shortTimeframeOk,
        intermediate_timeframe_confirmed: intermediateTimeframeOk,
        long_timeframe_confirmed: longTimeframeOk,
        timeframe_agreement: `${timeframeAgreementCount}/3`,
        near_eligible: troughZoneCount >= 2 && priceLowChange <= -0.005,
      }
      const matched =
        !selloffDisorderly && indicatorConfirmations >= 2 && timeframeAgreementCount >= 2 && score >= 62
      const boundedScore = clampScore(score)
      if (
        (matched && (!bestMatched || boundedScore > bestScore)) ||
        (!bestMatched && !matched && boundedScore > bestScore)
      ) {
        bestScore = boundedScore
        bestReasons = reasons.slice(0, 8)
        bestSnapshot = snapshot
        bestMatched = matched
      }
    }
  }

  if (!bestSnapshot) return EMPTY_RESULT
  return { matched: bestMatched, score: bestScore, reasons: bestReasons, snapshot: bestSnapshot }
}

export const ROLL_EVALUATORS: Record<RollPatternMode, (bars: RollBar[]) => RollPatternResult> = {
  breakout: evaluateBreakout,
  consolidation: evaluateConsolidation,
  downtrend: evaluateDowntrend,
  double_bottom: evaluateDoubleBottom,
  bullish_flag: evaluateBullishFlag,
  bullish_rsi_divergence: evaluateBullishRsiDivergence,
}

/* ------------------------------------------------------------ pattern dispatch */

/** `_pattern_label`: the snapshot names its own stage, and a near match says so. */
export function rollPatternLabel(
  mode: RollPatternMode,
  snapshot: RollSnapshot,
  near = false,
): string {
  const defaults: Record<RollPatternMode, string> = {
    breakout: 'Breakout Setup',
    consolidation: 'Consolidation',
    downtrend: 'Downtrend',
    double_bottom: 'Double Bottom',
    bullish_flag: 'Bullish Flag',
    bullish_rsi_divergence: 'Bullish RSI Divergence',
  }
  const stage = typeof snapshot.setup_stage === 'string' ? snapshot.setup_stage.trim() : ''
  const label = stage || defaults[mode]
  return near ? `Near ${label}` : label
}

/**
 * `_near_pattern_result`. A shape that scored well but failed one gate is still worth
 * showing when nothing matched strictly; `near_eligible: false` is how an evaluator says
 * its structure was never there in the first place, so it must not be promoted.
 */
export function rollNearPatternResult(mode: RollPatternMode, result: RollPatternResult): boolean {
  if (result.matched || !Object.keys(result.snapshot).length) return false
  if (result.snapshot.near_eligible === false) return false
  const threshold = mode === 'breakout' ? 50 : 55
  if (result.score < threshold) return false
  if (
    mode === 'breakout' &&
    (result.snapshot.setup_stage === 'Late Breakout' || result.snapshot.setup_stage === 'No Breakout')
  ) {
    return false
  }
  return true
}

/**
 * `_primary_pattern_mode`.
 *
 * A structural shape within six points of the top score wins over a generic one, so a
 * clean flag is not reported as a "Breakout Setup" merely because breakout scored a point
 * higher; the explicit order then breaks ties deterministically.
 */
export function rollPrimaryPatternMode(
  modes: RollPatternMode[],
  results: Partial<Record<RollPatternMode, RollPatternResult>>,
): RollPatternMode | '' {
  const eligible = modes.filter((mode) => results[mode])
  if (!eligible.length) return ''
  const deterministicOrder: Record<RollPatternMode, number> = {
    bullish_flag: 6,
    double_bottom: 5,
    bullish_rsi_divergence: 4,
    breakout: 3,
    consolidation: 2,
    downtrend: 1,
  }
  const topScore = Math.max(...eligible.map((mode) => results[mode]?.score ?? 0))
  const structural: RollPatternMode[] = ['bullish_flag', 'double_bottom', 'bullish_rsi_divergence']
  const closeStructural = eligible.filter(
    (mode) => structural.includes(mode) && (results[mode]?.score ?? 0) >= topScore - 6,
  )
  const pool = closeStructural.length ? closeStructural : eligible
  return pool.reduce((best, mode) => {
    const bestScore = results[best]?.score ?? 0
    const score = results[mode]?.score ?? 0
    if (score > bestScore) return mode
    if (score < bestScore) return best
    return deterministicOrder[mode] > deterministicOrder[best] ? mode : best
  })
}

export interface RollPatternAnalysis {
  candidates: RollCandidate[]
  fallbackReason: string
  historySuccessCount: number
}

/**
 * `_apply_pattern_analysis`.
 *
 * Three tiers, in order: candidates that matched strictly, then the near misses, then the
 * whole scored pool with a reason saying why. Ranks are reassigned over the surviving
 * pool, which is what makes rank 1 mean "best match for what you asked for" rather than
 * "highest quote score".
 */
export function applyRollPatternAnalysis(
  candidates: RollCandidate[],
  modes: RollPatternMode[],
  histories: Map<string, RollBar[]>,
): RollPatternAnalysis {
  if (!modes.length || !candidates.length) {
    return { candidates, fallbackReason: '', historySuccessCount: 0 }
  }
  const sortedModes = [...modes].sort()
  let historySuccessCount = 0
  const analyzed: RollCandidate[] = candidates.map((candidate) => {
    const bars = histories.get(candidate.symbol) ?? []
    const availableModes = sortedModes.filter((mode) => bars.length >= ROLL_REQUIRED_ROWS[mode])
    if (availableModes.length) historySuccessCount += 1

    const results: Partial<Record<RollPatternMode, RollPatternResult>> = {}
    for (const mode of sortedModes) results[mode] = ROLL_EVALUATORS[mode](bars)

    const strictModes = sortedModes.filter((mode) => results[mode]?.matched)
    const nearModes = sortedModes.filter((mode) =>
      rollNearPatternResult(mode, results[mode] as RollPatternResult),
    )
    const tier: RollMatchTier = strictModes.length
      ? 'strict'
      : nearModes.length
        ? 'near'
        : availableModes.length
          ? 'fallback'
          : 'unavailable'
    const fallbackModes = availableModes.filter((mode) => {
      const result = results[mode]
      return result && Object.keys(result.snapshot).length > 0 && result.score > 0
    })
    const eligibleModes = strictModes.length ? strictModes : nearModes.length ? nearModes : fallbackModes
    const bestMode = rollPrimaryPatternMode(eligibleModes, results)

    let patternScore = 0
    let patternReasons: string[] = []
    let patternType = 'None'
    if (bestMode) {
      const best = results[bestMode] as RollPatternResult
      patternScore = best.score
      patternReasons = best.reasons
      patternType = rollPatternLabel(bestMode, best.snapshot, tier === 'near')
    }
    const snapshotModes = strictModes.length ? strictModes : nearModes.length ? nearModes : bestMode ? [bestMode] : []
    const technicalSnapshot: Partial<Record<RollPatternMode, RollSnapshot>> = {}
    for (const mode of snapshotModes) {
      const snapshot = results[mode]?.snapshot
      if (snapshot && Object.keys(snapshot).length) technicalSnapshot[mode] = snapshot
    }

    return {
      ...candidate,
      matchTier: tier,
      matchedModes: [...strictModes].sort(),
      primaryPatternMode: bestMode,
      patternMatch: tier === 'strict',
      patternType,
      patternScore: Math.round(patternScore * 10) / 10,
      patternReasons,
      technicalSnapshot,
    }
  })

  const strict = analyzed.filter((candidate) => candidate.matchTier === 'strict')
  const near = analyzed.filter((candidate) => candidate.matchTier === 'near')
  let pool: RollCandidate[]
  let fallbackReason: string
  if (strict.length) {
    pool = strict
    fallbackReason = ''
  } else if (near.length) {
    pool = near
    fallbackReason = 'No strict setup matched; loaded closest technical candidates.'
  } else {
    pool = analyzed
    fallbackReason =
      historySuccessCount <= 0
        ? 'Technical pattern history was unavailable; showing balanced scored candidates.'
        : 'No strong technical setup found; showing balanced scored candidates.'
  }
  const tierOrder: Record<RollMatchTier, number> = { strict: 0, near: 1, fallback: 2, unavailable: 3 }
  pool.sort(
    (left, right) =>
      tierOrder[left.matchTier] - tierOrder[right.matchTier] ||
      right.patternScore - left.patternScore ||
      right.score - left.score,
  )
  pool.forEach((candidate, index) => {
    candidate.rank = index + 1
    if (fallbackReason) candidate.patternFallbackReason = fallbackReason
  })
  return { candidates: pool, fallbackReason, historySuccessCount }
}

/* ------------------------------------------------------------- quote scoring */

/** `_quote_is_screenable`: enough of a quote to rank without a second request. */
export function rollQuoteIsScreenable(quote: RollQuote): boolean {
  const symbol = (quote.symbol ?? '').trim().toUpperCase()
  const quoteType = (quote.quoteType ?? '').trim().toUpperCase()
  const price = finiteOrNull(quote.regularMarketPrice ?? quote.regularMarketPreviousClose)
  const marketCap = finiteOrNull(quote.marketCap)
  const averageVolume = finiteOrNull(quote.averageDailyVolume3Month ?? quote.averageDailyVolume10Day)
  const name = quote.longName || quote.shortName || quote.displayName
  return Boolean(
    symbol &&
      (quoteType === 'EQUITY' || quoteType === '') &&
      name &&
      price !== null &&
      marketCap !== null &&
      averageVolume !== null,
  )
}

/**
 * `finiteOrNull`, guarding null before `Number()` the way the Valuation and Economic ports
 * do: `Number(null)` and `Number('')` are both 0, so an absent market cap would otherwise
 * score as a real zero-dollar company rather than being skipped.
 */
function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === 'N/A') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * `_score_quote`. Liquidity, size, both momentum windows, analyst coverage and quote
 * completeness, then a freshness adjustment: a name already in the portfolio or in the
 * roll history is pushed down so the page keeps surfacing something new.
 */
export function scoreRollQuote(
  symbol: string,
  quote: RollQuote,
  excludeSymbols: Set<string>,
  historySymbols: Set<string>,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  const marketCap = finiteOrNull(quote.marketCap)
  if (marketCap !== null) {
    if (marketCap >= 200e9) {
      score += 16
      reasons.push('mega cap')
    } else if (marketCap >= 10e9) {
      score += 14
      reasons.push('large cap')
    } else if (marketCap >= 2e9) {
      score += 11
      reasons.push('mid cap')
    } else {
      score += 8
    }
  }

  const averageVolume = finiteOrNull(quote.averageDailyVolume3Month ?? quote.averageDailyVolume10Day)
  if (averageVolume !== null) {
    if (averageVolume >= 10e6) {
      score += 18
      reasons.push('very liquid')
    } else if (averageVolume >= 3e6) {
      score += 15
      reasons.push('liquid')
    } else {
      score += 10
    }
  }

  const dayChange = finiteOrNull(quote.regularMarketChangePercent)
  if (dayChange !== null) {
    if (dayChange >= 3) {
      score += 9
      reasons.push('strong day move')
    } else if (dayChange > 0) {
      score += 7
      reasons.push('green today')
    } else if (dayChange > -2) {
      score += 4
    } else {
      score += 1
    }
  }

  const yearChange = finiteOrNull(quote.fiftyTwoWeekChangePercent)
  if (yearChange !== null) {
    if (yearChange >= 40) {
      score += 15
      reasons.push('strong 1Y momentum')
    } else if (yearChange >= 10) {
      score += 12
      reasons.push('positive 1Y trend')
    } else if (yearChange >= 0) {
      score += 8
    } else if (yearChange > -20) {
      score += 4
    }
  }

  const analystRating = (quote.averageAnalystRating ?? '').trim()
  if (analystRating) {
    score += 10
    reasons.push(analystRating.split(' - ').pop()?.toLowerCase() ?? analystRating.toLowerCase())
  } else if (present(quote.epsForward) || present(quote.forwardPE)) {
    score += 5
  }

  const metadataFields = [
    quote.longName,
    quote.shortName,
    quote.fullExchangeName,
    quote.currency,
    quote.trailingPE,
    quote.forwardPE,
    quote.fiftyTwoWeekHigh,
    quote.fiftyTwoWeekLow,
  ]
  const metadataCount = metadataFields.filter(present).length
  score += Math.min(14, metadataCount * 1.75)
  if (metadataCount >= 6) reasons.push('complete quote')

  if (excludeSymbols.has(symbol)) score -= 14
  else if (historySymbols.has(symbol)) score -= 7
  else {
    score += 8
    reasons.push('fresh idea')
  }

  return { score: clampScore(score), reasons: reasons.slice(0, 4) }
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '' && value !== 'N/A'
}

/** `_candidate_from_quote`. */
export function rollCandidateFromQuote(
  quote: RollQuote,
  excludeSymbols: Set<string>,
  historySymbols: Set<string>,
): RollCandidate | null {
  const symbol = (quote.symbol ?? '').trim().toUpperCase()
  if (!symbol) return null
  const { score, reasons } = scoreRollQuote(symbol, quote, excludeSymbols, historySymbols)
  return {
    rank: 0,
    symbol,
    name: quote.longName || quote.shortName || quote.displayName || symbol,
    sector: quote.sector || quote.sectorDisp || 'N/A',
    score: Math.round(score * 10) / 10,
    reasons,
    dayChangePct: finiteOrNull(quote.regularMarketChangePercent),
    fiftyTwoWeekChangePct: finiteOrNull(quote.fiftyTwoWeekChangePercent),
    averageVolume: finiteOrNull(quote.averageDailyVolume3Month ?? quote.averageDailyVolume10Day),
    marketCap: finiteOrNull(quote.marketCap),
    matchTier: 'fallback',
    matchedModes: [],
    primaryPatternMode: '',
    patternMatch: false,
    patternType: 'None',
    patternScore: 0,
    patternReasons: [],
    patternFallbackReason: '',
    technicalSnapshot: {},
  }
}

/**
 * `_select_candidate`.
 *
 * The roll is weighted, not uniform, and it is drawn from the top twelve only — a
 * ninetieth-ranked name never surfaces. With patterns on, the pattern score dominates and
 * the quote score is worth a quarter of itself, which is what stops a liquid megacap with
 * no setup from outdrawing the shape the user asked for.
 */
export function selectRollCandidate(
  candidates: RollCandidate[],
  options: {
    targetSymbol?: string
    excludeSymbols: Set<string>
    historySymbols: Set<string>
    patternActive: boolean
    /** Injected so the probe can roll deterministically. */
    random?: () => number
  },
): RollCandidate | null {
  if (!candidates.length) return null
  const random = options.random ?? Math.random
  if (options.targetSymbol) {
    const target = candidates.find((candidate) => candidate.symbol === options.targetSymbol)
    if (target) return target
  }
  const fresh = candidates.filter(
    (candidate) =>
      !options.excludeSymbols.has(candidate.symbol) && !options.historySymbols.has(candidate.symbol),
  )
  const pool = fresh.length
    ? fresh
    : candidates.filter((candidate) => !options.excludeSymbols.has(candidate.symbol))
  const choicePool = (pool.length ? pool : candidates).slice(0, ROLL_TOP_COUNT)
  if (choicePool.length <= 1) return choicePool[0] ?? null
  const weights = choicePool.map((candidate) =>
    options.patternActive
      ? Math.max(1, candidate.patternScore + candidate.score * 0.25)
      : Math.max(1, candidate.score),
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let ticket = random() * total
  for (let index = 0; index < choicePool.length; index += 1) {
    ticket -= weights[index]
    if (ticket <= 0) return choicePool[index]
  }
  return choicePool[choicePool.length - 1]
}

/** `_ROLL_TOP_COUNT`: how far down the ranked pool the weighted draw can reach. */
export const ROLL_TOP_COUNT = 12
/** `_CANDIDATE_LIMIT` and `_PATTERN_CANDIDATE_LIMIT`. */
export const ROLL_CANDIDATE_LIMIT = 30
export const ROLL_PATTERN_CANDIDATE_LIMIT = 120
/** `_MAX_OPTION_EXPIRIES`: the near-term expirations the options panel scans. */
export const ROLL_MAX_OPTION_EXPIRIES = 4
/** `P18_HISTORY_LIMIT`: how many past rolls the history panel keeps. */
export const ROLL_HISTORY_LIMIT = 20

/** The summary sentence under the header, built exactly as `fetch` builds it. */
export function rollScreeningSummary(
  candidateCount: number,
  universeTotal: number,
  modes: RollPatternMode[],
  targetSymbol: string,
): string {
  let summary = targetSymbol
    ? `Loaded exact-symbol research for ${targetSymbol}.`
    : `Sampled and scored ${candidateCount} candidates from a universe of ${universeTotal.toLocaleString('en-US')} yfinance-screened US equities with market cap above $1B and 3-month average volume above 1M.`
  if (modes.length) {
    const phrase = [...modes]
      .sort()
      .map((mode) => ROLL_MODE_PHRASES[mode])
      .join(' or ')
    summary = `${summary} Searched for ${phrase} setups using one-year daily history.`
  }
  return summary
}

/* ----------------------------------------------------------------- why panel */

/** The Why panel's ten rows, in `P18_WHY_METRICS` order. */
export const ROLL_WHY_METRICS: ReadonlyArray<{ label: string; key: string }> = [
  { label: 'Rank', key: 'rank' },
  { label: 'Score', key: 'score' },
  { label: 'Setup', key: 'setup' },
  { label: 'Pattern', key: 'pattern' },
  { label: 'Resistance', key: 'resistance' },
  { label: 'MA stack', key: 'ma_stack' },
  { label: 'RSI', key: 'rsi' },
  { label: 'MACD', key: 'macd' },
  { label: 'Volume', key: 'volume' },
  { label: 'Timeframes', key: 'timeframes' },
]

const NOT_AVAILABLE = 'N/A'

function num(value: RollSnapshotValue | number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(value: RollSnapshotValue | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function signedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function integerText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE
  return Math.trunc(value).toLocaleString('en-US')
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (character) => character.toUpperCase())
}

/** The snapshot the Why panel reads: the primary mode's, or the only one present. */
function primarySnapshot(payload: RollPayload): { mode: string; snapshot: RollSnapshot } | null {
  const snapshots = payload.technicalSnapshot ?? {}
  const primary = payload.primaryPatternMode
  if (primary && snapshots[primary]) return { mode: primary, snapshot: snapshots[primary] }
  for (const mode of ROLL_PATTERN_MODES) {
    if (snapshots[mode]) return { mode, snapshot: snapshots[mode] }
  }
  return null
}

/**
 * `_p18_update_why_metrics`.
 *
 * Each pattern reports through the same ten labels, which is why "Resistance" reads as a
 * neckline distance on a double bottom and a 20-day decline on a downtrend: the row is the
 * *most load-bearing number that pattern has*, not one fixed quantity. With no pattern at
 * all, the last branch falls back to the quote's own moves and reasons.
 */
export function rollWhyMetrics(payload: RollPayload): Record<string, string> {
  const scoreText = Number.isFinite(payload.candidateScore)
    ? `${payload.candidateScore.toFixed(1)}/100`
    : NOT_AVAILABLE
  const rankText = payload.candidateRank > 0 ? `#${payload.candidateRank}` : 'ranked'
  const patternType = payload.patternType.trim()
  const setupText = !patternType || patternType === 'None' ? 'Balanced' : patternType

  const values: Record<string, string> = {
    rank: rankText,
    score: scoreText,
    setup: setupText,
    pattern:
      setupText !== 'Balanced' && Number.isFinite(payload.patternScore)
        ? payload.patternScore.toFixed(1)
        : NOT_AVAILABLE,
    resistance: NOT_AVAILABLE,
    ma_stack: NOT_AVAILABLE,
    rsi: NOT_AVAILABLE,
    macd: NOT_AVAILABLE,
    volume: integerText(payload.info.averageVolume),
    timeframes: NOT_AVAILABLE,
  }

  /** The four rows every confirmation-style pattern fills identically. */
  const applyCommon = (snapshot: RollSnapshot) => {
    const rsi = num(snapshot.rsi14)
    const rsiState = text(snapshot.rsi_state).replace('RSI ', '')
    if (rsi !== null) values.rsi = `${rsi.toFixed(1)}${rsiState ? ` ${rsiState}` : ''}`
    const macdState = text(snapshot.macd_state)
    if (macdState) values.macd = titleCase(macdState)
    const volumeState = text(snapshot.volume_state)
    if (volumeState) values.volume = titleCase(volumeState)
    const timeframes = text(snapshot.timeframe_agreement)
    if (timeframes) values.timeframes = timeframes
  }

  const primary = primarySnapshot(payload)
  if (primary?.mode === 'breakout') {
    const snapshot = primary.snapshot
    const distance = num(snapshot.distance_to_resistance_pct)
    if (distance !== null) values.resistance = signedPercent(distance)
    const maStack = text(snapshot.daily_ma_stack)
    if (maStack) values.ma_stack = titleCase(maStack)
    applyCommon(snapshot)
  } else if (primary?.mode === 'consolidation') {
    const snapshot = primary.snapshot
    const rangePct = num(snapshot.range_pct)
    const atr20 = num(snapshot.atr20)
    const atr60 = num(snapshot.atr60)
    const volume20 = num(snapshot.volume20)
    const volume60 = num(snapshot.volume60)
    if (rangePct !== null) values.resistance = `Range ${rangePct.toFixed(2)}%`
    if (atr20 !== null && atr60) values.ma_stack = `ATR ${(atr20 / atr60).toFixed(2)}x`
    if (volume20 !== null && volume60) values.volume = `Vol ${(volume20 / volume60).toFixed(2)}x`
    values.rsi = 'Volatility contracted'
    values.macd = 'Inside range'
    values.timeframes = '20D / 60D'
  } else if (primary?.mode === 'double_bottom') {
    const snapshot = primary.snapshot
    const distance = num(snapshot.distance_to_neckline_pct)
    const bottomGap = num(snapshot.bottom_gap_pct)
    const rebound = num(snapshot.rebound_from_second_pct)
    if (distance !== null) values.resistance = `Neckline ${signedPercent(distance)}`
    if (bottomGap !== null) values.ma_stack = `Gap ${bottomGap.toFixed(2)}%`
    else if (rebound !== null) values.ma_stack = `Rebound ${rebound.toFixed(2)}%`
    applyCommon(snapshot)
  } else if (primary?.mode === 'bullish_flag') {
    const snapshot = primary.snapshot
    const distance = num(snapshot.distance_to_flag_resistance_pct)
    const pullback = num(snapshot.pullback_pct)
    const flagDays = num(snapshot.flag_days)
    if (distance !== null) values.resistance = `Flag ${signedPercent(distance)}`
    if (pullback !== null) values.ma_stack = `Pullback ${pullback.toFixed(2)}%`
    else if (flagDays !== null) values.ma_stack = `${Math.trunc(flagDays)}D flag`
    applyCommon(snapshot)
  } else if (primary?.mode === 'bullish_rsi_divergence') {
    const snapshot = primary.snapshot
    const triggerDistance = num(snapshot.trigger_distance_pct)
    const rsiPoints = num(snapshot.rsi_divergence_points)
    const priceChange = num(snapshot.price_low_change_pct)
    if (triggerDistance !== null) values.resistance = `Trigger ${signedPercent(triggerDistance)}`
    if (rsiPoints !== null) values.ma_stack = `RSI +${rsiPoints.toFixed(1)}`
    else if (priceChange !== null) values.ma_stack = `Low ${signedPercent(priceChange)}`
    const firstRsi = num(snapshot.first_rsi)
    const secondRsi = num(snapshot.second_rsi)
    if (firstRsi !== null && secondRsi !== null) {
      values.rsi = `${firstRsi.toFixed(1)} -> ${secondRsi.toFixed(1)}`
    }
    const macdState = text(snapshot.macd_state)
    if (macdState) values.macd = titleCase(macdState)
    const volumeState = text(snapshot.volume_state)
    if (volumeState) values.volume = titleCase(volumeState)
    const timeframes = text(snapshot.timeframe_agreement)
    if (timeframes) values.timeframes = timeframes
  } else if (primary?.mode === 'downtrend') {
    const snapshot = primary.snapshot
    const decline20 = num(snapshot.decline_20d_pct)
    const distanceSma50 = num(snapshot.distance_to_sma50_pct)
    if (decline20 !== null) values.resistance = `20D ${signedPercent(decline20)}`
    else if (distanceSma50 !== null) values.resistance = `SMA50 ${signedPercent(distanceSma50)}`
    const maStack = text(snapshot.daily_ma_stack)
    if (maStack) values.ma_stack = titleCase(maStack)
    applyCommon(snapshot)
  } else {
    const selected = payload.candidatePool.find((candidate) => candidate.symbol === payload.symbol)
    const reasons = payload.candidateReasons.filter(Boolean)
    values.resistance = signedPercent(selected?.dayChangePct ?? null)
    values.ma_stack = signedPercent(selected?.fiftyTwoWeekChangePct ?? null)
    values.rsi = reasons[0] ?? NOT_AVAILABLE
    values.macd = reasons[1] ?? NOT_AVAILABLE
    values.timeframes = reasons[2] ?? NOT_AVAILABLE
  }

  return values
}

/**
 * `_p18_technical_snapshot_text`: at most three clauses describing the primary setup, in
 * each pattern's own vocabulary. Appended to the Why summary sentence.
 */
export function rollTechnicalSnapshotText(payload: RollPayload): string {
  const primary = primarySnapshot(payload)
  if (!primary) return ''
  const snapshot = primary.snapshot
  const parts: string[] = []

  /** The trailing "volume, N/3 timeframes" clause five of the six patterns share. */
  const pushVolumeAndTimeframes = (volumeSuffix = '') => {
    const volumeState = text(snapshot.volume_state)
    const timeframes = text(snapshot.timeframe_agreement)
    const volumeText = volumeState ? `${volumeState}${volumeSuffix}` : ''
    if (volumeText && timeframes) parts.push(`${volumeText}, ${timeframes} timeframes`)
    else if (volumeText) parts.push(volumeText)
    else if (timeframes) parts.push(`${timeframes} timeframes`)
  }
  const pushRsiAndMacd = () => {
    const rsi = num(snapshot.rsi14)
    const rsiState = text(snapshot.rsi_state)
    if (rsi !== null && rsiState) parts.push(`RSI ${rsi.toFixed(1)} ${rsiState}`)
    const macdState = text(snapshot.macd_state)
    if (macdState) parts.push(`MACD ${macdState}`)
  }

  if (primary.mode === 'bullish_flag') {
    const distance = num(snapshot.distance_to_flag_resistance_pct)
    const flagpoleGain = num(snapshot.flagpole_gain_pct)
    const pullback = num(snapshot.pullback_pct)
    if (distance !== null) parts.push(`${signedPercent(distance)} vs flag resistance`)
    if (flagpoleGain !== null && pullback !== null) {
      parts.push(`${flagpoleGain.toFixed(1)}% pole, ${pullback.toFixed(1)}% pullback`)
    }
    pushRsiAndMacd()
    pushVolumeAndTimeframes()
  } else if (primary.mode === 'bullish_rsi_divergence') {
    const triggerDistance = num(snapshot.trigger_distance_pct)
    const priceChange = num(snapshot.price_low_change_pct)
    const rsiPoints = num(snapshot.rsi_divergence_points)
    const rebound = num(snapshot.rebound_from_second_pct)
    if (triggerDistance !== null) parts.push(`${signedPercent(triggerDistance)} vs trigger`)
    if (priceChange !== null && rsiPoints !== null) {
      parts.push(`${signedPercent(priceChange)} low, +${rsiPoints.toFixed(1)} RSI`)
    }
    if (rebound !== null) parts.push(`${rebound.toFixed(2)}% rebound`)
    const macdState = text(snapshot.macd_state)
    if (macdState) parts.push(`MACD ${macdState}`)
    pushVolumeAndTimeframes()
  } else if (primary.mode === 'double_bottom') {
    const distance = num(snapshot.distance_to_neckline_pct)
    const bottomGap = num(snapshot.bottom_gap_pct)
    const rebound = num(snapshot.rebound_from_second_pct)
    if (distance !== null) parts.push(`${signedPercent(distance)} vs neckline`)
    if (bottomGap !== null) parts.push(`${bottomGap.toFixed(2)}% bottom gap`)
    else if (rebound !== null) parts.push(`${rebound.toFixed(2)}% rebound`)
    pushRsiAndMacd()
    pushVolumeAndTimeframes()
  } else if (primary.mode === 'consolidation') {
    const rangePct = num(snapshot.range_pct)
    const atr20 = num(snapshot.atr20)
    const atr60 = num(snapshot.atr60)
    const volume20 = num(snapshot.volume20)
    const volume60 = num(snapshot.volume60)
    if (rangePct !== null) parts.push(`${rangePct.toFixed(2)}% 20D range`)
    if (atr20 !== null && atr60 !== null && atr60 > 0) parts.push(`ATR ${(atr20 / atr60).toFixed(2)}x 60D`)
    if (volume20 !== null && volume60 !== null && volume60 > 0) {
      parts.push(`volume ${(volume20 / volume60).toFixed(2)}x 60D`)
    }
  } else if (primary.mode === 'downtrend') {
    const decline20 = num(snapshot.decline_20d_pct)
    const distanceSma50 = num(snapshot.distance_to_sma50_pct)
    if (decline20 !== null) parts.push(`${signedPercent(decline20)} over 20D`)
    else if (distanceSma50 !== null) parts.push(`${signedPercent(distanceSma50)} vs SMA50`)
    pushRsiAndMacd()
    pushVolumeAndTimeframes()
  } else {
    const distance = num(snapshot.distance_to_resistance_pct)
    if (distance !== null) parts.push(`${signedPercent(distance)} vs resistance`)
    pushRsiAndMacd()
    // Breakout is the one that says "volume" out loud, because its state words
    // ("accumulation", "controlled") do not read as volume on their own.
    pushVolumeAndTimeframes(' volume')
  }
  return parts.slice(0, 3).join('; ')
}

/**
 * `_p18_update_why_panel`'s summary sentence and its six badges.
 *
 * The badge row ends with the pattern when there is one, and otherwise falls back to the
 * top quote reason, and then to a P/E band — so the sixth badge always says *something*
 * about why this name and not another.
 */
export function rollWhySummary(payload: RollPayload): { summary: string; badges: string[] } {
  const scoreText = Number.isFinite(payload.candidateScore)
    ? `${payload.candidateScore.toFixed(1)}/100`
    : NOT_AVAILABLE
  const rankText = payload.candidateRank > 0 ? `#${payload.candidateRank}` : 'ranked'
  const reasons = payload.candidateReasons.filter(Boolean)
  const patternType = payload.patternType.trim()
  const patternReasons = payload.patternReasons.filter(Boolean)

  let reasonText = reasons.length
    ? reasons.slice(0, 3).join(', ')
    : 'balanced liquidity, momentum, and metadata quality'
  if (patternType && patternType !== 'None') {
    const patternScoreText = Number.isFinite(payload.patternScore)
      ? `${payload.patternScore.toFixed(1)}/100`
      : NOT_AVAILABLE
    reasonText = `${patternType} setup ${patternScoreText}: ${
      patternReasons.length ? patternReasons.slice(0, 3).join(', ') : 'technical setup scored'
    }`
    const technicalText = rollTechnicalSnapshotText(payload)
    if (technicalText) reasonText = `${reasonText}; ${technicalText}`
  } else if (payload.patternModes.length) {
    reasonText =
      payload.patternFallbackReason ||
      (payload.matchTier === 'unavailable'
        ? 'pattern history unavailable; showing balanced scored candidates'
        : 'no strong technical setup found; showing balanced scored candidates')
  }

  const totalText = payload.universeTotal > 0 ? payload.universeTotal.toLocaleString('en-US') : 'liquid'
  const summary = payload.screeningSummary
    ? `${payload.screeningSummary} Selected ${rankText} with a ${scoreText} score: ${reasonText}.`
    : `Picked ${rankText} with a ${scoreText} score from ${totalText} yfinance-screened US equities: ${reasonText}.`

  const badges = [
    `Score ${scoreText}`,
    `${rollMarketCapTier(payload.info.marketCap)} cap`,
    `Vol ${integerText(payload.info.averageVolume)}`,
    payload.info.sector || 'Sector N/A',
    payload.info.exchange || 'Exchange N/A',
    patternType && patternType !== 'None'
      ? patternType
      : (reasons[0] ?? rollValuationBadge(payload.info.trailingPe)),
  ]
  return { summary, badges }
}

/** `_p18_market_cap_tier`. */
export function rollMarketCapTier(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unknown'
  if (value >= 200e9) return 'Mega'
  if (value >= 10e9) return 'Large'
  if (value >= 2e9) return 'Mid'
  return 'Small'
}

/** `_p18_valuation_badge`. */
export function rollValuationBadge(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return 'P/E N/A'
  if (value < 15) return 'Lower P/E'
  if (value <= 30) return 'Mid P/E'
  return 'High P/E'
}

/**
 * `_p18_result_status`: the sentence the status line shows once a roll lands. A fallback
 * reason, a warning or a near-tier match all downgrade it to a warning tone, which is what
 * keeps "loaded something, but not what you asked for" from reading as success.
 */
export function rollResultStatus(payload: RollPayload): {
  text: string
  tone: 'positive' | 'warning'
} {
  const scoreText = Number.isFinite(payload.candidateScore)
    ? ` score ${payload.candidateScore.toFixed(1)}`
    : ''
  const poolCount = payload.candidatePool.length
  const suffix = poolCount ? ` from ${poolCount} scored candidates` : ''
  const patternType = payload.patternType.trim()
  const patternText = patternType && patternType !== 'None' ? ` (${patternType} setup)` : ''
  const fallbackReason = payload.patternFallbackReason.trim()
  const warningText = payload.warnings.find((warning) => warning.trim()) ?? ''
  const tierWarning = payload.matchTier === 'near' ? 'Near technical match.' : ''
  if (fallbackReason || warningText || tierWarning) {
    const prefix = fallbackReason || warningText || tierWarning
    return {
      text: `${prefix} Loaded ${payload.symbol}${scoreText}${suffix}.`,
      tone: 'warning',
    }
  }
  return {
    text: `Loaded ${payload.symbol}${scoreText}${patternText}${suffix}.`,
    tone: 'positive',
  }
}

/** `_p18_pattern_reason_text` / `_p18_candidate_reason_text`: the Reason column. */
export function rollCandidateReasonText(candidate: RollCandidate, patternActive: boolean): string {
  const quoteReasons = candidate.reasons.filter(Boolean)
  if (!patternActive) return quoteReasons.join(', ') || 'scored candidate'
  const parts: string[] = []
  const patternReasons = candidate.patternReasons.filter(Boolean)
  if (patternReasons.length) parts.push(patternReasons.join(', '))
  if (candidate.patternFallbackReason.trim()) parts.push(candidate.patternFallbackReason.trim())
  if (parts.length) return parts.join(' — ')
  return quoteReasons.join(', ') || 'scored candidate'
}
