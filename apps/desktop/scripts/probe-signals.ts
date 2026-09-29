import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DayTradingCandidate, SignalsPayload } from '../electron/shared/contract.js'
import {
  dayTradingDataMessage, dayTradingSession, dayTradingStatus, dayTradingVisible, evaluateDayTrading,
  normalizeDayTradingSettings, shouldRefreshDayTrading, validDayTradingPayload,
} from '../electron/shared/dayTrading.js'
import { completedMedianDollarVolume, signalCandidateFromQuote, type SignalBar } from '../electron/shared/signals.js'

const OPEN = Date.parse('2026-08-12T13:30:00Z')
const MINUTE = 60_000
function bar(index: number, overrides: Partial<SignalBar> = {}): SignalBar {
  return { timestamp: OPEN + index * MINUTE, open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides }
}
const opening = Array.from({ length: 5 }, (_, i) => bar(i))
const breakout = [...opening, bar(5, { open: 100, high: 103, low: 100, close: 102 })]
const confirmed = OPEN + 6 * MINUTE
const candidate = (ticker: string): DayTradingCandidate => ({ ticker, name: ticker, exchange: 'NMS', price: 100,
  marketCap: 10e9, estimatedDollarVolume: 100e6, medianDollarVolume: 90e6, qualityRank: 1, reasons: [] })

function engineChecks(): void {
  const rows = evaluateDayTrading('TEST', breakout, confirmed)
  const orb = rows[0]
  assert.equal(orb.status, 'ready')
  assert.equal(orb.confirmedAt, new Date(confirmed).toISOString())
  assert.deepEqual([orb.entry, orb.stop, orb.target1, orb.target2], [102, 99, 105, 108])
  assert.equal(orb.openingHigh, 101)
  assert.equal(orb.openingLow, 99)
  assert.equal(orb.vwap, (5 * 100 + 305 / 3) / 6)
  assert.equal(dayTradingStatus(orb, confirmed + 119_999), 'ready')
  assert.equal(dayTradingStatus(orb, confirmed + 120_000), 'expired')
  assert.equal(dayTradingStatus(orb, confirmed + 120_001), 'stale')
  assert.equal(dayTradingStatus(orb, Date.parse('2026-08-12T20:00:00Z')), 'market_closed')
  assert.equal(dayTradingStatus(orb, Date.parse('2026-08-13T13:36:00Z')), 'stale')
  const awaiting = evaluateDayTrading('TEST', [], OPEN)[0]
  assert.equal(awaiting.status, 'awaiting_data')
  assert.match(dayTradingDataMessage(awaiting, OPEN), /09:31/)
  assert.match(dayTradingDataMessage(awaiting, confirmed), /not returned a completed candle/)
  assert.equal(dayTradingStatus(awaiting, confirmed), 'awaiting_data')
  assert.equal(dayTradingStatus({ ...awaiting, error: 'Offline' }, confirmed), 'error')
  assert.match(dayTradingDataMessage(orb, confirmed + 120_001), /more than 2 minutes/)
  assert.equal(dayTradingStatus({ ...orb, error: 'Provider failed' }, confirmed), 'error')
  assert.equal(evaluateDayTrading('TEST', breakout, confirmed - 1)[0].confirmedAt, null, 'forming candle ignored')
  assert.equal(evaluateDayTrading('TEST', opening, OPEN + 5 * MINUTE)[0].status, 'watching')
  assert.equal(evaluateDayTrading('TEST', breakout.slice(1), confirmed)[0].status, 'error', 'missing opening candle')
  assert.equal(evaluateDayTrading('TEST', [...breakout, bar(7)], OPEN + 8 * MINUTE)[0].status, 'error', 'missing middle candle')
  assert.equal(evaluateDayTrading('TEST', [...opening, bar(5, { volume: null })], confirmed)[0].status, 'error')
  assert.equal(evaluateDayTrading('TEST', [...opening, bar(5, { low: null })], confirmed)[0].status, 'error')
  assert.equal(evaluateDayTrading('TEST', breakout.map((row) => ({ ...row, volume: 0 })), confirmed)[0].entry, null)
  assert.equal(evaluateDayTrading('TEST', [bar(-1, { high: 1e6 }), ...breakout], confirmed)[0].openingHigh, 101)
  assert.equal(evaluateDayTrading('TEST', [...breakout, bar(390, { close: 1e6 })], Date.parse('2026-08-12T20:02:00Z'))[0].latestPrice, 102)
  assert.equal(evaluateDayTrading('TEST', breakout, Date.parse('2026-08-13T13:36:00Z'))[0].confirmedAt, null)
  const invalid = evaluateDayTrading('TEST', [...breakout, bar(6, { open: 102, high: 102, low: 98, close: 99 })], confirmed + MINUTE)[0]
  assert.equal(invalid.status, 'invalidated')
  assert.equal(invalid.invalidatedAt, new Date(confirmed + MINUTE).toISOString())
  const pullback = [...breakout, bar(6, { open: 101, high: 102, low: 100, close: 101.5 })]
  const both = evaluateDayTrading('TEST', pullback, confirmed + MINUTE)
  assert.equal(both[0].status, 'ready')
  assert.equal(both[1].status, 'ready')
  assert.deepEqual([both[1].entry, both[1].stop, both[1].target1, both[1].target2], [101.5, 100, 103, 104.5])
  assert.notEqual(both[0].id, both[1].id)
  assert.equal(evaluateDayTrading('TEST', [...breakout, bar(6, { open: 102, high: 103, low: 100, close: 101.5 })], confirmed + MINUTE)[1].entry, null, 'bearish candle is not a pullback confirmation')
  assert.equal(evaluateDayTrading('TEST', [...opening, bar(5, { open: 102, close: 102, high: 102, low: 102 })], confirmed)[1].entry, null, 'no VWAP touch and no positive risk')
  const later = [...pullback, bar(7, { open: 101.5, high: 103, low: 101.5, close: 102 }), bar(8, { open: 102, high: 103, low: 102, close: 102 })]
  assert.equal(evaluateDayTrading('TEST', later, confirmed + 3 * MINUTE)[0].status, 'expired')
  assert.equal(evaluateDayTrading('TEST', [...breakout].reverse(), confirmed)[0].id, orb.id)
  assert.equal(evaluateDayTrading('TEST', [...breakout, breakout[5]], confirmed)[0].id, orb.id)
  assert.equal(dayTradingVisible(orb, { filter: 'ready', setup: 'opening_range', search: 'te' }), true)
  assert.equal(dayTradingVisible(orb, { filter: 'ready', setup: 'vwap_pullback', search: '' }), false)
  assert.deepEqual(normalizeDayTradingSettings({ filter: 'blocked', search: 'NVDA' }), { filter: 'all', setup: 'all', search: 'NVDA' })
  assert.equal(normalizeDayTradingSettings({ filter: 'ready', setup: 'vwap_pullback' }).setup, 'vwap_pullback')

  assert.equal(dayTradingSession(Date.parse('2026-01-05T14:30:00Z')).open, true, 'winter EST')
  assert.equal(dayTradingSession(Date.parse('2026-08-12T13:29:59Z')).open, false)
  assert.equal(dayTradingSession(Date.parse('2026-09-06T14:00:00Z')).open, false, 'weekend')
  assert.equal(dayTradingSession(Date.parse('2026-09-07T14:00:00Z')).open, false, 'Labor Day')
  assert.equal(dayTradingSession(Date.parse('2026-11-27T18:00:00Z')).open, false, 'early close')
  assert.equal(shouldRefreshDayTrading(confirmed, true, false, -Infinity), true)
  assert.equal(shouldRefreshDayTrading(confirmed, false, false, -Infinity), false)
  assert.equal(shouldRefreshDayTrading(confirmed, true, true, -Infinity), false)
  assert.equal(shouldRefreshDayTrading(confirmed, true, false, confirmed - 59_999), false)
  assert.equal(shouldRefreshDayTrading(confirmed, true, false, confirmed - MINUTE), true)
  assert.equal(shouldRefreshDayTrading(Date.parse('2026-09-07T14:00:00Z'), true, false, -Infinity), false)
  assert.equal(signalCandidateFromQuote({ symbol: 'PENNY', regularMarketPrice: 4, marketCap: 3e9, exchange: 'NMS' }), null)
  const daily = Array.from({ length: 21 }, (_, i) => ({ ...bar(0), timestamp: OPEN - (21 - i) * 86_400_000, volume: 300_000 }))
  assert.equal(completedMedianDollarVolume(daily, '2026-08-12'), 30e6)
  assert.equal(validDayTradingPayload({ results: rows, completedAt: new Date().toISOString() }), false)
  console.log('PASS: opening range, VWAP, levels, expiry, invalidation, data quality, session rules, filters and refresh policy')
}

async function serviceChecks(): Promise<void> {
  const { cache } = await import('../electron/services/cache.js')
  const { yahoo } = await import('../electron/services/yahoo/client.js')
  const { getSignals, getLatestSignals, clearLatestSignals } = await import('../electron/services/yahoo/signals.js')
  const folder = join(process.env.APPDATA!, 'BudgetTerminalElectron')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'signals-latest-v4.json'), JSON.stringify({ results: [{ rawScore: 99 }], completedAt: new Date().toISOString() }))
  assert.equal(await getLatestSignals(), null, 'old cache is never loaded')
  await writeFile(join(folder, 'signals-latest-v5.json'), JSON.stringify({ version: 4, results: [], completedAt: new Date().toISOString() }))
  assert.equal(await getLatestSignals(), null, 'wrong version rejected at new path')
  const session = dayTradingSession()
  const cachedFailureRows = evaluateDayTrading('FAIL', breakout, confirmed).map((row) => ({ ...row, session: session.date }))
  const cachedPayload: SignalsPayload = {
    version: 5, session: session.date, marketOpen: session.open,
    candidates: [candidate('FAIL')], results: cachedFailureRows, source: 'Yahoo Finance',
    sourcedAt: new Date().toISOString(), startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    sourceCandidateCount: 1, prefilteredCount: 1, confirmedCount: 1, errors: {}, universeFromCache: true,
  }
  await writeFile(join(folder, 'signals-latest-v5.json'), JSON.stringify(cachedPayload))
  assert.deepEqual(await getLatestSignals(), cachedPayload, 'restore new cache after restart')
  cache.set(`signals:day-trading-universe-v5:${session.date}`, {
    candidates: [candidate('GOOD'), { ...candidate('FAIL'), qualityRank: 2 }], sourcedAt: new Date().toISOString(),
    sourceCandidateCount: 2, prefilteredCount: 2, confirmedCount: 2, rejectedCandidateCount: 0, passedFilterCount: 2,
  }, 60_000)
  cache.set('signals:day-trading-v5:GOOD:1m:7', breakout, 60_000)
  const chartClient: { chart: typeof yahoo.chart } = yahoo
  const originalChart = chartClient.chart
  let failures = 0
  let successes = 0
  chartClient.chart = (async (symbol: string) => {
    if (symbol === 'GOOD') {
      successes++
      return { quotes: breakout.map((row, index) => ({ ...row, date: new Date(Date.now() - 86_400_000 + index * MINUTE) })), meta: { currency: 'USD' } }
    }
    failures++
    throw new Error('Fixture provider failure')
  }) as unknown as typeof yahoo.chart
  try {
    const first = getSignals()
    assert.equal(getSignals(), first, 'concurrent scans share the exact promise')
    const result = await first
    assert.equal(result.version, 5)
    assert.equal(result.results.length, 4)
    assert.equal(failures, 1)
    assert.equal(successes, 1, 'a scan bypasses the still-fresh outer intraday cache')
    assert.match(result.errors.FAIL, /Fixture provider failure/)
    const preserved = result.results.find((row) => row.ticker === 'FAIL' && row.setup === 'opening_range')!
    assert.equal(preserved.entry, 102, 'failed refresh retains cached reference levels')
    assert.equal(preserved.barTime, cachedFailureRows[0].barTime, 'failed refresh never advances the data timestamp')
    assert.equal(result.results.find((row) => row.ticker === 'GOOD')!.error, null)
    assert.ok(result.results.filter((row) => row.ticker === 'FAIL').every((row) => row.status !== 'ready'))
    assert.equal(validDayTradingPayload(result), true)
    assert.equal(validDayTradingPayload({ ...result, results: [{ ...result.results[0], entry: 'bad' }] }), false)
    assert.deepEqual(JSON.parse(await readFile(join(folder, 'signals-latest-v5.json'), 'utf8')), result)
    assert.deepEqual(await getLatestSignals(), result)
    await getSignals()
    assert.equal(successes, 2, 'the next scan bypasses the fresh canonical chart cache too')
    chartClient.chart = (async () => { throw new Error('Fixture offline after success') }) as typeof yahoo.chart
    const fallback = await getSignals()
    assert.match(fallback.errors.GOOD, /cached history was returned/, 'stale series fallback must remain an error')
    assert.equal(fallback.results.find((row) => row.ticker === 'GOOD')!.barTime, result.results.find((row) => row.ticker === 'GOOD')!.barTime)
    await clearLatestSignals()
    assert.equal(await getLatestSignals(), null)
  } finally { chartClient.chart = originalChart; cache.clear() }
  console.log('PASS: cache versioning, persistence, concurrent scans and partial provider failure')
}

async function liveCheck(): Promise<void> {
  const { yahooProvider } = await import('../electron/services/provider.js')
  const started = Date.now()
  const envelope = await yahooProvider.signals({})
  assert.notEqual(envelope.meta.freshness, 'failed', envelope.meta.failureReason ?? '')
  assert.ok(envelope.data)
  const payload: SignalsPayload = envelope.data
  assert.ok(payload.candidates.length > 0 && payload.candidates.length <= 30)
  assert.equal(payload.results.length, payload.candidates.length * 2)
  assert.equal(validDayTradingPayload(payload), true)
  assert.ok(payload.candidates.every((row, index, all) => index === 0 || all[index - 1].estimatedDollarVolume >= row.estimatedDollarVolume))
  assert.ok(payload.results.every((row) => row.status !== 'ready' || (row.entry !== null && row.stop !== null && row.entry > row.stop)))
  console.log(`PASS: live Yahoo scan ${(Date.now() - started) / 1000}s; ${payload.candidates.length} stocks; ${payload.results.length} setups; ${Object.keys(payload.errors).length} errors; session open=${payload.marketOpen}`)
  const stocks = payload.results.filter((row) => row.setup === 'opening_range')
  console.log(`Feed coverage: ${stocks.filter((row) => row.barTime).length}/${stocks.length} stocks with candles; ${stocks.filter((row) => row.status === 'stale').length} delayed; ${stocks.filter((row) => row.status === 'awaiting_data').length} awaiting candles`)
  console.log(payload.results.slice(0, 4).map((row) => `${row.ticker} ${row.setup}: ${row.status}`).join('\n'))
}

const scratch = await mkdtemp(join(tmpdir(), 'bt-day-trading-'))
const previousAppData = process.env.APPDATA
const previousLocal = process.env.LOCALAPPDATA
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
try {
  engineChecks()
  await serviceChecks()
  if (!process.argv.includes('--offline')) await liveCheck()
} finally {
  if (previousAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = previousAppData
  if (previousLocal === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = previousLocal
  await rm(scratch, { recursive: true, force: true })
}
