import assert from 'node:assert/strict'

import type { GoldBuildInput } from '../electron/shared/gold.js'
import {
  buildGoldPayload,
  buildGoldSnapshot,
  emptyGoldMarket,
  goldValue,
  parseAboveGroundHtml,
  parseGoldDemandHtml,
  parseGoldEtfHtml,
  parseUsgsGoldText,
} from '../electron/shared/gold.js'
import { discoverDemandUrl, discoverEtfUrl, getGold } from '../electron/services/gold.js'

const demandFixture = `
<html><p>*Data as of 30 June 2026.</p><table><tbody>
<tr><td></td><td><strong>Q2'25</strong></td><td>Q3'25</td><td>Q4'25</td><td>Q1'26</td><td>Q2'26</td><td>q/q %</td><td>y/y %</td></tr>
<tr><td>Mine Production</td><td>947.7</td><td>1,028.1</td><td>986.6</td><td>901.3</td><td>965.6</td><td>7</td><td>2</td></tr>
<tr><td>Net Producer Hedging</td><td>-25.8</td><td>-0.2</td><td>-20.2</td><td>-22.1</td><td>-22.8</td><td>-</td><td>-</td></tr>
<tr><td>Recycled Gold</td><td>346.7</td><td>342.7</td><td>365.8</td><td>373.8</td><td>326.1</td><td>-13</td><td>-6</td></tr>
<tr><td>Total Supply</td><td>1,268.6</td><td>1,370.6</td><td>1,332.2</td><td>1,253.1</td><td>1,268.9</td><td>1</td><td>0</td></tr>
<tr><td>Jewellery Fabrication</td><td>354.2</td><td>420</td><td>438.9</td><td>332.1</td><td>310.3</td></tr>
<tr><td>Technology</td><td>78.6</td><td>81.7</td><td>82.1</td><td>81.6</td><td>80.4</td></tr>
<tr><td>Total Bar and Coin</td><td>315.6</td><td>328.4</td><td>428.1</td><td>476.8</td><td>307.1</td></tr>
<tr><td>ETFs &amp; Similar Products</td><td>171.1</td><td>225.7</td><td>175.7</td><td>62.4</td><td>-44.8</td></tr>
<tr><td>Central Banks &amp; Other inst.</td><td>177.9</td><td>226.3</td><td>208.2</td><td>56.5</td><td>288.9</td></tr>
<tr><td>OTC and Other</td><td>171.1</td><td>88.5</td><td>-0.9</td><td>243.7</td><td>327.1</td></tr>
<tr><td>Total Demand</td><td>1,268.6</td><td>1,370.6</td><td>1,332.2</td><td>1,253.1</td><td>1,268.9</td></tr>
<tr><td>LBMA Gold Price (US$/oz)</td><td>3,280.4</td><td>3,456.5</td><td>4,135.2</td><td>4,872.9</td><td>4,506.3</td></tr>
</tbody></table></html>`

const aboveFixture = `
<p><strong>Total above-ground stock (end-Q2 2026):</strong><br>222,600 tonnes</p>
<ol><li><strong>Jewellery</strong><br>~99,700t, 45%</li>
<li><strong>Central banks</strong><br>~39,000t, 18%</li>
<li><strong>Bars, coins &amp; gold ETFs</strong><br>Bars and coins: ~47,800t, 21%<br>Gold ETFs: ~4,000t, 2%</li>
<li><strong>OTC &amp; other</strong><br>OTC: ~10,000t, 4%<br>Other: ~22,100t, 10%</li></ol>
<p><strong>Below-ground</strong><br>5. Reserves: ~61,000t<br>6. Resources: ~114,400t</p>`

const etfFixture = `
<h1>Gold ETF Flows: July 2026</h1><p>Published: 6 August, 2026</p>
<p>Global investors added gold ETFs back to their portfolios in July, resulting in US$3bn net inflows.</p>
<p>Global gold ETFs’ AUM rose 1% to US$530bn, and their collective holdings rebounded by 23t to 4,068t.</p>
<p>*As of 31 July 2026.</p>`

const usgsFixture = `
World Mine Production and Reserves: Reserves were revised.
Mine production   Reserves 10
2024   2025 e
United States   163   160   3,000
Australia   284   280   11 13,000
Brazil   e 82   80   2,500
China   377   380   3,200
Other countries   1,020   1,000   11,000
World total (rounded)   3,280   3,300   66,000
World Resources:
`

function market() {
  return {
    futuresPrice: goldValue(4_500, 'usdPerOz', '2026-09-02', 'Yahoo Finance', 'live'),
    futuresChangePct: goldValue(1.25, 'percent', '2026-09-02', 'Yahoo Finance', 'live'),
    gldPrice: goldValue(420, 'usd', '2026-09-02', 'Yahoo Finance', 'live'),
    gldChangePct: goldValue(1.1, 'percent', '2026-09-02', 'Yahoo Finance', 'live'),
  }
}

function offline(): void {
  const demandUrl = 'https://www.gold.org/goldhub/research/gold-demand-trends/gold-demand-trends-q2-2026'
  const quarterly = parseGoldDemandHtml(demandFixture, demandUrl)
  assert(quarterly)
  assert.equal(quarterly.asOf, '2026-06-30')
  assert.equal(quarterly.periods.length, 5)
  assert.equal(quarterly.periods[4].producerHedging, -22.8)
  assert.equal(quarterly.periods[4].etfDemand, -44.8)
  assert.equal(quarterly.periods[4].totalDemand, 1_268.9)
  assert.equal(quarterly.periods[4].averagePrice, 4_506.3)
  assert.equal(parseGoldDemandHtml('<table><tr><td>Nothing</td></tr></table>', demandUrl), null)

  const above = parseAboveGroundHtml(aboveFixture)
  assert(above)
  assert.equal(above.asOf, '2026-Q2')
  assert.equal(above.total.value, 222_600)
  assert.equal(above.slices.length, 4)
  assert.equal(above.slices.find((entry) => entry.label.includes('Bars'))?.tonnes, 51_800)
  assert.equal(above.reconciliationGap, 0)
  assert.equal(above.belowGroundReserves.value, 61_000)

  const etfUrl = 'https://www.gold.org/goldhub/research/gold-etfs-holdings-and-flows/2026/08'
  const etf = parseGoldEtfHtml(etfFixture, etfUrl)
  assert(etf)
  assert.equal(etf.asOf, '2026-07-31')
  assert.equal(etf.holdings.value, 4_068)
  assert.equal(etf.monthlyDemand.value, 23)
  assert.equal(etf.monthlyFlowUsd.value, 3e9)
  assert.equal(etf.aum.value, 530e9)
  const outflow = parseGoldEtfHtml(
    '<p>Published: 8 July, 2026</p><p>US$8.9bn net outflows.</p><p>AUM fell to US$526bn and collective holdings reduced by 74t to 4,047t.</p>',
    etfUrl,
  )
  assert.equal(outflow?.monthlyFlowUsd.value, -8.9e9)
  assert.equal(outflow?.monthlyDemand.value, -74)

  const mining = parseUsgsGoldText(usgsFixture, 'https://pubs.usgs.gov/mcs.pdf')
  assert(mining)
  assert.equal(mining.asOf, '2025')
  assert.equal(mining.rows.find((row) => row.country === 'Australia')?.reserves, 13_000)
  assert.equal(mining.rows.find((row) => row.country === 'Brazil')?.estimated, true)
  assert.equal(mining.rows.find((row) => row.country === 'World total')?.production, 3_300)

  const input: GoldBuildInput = {
    fetchedAt: '2026-09-02T00:00:00',
    market: market(),
    quarterly,
    aboveGround: above,
    etf,
    mining,
  }
  const payload = buildGoldPayload(input)
  assert.equal(payload.derived.latestSupply.value, 1_268.9)
  assert.equal(payload.derived.stockToFlow.frequency, 'derived')
  assert.equal(payload.derived.stockToFlow.value, 222_600 / 3_300)
  assert(Object.values(payload.progress).every((state) => state === 'loaded'))
  assert(buildGoldSnapshot(payload).includes('Public headline extracts only'))

  const lanes: Array<keyof Pick<GoldBuildInput, 'quarterly' | 'aboveGround' | 'etf' | 'mining'>> = [
    'quarterly',
    'aboveGround',
    'etf',
    'mining',
  ]
  for (const missing of lanes) {
    const partial = buildGoldPayload({ ...input, [missing]: null })
    const progressKey = missing === 'quarterly' ? 'demand' : missing
    assert.equal(partial.progress[progressKey], 'unavailable')
  }
  const noMarket = buildGoldPayload({ ...input, market: emptyGoldMarket() })
  assert.equal(noMarket.progress.market, 'unavailable')

  assert.equal(
    discoverDemandUrl(`<a href="/goldhub/research/gold-demand-trends/gold-demand-trends-q4-2025"></a><a href="/goldhub/research/gold-demand-trends/gold-demand-trends-q2-2026"></a>`),
    demandUrl,
  )
  assert.equal(
    discoverEtfUrl([
      '<loc>https://www.gold.org/goldhub/research/gold-etfs-holdings-and-flows/2026/07</loc>',
      '<loc>https://www.gold.org/goldhub/research/gold-etfs-holdings-and-flows/2026/08</loc>',
    ]),
    etfUrl,
  )
  console.log('offline: all Gold assertions passed')
}

async function live(): Promise<void> {
  const { payload, errors } = await getGold(true)
  console.log('\n=== Gold live ===')
  console.log(`lanes: ${JSON.stringify(payload.progress)}`)
  console.log(`quarter: ${payload.quarterly?.periods.at(-1)?.period ?? 'unavailable'}`)
  console.log(`above ground: ${payload.aboveGround?.total.value ?? 'unavailable'}t`)
  console.log(`mining rows: ${payload.mining?.rows.length ?? 0}`)
  console.log(`ETF holdings: ${payload.etf?.holdings.value ?? 'unavailable'}t`)
  console.log(`GC=F: ${payload.market.futuresPrice.value ?? 'unavailable'}`)
  for (const error of errors) console.log(`warning: ${error.symbol}: ${error.reason}`)
  assert(Object.values(payload.progress).some((state) => state === 'loaded'), 'at least one live lane should load')
  if (payload.quarterly) assert.equal(payload.quarterly.periods.length, 5)
  if (payload.mining) assert(payload.mining.rows.some((row) => row.country === 'World total'))
  console.log('live: Gold probe completed')
}

offline()
if (!process.argv.includes('--offline')) await live()
