import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { anthropicResearch, anthropicReviewReasons, parseAnthropicNews } from '../electron/shared/anthropic.js'
import { TABS } from '../electron/shared/contract.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { requiredPermissions } from '../mcp/permissions.js'
import { anthropicCommitmentBuckets, anthropicComputeSeries } from '../electron/shared/anthropicCharts.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-anthropic-'))
process.env.APPDATA = join(scratch, 'roaming')
process.env.LOCALAPPDATA = join(scratch, 'local')
process.env.BUDGET_TERMINAL_DATA_DIR = join(scratch, 'data')
const { getAnthropic, anthropicDocumentHash } = await import('../electron/services/anthropic.js')
const { TtlCache, cache } = await import('../electron/services/cache.js')
const { anthropicReviewedHashes } = await import('../electron/shared/anthropicReviewedHashes.js')
try {
  assert(TABS.some(tab => tab.id === 'anthropic' && tab.implemented))
  assert.equal(workspaceFor('anthropic')?.id, 'focus')
  assert(startupPages('dashboard', [], []).includes('anthropic'))
  assert.deepEqual(requiredPermissions('anthropic'), ['marketResearch'])
  const research = anthropicResearch()
  assert.equal(research.topics.length, 5)
  for (const topic of research.topics) for (const fact of topic.facts) assert(research.sources.some(source => source.id === fact.source))
  assert.equal(research.quarters.length, 7)
  assert(research.quarters.every(row => row.revenue > 0 && row.compute > 0))
  assert.equal(research.quarters.at(-1)?.revenue, 17)
  const ratios = anthropicComputeSeries(research.quarters)
  assert.equal(ratios[0].spendPerRevenue, 2.25)
  assert(Math.abs(ratios.at(-1)!.revenuePerSpend! - 17 / 9.9) < 1e-10)
  assert.deepEqual(anthropicComputeSeries([{ period: 'missing', revenue: 0, compute: 0 }])[0], { period: 'missing', spendPerRevenue: null, revenuePerSpend: null })
  assert.equal(anthropicComputeSeries([{ period: 'bad', revenue: NaN, compute: 1 }])[0].spendPerRevenue, null)
  const buckets = anthropicCommitmentBuckets(research.capitalSnapshot)
  assert.deepEqual(buckets.map(row => Number(row.value.toFixed(1))), [70.7, 380.9, 448.4])
  assert.equal(buckets.reduce((total, row) => total + row.value, 0), 900)
  assert.deepEqual(anthropicCommitmentBuckets({ ...research.capitalSnapshot, commitmentsThrough2030: 1000 }), [])
  assert.deepEqual(anthropicCommitmentBuckets({ ...research.capitalSnapshot, commitmentsNext12Months: -1 }), [])
  assert.equal(research.capitalSnapshot.cash + research.capitalSnapshot.shortTermInvestments, 132)
  assert(research.sources.some(source => source.id === research.capitalSnapshot.source))
  assert(research.sources.some(source => source.id === research.operatingMetrics.source))
  assert.deepEqual(anthropicReviewReasons(research, Date.parse('2026-11-16')), [])
  assert(anthropicReviewReasons(research, Date.parse('2026-11-22')).includes('Scheduled weekly research review is due.'))
  const newsRows = [{ title: 'Claude &amp; research', slug: { current: 'release' }, articleType: 'news', publishedOn: '2026-11-16' }, { title: 'Bad URL', slug: { current: 'javascript:alert(1)' }, articleType: 'news', publishedOn: '2026-11-17' }]
  const news = '<a href="/news/release">Release</a><script>self.__next_f.push(' + JSON.stringify([1, '1:' + JSON.stringify(newsRows) + '\n']) + ')</script>'
  assert.deepEqual(parseAnthropicNews(news), [{ title: 'Claude & research', url: 'https://www.anthropic.com/news/release', date: '2026-11-16' }])
  const cards = '<article><time>Oct 26, 2026</time><a href="/news/s1-sec"><h3>Registration filing</h3><p>Description is not the title.</p></a></article><article><time>Oct 27, 2026</time><a href="/news/partner"><h3>Partner news</h3></a></article>'
  assert.deepEqual(parseAnthropicNews(cards).map(row => [row.title, row.date]), [['Partner news', '2026-10-27'], ['Registration filing', '2026-10-26']])
  assert.throws(() => parseAnthropicNews('<html>Bot challenge</html>'))
  const document = '<main><h1>Research</h1>' + '<p>Reviewed policy content.</p>'.repeat(20) + '</main>'
  assert.equal(anthropicDocumentHash(document), anthropicDocumentHash('<script>random()</script>' + document))
  assert.throws(() => anthropicDocumentHash('<html>Unavailable</html>'))
  const storage = new TtlCache()
  let documents = 0, filings = 0, fail = false
  const fetchers = {
    document: async (url: string) => { documents++; if (fail) throw Error('HTTP 503'); return url.endsWith('/news') ? news : document },
    filings: async () => { filings++; if (fail) throw Error('SEC unavailable'); return { filings: [{ accessionNumber: 'new-filing', form: 'S-1/A', filedDate: '2026-11-16', reportPeriod: '', description: 'Registration amendment', items: '', documentUrl: 'https://www.sec.gov/Archives/edgar/data/2130357/new/filing.htm' }], warnings: [], freshness: 'fresh' as const } },
  }
  const first = await getAnthropic({}, fetchers, storage)
  assert.equal(first.meta.freshness, 'fresh')
  assert.equal(first.data.checks.length, 5)
  assert(first.data.checks.filter(check => check.changed).length === 3)
  assert(first.data.reviewReasons.some(reason => reason.includes('New announcements')))
  assert(first.data.reviewReasons.some(reason => reason.includes('SEC filings')))
  assert.equal(first.data.reviewedAt, research.reviewedAt)
  const second = await getAnthropic({}, fetchers, storage)
  assert.equal(second.meta.freshness, 'cached')
  assert.equal(documents, 4); assert.equal(filings, 1)
  fail = true
  const stale = await getAnthropic({ force: true }, fetchers, storage)
  assert.equal(stale.meta.freshness, 'stale')
  assert.equal(stale.data.announcements.length, 1)
  assert.equal(stale.data.checks.length, 5)
  assert.equal(stale.errors.length, 5)
  assert.equal(stale.data.checks[0].checkedAt, first.data.checks[0].checkedAt)
  const unavailable = await getAnthropic({ force: true }, fetchers, new TtlCache())
  assert.equal(unavailable.meta.freshness, 'partial')
  assert.equal(unavailable.data.topics.length, 5, 'Reviewed dossier must work offline')
  assert(unavailable.data.checks.every(check => check.checkedAt === null && check.error))
  assert(Object.values(anthropicReviewedHashes).every(hash => /^[a-f0-9]{64}$/.test(hash)))
  if (process.argv.includes('--live')) {
    const live = await getAnthropic({ force: true })
    console.log(JSON.stringify({ meta: live.meta, checks: live.data.checks, latestAnnouncements: live.data.announcements.slice(0, 4), latestFilings: live.data.filings.slice(0, 3), reviewReasons: live.data.reviewReasons }, null, 2))
    assert.equal(live.errors.length, 0, JSON.stringify(live.errors))
    assert(live.data.announcements.length >= 5, 'Live announcement coverage is unexpectedly small')
    assert.equal(live.data.announcements.find(row => row.url.endsWith('/news/s1-sec'))?.date, '2026-10-26')
    assert(live.data.filings.some(row => row.form === 'S-1/A'))
    assert(live.data.filings.some(row => row.form === 'FWP'))
  }
  console.log('PASS: Anthropic source parsing, review triggers, provenance, cache, stale fallback, startup and MCP permission')
} finally {
  await cache.close()
  const location = relative(tmpdir(), scratch)
  assert(location && !location.startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
