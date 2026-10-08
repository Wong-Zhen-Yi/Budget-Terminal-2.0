/** Public feed verification in one process so every Yahoo call shares its rate gate. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { TABS } from '../electron/shared/contract.js'
import type { Envelope } from '../electron/shared/contract.js'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'out', 'maintenance')
const scratch = await mkdtemp(join(tmpdir(), 'budget-maintenance-live-'))
process.env.APPDATA = join(scratch, 'roaming')
process.env.LOCALAPPDATA = join(scratch, 'local')
process.env.BUDGET_TERMINAL_DATA_DIR = join(scratch, 'roaming', 'BudgetTerminalElectron')
delete process.env.ELECTRON_RUN_AS_NODE
const { yahooProvider: provider } = await import('../electron/services/provider.js')
const { getBitcoin } = await import('../electron/services/bitcoin.js')
const { getForexQuotes, getForexHistory, getForexNews } = await import('../electron/services/forex.js')
const { cache } = await import('../electron/services/cache.js')
const { yahoo, paced } = await import('../electron/services/yahoo/client.js')
const only = process.argv.find(value => value.startsWith('--only='))?.slice(7).split(',')
const fullScans = process.argv.includes('--full-scans')
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
const datePart = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value
const year = Number(datePart('year'))
const month = Number(datePart('month'))
const today = `${datePart('year')}-${datePart('month')}-${datePart('day')}`
interface Task { name: string; pages: string[]; run: () => Promise<Envelope<unknown>>; check?: (result: Envelope<unknown>) => void }
const positions = [{ ticker: 'AAPL', shares: 1 }]
const tasks: Task[] = [
  { name: 'quotes', pages: ['dashboard', 'portfolio', 'personal-finance'], run: () => provider.quotes({ holdings: ['AAPL', 'SPY'] }), check: result => {
    const data = result.data as Awaited<ReturnType<typeof provider.quotes>>['data']
    assert.ok(data.holdings.AAPL?.price > 0, 'AAPL quote must be available')
  } },
  { name: 'chart', pages: ['dashboard'], run: () => provider.chart({ symbol: 'AAPL', timeframe: '1 Day' }) },
  { name: 'dashboardOptions', pages: ['dashboard'], run: () => provider.options({ symbol: 'AAPL' }) },
  { name: 'targets', pages: ['dashboard', 'portfolio'], run: () => provider.targets({ tickers: ['AAPL'] }) },
  { name: 'holdingNews', pages: ['dashboard', 'portfolio'], run: () => provider.news({ tickers: ['AAPL'] }) },
  { name: 'fundamentals', pages: ['portfolio'], run: () => provider.fundamentals({ tickers: ['AAPL'] }) },
  { name: 'returns', pages: ['portfolio'], run: () => provider.returns({ tickers: ['AAPL'], window: '1mo' }) },
  { name: 'momentum', pages: ['portfolio'], run: () => provider.momentum({ positions, cashAmount: 0, timeframe: '1mo' }) },
  { name: 'analytics', pages: ['portfolio'], run: () => provider.analytics({ positions, cashAmount: 0, currentValues: { AAPL: 100 }, benchmarkSymbol: 'SPY', lookback: '1y' }) },
  { name: 'fx', pages: ['personal-finance'], run: () => provider.fx({}) },
  { name: 'cardsPerformance', pages: ['cards'], run: () => provider.cardsPerformance({ interval: '30d', cards: [{ id: 'fixture', symbols: ['AAPL'], weighting: 'equal', weights: {}, shares: {}, cashBalance: 0 }] }) },
  { name: 'calendarMonth', pages: ['calendar'], run: () => provider.calendarMonth({ tickers: ['AAPL'], year, month }) },
  { name: 'earningsCalendar', pages: ['calendar'], run: () => provider.earningsCalendar({ startDate: today, endDate: `${year}-12-31`, rangeKey: `maintenance-${today}` }) },
  { name: 'globalMarkets', pages: ['global'], run: () => provider.globalMarkets({}) },
  { name: 'preMarket', pages: ['pre-market'], run: () => provider.preMarket({}) },
  { name: 'tradingVolumes', pages: ['trading-volumes', 'beta'], run: () => provider.tradingVolumes({}) },
  { name: 'heatmap', pages: ['heatmap'], run: () => provider.heatmap({ etf: 'SPY' }) },
  { name: 'upDown', pages: ['up-down'], run: () => provider.upDown({ source: 'custom', symbols: ['AAPL', 'MSFT'], interval: '1d' }) },
  { name: 'upDownTargets', pages: ['up-down'], run: () => provider.upDownTargets({ tickers: ['AAPL', 'MSFT'] }) },
  { name: 'sp500Market', pages: ['sp500'], run: () => provider.sp500({ part: 'market' }) },
  { name: 'sp500Constituents', pages: ['sp500'], run: () => provider.sp500({ part: 'constituents' }) },
  { name: 'sp500Valuation', pages: ['sp500'], run: () => provider.sp500({ part: 'valuation' }) },
  { name: 'sp500History', pages: ['sp500'], run: () => provider.sp500({ part: 'history' }) },
  { name: 'sp500Holdings', pages: ['sp500'], run: () => provider.sp500({ part: 'holdings' }) },
  { name: 'forexQuotes', pages: ['forex'], run: () => getForexQuotes({}) },
  { name: 'forexHistory', pages: ['forex'], run: () => getForexHistory({ pair: 'EUR/USD', range: '1M' }) },
  { name: 'forexNews', pages: ['forex'], run: () => getForexNews({ pair: 'EUR/USD' }) },
  { name: 'crypto', pages: ['crypto'], run: () => provider.crypto({}) },
  { name: 'bitcoin', pages: ['bitcoin'], run: () => getBitcoin({}) },
  { name: 'stocks', pages: ['stocks'], run: () => provider.stocks({ symbol: 'AAPL' }) },
  { name: 'fundamentalsPage', pages: ['fundamentals'], run: () => provider.fundamentalsPage({ symbol: 'AAPL' }) },
  { name: 'chartsHistory', pages: ['charts'], run: () => provider.chartsHistory({ symbol: 'AAPL', interval: '1 Day', range: '1Y' }) },
  { name: 'chartsCompare', pages: ['charts'], run: () => provider.chartsCompare({ symbols: ['AAPL', 'MSFT'], interval: '1 Day', range: '1Y' }) },
  { name: 'chartsRelationship', pages: ['charts'], run: () => provider.chartsRelationship({ symbols: ['AAPL', 'MSFT'], range: '1Y', rollingWindow: 30 }) },
  { name: 'valuation', pages: ['valuation'], run: () => provider.valuation({ symbol: 'AAPL', customPeers: ['MSFT'] }) },
  { name: 'optionsChain', pages: ['options'], run: () => provider.optionsChain({ symbol: 'AAPL' }) },
  { name: 'optionQuotes', pages: ['portfolio'], run: async () => {
    const chain = await provider.optionsChain({ symbol: 'AAPL' })
    const row = chain.data.rows.find(row => row.type === 'Call')
    if (!row) throw Error('No live Call contract available for tracked-mark validation')
    return provider.optionQuotes({ positions: [{ rowId: 'fixture', ticker: 'AAPL', expiry: row.expiration, strike: row.strike, strategy: 'Long Call' }] })
  } },
  { name: 'optionsExpirations', pages: ['options'], run: () => provider.optionsExpirations({ symbol: 'AAPL' }) },
  { name: 'projections', pages: ['projections'], run: () => provider.projections({ symbol: 'AAPL', timeframe: '1 Day' }) },
  { name: 'etfHoldings', pages: ['etf'], run: () => provider.etfHoldings({ ticker: 'SPY' }) },
  { name: 'etfArbitrage', pages: ['etf'], run: () => provider.etfArbitrage({ ticker: 'SPY' }) },
  { name: 'etfAum', pages: ['etf'], run: () => provider.etfAum({}) },
  ...(['bmnr', 'sofi', 'mu', 'amzn', 'avgo', 'vst', 'hood', 'hims', 'gold', 'oil', 'money', 'economic'] as const)
    .map(name => ({ name, pages: name === 'economic' ? ['economic', 'bonds'] : [name], run: () => provider[name]({}) })),
  { name: 'discovery', pages: ['stock-discovery'], run: () => provider.discovery({ symbol: 'AAPL' }) },
  { name: 'signals', pages: ['signals'], run: () => provider.signals({}) },
  { name: 'quantPair', pages: ['quant'], run: () => provider.quantPair({ left: 'AAPL', right: 'MSFT' }) },
  { name: 'priceScreen', pages: ['price'], run: () => provider.priceScreen({ minimumPrice: 5, maximumPrice: 10 }) },
  { name: 'marketCap', pages: ['market-cap'], run: () => provider.marketCap({ tier: 'mega' }) },
  { name: 'backtest', pages: ['backtest'], run: () => provider.backtest({ rows: [{ symbol: 'AAPL', weight: 100 }], compareSymbol: 'SPY', interval: '1D', range: '1Y' }) },
  { name: 'newsPage', pages: ['news'], run: () => provider.newsPage({ tickers: ['AAPL'] }) },
  { name: 'newsThumbnail', pages: ['news'], run: async () => {
    const news = await provider.newsPage({ tickers: ['AAPL'] })
    const article = news.data.articles.find(article => article.imageUrl)
    if (!article) throw Error('No live article image available to validate')
    return provider.newsThumbnail({ url: article.imageUrl })
  } },
  { name: 'newsArticle', pages: ['news'], run: async () => {
    const news = await provider.newsPage({ tickers: ['AAPL'] })
    const article = news.data.articles[0]
    if (!article) throw Error('No live article available to validate')
    return provider.newsArticle({ url: article.url, title: article.title, summary: article.summary })
  } },
  { name: 'ipoUpcoming', pages: ['ipo'], run: () => provider.ipoUpcoming({}) },
  { name: 'ipoCompleted', pages: ['ipo'], run: () => provider.ipoCompleted({ year }) },
  { name: 'institutions', pages: ['institutions'], run: () => provider.institutionActivity({ limit: 10 }) },
  { name: 'institutionTicker', pages: ['institutions'], run: () => provider.institutionTickerActivity({ symbol: 'AAPL' }) },
  { name: 'politics', pages: ['politics'], run: () => provider.politicsPage({ page: 1 }) },
  { name: 'youtube', pages: ['youtube'], run: () => provider.youtube({ tickers: ['AAPL'] }) },
  { name: 'youtubeThumbnail', pages: ['youtube'], run: async () => {
    const feed = await provider.youtube({ tickers: ['AAPL'] })
    const video = feed.data.items[0]
    if (!video) throw Error('No live video available to validate')
    return provider.youtubeThumbnail({ videoId: video.videoId, thumbnailUrl: video.thumbnailUrl })
  } },
  { name: 'treasurySource', pages: ['valuation'], run: async () => {
    const valuation = await provider.valuation({ symbol: 'AAPL', customPeers: ['MSFT'] })
    assert.ok(valuation.data.market, 'No Treasury valuation anchor available')
    const latest = async (kind: string) => {
      const observations = await Promise.all([year - 1, year].map(async observationYear => {
        const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${observationYear}/all?type=${kind}&field_tdr_date_value=${observationYear}&page&_format=csv`
        const response = await fetch(url, { signal: AbortSignal.timeout(25_000) })
        if (!response.ok) throw Error(`Independent Treasury source ${observationYear}: HTTP ${response.status}`)
        const lines = (await response.text()).trim().split(/\r?\n/)
        // Deliberately separate from the production parser for source reconciliation.
        const cells = (line: string) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(cell => cell.replace(/^"|"$/g, '').trim())
        const column = cells(lines[0]).findIndex(cell => /^10\s+yr$/i.test(cell))
        assert.ok(column > 0, 'Independent source has no 10Y column')
        return lines.slice(1).flatMap(line => {
          const row = cells(line)
          const date = row[0].match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
          if (!date || !row[column] || !Number.isFinite(Number(row[column]))) return []
          return [{ asOf: `${date[3]}-${date[1].padStart(2, '0')}-${date[2].padStart(2, '0')}`, rate: Number(row[column]), url }]
        })
      }))
      const result = observations.flat().sort((a, b) => b.asOf.localeCompare(a.asOf))[0]
      assert.ok(result, 'No independent Treasury observation')
      return result
    }
    const [nominal, real] = await Promise.all([latest('daily_treasury_yield_curve'), latest('daily_treasury_real_yield_curve')])
    const market = valuation.data.market
    assert.equal(market.asOf, nominal.asOf, 'Valuation and nominal source dates differ')
    assert.equal(market.riskFreeRate.toFixed(2), nominal.rate.toFixed(2), 'Valuation nominal yield differs at displayed precision')
    assert.equal(market.realRate?.toFixed(2), real.rate.toFixed(2), 'Valuation real yield differs at displayed precision')
    if (nominal.asOf === real.asOf) assert.ok(Math.abs((market.breakevenInflation ?? NaN) - (nominal.rate - real.rate)) < 1e-10)
    else assert.equal(market.breakevenInflation, null)
    return { data: { displayed: market, nominal, real, matched: true }, errors: [],
      meta: { ...valuation.meta, source: 'Independent US Treasury CSV reconciliation' } }
  } },
]
if (fullScans) tasks.push(
  { name: 'quantScan', pages: ['quant'], run: () => provider.quantScan({}) },
  { name: 'technicalScan', pages: ['technical-screen'], run: () => provider.technicalScan() },
)
interface Result { name: string; pages: string[]; status: 'passed' | 'degraded' | 'failed'; startedAt: string; durationMs: number; reason?: string; envelope?: Envelope<unknown> }
const results: Result[] = []
const runId = new Date().toISOString().replace(/[:.]/g, '-')
await mkdir(output, { recursive: true })
const report = join(output, `live-results-${runId}.json`)
const localPages = new Set(['settings', 'dictionary'])
function assertFinite(value: unknown, path = 'data'): void {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} contains a non-finite value`)
  else if (Array.isArray(value)) value.forEach((item, index) => assertFinite(item, `${path}[${index}]`))
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) assertFinite(item, `${path}.${key}`)
}
async function persist() {
  const pages = TABS.filter(page => page.implemented).map(page => ({ id: page.id, label: page.label,
    liveChecks: results.filter(result => result.pages.includes(page.id)).map(result => ({ name: result.name, status: result.status })),
    ...(localPages.has(page.id) ? { note: 'Local calculation/settings page; deterministic and UI checks apply.' }
      : !results.some(result => result.pages.includes(page.id)) ? { note: 'Live validation not yet completed.' } : {}) }))
  await writeFile(report, JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version,
    timezone: 'Asia/Singapore', isolated: true, fullScans, pages, results }, null, 2) + '\n')
}
try {
  for (const task of tasks.filter(task => !only || only.includes(task.name))) {
    const started = Date.now()
    console.log(`RUN: ${task.name}`)
    const record: Result = { name: task.name, pages: task.pages, status: 'failed', startedAt: new Date(started).toISOString(), durationMs: 0 }
    try {
      const result = await task.run()
      record.envelope = result
      assert.ok(result.meta.source && Number.isFinite(result.meta.fetchedAt), 'Missing source or retrieval timestamp')
      assert.ok(result.meta.fetchedAt <= Date.now() + 60_000, 'Future retrieval timestamp')
      assertFinite(result.data)
      if (result.meta.freshness === 'failed') throw Error(result.meta.failureReason || 'Provider returned failed data')
      task.check?.(result)
      record.status = ['stale', 'partial'].includes(result.meta.freshness) ? 'degraded' : 'passed'
      record.reason = result.meta.failureReason
      if (task.name === 'quotes') {
        const source = await paced(() => yahoo.quote('AAPL', {}, { validateResult: false }))
        const quote = (result.data as Awaited<ReturnType<typeof provider.quotes>>['data']).holdings.AAPL
        assert.ok(quote && source.regularMarketPrice !== undefined, 'Source quote unavailable')
        // Compare at displayed cents only when the market observation timestamp matches.
        const sourceTime = source.regularMarketTime instanceof Date ? source.regularMarketTime.getTime() : null
        if (quote.asOf === sourceTime) assert.equal(quote.price.toFixed(2), source.regularMarketPrice.toFixed(2), 'Displayed price differs from source quote')
        else record.reason = 'Source and displayed quote have different observation times; exact price comparison is not applicable.'
      }
    } catch (error) { record.status = 'failed'; record.reason = error instanceof Error ? error.message : String(error) }
    record.durationMs = Date.now() - started
    results.push(record)
    console.log(`${record.status.toUpperCase()}: ${task.name} (${record.durationMs}ms)${record.reason ? ' — ' + record.reason : ''}`)
    await persist()
  }
  console.log(`Public feed results: ${results.filter(result => result.status === 'passed').length} passed, ${results.filter(result => result.status === 'degraded').length} degraded, ${results.filter(result => result.status === 'failed').length} failed. ${report}`)
  if (results.some(result => result.status !== 'passed')) process.exitCode = 1
} finally {
  cache.close()
  const location = relative(tmpdir(), scratch)
  assert.ok(location && !location.startsWith('..') && resolve(tmpdir(), location) === scratch)
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
