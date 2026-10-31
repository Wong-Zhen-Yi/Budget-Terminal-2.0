import assert from 'node:assert/strict'
import { mock } from 'node:test'

import type { CryptoQuote } from '../electron/shared/contract.js'
import {
  CRYPTO_HEATMAP_LIMIT,
  CRYPTO_NEWS_FEEDS,
  CRYPTO_NEWS_LIMIT,
  CRYPTO_PROXY_ROWS,
  CRYPTO_STAGES,
  CRYPTO_TICKERS,
  CRYPTO_WATCHLIST_ORDER,
  buildCryptoSnapshot,
  clockTail,
  cryptoMoney,
  cryptoNewsTone,
  cryptoPercent,
  cryptoPrice,
  cryptoTone,
  fearGreedStamp,
  firstNumber,
  hasUnavailableStage,
  heatmapIntensity,
  loadedStageCount,
  localIsoSeconds,
  rankSortValue,
} from '../electron/shared/crypto.js'
import { fetchTopTiles, getCrypto, sortTilesByRank } from '../electron/services/crypto.js'
import { yahoo } from '../electron/services/yahoo/client.js'
import { HyperliquidClient, hyperliquidClient, parseHyperliquidMarkets } from '../electron/services/hyperliquid.js'
import { getApiUsageSnapshot } from '../electron/services/apiUsage.js'
import { hyperliquidEquities } from '../electron/services/hyperliquidEquities.js'

const hyperliquidFixture = [
  { universe: [{ name: 'BTC' }, { name: 'OLD', isDelisted: true }, { name: 'ETH' }] },
  [
    { markPx: '110', prevDayPx: '100', funding: '0.0000125', openInterest: '5', dayNtlVlm: '1000' },
    {},
    { markPx: '20', prevDayPx: '0', funding: '-0.00002', openInterest: '3', dayNtlVlm: '2000' },
  ],
]

async function checkHyperliquid(): Promise<void> {
  const rows = parseHyperliquidMarkets(hyperliquidFixture)
  assert.deepEqual(rows.map(row => row.symbol), ['ETH', 'BTC'])
  assert.equal(rows[0].markPrice, 20, 'Delisted filtering must preserve metadata/context alignment')
  assert.equal(rows[0].changePct, null, 'New listings without a previous price have no daily change')
  assert.equal(rows[0].fundingHourlyPct, -0.002)
  assert.equal(rows[1].fundingHourlyPct, 0.00125, 'Funding must convert decimal rate to percent exactly once')
  assert.equal(rows[1].openInterestUsd, 550, 'Open interest is returned in base units')
  assert.ok(Math.abs(rows[1].changePct! - 10) < 1e-10)
  assert.throws(() => parseHyperliquidMarkets({}), /Invalid Hyperliquid/)
  assert.throws(() => parseHyperliquidMarkets([{ universe: [{ name: 'BTC' }] }, []]), /do not match/)
  assert.throws(() => parseHyperliquidMarkets([{ universe: [] }, []]), /no active/)
  for (const bad of [null, '', ' ', 'NaN', true, '-1']) {
    assert.throws(() => parseHyperliquidMarkets([{ universe: [{ name: 'BTC' }] },
      [{ markPx: bad, funding: '0', openInterest: '1', dayNtlVlm: '1' }]]), /Incomplete/)
  }

  let now = 100_000
  let calls = 0
  let response = () => new Response(JSON.stringify(hyperliquidFixture))
  const waits: number[] = []
  const client = new HyperliquidClient(async (url, options) => {
    calls += 1
    assert.equal(url, 'https://api.hyperliquid.xyz/info')
    assert.equal(options?.method, 'POST')
    assert.deepEqual(JSON.parse(String(options?.body)), { type: 'metaAndAssetCtxs' })
    assert.ok(options?.signal, 'Provider requests must have a timeout')
    return response()
  }, () => now, async ms => { waits.push(ms); now += ms })
  const before = getApiUsageSnapshot().providers.find(provider => provider.id === 'hyperliquid')!.requestCount
  const [first, concurrent] = await Promise.all([client.getMarkets(), client.getMarkets()])
  assert.equal(first, concurrent, 'Concurrent page loads share a request')
  assert.equal(calls, 1)
  assert.equal(getApiUsageSnapshot().providers.find(provider => provider.id === 'hyperliquid')!.requestCount, before + 1)
  await client.getMarkets()
  assert.deepEqual(waits, [2_000], 'Forced refreshes must respect provider pacing')

  response = () => new Response('', { status: 429, headers: { 'Retry-After': '120' } })
  await assert.rejects(client.getMarkets(), /HTTP 429/)
  const throttledCalls = calls
  now += 60_000
  await assert.rejects(client.getMarkets(), /retry in 60s/)
  assert.equal(calls, throttledCalls, 'Cooldown must prevent another HTTP request')
  now += 60_000
  response = () => new Response(JSON.stringify(hyperliquidFixture))
  assert.equal((await client.getMarkets()).markets.length, 2)

  const dated = new HyperliquidClient(async () => new Response('', { status: 429,
    headers: { 'Retry-After': new Date(now + 180_000).toUTCString() } }), () => now)
  await assert.rejects(dated.getMarkets(), /HTTP 429/)
  await assert.rejects(dated.getMarkets(), /retry in 180s/)
  const failed = new HyperliquidClient(async () => { throw new Error('Timed out') })
  await assert.rejects(failed.getMarkets(), /Timed out/)
  console.log('Hyperliquid checks passed: aligned markets, units, schema failures, request sharing, pacing, usage tracking, cooldown and timeout.')
}

async function checkHeatmapFallback(): Promise<void> {
  const request = mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }))
  const fallback = mock.method(yahoo, '_fetch', async () => ({ finance: { result: [{ quotes:
    Array.from({ length: 30 }, (_, index) => ({
      symbol: `COIN${index}-USD`, shortName: `Coin ${index} USD`,
      regularMarketPrice: 100 + index, regularMarketChangePercent: -1,
      marketCap: 1_000 + index, volume24Hr: 500,
    })),
  }] } }))
  try {
    const tiles = await fetchTopTiles()
    assert.equal(tiles.length, 30, 'HTTP 403 must recover the full heatmap')
    assert.equal(tiles[0].symbol, 'COIN29')
    assert.equal(tiles[0].source, 'Yahoo Finance')
    assert.equal(tiles[0].volume, 500)
    assert.equal(tiles[0].changePct, -1)
    assert.deepEqual(tiles.map(tile => tile.rank), Array.from({ length: 30 }, (_, i) => i + 1))
    request.mock.mockImplementation(async () => new Response('[]'))
    assert.equal((await fetchTopTiles()).length, 30, 'Empty successful responses also need fallback')
    fallback.mock.mockImplementation(async () => { throw new Error('offline') })
    await assert.rejects(fetchTopTiles(), /Yahoo fallback: offline/)
    console.log('Crypto fallback checks passed: HTTP 403, empty response, full ranking, and dual-provider failure.')
  } finally {
    request.mock.restore()
    fallback.mock.restore()
  }
}

async function checkCryptoHyperliquidStage(): Promise<void> {
  const equityQuote = mock.method(hyperliquidEquities, 'getQuote', async (symbol: string) => ({ symbol, price: 110, change: 10, absChange: 10,
    currency: 'USD', source: `Hyperliquid equity perp (xyz:${symbol})` }))
  const request = mock.method(globalThis, 'fetch', async () => new Response('[]'))
  const chart = mock.method(yahoo, 'chart', async () => ({ quotes: [{ close: 100 }, { close: 110 }] }))
  const summary = mock.method(yahoo, 'quoteSummary', async () => ({ price: { marketCap: 1000 } }))
  const screen = mock.method(yahoo, '_fetch', async () => ({ finance: { result: [{ quotes: [] }] } }))
  let calls = 0
  const markets = { markets: parseHyperliquidMarkets(hyperliquidFixture), fetchedAt: localIsoSeconds() }
  const hyperliquid = mock.method(hyperliquidClient, 'getMarkets', async () => { calls += 1; return markets })
  try {
    const first = await getCrypto(true)
    assert.equal(first.payload.hyperliquid, markets)
    assert.equal(first.payload.progress.hyperliquid, 'loaded')
    const cached = await getCrypto()
    assert.equal(cached, first)
    assert.equal(calls, 1, 'Tab revisits must reuse the shared page cache')
    hyperliquid.mock.mockImplementation(async () => { throw new Error('Hyperliquid HTTP 429.') })
    const partial = await getCrypto(true)
    assert.equal(partial.payload.hyperliquid, null)
    assert.equal(partial.payload.progress.hyperliquid, 'unavailable')
    assert.equal(partial.payload.progress.quotes, 'loaded', 'Other stages must survive a Hyperliquid outage')
    assert.equal(partial.payload.quotes.BTC.price, 110)
    assert.ok(partial.errors.some(error => error.symbol === 'Hyperliquid Perpetuals' && /429/.test(error.reason)))
    console.log('Crypto Hyperliquid integration passed: stage readiness, shared cache, force refresh and isolated provider failure.')
  } finally {
    request.mock.restore()
    chart.mock.restore()
    summary.mock.restore()
    screen.mock.restore()
    hyperliquid.mock.restore()
    equityQuote.mock.restore()
  }
}

/**
 * The Crypto page probe, run against `mixins/crypto.py` side by side.
 *
 * `--offline` covers everything pure: the formatting ladders, the tone rules, the heatmap
 * intensity curve and the snapshot export. Without it, it also runs the four live stages
 * and prints what each one returned, so the tiles and tables can be compared against the
 * PySide6 page directly.
 */

function runOffline(): void {
  // `_p19_format_price`: three bands, split at 1 and 1000.
  assert.equal(cryptoPrice(112_345.6), '$112,346')
  assert.equal(cryptoPrice(999.994), '$999.99')
  assert.equal(cryptoPrice(0.51234), '$0.5123')
  assert.equal(cryptoPrice(null), '--')
  assert.equal(cryptoPrice(Number.NaN), '--')

  // `_p19_format_money`: the T/B/M steps apply either way; only K needs `compact`.
  assert.equal(cryptoMoney(2_310_000_000_000), '$2.31T')
  assert.equal(cryptoMoney(64_500_000_000), '$64.50B')
  assert.equal(cryptoMoney(3_450_000), '$3.5M')
  assert.equal(cryptoMoney(4_200), '$4,200')
  assert.equal(cryptoMoney(4_200, true), '$4.2K')
  // The sign lands inside the prefix, as Python's f-string does: `$-64.50B`.
  assert.equal(cryptoMoney(-64_500_000_000), '$-64.50B')
  assert.equal(cryptoMoney(undefined), '--')

  // `_p19_format_pct` is always signed; `_p19_status_for_change` calls exactly zero positive.
  assert.equal(cryptoPercent(2.5), '+2.50%')
  assert.equal(cryptoPercent(-0.004), '-0.00%')
  assert.equal(cryptoPercent(null), '--')
  assert.equal(cryptoTone(0), 'positive')
  assert.equal(cryptoTone(-0.1), 'negative')
  assert.equal(cryptoTone(null), 'muted')

  // `_p19_heatmap_intensity`: |move| over 5, clamped.
  assert.equal(heatmapIntensity(0), 0)
  assert.equal(heatmapIntensity(-2.5), 0.5)
  assert.equal(heatmapIntensity(12), 1)
  assert.equal(heatmapIntensity(Number.NaN), 0)

  // `_p19_rank_sort_value`: unparseable ranks sort last, so a bad tile never displaces #1.
  assert.equal(rankSortValue('3'), 3)
  assert.equal(rankSortValue(null), 999)
  const tiles = [3, 1, 2].map((rank) => ({
    rank,
    symbol: `C${rank}`,
    name: `Coin ${rank}`,
    price: rank,
    changePct: 0,
    marketCap: null,
    volume: null,
    source: 'fixture',
  }))
  assert.deepEqual(sortTilesByRank(tiles).map((tile) => tile.rank), [1, 2, 3])

  // `_p19_news_tone`: bullish is checked first, so a headline with both reads Bullish.
  assert.equal(cryptoNewsTone('Bitcoin ETFs see record inflow'), 'Bullish')
  assert.equal(cryptoNewsTone('SEC opens probe into exchange'), 'Bearish')
  assert.equal(cryptoNewsTone('Ethereum upgrade ships on schedule'), 'Neutral')
  assert.equal(cryptoNewsTone('Record rally as outflows drop'), 'Bullish')

  assert.equal(firstNumber(null, undefined, '', 'x', 4), 4)
  assert.equal(firstNumber(Number.POSITIVE_INFINITY, 7), 7)
  assert.equal(firstNumber(), null)

  // `fetched_at[-8:]` is the clock tail of a seconds-precision local ISO stamp.
  assert.equal(localIsoSeconds(new Date(2026, 7, 27, 9, 5, 3)), '2026-08-27T09:05:03')
  assert.equal(clockTail('2026-08-27T09:05:03'), '09:05:03')
  assert.equal(clockTail(''), '--')
  assert.equal(fearGreedStamp(''), '')

  // Failed stages must not count as ready.
  const allLoaded = { heatmap: 'loaded', quotes: 'loaded', market: 'loaded', news: 'loaded', hyperliquid: 'loaded' } as const
  const mixed = { ...allLoaded, news: 'unavailable' } as const
  assert.equal(loadedStageCount(allLoaded), 5)
  assert.equal(loadedStageCount(mixed), 4)
  assert.equal(hasUnavailableStage(allLoaded), false)
  assert.equal(hasUnavailableStage(mixed), true)

  // `_p19_export_snapshot`: header, stamp, then BTC/ETH/SOL only.
  const quote = (label: string, price: number, changePct: number): CryptoQuote => ({
    label,
    symbol: `${label}-USD`,
    name: label,
    price,
    changePct,
    volume: null,
    marketCap: null,
    source: 'fixture',
  })
  const snapshot = buildCryptoSnapshot({
    fetchedAt: '2026-08-27T09:05:03',
    quotes: {
      BTC: quote('BTC', 112_345.6, 1.5),
      ETH: quote('ETH', 4_210.25, -0.75),
    },
  })
  assert.deepEqual(snapshot.split('\n'), [
    'Budget Terminal Crypto Market Snapshot',
    'Refreshed: 2026-08-27T09:05:03',
    'BTC $112,346 +1.50%',
    'ETH $4,210 -0.75%',
    'SOL -- --',
  ])

  // The tables' fixed orders, which the reference hard-codes rather than deriving.
  assert.equal(CRYPTO_WATCHLIST_ORDER.length, 10)
  assert.ok(!CRYPTO_WATCHLIST_ORDER.includes('BITQ'))
  assert.deepEqual(CRYPTO_PROXY_ROWS.map((row) => row.label), ['IBIT', 'ETHA', 'COIN', 'MSTR', 'BITQ'])
  assert.equal(CRYPTO_TICKERS.length, 5)
  assert.equal(CRYPTO_NEWS_FEEDS.length, 4)

  console.log('Crypto offline checks passed: price/money/percent ladders, tone rules, heatmap intensity, rank sort, stage counting, and the snapshot export.')
}

async function runLive(): Promise<void> {
  const { payload, errors } = await getCrypto(true)

  assert.equal(payload.heatmap.coverage.total, CRYPTO_HEATMAP_LIMIT)
  assert.ok(payload.heatmap.tiles.length <= CRYPTO_HEATMAP_LIMIT)
  assert.ok(payload.news.length <= CRYPTO_NEWS_LIMIT)
  assert.equal(clockTail(payload.fetchedAt).length, 8)
  // Nothing may be dated in the future; that is what catches a timezone-less RSS stamp.
  const now = Date.now()
  for (const article of payload.news) assert.ok(article.publishedAt <= now + 60_000)
  // The heatmap arrives ranked, so the grid can index straight into it.
  const ranks = payload.heatmap.tiles.map((tile) => tile.rank)
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))

  const watchlist = CRYPTO_WATCHLIST_ORDER.map((label) => {
    const row = payload.quotes[label]
    return `${label.padEnd(5)} ${cryptoPrice(row?.price).padStart(12)} ${cryptoPercent(row?.changePct).padStart(9)} ${cryptoMoney(row?.volume, true).padStart(9)} ${cryptoMoney(row?.marketCap, true).padStart(9)}  ${row?.source ?? '--'}`
  })

  console.log(
    JSON.stringify(
      {
        fetchedAt: payload.fetchedAt,
        progress: payload.progress,
        stagesReady: `${loadedStageCount(payload.progress)}/${CRYPTO_STAGES.length}`,
        coverage: payload.heatmap.coverage,
        global: payload.global,
        fearGreed: payload.fearGreed,
        newsBySource: payload.news.reduce<Record<string, number>>((counts, article) => {
          counts[article.source] = (counts[article.source] ?? 0) + 1
          return counts
        }, {}),
        errors: errors.map((error) => `${error.symbol ?? error.source}: ${error.reason}`),
      },
      null,
      2,
    ),
  )
  console.log('\nWatchlist / Movers')
  for (const line of watchlist) console.log(`  ${line}`)
  console.log('\nETF / Equity Proxies')
  for (const row of CRYPTO_PROXY_ROWS) {
    const quote = payload.quotes[row.label]
    console.log(
      `  ${row.label.padEnd(5)} ${row.type.padEnd(20)} ${cryptoMoney(quote?.marketCap, true).padStart(9)} ${cryptoPercent(quote?.changePct).padStart(9)}`,
    )
  }
  console.log('\nCrypto News Feed')
  for (const article of payload.news) {
    console.log(`  ${article.time}  ${cryptoNewsTone(article.title).padEnd(7)} ${article.title}`)
  }
}

const args = process.argv.slice(2)
runOffline()
await checkHeatmapFallback()
await checkHyperliquid()
await checkCryptoHyperliquidStage()
if (args.includes('--hyperliquid-live')) {
  const result = await hyperliquidClient.getMarkets()
  assert.ok(result.markets.some(row => row.symbol === 'BTC'))
  assert.ok(result.markets.some(row => row.symbol === 'ETH'))
  console.log(`Hyperliquid live check passed: ${result.markets.length} active perpetual markets at ${result.fetchedAt}.`)
} else if (!args.includes('--offline')) await runLive()
