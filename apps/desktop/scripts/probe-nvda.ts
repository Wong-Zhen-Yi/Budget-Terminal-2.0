import assert from 'node:assert/strict'
import { TtlCache } from '../electron/services/cache.js'
import { discoverNvdaRelease, fetchNvdaEarnings, getNvda, parseNvdaCommentary } from '../electron/services/nvda.js'
import { nvdaFixture } from './fixtures/nvda.js'

const { earnings, market } = nvdaFixture()
assert(earnings && market)
const archive = `<a href="${earnings.releaseUrl.replace('third-quarter', 'second-quarter')}">Results</a>
<a href="${earnings.releaseUrl}">Results</a>`
const release = discoverNvdaRelease(archive)
assert.equal(release.url, earnings.releaseUrl)
const commentary = `GAAP
($ in billions, except earnings per share) Q3 FY27 Q2 FY27 Q3 FY26 Q/Q* Y/Y*
Revenue $115.8 $96.2 $57.0 20 % 103 %
Gross margin 74.8 % 75.0 % 73.4 % (0.2) pts 1.4 pts
Operating income $77.5 $63.7 $36.0 22 % 115 %
Diluted earnings per share $2.70 $2.46 $1.30 10 % 108 %
Non-GAAP
Revenue by Market Platform
($ in billions) Q3 FY27 Q2 FY27 Q3 FY26 Q/Q* Y/Y*
Data Center $107.6 $89.0 $51.2 21 % 110 %
Hyperscale 60.1 48.7 35.1 23 % 71 %
AI Clouds, Industrial, &
Enterprise
47.5 40.3 16.1 18 % 195 %
Edge Computing 8.2 7.2 5.8 14 % 42 %
Total $115.8 $96.2 $57.0 20 % 103 %
Revenue is expected to be $130.0 billion, plus or minus 3%.`
assert.deepEqual(parseNvdaCommentary(commentary, earnings.sourceUrl, release), earnings)
assert.throws(() => parseNvdaCommentary(commentary.replace('60.1', '65.1'), earnings.sourceUrl, release), /does not reconcile/)
assert.throws(() => parseNvdaCommentary(commentary.replace('Q3 FY26', 'FY26'), earnings.sourceUrl, release), /columns changed/)
const storage = new TtlCache()
const fetchMarket = async (symbol: string) => {
  assert.equal(symbol, 'NVDA')
  return { payload: market, failures: [] }
}
const live = process.argv.includes('--live')
const loadEarnings = live ? fetchNvdaEarnings : async () => earnings
const fresh = await getNvda({}, { earnings: loadEarnings, market: fetchMarket }, storage)
assert.equal(fresh.meta.freshness, 'fresh', fresh.meta.failureReason ?? 'Expected both lanes to load')
assert.equal(fresh.data.earnings?.quarters.length, 3)
if (live) console.log(fresh.data.earnings?.quarters[0].period, fresh.data.earnings?.sourceUrl)
const outage = async () => { throw Error('Commentary offline') }
const stale = await getNvda({ force: true }, { earnings: outage, market: fetchMarket }, storage)
assert.equal(stale.meta.freshness, 'stale')
assert.deepEqual(stale.data.earnings, fresh.data.earnings)
assert.equal(stale.data.laneFetchedAt.earnings, fresh.data.laneFetchedAt.earnings)
assert.match(stale.meta.failureReason ?? '', /Commentary offline/)
const partial = await getNvda({}, { earnings: outage, market: fetchMarket }, new TtlCache())
assert.equal(partial.meta.freshness, 'partial')
assert.equal(partial.data.earnings, null)
assert.equal(partial.data.market?.symbol, 'NVDA')
console.log('PASS: NVDA fiscal columns, market mix, guidance, lane failures and stale fallback')
