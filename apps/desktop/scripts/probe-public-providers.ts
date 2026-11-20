import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const directory = await mkdtemp(join(tmpdir(), 'bt-public-providers-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const { DiversifiedHttp } = await import('../electron/services/diversifiedHttp.js')
const { DiversifiedData } = await import('../electron/services/diversifiedData.js')
const { PublicMacroClient, parseWorldBankInflation, parseImfGrowth } = await import('../electron/services/publicMacro.js')
const { TtlCache, cache } = await import('../electron/services/cache.js')
const { getEth, ethEndpoints } = await import('../electron/services/eth.js')
const { ETH_DAY_MS } = await import('../electron/shared/eth.js')
const { closeYahooWorker } = await import('../electron/services/yahoo/client.js')
try {
  const now = Date.now()
  const requested: string[] = []
  const request: typeof fetch = async input => {
    const url = String(input)
    requested.push(url)
    if (url.includes('USDT-USD')) return Response.json({ open: '0.98', last: '1.02' })
    if (url.includes('binance.vision')) return Response.json({ symbol: 'ETHUSDT', lastPrice: '100', openPrice: '80', closeTime: now })
    return Response.json({ open: '90', last: '100' })
  }
  const http = new DiversifiedHttp(request, () => now)
  const data = new DiversifiedData(http, new TtlCache(), () => now)
  const batch = await Promise.all(Array.from({ length: 20 }, () => data.spot('BTC-USD')))
  assert.equal(requested.length, 1, 'Repeated startup consumers did not coalesce')
  assert.ok(batch.every(row => row?.value.price === 100))
  await data.spot('BTC-USD')
  assert.equal(requested.length, 1, 'Cached spot quote re-requested')
  const eth = await data.spot('ETH-USD')
  assert.equal(eth?.value.price, 102, 'USDT must not be labelled USD without conversion')
  assert.ok(Math.abs(eth!.value.change - (102 / (80 * .98) - 1) * 100) < 1e-8)
  assert.match(eth!.value.source!, /converted to USD/)
  assert.equal(await data.spot('BTC-PERP'), null, 'Perpetual must not switch to spot')
  assert.equal(await data.spot('AAPL'), null, 'Stocks must not switch to crypto')
  assert.ok(requested.every(url => !/apikey|token|finnhub|alltick|financialmodelingprep/i.test(url)))

  let clock = now
  let calls = 0
  const limited = new DiversifiedHttp(async () => {
    calls += 1
    return new Response('', { status: 429, headers: { 'Retry-After': '120' } })
  }, () => clock)
  const endpoint = new URL('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT')
  await assert.rejects(limited.get('binance', endpoint, JSON.parse), /request failed/)
  clock += 119_000
  await assert.rejects(limited.get('binance', endpoint, JSON.parse), /cooldown/)
  assert.equal(calls, 1, 'Retry-After was bypassed')
  clock += 2_000
  await assert.rejects(limited.get('binance', endpoint, JSON.parse))
  assert.equal(calls, 2)
  const leak = new DiversifiedHttp(async () => { throw new Error('private-key-in-url') })
  await assert.rejects(leak.get('binance', endpoint, JSON.parse), error => error instanceof Error && !error.message.includes('private-key'))
  await assert.rejects(http.get('coinbase', new URL('https://api.exchange.coinbase.com/products/BTC-USD/stats?token=forbidden'), JSON.parse), /Only public/)
  await assert.rejects(http.get('coinbase', new URL('https://example.com/'), JSON.parse), /Only public/)
  let sent = 0
  let budgetClock = now
  const budget = new DiversifiedHttp(async () => { sent += 1; return Response.json({ ok: true }) }, () => budgetClock)
  for (let index = 0; index < 20; index += 1) {
    budgetClock += 1_100
    await budget.get('imf', new URL('https://api.imf.org/'), JSON.parse)
  }
  await assert.rejects(budget.get('imf', new URL('https://api.imf.org/'), JSON.parse), /budget/)
  assert.equal(sent, 20)
  const burst = new DiversifiedHttp(async () => Response.json({ ok: true }), () => now)
  for (let index = 0; index < 6; index += 1) await burst.get('coinbase', new URL('https://api.exchange.coinbase.com/products/BTC-USD/stats'), JSON.parse)
  await assert.rejects(burst.get('coinbase', new URL('https://api.exchange.coinbase.com/products/BTC-USD/stats'), JSON.parse), /budget/)

  const fallbackUrls: string[] = []
  const fallback = new DiversifiedData(new DiversifiedHttp(async input => {
    const url = String(input); fallbackUrls.push(url)
    if (url.includes('binance.vision')) return Response.json({ symbol: 'WRONG' })
    return Response.json({ open: '10', last: '12' })
  }), new TtlCache())
  const recovered = await fallback.spot('ETH-USD')
  assert.equal(recovered?.value.price, 12)
  assert.match(recovered!.value.source!, /Coinbase/)
  assert.ok(fallbackUrls.some(url => url.includes('binance.vision')))
  assert.ok(fallbackUrls.some(url => url.includes('/ETH-USD/stats')))

  const wbRow = (year: string, value: unknown) => ({ indicator: { id: 'FP.CPI.TOTL.ZG' }, countryiso3code: 'USA', date: year, value })
  assert.deepEqual(parseWorldBankInflation([{ pages: 1 }, [wbRow('2023', 3), wbRow('2024', 2), wbRow('2025', null), wbRow('2026', 99)]], 2026), [['2023-01-01', 3], ['2024-01-01', 2]])
  assert.throws(() => parseWorldBankInflation([{ pages: 2 }, []], 2026))
  const csv = 'COUNTRY,INDICATOR,FREQUENCY,TIME_PERIOD,OBS_VALUE,SCALE,LATEST_ACTUAL_ANNUAL_DATA\nUSA,NGDP_RPCH,A,2023,2.9,0,2024\nUSA,NGDP_RPCH,A,2024,2.8,0,2024\nUSA,NGDP_RPCH,A,2025,9,0,2024\nUSA,NGDP_RPCH,A,2027,99,0,2024'
  assert.deepEqual(parseImfGrowth(csv, 2026), [['2023-01-01', 2.9], ['2024-01-01', 2.8]])
  assert.throws(() => parseImfGrowth(csv.replaceAll('USA', 'GBR'), 2026))
  console.log('PASS: public-only endpoints, coalescing/cache, USD conversion, market validation, fallback, rate budgets, Retry-After, sanitized failures and annual actual-data cutoffs')

  if (process.argv.includes('--eth-live')) {
    const eth = await getEth()
    assert.equal(eth.meta.freshness, 'fresh', JSON.stringify(eth.errors))
    assert(eth.data.ecosystem.length > 1 && eth.data.mainnet?.blockTimeSeconds && eth.data.daily.length > 30)
    assert(eth.data.mainnet.medianTransactionFeeUsd !== undefined)
    const latest = eth.data.daily.at(-1)
    assert(latest?.gasThroughputMgasPerSecond && latest.feesPaidUsdPerDay && latest.stablecoinSupplyUsd
      && latest.layer2SettlementUsdPerDay !== undefined)
    const market = eth.data.market?.at(-1)
    assert(eth.data.market!.length >= 90 && market && market.priceUsd > 0 && market.marketCapUsd > 0 && market.supplyEth > 0)
    assert(market.issuanceEth !== undefined && market.activeAddresses !== undefined)
    const staking = eth.data.staking
    assert(staking && staking.validatorBalanceEth > 0 && staking.supplyEth > staking.validatorBalanceEth)
    assert(eth.data.burn && eth.data.burn.sevenDayEth >= 0)
    console.log('PASS live Ethereum: growthepie activity and settlement, Coin Metrics market and supply, ultrasound.money validator balances and fee burn')
  } else {
    const fetchOriginal = globalThis.fetch
    const day = Math.floor(now / ETH_DAY_MS) * ETH_DAY_MS
    const seen: string[] = []
    let unavailable = false
    let burnUnavailable = false
    const utcDate = day - ETH_DAY_MS
    const daily = (data: unknown[][], gas: number, fees: number, stables: number | null) => ({ metrics: {
      txcount: { daily: { types: ['value', 'unix'], data } },
      throughput: { daily: { types: ['unix', 'value'], data: [[utcDate, gas]] } },
      fees: { daily: { types: ['eth', 'unix', 'usd'], data: [[123, utcDate, fees]] } },
      stables_mcap: { daily: { types: ['unix', 'usd'], data: [[utcDate, stables]] } },
      rent_paid: { daily: { types: ['usd', 'unix'], data: [[0, utcDate]] } },
    } })
    const market = (timestamp: number) => ({
      asset: 'eth', time: new Date(timestamp).toISOString(),
      PriceUSD: '2400.5', CapMrktCurUSD: '289000000000', SplyCur: '120200000.125', IssTotNtv: '2190', AdrActCnt: '800123',
    })
    const slot = Math.floor((now / 1000 - 1_606_824_023) / 12)
    globalThis.fetch = async (input, options) => {
      const url = String(input)
      seen.push(url)
      assert.deepEqual([...new Headers(options?.headers).keys()], ['accept'])
      if (url === ethEndpoints.ecosystem) return Response.json({ history: [
        { tps: 200, timestamp_ms: now }, { tps: 180, timestamp_ms: now - 1000 },
      ] })
      if (url === ethEndpoints.mainnet) return unavailable ? new Response(null, { status: 503 })
        : Response.json({ data: { chain_name: 'ethereum', tps: 20, timestamp: now - 2000, block_time: 12.1, tx_cost_median_usd: 0 } })
      if (url === encodeURI(ethEndpoints.market)) return Response.json({ data: [
        market(utcDate), market(day), market(utcDate - ETH_DAY_MS / 2),
        { ...market(utcDate - ETH_DAY_MS), IssTotNtv: null },
        { ...market(utcDate - 2 * ETH_DAY_MS), asset: 'btc' },
      ] })
      if (url === ethEndpoints.staking) return Response.json({
        slot, executionBalancesSum: (170_000_000n * 10n ** 18n).toString(),
        beaconBalancesSum: (40_000_000n * 10n ** 9n).toString(),
        beaconDepositsSum: (90_000_000n * 10n ** 9n).toString(),
      })
      if (url === ethEndpoints.burn) return Response.json({
        d7: { timestamp: new Date(now).toISOString(), sum: { eth: burnUnavailable ? -1 : 0 } },
      })
      assert.equal(url, ethEndpoints.daily)
      return Response.json({ data: {
        ethereum: daily([[1_728_000, utcDate], [1_728_000, day - 2 * ETH_DAY_MS], [1, day]], 2.5, 310_000, 100_000_000),
        all_l2s: daily([[17_280_000, utcDate], [null, day - 2 * ETH_DAY_MS], [1, day]], 75, 200_000, null),
      } })
    }
    try {
      const eth = await getEth()
      assert.equal(eth.meta.freshness, 'fresh')
      assert.deepEqual(eth.data.ecosystem.map(point => point.tps), [180, 200])
      assert.deepEqual(eth.data.mainnet, { asOf: now - 2000, tps: 20, blockTimeSeconds: 12.1, medianTransactionFeeUsd: 0 })
      assert.deepEqual(eth.data.daily, [{
        day: utcDate, mainnetTps: 20, layer2Tps: 200, gasThroughputMgasPerSecond: { mainnet: 2.5, layer2: 75 },
        feesPaidUsdPerDay: { mainnet: 310_000, layer2: 200_000 }, stablecoinSupplyUsd: undefined, layer2SettlementUsdPerDay: 0,
      }])
      assert.deepEqual(eth.data.market, [
        { day: utcDate - ETH_DAY_MS, priceUsd: 2400.5, marketCapUsd: 289e9, supplyEth: 120_200_000.125, activeAddresses: 800_123, issuanceEth: undefined },
        { day: utcDate, priceUsd: 2400.5, marketCapUsd: 289e9, supplyEth: 120_200_000.125, activeAddresses: 800_123, issuanceEth: 2190 },
      ])
      assert.deepEqual(eth.data.staking, { asOf: (1_606_824_023 + slot * 12) * 1000, validatorBalanceEth: 40e6, supplyEth: 120e6 })
      assert.deepEqual(eth.data.burn, { asOf: now, sevenDayEth: 0 })
      assert.equal((await getEth()).meta.freshness, 'cached')
      assert.equal(seen.length, 6)
      unavailable = true
      burnUnavailable = true
      const degraded = await getEth({ force: true })
      assert.equal(degraded.meta.freshness, 'partial')
      assert.deepEqual(degraded.errors.map(error => error.operation), ['mainnet', 'burn'])
      assert.deepEqual(degraded.data.mainnet, eth.data.mainnet)
      assert.deepEqual(degraded.data.burn, eth.data.burn)
      const legacy = { asOf: now - 3000, tps: 19 }
      await cache.set('eth:mainnet', legacy, 30_000)
      await cache.delete('eth:mainnet:2')
      const upgraded = await getEth()
      assert.equal(upgraded.meta.freshness, 'partial')
      assert.deepEqual(upgraded.data.mainnet, legacy)
      console.log('PASS Ethereum: UTC alignment, market and staking units, zero burn and settlement, cache reuse, fallback to saved and pre-upgrade snapshots')
    } finally { globalThis.fetch = fetchOriginal }
  }

  if (process.argv.includes('--live')) {
    const live = new DiversifiedData(new DiversifiedHttp(), new TtlCache())
    for (const symbol of ['BTC-USD', 'ETH-USD']) {
      const result = await live.spot(symbol)
      assert.ok(result && result.value.price > 0, `No live spot quote for ${symbol}`)
      console.log(`PASS live ${symbol}: ${result.value.source}`)
    }
    const macro = new PublicMacroClient(new DiversifiedHttp(), new TtlCache())
    for (const provider of ['world-bank', 'imf'] as const) {
      const points = await macro.series(provider)
      assert.ok(points.length > 2)
      console.log(`PASS live ${provider}: ${points.length} annual observations through ${points.at(-1)![0]}`)
    }
  }
} finally {
  closeYahooWorker()
  await cache.close()
  for (const name of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (previous[name] === undefined) delete process.env[name]
    else process.env[name] = previous[name]
  }
  await rm(directory, { recursive: true, force: true })
}
