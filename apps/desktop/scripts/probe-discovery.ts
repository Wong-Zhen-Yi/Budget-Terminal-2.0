import assert from 'node:assert/strict'

import type { Candle, DiscoverySnapshot } from '../electron/shared/contract.js'
import { analyzeDiscovery, parseDiscoveryInterval, pickDiscoverySymbol } from '../electron/shared/discovery.js'
import { parseNasdaqCompanySymbols } from '../electron/shared/calendar.js'

const day = 86_400
const candles: Candle[] = Array.from({ length: 260 }, (_, index) => ({
  time: 1_700_000_000 + index * day,
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100 + index,
  volume: 1_000 + index,
}))
const snapshot = {
  price: 359,
  previousClose: 358,
  market: { high52: 360, low52: 100, volume: 2_000 },
  candles,
} as unknown as DiscoverySnapshot

assert.equal(pickDiscoverySymbol(['A', 'B', 'C'], ['A', 'B'], () => 0), 'C')
assert.equal(pickDiscoverySymbol(['A'], ['A'], () => 0), 'A')
assert.equal(pickDiscoverySymbol([], [], () => 0), null)
assert.equal(parseDiscoveryInterval('10'), 10)
assert.equal(parseDiscoveryInterval('300'), 300)
assert.equal(parseDiscoveryInterval('5'), 5)
assert.equal(parseDiscoveryInterval('4'), null)
assert.equal(parseDiscoveryInterval('301'), null)
assert.equal(parseDiscoveryInterval('7.5'), null)
assert.equal(parseDiscoveryInterval(''), null)
const directory = [
  'Nasdaq Traded|Symbol|Security Name|Listing Exchange|ETF|Test Issue',
  'Y|AAPL|Apple Inc. Common Stock|Q|N|N',
  'Y|IBM|International Business Machines Corporation Common Stock|N|N|N',
  'Y|AMER|American Example Common Stock|A|N|N',
  'Y|OTHER|Other Example Common Stock|Z|N|N',
].join('\n')
assert.deepEqual([...parseNasdaqCompanySymbols(directory, new Set(['Q', 'N', 'A']))], ['AAPL', 'IBM', 'AMER'])
const analysis = analyzeDiscovery(snapshot)
assert.equal(analysis.technicals.sma20, 349.5)
assert.equal(analysis.technicals.sma200, 259.5)
assert.equal(analysis.technicals.rsi14, 100)
assert.equal(analysis.technicals.atr14, 2)
assert.equal(analysis.technicals.rangePosition, (359 - 100) / 260 * 100)
assert.ok(Math.abs((analysis.technicals.macd ?? 0) - 7) < 0.01)
assert.ok(Math.abs((analysis.technicals.macdSignal ?? 0) - 7) < 0.01)
assert.ok((analysis.performance['5D'] ?? 0) > 0)
assert.equal(analyzeDiscovery({ ...snapshot, candles: candles.slice(0, 5) }).technicals.sma200, null)
console.log('Discovery offline calculations and rotation selection passed.')

if (!process.argv.includes('--offline')) {
  const { getDiscoveryUniverse, getDiscoverySnapshot } = await import('../electron/services/yahoo/discovery.js')
  const universe = await getDiscoveryUniverse()
  assert.ok(universe.symbols.includes('AAPL'))
  const live = await getDiscoverySnapshot('AAPL')
  assert.equal(live.symbol, 'AAPL')
  assert.ok(live.candles.length >= 200)
  assert.ok(live.price !== null && live.price > 0)
  assert.ok(analyzeDiscovery(live).performance['5Y'] !== null)
  console.log(`Live discovery: ${live.symbol} ${live.name}, ${live.candles.length} bars, quote ${live.quoteStatus}.`)
}
