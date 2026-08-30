import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RollCandidate } from '../electron/shared/contract.js'
import {
  applyRollPatternAnalysis,
  evaluateBreakout,
  evaluateBullishFlag,
  evaluateBullishRsiDivergence,
  evaluateConsolidation,
  evaluateDoubleBottom,
  evaluateDowntrend,
  rollCandidateFromQuote,
  rollMacd,
  rollPatternContext,
  rollPrimaryPatternMode,
  rollRsi,
  rollScreeningSummary,
  scoreRollQuote,
  selectRollCandidate,
  type RollBar,
  type RollPatternMode,
} from '../electron/shared/roll.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** A deterministic pseudo-random draw, so the weighted-roll checks repeat exactly. */
function walk(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

function bar(index: number, close: number, spread: number, volume: number): RollBar {
  const date = new Date(Date.UTC(2025, 0, 1) + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return {
    date,
    open: close * (1 - spread / 4),
    high: close * (1 + spread),
    low: close * (1 - spread),
    close,
    volume,
  }
}

/**
 * A coiling series: a +/-5% oscillation that tightens to +/-1.6% over the final twenty
 * sessions. That is what a consolidation actually is — the range has to stay wide enough
 * for the close to sit *inside* it (the 1%/99% band the reference tests), while ATR over
 * twenty bars falls below 85% of ATR over sixty. A uniformly quiet series fails: its
 * ATR never contracts, and its range is too narrow for anything to be inside.
 */
function coilSeries(length: number): RollBar[] {
  return Array.from({ length }, (_value, index) => {
    const amplitude = length - 1 - index < 20 ? 0.016 : 0.05
    const close = 100 * (1 + amplitude * Math.sin((2 * Math.PI * index) / 20))
    return bar(index, close, amplitude * 0.15, 900_000)
  })
}

/**
 * A controlled decline: a steady downward drift with a 2% wobble on it.
 *
 * The wobble is load-bearing. A *monotonic* decline drives RSI to 0, and the reference
 * refuses that as uncontrolled — `controlled_decline` needs RSI at or above 24 and
 * `rsi_bearish` wants 26-52. A downtrend the page will show you is an orderly one.
 */
function downSeries(length: number): RollBar[] {
  const closes = Array.from(
    { length },
    (_value, index) => 200 * (1 - index / (length * 2.5)) * (1 + 0.02 * Math.sin((2 * Math.PI * index) / 9)),
  )
  return closes.map((close, index) => ({
    ...bar(index, close, 0.012, 1_200_000),
    open: index ? closes[index - 1] : close * 1.004,
  }))
}

function offlineChecks(): void {
  /* --------------------------------------------------------------- indicators */

  // A monotonically rising close can only be gains, so Wilder RSI pins at 100 and the
  // warm-up window is the literal 50 that `_calculate_rsi`'s `fillna` leaves behind.
  const rising = Array.from({ length: 40 }, (_value, index) => 100 + index)
  const risingRsi = rollRsi(rising)
  assert(risingRsi.slice(0, 14).every((value) => value === 50), 'RSI warm-up must be 50, not null')
  assert(Math.abs(risingRsi[risingRsi.length - 1] - 100) < 1e-9, 'an all-gains series must pin RSI at 100')
  const falling = rising.map((value) => 200 - value)
  assert(Math.abs(rollRsi(falling)[39]) < 1e-9, 'an all-losses series must pin RSI at 0')
  const flatRsi = rollRsi(new Array(40).fill(100))
  assert(flatRsi.every((value) => value === 50), 'a flat series has neither gains nor losses, so RSI is 50')

  const macd = rollMacd(rising)
  assert(macd.line.slice(0, 25).every((value) => value === null), 'the MACD line needs 26 closes')
  assert(macd.line[25] !== null, 'the MACD line must start at the 26th close')
  assert(macd.signal.slice(0, 33).every((value) => value === null), 'the signal needs 9 MACD values')
  assert(macd.signal[33] !== null, 'the signal must start at the 34th close')
  assert((macd.line[39] ?? 0) > 0, 'a rising series must leave the MACD line above zero')

  const context = rollPatternContext(coilSeries(220))
  assert(context.sma20[18] === null && context.sma20[19] !== null, 'SMA20 must respect min_periods=20')
  assert(context.sma200[178] === null && context.sma200[179] !== null, 'SMA200 uses min_periods=180')
  assert(context.rsiMa10[3] === null && context.rsiMa10[4] !== null, 'the RSI MA uses min_periods=5')

  /* ---------------------------------------------------------------- evaluators */

  // Every evaluator refuses a history shorter than its `required_rows` entry.
  assert(!evaluateBreakout(coilSeries(69)).snapshot.close, 'breakout needs 70 bars')
  assert(!evaluateDowntrend(coilSeries(69)).snapshot.close, 'downtrend needs 70 bars')
  assert(!evaluateConsolidation(coilSeries(69)).snapshot.close, 'consolidation needs 70 bars')
  for (const evaluate of [evaluateDoubleBottom, evaluateBullishFlag, evaluateBullishRsiDivergence]) {
    const short = evaluate(coilSeries(89))
    assert(!short.matched && short.score === 0, 'the three structural patterns need 90 bars')
  }

  const consolidation = evaluateConsolidation(coilSeries(220))
  assert(consolidation.matched, 'a coiling series must match consolidation')
  assert(
    consolidation.reasons.includes('tight 20D range') &&
      consolidation.reasons.includes('low directional drift'),
    'the consolidation reasons must name the range and the drift',
  )
  assert(
    consolidation.snapshot.setup_stage === 'Consolidation' &&
      typeof consolidation.snapshot.range_pct === 'number' &&
      (consolidation.snapshot.range_pct as number) < 14,
    'the consolidation snapshot must carry a sub-14% range',
  )

  const downtrend = evaluateDowntrend(downSeries(220))
  assert(downtrend.snapshot.setup_stage === 'Downtrend', 'the downtrend snapshot must name its stage')
  assert(
    (downtrend.snapshot.decline_20d_pct as number) < 0 && downtrend.snapshot.lower_lows === true,
    'a steady decline must report a negative 20D move and lower lows',
  )
  assert(downtrend.snapshot.timeframe_agreement === '3/3', 'a clean decline should confirm on all three timeframes')

  // The coiling series is *not* a downtrend, and the falling one is not a consolidation:
  // the evaluators have to disagree, or the OR-matching filter is meaningless.
  assert(!evaluateDowntrend(coilSeries(220)).matched, 'a coiling series must not match downtrend')
  assert(!evaluateConsolidation(downSeries(220)).matched, 'a steady decline must not match consolidation')

  // A breakout needs price at 55-day resistance; the coil ends mid-range, and the
  // `setup_stage` says which side of the gate it failed on.
  const breakout = evaluateBreakout(coilSeries(220))
  assert(!breakout.matched, 'a coiling series is not a breakout')
  assert(
    typeof breakout.snapshot.setup_stage === 'string' &&
      ['Pre-Breakout', 'Fresh Breakout', 'Late Breakout', 'No Breakout'].includes(
        breakout.snapshot.setup_stage as string,
      ),
    'the breakout snapshot must always name a stage',
  )

  /* ------------------------------------------------------------ primary mode */

  // A structural shape within six points of the top score wins over a generic one.
  const results = {
    breakout: { matched: true, score: 70, reasons: [], snapshot: { setup_stage: 'Pre-Breakout' } },
    bullish_flag: { matched: true, score: 66, reasons: [], snapshot: { setup_stage: 'Bullish Flag Setup' } },
  }
  assert(
    rollPrimaryPatternMode(['breakout', 'bullish_flag'], results) === 'bullish_flag',
    'a close structural shape must outrank a higher-scoring generic one',
  )
  results.bullish_flag.score = 60
  assert(
    rollPrimaryPatternMode(['breakout', 'bullish_flag'], results) === 'breakout',
    'a structural shape more than six points behind must not win',
  )

  /* ------------------------------------------------------------ quote scoring */

  const excluded = new Set(['HELD'])
  const rolled = new Set(['SEEN'])
  const megacap = {
    symbol: 'AAA',
    quoteType: 'EQUITY',
    longName: 'Alpha',
    shortName: 'Alpha',
    fullExchangeName: 'NasdaqGS',
    currency: 'USD',
    marketCap: 300e9,
    averageDailyVolume3Month: 20e6,
    regularMarketPrice: 100,
    regularMarketChangePercent: 4,
    fiftyTwoWeekChangePercent: 50,
    trailingPE: 30,
    forwardPE: 25,
    fiftyTwoWeekHigh: 120,
    fiftyTwoWeekLow: 60,
  }
  const fresh = scoreRollQuote('AAA', megacap, excluded, rolled)
  const held = scoreRollQuote('HELD', { ...megacap, symbol: 'HELD' }, excluded, rolled)
  const seen = scoreRollQuote('SEEN', { ...megacap, symbol: 'SEEN' }, excluded, rolled)
  // 16 mega cap + 18 very liquid + 9 strong day + 15 strong 1Y + 5 forward P/E present
  // + 14 metadata (8 fields, capped) + 8 fresh idea.
  assert(fresh.score === 85, 'a complete megacap quote scores 85 without an analyst rating')
  const rated = scoreRollQuote('AAA', { ...megacap, averageAnalystRating: '1.8 - Buy' }, excluded, rolled)
  // The rating replaces the 5-point "has forward estimates" consolation with 10 points,
  // and its own text becomes a reason — the reference keeps only the part after the dash.
  assert(rated.score === 90, 'an analyst rating is worth 10, not the 5 the estimate fallback gives')
  // The megacap already has four reasons, and `reasons[:4]` drops the rest — so the
  // rating text only surfaces on a quote with fewer earlier reasons to spend.
  assert(rated.reasons.length === 4 && !rated.reasons.includes('buy'), 'only four reasons survive')
  const quiet = scoreRollQuote(
    'BBB',
    { symbol: 'BBB', quoteType: 'EQUITY', marketCap: 3e9, averageAnalystRating: '1.8 - Buy' },
    excluded,
    rolled,
  )
  assert(quiet.reasons.includes('buy'), 'the rating reason is the lowercased label after the dash')
  assert(fresh.score - seen.score === 15, 'a rolled name loses the 8-point bonus and takes a 7-point penalty')
  assert(seen.score - held.score === 7, 'a held name is penalised 7 points more than a rolled one')
  assert(fresh.reasons.length <= 4, 'only the first four quote reasons are kept')
  assert(fresh.reasons.includes('mega cap') && fresh.reasons.includes('very liquid'), 'reasons must name the tiers')

  const candidate = rollCandidateFromQuote(megacap, excluded, rolled)
  assert(candidate?.symbol === 'AAA' && candidate.matchTier === 'fallback', 'an unanalysed candidate is fallback tier')
  assert(rollCandidateFromQuote({ symbol: '  ' }, excluded, rolled) === null, 'a candidate needs a symbol')

  /* -------------------------------------------------------- pattern analysis */

  const pool: RollCandidate[] = [
    { ...(candidate as RollCandidate) },
    { ...(candidate as RollCandidate), symbol: 'BBB', score: 90 },
    { ...(candidate as RollCandidate), symbol: 'CCC', score: 80 },
  ]
  const histories = new Map<string, RollBar[]>([
    ['AAA', coilSeries(220)],
    ['BBB', downSeries(220)],
    // CCC gets no history at all: it must survive as an `unavailable` row rather than
    // vanishing, which is what keeps the pool from silently shrinking on a Yahoo hiccup.
  ])
  const modes: RollPatternMode[] = ['consolidation']
  const analysis = applyRollPatternAnalysis(pool, modes, histories)
  assert(analysis.candidates.length === 1, 'a strict match must narrow the pool to strict rows only')
  assert(analysis.candidates[0].symbol === 'AAA' && analysis.candidates[0].matchTier === 'strict', 'AAA matches')
  assert(analysis.candidates[0].rank === 1, 'ranks are reassigned over the surviving pool')
  assert(analysis.fallbackReason === '', 'a strict match carries no fallback reason')
  assert(analysis.historySuccessCount === 2, 'only the two symbols with enough bars count as loaded')

  const noMatch = applyRollPatternAnalysis(
    [
      { ...(candidate as RollCandidate), symbol: 'BBB' },
      { ...(candidate as RollCandidate), symbol: 'CCC' },
    ],
    modes,
    new Map([['BBB', downSeries(220)]]),
  )
  assert(noMatch.candidates.length === 2, 'with nothing matching, the whole pool is kept')
  assert(
    noMatch.fallbackReason.startsWith('No strong technical setup found'),
    'a pool with loaded history but no match says so',
  )
  assert(
    noMatch.candidates[0].matchTier === 'fallback' && noMatch.candidates[1].matchTier === 'unavailable',
    'fallback rows must sort above rows whose history never loaded',
  )
  const blackout = applyRollPatternAnalysis([{ ...(candidate as RollCandidate) }], modes, new Map())
  assert(
    blackout.fallbackReason.startsWith('Technical pattern history was unavailable'),
    'a total history blackout reports a different reason than a failed search',
  )

  /* ------------------------------------------------------------- the draw */

  const ranked: RollCandidate[] = Array.from({ length: 40 }, (_value, index) => ({
    ...(candidate as RollCandidate),
    symbol: `S${index}`,
    rank: index + 1,
    score: 100 - index,
  }))
  const drawn = new Set<string>()
  for (let index = 0; index < 200; index += 1) {
    const pick = selectRollCandidate(ranked, {
      excludeSymbols: new Set(),
      historySymbols: new Set(),
      patternActive: false,
      random: walk(index + 1),
    })
    assert(pick, 'the draw must always return a candidate')
    drawn.add(pick.symbol)
  }
  assert([...drawn].every((symbol) => Number(symbol.slice(1)) < 12), 'the draw never reaches past the top twelve')
  assert(drawn.size > 1, 'the draw is weighted, not deterministic')
  const targeted = selectRollCandidate(ranked, {
    targetSymbol: 'S30',
    excludeSymbols: new Set(),
    historySymbols: new Set(),
    patternActive: false,
  })
  assert(targeted?.symbol === 'S30', 'a target symbol bypasses the weighted draw entirely')

  /* --------------------------------------------------------------- summary */

  assert(
    rollScreeningSummary(30, 1234, [], '').includes('universe of 1,234'),
    'the screening summary prints a grouped universe total',
  )
  assert(
    rollScreeningSummary(120, 1234, ['bullish_flag', 'downtrend'], '').endsWith(
      'Searched for bullish flag or downtrend setups using one-year daily history.',
    ),
    'selected modes are named in sorted order, joined with "or"',
  )
  assert(
    rollScreeningSummary(0, 0, [], 'AAPL') === 'Loaded exact-symbol research for AAPL.',
    'a targeted roll reports an exact-symbol load',
  )
}

async function main(): Promise<void> {
  offlineChecks()
  console.log('Roll offline checks passed.')
  if (process.argv.includes('--offline')) return

  const requested = process.argv.slice(2).filter((value) => !value.startsWith('-'))
  const patternModes = requested.filter((value) =>
    ['breakout', 'consolidation', 'downtrend', 'double_bottom', 'bullish_flag', 'bullish_rsi_divergence'].includes(
      value,
    ),
  )
  const temporary = await mkdtemp(join(tmpdir(), 'budget-terminal-roll-'))
  const previousAppData = process.env.APPDATA
  process.env.APPDATA = temporary
  try {
    const { getRoll } = await import('../electron/services/yahoo/roll.js')
    const started = Date.now()
    const payload = await getRoll({ patternModes })
    const seconds = ((Date.now() - started) / 1000).toFixed(1)

    assert(payload.symbol, 'a live roll must return a symbol')
    assert(payload.info.price !== null, 'a live roll must return a usable price')
    assert(payload.candidatePool.length > 0, 'a live roll must return a scored pool')
    assert(
      payload.candidatePool.every((row, index) => row.rank === index + 1),
      'the pool must come back densely ranked',
    )

    console.log(
      `Live roll in ${seconds}s: ${payload.symbol} (${payload.info.name}) ` +
        `score=${payload.candidateScore} rank=#${payload.candidateRank} of ${payload.candidatePool.length} ` +
        `from ${payload.universeTotal.toLocaleString('en-US')} screened`,
    )
    console.log(`  ${payload.screeningSummary}`)
    console.log(
      `  tier=${payload.matchTier} pattern=${payload.patternType} score=${payload.patternScore} ` +
        `modes=[${payload.matchedModes.join(', ') || 'none'}]`,
    )
    console.log(
      `  chart=${payload.chart.length} bars  news=${payload.news.length}  ` +
        `options=${payload.topOptions.length}/${payload.topOptions.length ? 4 : 0} expiries`,
    )
    if (payload.chart.length) {
      const last = payload.chart[payload.chart.length - 1]
      console.log(`  last bar ${last.date}: close=${last.close.toFixed(2)} volume=${last.volume}`)
      // The reference drops the still-forming session; a bar dated today would mean the
      // NYSE-close guard did not fire.
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
      assert(last.date <= today, 'the newest bar must not be dated in the future')
    }
    for (const option of payload.topOptions) {
      console.log(
        `  ${option.expiration} ${option.type} ${option.strike} last=${option.lastPrice} ` +
          `vol=${option.volume} oi=${option.openInterest}`,
      )
    }
    if (payload.warnings.length) console.log(`  warnings: ${payload.warnings.join(' | ')}`)

    // Rolling again must reuse the ten-minute universe and history caches, so the second
    // roll is dramatically cheaper. This is what makes the page usable at all.
    const secondStart = Date.now()
    const second = await getRoll({ patternModes })
    console.log(
      `Second roll in ${((Date.now() - secondStart) / 1000).toFixed(1)}s (cached universe): ${second.symbol}`,
    )
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    await rm(temporary, { recursive: true, force: true })
  }
}

await main()
