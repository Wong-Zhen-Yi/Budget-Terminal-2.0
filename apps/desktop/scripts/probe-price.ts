import assert from 'node:assert/strict'

import type { PriceScreenRow } from '../electron/shared/contract.js'
import {
  formatPriceScreenMarketCap,
  priceScreenRowFromQuote,
  rankPriceScreenRows,
  validatePriceRange,
} from '../electron/shared/priceScreen.js'
import { yahooProvider } from '../electron/services/provider.js'
import { getPriceScreen } from '../electron/services/yahoo/priceScreen.js'

function quote(
  ticker: string,
  price = 150,
  marketCap = 1_000_000_000,
  exchange = 'NYQ',
  quoteType = 'EQUITY',
) {
  return {
    symbol: ticker,
    shortName: `${ticker} Company`,
    regularMarketPrice: price,
    marketCap,
    exchange,
    quoteType,
  }
}

async function offlineChecks(): Promise<void> {
  assert.throws(() => validatePriceRange(Number.NaN, 200), /finite/)
  assert.throws(() => validatePriceRange(0, 200), /greater than/)
  assert.throws(() => validatePriceRange(201, 200), /cannot exceed/)
  validatePriceRange(100, 200)

  assert.equal(priceScreenRowFromQuote(quote('NYSE'), 100, 200)?.exchange, 'NYSE')
  assert.equal(priceScreenRowFromQuote(quote('NASDAQ', 150, 1e9, 'NMS'), 100, 200)?.exchange, 'Nasdaq')
  assert.equal(priceScreenRowFromQuote(quote('AMEX', 150, 1e9, 'ASE'), 100, 200)?.exchange, 'NYSE American')
  assert.equal(priceScreenRowFromQuote(quote('ETF', 150, 1e9, 'NYQ', 'ETF'), 100, 200), null)
  assert.equal(priceScreenRowFromQuote(quote('OTC', 150, 1e9, 'PNK'), 100, 200), null)
  assert.equal(priceScreenRowFromQuote(quote('LOW', 99.99), 100, 200), null)
  assert.equal(priceScreenRowFromQuote(quote('HIGH', 200.01), 100, 200), null)
  assert.ok(priceScreenRowFromQuote(quote('MIN', 100), 100, 200))
  assert.ok(priceScreenRowFromQuote(quote('MAX', 200), 100, 200))
  for (const volume of [12_345_678, 0, null, undefined, -1, Number.NaN, Infinity]) {
    const row = priceScreenRowFromQuote({ ...quote('VOL'), regularMarketVolume: volume }, 100, 200)
    assert.ok(row, 'Missing volume must not exclude an otherwise valid equity')
    assert.equal(row.volume, typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 ? volume : null)
  }

  const rows: PriceScreenRow[] = Array.from({ length: 120 }, (_, index) => ({
    ticker: `T${String(index).padStart(3, '0')}`,
    name: `Company ${index}`,
    exchange: 'NYSE',
    price: 100 + index / 10,
    marketCap: (120 - index) * 1_000_000,
    volume: null,
  }))
  const ranked = rankPriceScreenRows(rows)
  assert.equal(ranked.length, 100)
  assert.equal(ranked[0]?.ticker, 'T000')
  assert.equal(ranked[99]?.ticker, 'T099')
  assert.equal(formatPriceScreenMarketCap(900_000_000_000), '$900.00B')
  assert.equal(formatPriceScreenMarketCap(50_000_000_000), '$50.00B')

  const offsets: number[] = []
  const pages = new Map([
    [
      0,
      {
        total: 6,
        quotes: [
          quote('AAA', 150, 10_000_000_000),
          quote('FUND', 150, 50_000_000_000, 'NYQ', 'ETF'),
          quote('OTC', 150, 40_000_000_000, 'PNK'),
        ],
      },
    ],
    [
      3,
      {
        total: 6,
        quotes: [
          quote('BBB', 150, 9_000_000_000),
          quote('CCC', 150, 8_000_000_000),
          quote('AAA', 150, 7_000_000_000),
        ],
      },
    ],
  ])
  const paged = await getPriceScreen(100, 200, {
    limit: 2,
    pageSize: 3,
    now: new Date(2026, 6, 14, 10, 0),
    fetchPage: async (_minimum, _maximum, _exchanges, offset) => {
      offsets.push(offset)
      const page = pages.get(offset)
      if (!page) throw new Error(`Unexpected offset ${offset}`)
      return page
    },
  })
  assert.deepEqual(offsets, [0, 3])
  assert.equal(paged.candidateCount, 6)
  assert.deepEqual(paged.rows.map((row) => row.ticker), ['AAA', 'BBB'])
  assert.equal(paged.rows[0]?.marketCap, 10_000_000_000)
  console.log('Price offline checks passed: validation, exchange filtering, inclusive bounds, pagination, deduplication, ranking, result cap, and formatting.')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const offline = args.includes('--offline')
  const values = args.filter((arg) => arg !== '--offline').map(Number)
  const minimumPrice = values[0] ?? 100
  const maximumPrice = values[1] ?? 200

  await offlineChecks()
  if (offline) return

  const envelope = await yahooProvider.priceScreen({ minimumPrice, maximumPrice })
  assert.notEqual(envelope.meta.freshness, 'failed', envelope.meta.failureReason ?? '')
  assert.ok(envelope.data.rows.length <= 100)
  assert.ok(
    envelope.data.rows.every(
      (row) => row.price >= minimumPrice && row.price <= maximumPrice && row.marketCap > 0,
    ),
  )
  assert.deepEqual(
    envelope.data.rows,
    rankPriceScreenRows(envelope.data.rows),
    'live rows are not in market-cap rank order',
  )

  console.log('\n== Price ==')
  console.log(`range      : $${minimumPrice.toFixed(2)} to $${maximumPrice.toFixed(2)}`)
  console.log(`source     : ${envelope.data.source}`)
  console.log(`as of      : ${envelope.data.asOf}`)
  console.log(`candidates : ${envelope.data.candidateCount.toLocaleString('en-US')}`)
  console.log(`rows       : ${envelope.data.rows.length}`)
  for (const [index, row] of envelope.data.rows.slice(0, 10).entries()) {
    console.log(
      `${String(index + 1).padStart(3)}  ${row.ticker.padEnd(7)} ${row.exchange.padEnd(14)} ` +
      `$${row.price.toFixed(2).padStart(10)}  ${formatPriceScreenMarketCap(row.marketCap).padStart(12)}  ${row.name}`,
    )
  }
}

await main()
