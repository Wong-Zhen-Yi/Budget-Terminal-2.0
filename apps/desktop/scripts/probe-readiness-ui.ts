import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
// TypeScript 7 ships its native compiler API separately; schema generation already
// owns the compatible JavaScript compiler used to inspect the same contracts.
import ts from 'ts-json-schema-generator/node_modules/typescript/lib/typescript.js'

const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-ready-ui-'))
const require = createRequire(import.meta.url)
const screenshots = join(root, 'out/maintenance')

// Derive empty, structurally valid payloads from the public IPC contract. The
// overrides below add known synthetic observations and exercise dependent loads.
const configuration = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root)
const program = ts.createProgram(parsed.fileNames, parsed.options)
const checker = program.getTypeChecker()
const contract = program.getSourceFile(join(root, 'electron/shared/contract.ts'))!
const declaration = contract.statements.find((statement): statement is ts.InterfaceDeclaration =>
  ts.isInterfaceDeclaration(statement) && statement.name.text === 'DesktopApi')!
const apiType = checker.getTypeAtLocation(declaration)
function empty(type: ts.Type, depth = 0): unknown {
  if (depth > 15) return null
  if (type.flags & ts.TypeFlags.Null) return null
  if (type.flags & ts.TypeFlags.Undefined) return undefined
  if (type.isUnion()) {
    const nullable = type.types.find((entry) => entry.flags & ts.TypeFlags.Null)
    const object = type.types.find((entry) => entry.flags & ts.TypeFlags.Object)
    return empty(object ?? nullable ?? type.types.find((entry) => !(entry.flags & ts.TypeFlags.Undefined))!, depth + 1)
  }
  if (type.isStringLiteral() || type.isNumberLiteral()) return type.value
  if (type.flags & ts.TypeFlags.String) return ''
  if (type.flags & ts.TypeFlags.Number) return 0
  if (type.flags & ts.TypeFlags.BooleanLike) return false
  if (checker.isArrayType(type) || checker.isTupleType(type)) return []
  return Object.fromEntries(checker.getPropertiesOfType(type)
    .filter((property) => !(property.flags & ts.SymbolFlags.Optional))
    .map((property) => [property.name, empty(checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? declaration), depth + 1)]))
}
const templates: Record<string, unknown> = {}
for (const property of checker.getPropertiesOfType(apiType)) {
  const signature = checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(property, declaration), ts.SignatureKind.Call)[0]
  if (signature) templates[property.name] = empty(checker.getAwaitedType(checker.getReturnTypeOfSignature(signature))!)
}
try {
  await mkdir(screenshots, { recursive: true })
  const assets = join(root, 'out/renderer/assets')
  const stylesheet = (await readdir(assets)).find((name) => name.endsWith('.css'))
  assert(stylesheet, 'Run npm run build before the readiness UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, stylesheet)))
  const renderer = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { App } from './src/App'
    import { buildTasks } from './src/api/prefetch'
    import { applyEquityMarketUpdate } from './src/api/equityStream'
    import { backtestQuotesKey } from './src/api/backtestQueries'
    import { useDataHealth } from './src/stores/dataHealth'
    import { useAuthPrompt } from './src/stores/authPrompt'
    import { CloudSyncPanel } from './src/components/settings/CloudSyncPanel'
    import { useStocksPage } from './src/stores/stocks'
    import { useFundamentalsStore } from './src/stores/fundamentals'
    import { useCalendarPage } from './src/stores/calendar'
    import { useIpoPage } from './src/stores/ipo'
    import { useOptionsPage } from './src/stores/options'
    import { useEtfPage } from './src/stores/etf'
    import { useChartsStore } from './src/stores/charts'
    import { useDashboard } from './src/stores/dashboard'
    import { useValuationPage } from './src/stores/valuation'
    import { useProjectionsPage } from './src/stores/projections'
    import { registerSnapshot } from './src/api/snapshotHealth'
    import { manageQueryMemory, QUERY_IDLE_MS } from './src/api/queryMemory'
    import { queryFreshness } from './src/api/queryPersistence'
    import { MACRO_SYMBOLS, TABS } from './electron/shared/contract'
    import { MOBILE_DIRECT_SERVE_COMMAND, MOBILE_SERVE_COMMAND } from './electron/shared/mobileAccess'
    import { DEFAULT_BACKTEST_PAGE_SETTINGS } from './electron/shared/backtest'
    import { DEFAULT_QUANT_PAGE_SETTINGS } from './electron/shared/quant'
    import { DEFAULT_YOUTUBE_PAGE_SETTINGS } from './electron/shared/youtube'
    import { DEFAULT_CACHE_SETTINGS } from './electron/shared/cachePolicy'
    import { anthropicResearch } from './electron/shared/anthropic'
    import { buildRow, SERIES_BY_ID } from './electron/shared/economic'
    import { computeExposure, emptyRiskMetrics } from './electron/shared/analytics'
    const check = (condition, message) => { if (!condition) throw Error(message) }
    const focusOnly = ${JSON.stringify(process.argv.includes('--focus'))}
    const wait = () => new Promise(resolve => setTimeout(resolve, 110))
    const visiblePage = id => [...document.querySelectorAll('[data-page-id]')].find(page => page.dataset.pageId === id && page.getBoundingClientRect().height > 0)
    const paint = async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    const subtabLabels = {
      portfolio: ['Stocks', 'Options', 'Portfolio Weight', 'Dip Finder', 'Pie Chart', 'Portfolio Heatmap', 'Momentum Tracker', 'Portfolio Metrics'],
      calendar: ['Calendar', 'Earnings'], fundamentals: ['Statements', 'SEC Filings'],
      charts: ['Main', 'Multi Charts', 'Compare', 'Relationship', 'Cheat Sheet'],
      valuation: ['Main', 'Scenarios', 'Peers', 'Risk', 'Trends', 'Notes', 'Sources'],
      options: ['Chain', 'Options by Top Volume', 'Options by Strike'], quant: ['Factor screener', 'Pairs lab'],
      economic: ['Overview', 'Inflation', 'Labor', 'Growth', 'Rates'],
      bmnr: ['Table', 'Chart'], gold: ['Table', 'Chart'], oil: ['Table', 'Chart'],
    }
    const coverage = []
    const selectPage = async tab => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await wait()
      const choice = [...document.querySelectorAll('[data-result-index]')].find(button => button.querySelector('span')?.textContent === tab.label)
      check(choice, 'Missing route: ' + tab.id)
      choice.click(); await wait(); await wait()
      check(visiblePage(tab.id), 'Wrong visible selected page: ' + tab.id)
    }
    const book = { id: 'main', name: 'Fixture', readOnly: false, tickers: ['AAPL'],
      holdings: { AAPL: { ticker: 'AAPL', shares: 1, avgPrice: 50, includeInWeight: true } },
      cashBalance: 100, marginDebt: 0, includeCashInWeight: true, options: [{ rowId: 'fixture-call', ticker: 'AAPL',
        strategy: 'Calls', expiry: '2026-12-18', strike: 100, contracts: 1, premium: 5, status: 'Open',
        openDate: '2026-10-01', currentPrice: 0, volume: 0, openInterest: 0, impliedVolatility: 0 }] }
    const settings = { clockCountry: 'US', time12h: true, tabOrder: TABS.map(tab => tab.id),
      hiddenTabs: [], enabledLabs: [], obscuredTabs: [], favoriteTabs: [], sidebarCollapsed: false, sourcePath: '',
      backtestPage: DEFAULT_BACKTEST_PAGE_SETTINGS, quantPage: DEFAULT_QUANT_PAGE_SETTINGS,
      signalsPage: { filter: 'all', setup: 'all', search: '' }, youtubePage: DEFAULT_YOUTUBE_PAGE_SETTINGS }
    const quote = symbol => ({ symbol, price: 100, absChange: 1, change: 1, currency: 'USD', asOf: Date.now() })
    const candles = [{ time: Math.floor(Date.now() / 1000) - 86400, open: 99, close: 100, high: 101, low: 98, volume: 1000 }]
    const ok = data => ({ data, errors: [], meta: { freshness: 'fresh', source: 'Synthetic readiness fixture', fetchedAt: Date.now() } })
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
    let populated = false, calls = [], fixtureSettings = settings, restoredCurrency = false
    let mobileEnabled = false, mobileHttpsReady = false, mobileDirectReady = false
    let fixtureAuth = { url: '', signedIn: false, encryptionAvailable: true, state: 'disconnected', pending: false }, authUnavailable = false, authRejected = false
    const fixture = (method, request = {}) => {
      request ??= {} // Native player teardown accepts null instead of a request object.
      if (method === 'mobileAccessStatus' || method === 'configureMobileAccess') {
        if (method === 'configureMobileAccess') mobileEnabled = request === true
        return { available: true, enabled: mobileEnabled, canSetUpLinks: mobileEnabled, url: mobileEnabled && mobileHttpsReady ? 'https://fixture.test-tailnet.ts.net:8443/' : '',
          directUrl: mobileEnabled && mobileDirectReady ? 'http://100.64.1.1:8081/' : '', message: mobileEnabled ? 'Mobile Access is on.' : 'Mobile Access is off.' }
      }
      if (method === 'cloudSyncStatus') {
        if (authUnavailable) throw Error('Synthetic account status outage')
        return ok(fixtureAuth)
      }
      if (method === 'cloudSyncCommand') {
        if (authRejected) return { ...ok(fixtureAuth), meta: { freshness: 'failed', failureReason: 'Synthetic sign-in failure. Try again.' } }
        fixtureAuth = { ...fixtureAuth, signInPending: ['signInGitHub', 'signInGoogle', 'revokeOtherSessions'].includes(request.type),
          credentialCleanupRequired: request.type === 'retryCredentialCleanup' ? false : fixtureAuth.credentialCleanupRequired,
          workspaceApprovalRequired: request.type === 'confirmWorkspace' ? false : fixtureAuth.workspaceApprovalRequired,
          message: request.type === 'signInGitHub' ? 'Complete GitHub sign-in in your browser.' : request.type === 'signInGoogle' ? 'Complete Google sign-in in your browser.' : undefined }
        return ok(fixtureAuth)
      }
      if (method === 'cacheStatus') {
        const part = { bytes: 0, entries: 0, expiredEntries: 0, evictions: 0 }
        return ok({ settings: DEFAULT_CACHE_SETTINGS, service: { market: part, assets: part,
          hits: 0, misses: 0, expired: 0, loads: 0, forced: 0, errors: 0 } })
      }
      if (method === 'mutateSettings') {
        if (request.type === 'setMainPage') fixtureSettings = { ...fixtureSettings, mainPage: request.id ?? undefined }
        if (request.type === 'setLabEnabled') {
          const others = fixtureSettings.enabledLabs.filter(id => id !== request.id)
          fixtureSettings = { ...fixtureSettings, enabledLabs: request.enabled ? [...others, request.id] : others }
        }
        if (request.type === 'setBacktestPage') fixtureSettings = { ...fixtureSettings, backtestPage: request.value }
        if (request.type === 'setClockCountry') fixtureSettings = { ...fixtureSettings, clockCountry: request.code }
        if (request.type === 'setTime12h') fixtureSettings = { ...fixtureSettings, time12h: request.value }
        if (request.type === 'setTabHidden') fixtureSettings = { ...fixtureSettings, hiddenTabs: request.hidden ? [...fixtureSettings.hiddenTabs, request.id] : fixtureSettings.hiddenTabs.filter(id => id !== request.id) }
        if (request.type === 'setTabObscured') fixtureSettings = { ...fixtureSettings, obscuredTabs: request.obscured ? [...fixtureSettings.obscuredTabs, request.id] : fixtureSettings.obscuredTabs.filter(id => id !== request.id) }
        if (request.type === 'moveTab') {
          const order = [...fixtureSettings.tabOrder], index = order.indexOf(request.id), next = index + request.direction
          if (next >= 0 && next < order.length) [order[index], order[next]] = [order[next], order[index]]
          fixtureSettings = { ...fixtureSettings, tabOrder: order }
        }
        return ok(fixtureSettings)
      }
      if (method === 'settings') return ok(fixtureSettings)
      if (method === 'portfolio' || method === 'mutatePortfolio') return ok({ portfolios: populated ? [book] : [], activeId: populated ? 'main' : null, mainId: populated ? 'main' : null, sourcePath: '' })
      if (method === 'quotes') return ok({ macro: Object.fromEntries(MACRO_SYMBOLS.map(row => [row.label, quote(row.symbol)])), holdings: Object.fromEntries((request.holdings ?? []).map(symbol => [symbol, quote(symbol)])), missing: [] })
      if (method === 'returns') return ok({ returns: Object.fromEntries((request.tickers ?? []).map(symbol => [symbol, -5])) })
      if (method === 'momentum') return ok({ dates: [], candles: [], values: [], returns: [], emaPeriod: 10, ema: [],
        startDate: null, includedTickers: [], excludedTickers: [], reason: 'No common historical window' })
      if (method === 'analytics') return ok({ metrics: emptyRiskMetrics(), exposure: computeExposure(0, {}),
        benchmarkSymbol: request.benchmarkSymbol, lookback: request.lookback, startDate: null, endDate: null,
        historyPoints: 0, includedTickers: [], excludedTickers: [], note: '', reason: 'No common historical window' })
      if (method === 'optionQuotes') return ok({ quotes: Object.fromEntries((request.positions ?? []).map(position => [position.rowId,
        { currentPrice: 6, volume: 100, openInterest: 200, impliedVolatility: 0.3 }])), expiries: { AAPL: ['2026-12-18'] } })
      if (method === 'signals' || method === 'quantScan' || method === 'technicalScan') return ok(null)
      if (method === 'mcpStatus') return { available: true, tools: 1 }
      if (method === 'apiUsage') return { providers: [], sampledAt: Date.now() }
      if (method === 'appMetrics') return ok({ memory: [{ at: Date.now(), mainMiB: 100, rendererMiB: 200, otherMiB: 50 }], backup: { state: 'not-created' } })
      if (method === 'anthropic') return ok(anthropicResearch())
      let result = structuredClone(window.fixtureTemplates[method])
      if (!result || !('data' in result)) return result
      if (!result.data) result.data = {}
      result.meta = ok(null).meta
      const data = result.data
      if (focusOnly && method === 'economic') data.rows = [
        buildRow(SERIES_BY_ID.get('CPIAUCSL'), [['2025-09-01', 324.245], ['2026-09-01', 336.298]]),
        buildRow(SERIES_BY_ID.get('GDPC1'), [['2026-04-01', 24408.011], ['2026-07-01', 24611.077]]),
      ]
      if ('symbol' in data) data.symbol = request.symbol ?? 'AAPL'
      if ('ticker' in data) data.ticker = request.ticker ?? request.symbol ?? 'AAPL'
      if ('fetchedAt' in data) data.fetchedAt = typeof data.fetchedAt === 'string' ? new Date().toISOString() : Date.now()
      if ('candles' in data) data.candles = candles
      const stats = { symbol: request.symbol ?? 'AAPL', price: 123.45, absChange: -2.5, change: -1.98,
        open: 124, high: 125, low: 123, close: 123.45, volume: 100, currency: restoredCurrency ? 'EUR' : 'USD', longName: 'Synthetic quote' }
      if (method === 'stocks') { data.chart.stats = stats; data.chart.candles = candles }
      if (method === 'chart') data.stats = stats
      if (method === 'chartsHistory') data.stats = { ...stats, currency: restoredCurrency ? 'GBp' : 'USD' }
      if ('expiry' in data) data.expiry = request.expiry || '2026-12-18'
      if (method === 'chart') { data.symbol = request.symbol; data.timeframe = request.timeframe }
      if (method === 'chartsHistory') { data.intervalLabel = request.interval; data.range = request.range }
      if (method === 'fundamentalsPage') { data.displayCurrency = 'USD'; data.currencyVersion = 2; data.generatedAt = Date.now() }
      if (method === 'upDown') {
        data.source = request.source; data.interval = request.interval; data.forceTargets = false
        data.rows = Array.from({ length: 25 }, (_, i) => ({ ticker: 'FIX' + i, name: 'Target fixture', lastClose: 100,
          intervalReturn: 1, tradingDays: 1, daysUp: 1, daysDown: 0, flatDays: 0 }))
      }
      if (method === 'upDownTargets') {
        data.targets = Object.fromEntries(request.tickers.map(ticker => [ticker, 120])); data.resolved = request.tickers.length; data.available = request.tickers.length
      }
      if (method === 'newsPage') {
        data.articles = [{ id: 'fixture-news', ticker: 'MSFT', title: 'Synthetic readiness headline', source: 'Fixture', summary: 'Synthetic story', publishedAt: Date.now(), time: '', url: 'https://example.com/fixture', imageUrl: 'https://example.com/fixture.png', signals: [], score: 5, category: 'market' }]
      }
      if (method === 'youtube') {
        data.items = [{ ticker: 'AAPL', title: 'Synthetic readiness video', channel: 'Fixture', videoId: 'fixture1', url: 'https://www.youtube.com/watch?v=fixture1', thumbnailUrl: 'https://example.com/video.png', viewCount: 10000, viewCountText: '10K', publishedText: '2026-10-06', publishedDays: 1, publishedDaysText: '1', durationText: '1:00', descriptionSnippet: 'Synthetic' }]
        data.tickersTotal = request.tickers?.length ?? 0; data.fetchedCount = data.tickersTotal
      }
      if (method === 'newsThumbnail' || method === 'youtubeThumbnail') data.dataUri = image
      if (method === 'newsThumbnail' && populated) {
        data.dataUri = ''
        result.meta.freshness = 'partial'
        result.meta.expiresAt = Date.now() + 30 * 60_000
        result.errors = [{ source: 'news image', operation: 'newsThumbnail', reason: 'HTTP 403: publisher denied image access' }]
      }
      if (method === 'discoveryUniverse') data.symbols = ['AAPL']
      if (method === 'discovery') { data.symbol = 'AAPL'; data.price = 100; data.previousClose = 99 }
      if (method === 'heatmap') {
        data.etf = request.etf
        data.holdings = [{ symbol: 'AAPL', name: 'Fixture security', sector: 'Technology', weight: 1, price: 102, changes: {},
          history: { dates: ['2026-10-06', '2026-10-07', '2026-10-08'], closes: [100, 101, 102] } }]
      }
      if (method === 'fx') data.usdSgd = 1.3
      if (method === 'calendarMonth') { data.year = request.year; data.month = request.month }
      if (method === 'forexHistory' || method === 'forexNews') data.pair = request.pair
      return result
    }
    let holdReload
    window.fixtureHandler = async (method, request) => {
      calls.push({ method, request })
      if (holdReload) await holdReload(method, request)
      return fixture(method, request)
    }
    window.runReadinessProbe = async () => {
      const element = document.getElementById('root')
      const reloadOnly = ${JSON.stringify(process.argv.includes('--reload'))}
      const agentsOnly = ${JSON.stringify(process.argv.includes('--agents'))}
      const refreshOnly = ${JSON.stringify(process.argv.includes('--refresh'))}
      const startupOnly = ${JSON.stringify(process.argv.includes('--startup-only'))}
      const mainPageOnly = ${JSON.stringify(process.argv.includes('--main-page'))}
      const authOnly = ${JSON.stringify(process.argv.includes('--auth-only'))}
      const scenarios = mainPageOnly ? ['empty', 'persisted'] : authOnly || focusOnly ? ['empty'] : reloadOnly ? ['populated'] : refreshOnly ? ['persisted'] : agentsOnly ? ['empty'] : ['empty', 'populated', 'persisted']
      for (const scenario of scenarios) {
        console.log('Completed-startup scenario: ' + scenario)
        populated = scenario !== 'empty'
        const restored = scenario === 'persisted'
        restoredCurrency = restored
        fixtureSettings = { ...settings, mainPage: restored ? 'calendar' : undefined,
          obscuredTabs: focusOnly ? ['anthropic'] : mainPageOnly && restored ? ['calendar'] : [],
          youtubePage: { sortColumn: restored ? 3 : -1, sortDescending: restored },
          backtestPage: restored ? { ...DEFAULT_BACKTEST_PAGE_SETTINGS, rows: [{ symbol: 'MSFT', weight: 100 }] } : DEFAULT_BACKTEST_PAGE_SETTINGS }
        useStocksPage.getState().setSymbol(restored ? 'MSFT' : 'AAPL')
        useFundamentalsStore.getState().setSymbol(scenario === 'empty' ? '' : restored ? 'MSFT' : 'AAPL')
        useChartsStore.setState({ symbol: restored ? 'MSFT' : 'AAPL', interval: restored ? '1 Week' : '1 Day', range: restored ? '5Y' : '1Y' })
        useDashboard.setState({ symbol: restored ? 'MSFT' : 'AAPL', timeframe: restored ? '1 Week' : '1 Day' })
        useValuationPage.getState().setTicker(restored ? 'MSFT' : 'AAPL')
        useProjectionsPage.getState().setSymbol(restored ? 'MSFT' : 'AAPL')
        useCalendarPage.setState({ initialized: restored, year: restored ? 2025 : 2026, month: restored ? 3 : 9, earningsYear: restored ? 2025 : 2026 })
        useIpoPage.setState({ completedYear: restored ? 2025 : 2026 })
        useOptionsPage.setState({ symbol: scenario === 'persisted' ? 'AAPL' : '', expiry: '', loaded: scenario === 'persisted' })
        useEtfPage.setState({ ticker: scenario === 'persisted' ? 'SPY' : '' })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, gcTime: QUERY_IDLE_MS } } })
        const memory = manageQueryMemory(client, { deferUntilStartup: true, maxBytes: 8192, maxQueries: 20, readScale: window.api.queryCacheMemoryScale })
        client.getQueryCache().subscribe(({query}) => registerSnapshot(query.state.data, queryFreshness(query.queryKey)))
        const rendered = createRoot(element)
        rendered.render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
        const deadline = Date.now() + 15000
        while ((!useDataHealth.getState().startup || useDataHealth.getState().startup.timings.length !== useDataHealth.getState().startup.planned || !useDataHealth.getState().startup.planned) && Date.now() < deadline) await wait()
        await wait()
        const startup = useDataHealth.getState().startup
        check(startup && startup.timings.length === startup.planned, 'Startup failed to complete: ' + scenario)
        check(Object.keys(startup.pages).length === TABS.filter(tab => tab.implemented).length, 'Startup omitted a page state')
        check(visiblePage(restored ? 'calendar' : 'dashboard-2'), 'Startup must open the saved main page or the default')
        if (focusOnly) {
          check(startup.pages['focus-dashboard']?.state === 'ready', 'Focus Dashboard was not ready at startup')
          document.querySelector('.auth-popup[open] .auth-popup-close')?.click()
          const obscure = document.querySelector('button[aria-label="Obscure mode"]')
          if (obscure.getAttribute('aria-pressed') === 'true') obscure.click()
          await wait()
          const focus = () => document.querySelector('nav[aria-label="Workspaces"] button[aria-label="Focus"]')
          const anthropicCalls = calls.filter(call => call.method === 'anthropic').length
          const economicCalls = calls.filter(call => call.method === 'economic').length
          check(anthropicCalls > 0 && economicCalls === 1, 'Anthropic and the shared Macro data must fetch at startup')
          focus().click(); await wait()
          const dashboard = visiblePage('focus-dashboard')?.querySelector('.focus-dashboard')
          check(dashboard, 'Focus workspace did not open the dashboard')
          const anthropic = dashboard.querySelector('#focus-metric-anthropic')
          const anthropicValues = () => [...anthropic.querySelectorAll('b')].map(item => item.textContent).join('|')
          check(anthropic && anthropicValues() === '$17.0B|$9.9B', 'Focus must display both warmed readings')
          const macroValues = [...dashboard.querySelectorAll('#focus-metric-macro b')].map(item => item.textContent).join('|')
          check(macroValues === '3.72%|3.37%', 'Focus must display both warmed Macro readings')
          check(calls.filter(call => call.method === 'anthropic').length === anthropicCalls, 'Opening Focus must not request the reading again')
          check(calls.filter(call => call.method === 'economic').length === economicCalls, 'Opening Focus must not repeat the shared Macro fetch')
          obscure.click(); await wait()
          check(anthropicValues() === '—|—', 'Focus must hide both readings for protected pages')
          obscure.click(); await wait()
          for (const [width, height] of [[1400, 950], [960, 600]]) {
            await window.resizeFixture(width, height); await paint()
            check(dashboard.scrollWidth <= dashboard.clientWidth && dashboard.scrollHeight <= dashboard.clientHeight,
              'Focus Dashboard must fit within ' + width + 'x' + height + ' (' +
              dashboard.scrollWidth + 'x' + dashboard.scrollHeight + ' content in ' +
              dashboard.clientWidth + 'x' + dashboard.clientHeight + ' available pixels)')
            const cards = [...dashboard.querySelectorAll('nav[aria-label="Focus pages"] button')]
            check(cards.length === 19, 'The Focus Dashboard is missing topic shortcuts')
            for (const card of cards) {
              const metrics = [...card.querySelectorAll('[data-focus-metric]')].map(item => item.getBoundingClientRect())
              check(metrics.length === 2 && metrics[0].right <= metrics[1].left && metrics[0].top === metrics[1].top,
                'Focus metrics must fit side by side for ' + card.getAttribute('aria-label'))
            }
          }
          const bitcoin = dashboard.querySelector('button[aria-label="Bitcoin"]')
          bitcoin.click(); await wait()
          check(visiblePage('bitcoin') && !visiblePage('focus-dashboard'), 'Bitcoin selected from Focus must use the normal page route')
          check(document.querySelector('.workspace-header h1')?.textContent === 'Bitcoin', 'Focus detail header did not update')
          const back = [...document.querySelectorAll('.workspace-header button')].find(button => button.textContent.includes('Focus Dashboard'))
          back.click(); await wait()
          check(visiblePage('focus-dashboard'), 'Focus detail shortcut did not return to the dashboard')
          memory.stop(); rendered.unmount(); client.clear()
          return 'PASS: Focus Dashboard uses warmed readings, honors Obscure mode, fits at 1400x950 and 960x600, and returns from detail pages'
        }
        if (authOnly) {
          const popup = () => document.querySelector('dialog.auth-popup[open]')
          const click = text => { const button = [...popup().querySelectorAll('button')].find(button => button.textContent.trim() === text); check(button && !button.disabled, 'Missing enabled auth button: ' + text); button.click() }
          const refreshAuth = async () => { await client.refetchQueries({ queryKey: ['cloudSyncStatus'] }); await wait() }
          check(popup() && popup().contains(document.activeElement), 'Signed-out startup must open and focus the popup')
          check(popup().textContent.includes('You’ll stay signed in on this device'), 'Persistent sign-in must be the default')
          check(!document.querySelector('input[type=password]'), 'OAuth sign-in must not collect passwords')
          check(!popup().querySelector('input[type=url]') && !popup().querySelector('button[type=submit]').disabled, 'A fresh install must offer sign-in without a URL field')
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await wait()
          check(!document.querySelector('[aria-label="Page search"]'), 'Workspace shortcuts escaped the auth popup')
          click('Sign up'); await wait()
          check(popup().textContent.includes('Create your account'), 'Sign-up mode missing')
          for (const [width, height] of [[1400, 950], [1366, 768], [1024, 768], [480, 700]]) {
            await window.resizeFixture(width, height); await paint()
            const element = popup(), bounds = element.getBoundingClientRect()
            check(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'Auth popup leaves the viewport at ' + width + 'x' + height)
            check(element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight + 1, 'Auth popup must fit without scrollbars at ' + width + 'x' + height)
          }
          await window.resizeFixture(1400, 950); await paint()
          await window.captureFixture('auth-sign-up')
          check([...popup().querySelectorAll('button')].some(button => button.textContent.trim() === 'Continue with Google'), 'Google sign-in must be available')
          authRejected = true; click('Continue with Google'); await wait()
          check(popup().textContent.includes('Synthetic sign-in failure'), 'Failed sign-in must offer recovery')
          authRejected = false; click('Continue with GitHub'); await wait()
          check(popup().textContent.includes('Complete GitHub sign-in') && !popup().querySelector('input'), 'Browser approval state missing')
          check(calls.some(call => call.method === 'cloudSyncCommand' && call.request.type === 'signInGitHub' && !('url' in call.request)), 'Sign-up must leave endpoint selection to the main process')
          click('Cancel sign-in'); await wait()
          click('Continue with Google'); await wait()
          check(popup().textContent.includes('Complete Google sign-in'), 'Google browser approval state missing')
          check(calls.some(call => call.method === 'cloudSyncCommand' && call.request.type === 'signInGoogle' && !('url' in call.request)), 'Google sign-in must leave endpoint selection to the main process')
          click('Cancel sign-in'); await wait(); click('Sign in'); await wait()
          click('Continue with GitHub'); await wait()
          fixtureAuth = { ...fixtureAuth, signedIn: true, signInPending: false, state: 'synced' }
          await new Promise(resolve => setTimeout(resolve, 2200))
          check(!popup(), 'Successful browser approval must close the popup automatically')
          fixtureAuth = { ...fixtureAuth, signedIn: false, state: 'disconnected' }; await refreshAuth()
          check(popup(), 'Signing out must reveal account access')
          await paint()
          await window.captureFixture('auth-front-screen')
          click('Continue locally'); await wait(); await refreshAuth()
          check(!popup(), 'Continue locally must stay dismissed during this session')
          memory.stop(); rendered.unmount(); client.clear(); useDataHealth.setState({ startup: null }); await wait()
          const mountAuth = async () => {
            const nextClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
            const nextRoot = createRoot(element)
            nextRoot.render(<QueryClientProvider client={nextClient}><App /></QueryClientProvider>)
            await wait(); await wait()
            return () => { nextRoot.unmount(); nextClient.clear(); useDataHealth.setState({ startup: null }) }
          }
          fixtureAuth = { ...fixtureAuth, signedIn: true, state: 'synced' }
          let unmount = await mountAuth()
          check(!popup(), 'Returning signed-in user must skip the popup'); unmount(); await wait()
          fixtureAuth = { ...fixtureAuth, signedIn: false, state: 'disconnected', encryptionAvailable: false }
          unmount = await mountAuth()
          check(popup().querySelector('button[type=submit]').disabled && popup().textContent.includes('credential keyring'), 'Missing encryption must explain disabled sign-in')
          popup().dispatchEvent(new Event('cancel', { cancelable: true })); await wait()
          check(!popup(), 'Escape must permit local use'); unmount(); await wait()
          authUnavailable = true
          unmount = await mountAuth()
          check(popup()?.textContent.includes('Account status is unavailable'), 'Unavailable status must offer retry and local use')
          authUnavailable = false; fixtureAuth = { ...fixtureAuth, encryptionAvailable: true }
          click('Try again'); await wait(); await wait()
          check(popup().querySelector('button[type=submit]') && !popup().querySelector('button[type=submit]').disabled, 'Retry did not recover account access')
          click('Don’t show again'); await wait()
          check(!popup(), 'Don’t show again must dismiss the popup')
          const savedPreference = localStorage.getItem('budget-terminal:auth-prompt')
          check(JSON.parse(savedPreference).state.hidden === true && Object.keys(JSON.parse(savedPreference).state).join() === 'hidden', 'Only the device dismissal preference may be persisted')
          unmount(); await wait()
          useAuthPrompt.setState({ hidden: false })
          localStorage.setItem('budget-terminal:auth-prompt', savedPreference)
          await useAuthPrompt.persist.rehydrate()
          unmount = await mountAuth()
          check(!popup(), 'Don’t show again must survive a fresh app mount and storage rehydration')
          await selectPage(TABS.find(tab => tab.id === 'settings'))
          const preference = [...visiblePage('settings').querySelectorAll('label')].find(label => label.textContent.includes('Show sign-in popup at startup')).querySelector('input')
          check(!preference.checked, 'Settings must reflect the saved popup preference')
          preference.click(); await wait()
          check(popup() && !useAuthPrompt.getState().hidden, 'Settings must be able to restore the auth popup')
          unmount()
          await wait()
          fixtureAuth = { ...fixtureAuth, signedIn: true, url: 'https://fixture.convex.cloud', state: 'disconnected', authState: 'authenticated', githubLogin: 'fixture-user', workspaceApprovalRequired: true, message: undefined }
          const accountClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
          const accountRoot = createRoot(element)
          accountRoot.render(<QueryClientProvider client={accountClient}><CloudSyncPanel /></QueryClientProvider>)
          await wait(); await wait()
          const panel = () => document.querySelector('[data-cloud-sync]')
          const accountClick = text => { const button = [...panel().querySelectorAll('button')].find(button => button.textContent.trim() === text); check(button && !button.disabled, 'Missing account control: ' + text); button.click() }
          check(panel().textContent.includes('@fixture-user'), 'Connected account must be visible')
          check([...panel().querySelectorAll('button')].find(button => button.textContent === 'Sync now').disabled, 'Sync must stay paused until ownership is approved')
          accountClick('Import this device’s data'); await wait()
          check(panel().textContent.includes('Allow this account to receive'), 'Import requires a reviewable confirmation')
          for (const [width, height] of [[1366, 768], [1024, 768], [480, 700]]) {
            await window.resizeFixture(width, height); await paint()
            const bounds = panel().getBoundingClientRect()
            check(bounds.right <= innerWidth && bounds.bottom <= innerHeight && panel().scrollWidth <= panel().clientWidth, 'Account controls leave the viewport at ' + width + 'x' + height)
          }
          await window.captureFixture('auth-workspace-approval')
          accountClick('Confirm workspace choice'); await wait()
          check(calls.some(call => call.method === 'cloudSyncCommand' && call.request.type === 'confirmWorkspace' && call.request.use === 'local'), 'Import did not invoke explicit workspace consent')
          check(!panel().querySelector('[data-workspace-approval]'), 'Approved workspace must leave the consent state')
          accountClick('Sign out other devices'); await wait()
          accountClick('Verify with GitHub'); await wait()
          check(panel().textContent.includes('same account') && panel().textContent.includes('Cancel sign-in'), 'Other-device sign-out must request GitHub verification')
          accountClick('Cancel sign-in'); await wait()
          fixtureAuth = { ...fixtureAuth, signedIn: false, signInPending: false, authState: 'signedOut', revocation: 'unconfirmed' }
          await accountClient.refetchQueries({ queryKey: ['cloudSyncStatus'] }); await wait()
          check(panel().textContent.includes('Server revocation is unconfirmed'), 'Offline disconnect must report revocation uncertainty')
          fixtureAuth = { ...fixtureAuth, authState: 'keyringUnavailable', encryptionAvailable: false }
          await accountClient.refetchQueries({ queryKey: ['cloudSyncStatus'] }); await wait()
          check([...panel().querySelectorAll('button')].some(button => button.textContent === 'Retry saved sign-in'), 'A locked keyring must offer saved-session recovery')
          fixtureAuth = { ...fixtureAuth, authState: 'storageError', encryptionAvailable: true, credentialCleanupRequired: true }
          await accountClient.refetchQueries({ queryKey: ['cloudSyncStatus'] }); await wait()
          check([...panel().querySelectorAll('button')].find(button => button.textContent === 'Sign in with GitHub').disabled, 'Credential cleanup must be completed before signing in again')
          accountClick('Retry credential cleanup'); await wait()
          check(calls.some(call => call.method === 'cloudSyncCommand' && call.request.type === 'retryCredentialCleanup'), 'Credential cleanup must call the main process')
          accountRoot.unmount(); accountClient.clear()
          return 'PASS: responsive auth and account controls, workspace consent, provider session verification, revocation uncertainty, keyring recovery, persistent dismissal and all-page preloading'
        }
        if (document.querySelector('dialog.auth-popup[open]')) {
          ;[...document.querySelector('dialog.auth-popup').querySelectorAll('button')].find(button => button.textContent === 'Continue locally').click()
          await wait()
        }
        if (mainPageOnly) {
          if (restored) {
            const calendar = visiblePage('calendar')
            const obscure = document.querySelector('.terminal-topbar button[aria-label="Obscure mode"]')
            check(calendar.closest('[inert]') && obscure.getAttribute('aria-pressed') === 'true', 'The configured startup page must open protected')
            obscure.click(); await wait()
            check(!calendar.closest('[inert]') && obscure.getAttribute('aria-pressed') === 'false', 'The toolbar control must reveal the page')
            await selectPage(TABS.find(tab => tab.id === 'settings'))
            document.querySelector('[data-settings-category="privacy"]').click(); await wait()
            const privacySwitch = document.querySelector('[data-settings-card="privacy"] [role="switch"]')
            check(privacySwitch.getAttribute('aria-checked') === 'false', 'Privacy switch must reflect the toolbar state')
            privacySwitch.click(); await wait()
            check(obscure.getAttribute('aria-pressed') === 'true', 'Privacy switch must update the toolbar')
            document.querySelector('[data-settings-category="workspace"]').click(); await wait()
            const mainPage = document.querySelector('#settings-main-page')
            mainPage.value = 'charts'
            mainPage.dispatchEvent(new Event('change', { bubbles: true })); await wait()
            check(fixtureSettings.mainPage === 'charts' && visiblePage('settings'), 'Saving the next launch page must keep Settings open')
          }
          memory.stop(); rendered.unmount(); client.clear(); useDataHealth.setState({ startup: null }); calls = []
          await wait()
          continue
        }
        if (scenario === 'empty') {
          for (const id of ['fundamentals', 'options']) {
            check(startup.pages[id].state === 'ready', id + ' selection screen must be prepared at startup')
            check(startup.pages[id].reason.includes('awaiting ticker selection'), id + ' must explain the empty selection in Settings')
          }
          check(!calls.some(call => call.method === 'optionsChain' && !call.request.symbol), 'Empty Options must not issue a blank-symbol request')
        }
        for (let extra = 0; extra < 2000; extra++) client.setQueryData(['history', 'memory-stress-' + extra], { values: Array(100).fill(extra) })
        await memory.sweep()
        check(client.getQueryCache().findAll({ queryKey: ['history'] }).length <= 5, 'Extra memory did not converge before page visits')
        check(!startup.timings.some(task => task.state !== 'ready'), 'Fixture startup failed: ' + JSON.stringify(startup.timings.filter(task => task.state !== 'ready')))
        if (!populated) check(client.getQueryData(['quotes', ''])?.data.macro[MACRO_SYMBOLS[0].label]?.price === 100, 'Empty portfolio macro quotes missing')
        if (populated) {
          check(startup.pages.news.state === 'ready', 'Publisher image denials must not degrade healthy article feeds')
          check(useDataHealth.getState().records['news:News images']?.freshness === 'partial', 'Image denials must remain visible separately in Settings')
          check(client.getQueryData(['quotes', 'MSFT']), 'News article quote set was not warmed')
          check(client.getQueryData(['newsThumbnail', 'https://example.com/fixture.png']), 'Initial News media was not warmed')
          check(client.getQueryData(['youtubeThumbnail', 'fixture1', 'https://example.com/video.png']), 'Selected video media was not warmed')
        }
        check(!document.body.innerText.includes('Review access') && !document.body.innerText.includes('Pairing code'), 'Remote controls must not appear in the desktop shell')
        if (refreshOnly) {
          const intervals = []
          const originalInterval = window.setInterval
          window.setInterval = (callback, delay, ...args) => {
            intervals.push(delay)
            return originalInterval(callback, delay, ...args)
          }
          try {
            await selectPage(TABS.find(tab => tab.id === 'backtest'))
          } finally { window.setInterval = originalInterval }
          const page = visiblePage('backtest')
          check(page && !document.body.innerText.includes('This page could not render'), 'Prepared Backtest must render')
          check(!intervals.includes(60000), 'Opening Backtest must not install a quote polling timer')
          const key = backtestQuotesKey(book.tickers)
          const snapshot = client.getQueryData(key)
          check(snapshot, 'Backtest must have an independent quote snapshot before first visit')
          applyEquityMarketUpdate(client, { candles: [], quotes: [{ symbol: 'AAPL', price: 999, change: 2, absChange: 2 }] })
          check(client.getQueryData(key) === snapshot, 'Live market marks must leave Backtest quotes unchanged')
          const runsBefore = calls.filter(call => call.method === 'backtest').length
          const interval = [...page.querySelectorAll('button')].find(button => button.textContent.trim() === '1W')
          interval.click()
          await new Promise(resolve => setTimeout(resolve, 350))
          check(fixtureSettings.backtestPage.interval === '1W', 'Backtest control change was not saved')
          check(calls.filter(call => call.method === 'backtest').length === runsBefore, 'Saving Backtest controls must not automatically recompute results')
          ;[...page.querySelectorAll('button')].find(button => button.textContent.trim() === 'Run Backtest').click()
          await wait()
          check(calls.filter(call => call.method === 'backtest').length === runsBefore + 1, 'Explicit Run must still execute Backtest once')
          check(calls.filter(call => call.method === 'backtest').at(-1).request.interval === '1W', 'Manual Run must use the edited controls')
          await paint(); await window.captureFixture('completed-backtest-refresh')
          memory.stop(); rendered.unmount(); client.clear()
          return 'PASS: all-page startup retained; Backtest has no quote polling, ignores shared live marks, does not recompute on saved control changes and still runs manually'
        }
        if (agentsOnly) {
          const before = calls.length
          await selectPage(TABS.find(tab => tab.id === 'agents'))
          check(visiblePage('agents').querySelector('[role=switch]').getAttribute('aria-checked') === 'false', 'Agents autonomy must start off')
          check(!calls.slice(before).some(call => ['agentsStatus', 'agentsCommand'].includes(call.method)), 'Agents must be ready without a first-visit request or connection')
          await selectPage(TABS.find(tab => tab.id === 'dashboard'))
          client.setQueryData(['agents'], ok({ connected: true, busy: true, autonomy: false, objective: '', intervalMinutes: 15, runsRemaining: 0, nextRunAt: null, messages: [], error: '', navigation: { id: 'fixture-navigation', page: 'charts', symbol: 'MSFT' } }))
          await wait(); await wait()
          check(visiblePage('charts') && useChartsStore.getState().symbol === 'MSFT', 'Agent navigation must select Charts/MSFT while another page is active')
          check(calls.some(call => call.method === 'agentsCommand' && call.request.type === 'navigationResult' && call.request.id === 'fixture-navigation'), 'App must acknowledge agent navigation')
          check(client.getQueryData(['notifications']), 'Notification state must preload without visiting the page')
          for (const id of ['notifications']) {
            await selectPage(TABS.find(tab => tab.id === id))
            check(visiblePage(id).querySelector('h1'), 'Notification page did not render: ' + id)
            check(!visiblePage(id).textContent.includes('Loading notifications'), 'Notification page showed a first-visit load')
            await paint(); await window.captureFixture('completed-' + id)
            await paint(); await window.captureFixture('completed-' + id)
          }
          memory.stop(); rendered.unmount(); client.clear()
          return 'PASS: all pages ready at startup, Agents and Notifications ready on first visit, autonomy off and global agent navigation to Charts/MSFT'
        }
        if (!reloadOnly) {
          check(startup.pages['dashboard-lite']?.state === 'ready', 'Dashboard Lite must prepare its data with Labs off')
          check(startup.pages['news-lite']?.state === 'ready', 'News Lite must prepare its feed with Labs off')
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await wait()
          check(![...document.querySelectorAll('[data-result-index]')].some(button => ['Dashboard Lite', 'News Lite'].includes(button.querySelector('span')?.textContent)),
            'Labs pages must be absent from navigation before opting in')
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait()
          await selectPage(TABS.find(tab => tab.id === 'settings'))
          const settingsPage = visiblePage('settings')
          settingsPage.querySelector('[data-settings-category="integrations"]').click(); await wait()
          const mobileCard = settingsPage.querySelector('[data-settings-card="mobile-access"]')
          check(mobileCard.hidden, 'Mobile Access belongs in Labs')
          settingsPage.querySelector('[data-settings-category="labs"]').click(); await wait()
          check(!mobileCard.hidden, 'Mobile Access must appear under Labs')
          const mobileLab = mobileCard.querySelector('[role="switch"][aria-labelledby="lab-mobile-access"]')
          const setupButton = () => mobileCard.querySelector('button[aria-label="Copy Tailscale setup commands"]')
          const qrButtons = () => [...mobileCard.querySelectorAll('button[aria-haspopup="dialog"]')]
          const copiedValue = async button => {
            const before = calls.length
            button.click(); await wait()
            check(button.textContent === 'Copied', 'Mobile Access must confirm clipboard success')
            return calls.slice(before).find(call => call.method === 'writeClipboard')?.request
          }
          const checkConnection = async () => {
            ;[...mobileCard.querySelectorAll('button')].find(button => button.textContent === 'Check connection').click()
            await wait()
          }
          mobileHttpsReady = mobileDirectReady = false
          check(!qrButtons().length, 'Mobile Access must hide QR controls while off')
          mobileLab.click(); await wait()
          check(!qrButtons().length, 'Mobile Access must hide QR controls until a link is available')
          check(await copiedValue(setupButton()) === [MOBILE_SERVE_COMMAND, MOBILE_DIRECT_SERVE_COMMAND].join('\\n'),
            'Copy setup commands must copy both missing commands as separate lines')
          mobileHttpsReady = true
          await checkConnection()
          mobileCard.querySelector('details').open = true
          check(await copiedValue(setupButton()) === MOBILE_DIRECT_SERVE_COMMAND,
            'Copy setup commands must copy only the command still needed')
          check(qrButtons().length === 1 && qrButtons()[0].ariaLabel.includes('HTTPS link'), 'The HTTPS QR code must be available without the direct link')
          mobileDirectReady = true
          await checkConnection()
          check(!setupButton(), 'Setup commands must be hidden once both links are configured')
          check(mobileLab.getAttribute('aria-checked') === 'true' && mobileCard.textContent.includes('fixture.test-tailnet.ts.net'), 'Mobile Access must show its link when enabled')
          check(mobileCard.textContent.includes('http://100.64.1.1:8081/'), 'Mobile Access must show the DNS-independent link')
          check(mobileCard.textContent.includes('/mobile'), 'Mobile Access must keep the Telegram link instructions')
          const patterns = new Set()
          for (const [label, url] of [['Direct link', 'http://100.64.1.1:8081/'], ['HTTPS link', 'https://fixture.test-tailnet.ts.net:8443/']]) {
            const qrButton = qrButtons().find(button => button.ariaLabel.includes(label))
            qrButton.focus(); qrButton.click(); await wait()
            const dialog = mobileCard.querySelector('dialog[open]')
            const code = dialog?.querySelector('svg[role="img"]')
            const pattern = code?.querySelector('path:last-child')?.getAttribute('d')
            check(pattern && dialog.textContent.includes(url) && code.ariaLabel.includes(label), 'QR dialog must show the selected ' + label)
            patterns.add(pattern)
            if (scenario === 'empty') {
              const screenshot = label === 'Direct link' ? 'mobile-direct-qr' : 'mobile-https-qr'
              await paint(); await window.captureFixture(screenshot)
              await paint(); await window.captureFixture(screenshot)
            }
            dialog.querySelector('button').click(); await wait()
            check(!mobileCard.querySelector('dialog[open]') && document.activeElement === qrButton, 'Closing the QR dialog must restore focus')
            check(await copiedValue(mobileCard.querySelector('button[aria-label^="Copy ' + label + '"]')) === url, 'Copy must still use the displayed ' + label)
          }
          check(patterns.size === 2, 'The direct and HTTPS QR patterns must differ')
          check(!fixtureSettings.enabledLabs.includes('mobile-access'), 'Mobile Access must remain a host-local preference')
          mobileLab.click(); await wait()
          check(mobileLab.getAttribute('aria-checked') === 'false', 'Turning off the Mobile Access experiment must stop mobile sharing')
          check(!qrButtons().length, 'Turning off Mobile Access must remove the QR controls')
          const lab = settingsPage.querySelector('[role="switch"][aria-labelledby="lab-dashboard-lite"]')
          lab.click(); await wait()
          check(lab.getAttribute('aria-checked') === 'true', 'Labs must opt into Dashboard Lite before opening it')
          const newsLab = settingsPage.querySelector('[role="switch"][aria-labelledby="lab-news-lite"]')
          newsLab.click(); await wait()
          check(newsLab.getAttribute('aria-checked') === 'true', 'Labs must opt into News Lite before opening it')
          settingsPage.querySelector('[data-settings-category="dashboard"]').click(); await wait()
        }
        for (const tab of TABS.filter(tab => tab.implemented && (!reloadOnly || tab.id === 'amzn'))) {
          const before = calls.length
          await selectPage(tab)
          check(!document.body.innerText.includes('This page could not render'), 'Completed page crashed: ' + tab.id)
          const refreshButtons = [...visiblePage(tab.id).querySelectorAll('button')].filter(button => /^(Force )?Refresh(?:$| list$| holdings$| dataset$)/i.test(button.textContent.trim()))
          check(refreshButtons.length <= (tab.id === 'scorecard' ? 1 : 0), 'Page has an unexpected Refresh button: ' + tab.id)
          if (tab.id !== 'settings') check(!visiblePage(tab.id).querySelector('[aria-label="Data freshness"]') &&
            !/Snapshot age:|Cache age at retrieval:/.test(visiblePage(tab.id).innerText), 'Inline data diagnostics on ' + tab.id)
          if (restored && ['stocks', 'dashboard', 'dashboard-lite'].includes(tab.id)) {
            const text = visiblePage(tab.id).innerText
            check(text.includes('123.45 EUR') && text.includes('-2.50 EUR') && !text.includes('$123.45'), 'Foreign quote header mislabeled: ' + tab.id)
          }
          if (restored && tab.id === 'charts') check(visiblePage(tab.id).innerText.includes('100.00 GBp'), 'Charts did not retain the raw pence unit')
          // Browser viewport IPC only places/hides its already-initialized native
          // view. It is not a data load; browserStatus/research/control still count.
          // Shared notification polling continues independently of page navigation.
          if (tab.id === 'up-down') check(!visiblePage('up-down').innerText.includes('loading price targets'), 'Targets were deferred until first visit')
          if (tab.id === 'notifications') check(client.getQueryData(['notifications']), 'Notification data was not warmed')
          // Expiry maintenance runs throughout navigation and uses a rank behind
          // every initial page. It is independent of a first-visit data request.
          // Quote visibility updates subscriptions. Auth status polls from the shell.
          const maintenance = call => ['setEquityQuoteVisibility', 'cloudSyncStatus'].includes(call.method) ||
            (call.request?.background && call.request.backgroundOrder >= TABS.filter(tab => tab.implemented).length)
          const initial = calls.slice(before).filter(call => !maintenance(call) && !['startupPriority', 'mcpStatus', 'apiUsage', 'appMetrics', 'mutateSettings', 'browserViewport', 'notificationsStatus'].includes(call.method))
          check(initial.length === 0, 'First-visit request on ' + scenario + '/' + tab.id + ': ' + JSON.stringify(initial))
          if (tab.id === 'news-lite') {
            check(visiblePage(tab.id).querySelector('.news-lite-story')?.textContent.includes('Synthetic readiness headline'),
              'News Lite must render its prepared headline on the first visit')
          }
          if (scenario === 'populated' && tab.id === 'portfolio') {
            const page = visiblePage(tab.id)
            const headings = () => [...page.querySelectorAll('h2')].map(heading => heading.textContent.trim())
            check(headings().includes('Stocks') && !headings().includes('Options'), 'Stocks must have its own subpage')
            check(!headings().includes('Portfolio Weight') && !headings().includes('Dip Finder'), 'Analytics still shown beside Stocks')
            const optionSummary = [...page.querySelectorAll('span')].find(span => span.textContent === 'Options P&L')?.parentElement
            check(optionSummary?.textContent.includes('+$100'), 'Option marks must be ready in the summary before opening Options')
            await paint(); await window.captureFixture('completed-portfolio-stocks')
            for (const label of ['Options', 'Portfolio Weight', 'Dip Finder', 'Stocks']) {
              const beforeSubtab = calls.length
              const button = [...page.querySelectorAll('button')].find(button => button.textContent.trim() === label)
              check(button, 'Missing Portfolio subtab: ' + label)
              button.click(); await wait(); await paint()
              check(headings().includes(label), 'Portfolio subtab panel missing: ' + label)
              const subtabRequests = calls.slice(beforeSubtab).filter(call => !maintenance(call) && !['startupPriority', 'mcpStatus', 'apiUsage', 'appMetrics', 'mutateSettings', 'notificationsStatus'].includes(call.method))
              check(subtabRequests.length === 0, 'Portfolio subtab made a first-visit request: ' + label + ': ' + JSON.stringify(subtabRequests))
              const panel = [...page.querySelectorAll('section')].find(panel => panel.querySelector('h2')?.textContent.trim() === label)
              check(panel.getBoundingClientRect().width >= page.getBoundingClientRect().width - 20, 'Portfolio subtab must use the full width: ' + label)
              if (label === 'Options') {
                check(!headings().includes('Stocks'), 'Stocks remain visible on Options')
                check(page.querySelector('input[aria-label="Option ticker"]')?.value === 'AAPL', 'Stored option row missing')
                check(panel.getBoundingClientRect().height >= 300, 'Options must use the available height')
                await window.captureFixture('completed-portfolio-options')
              } else if (label !== 'Stocks') {
                check(!headings().includes('Stocks') && !headings().includes('Options'), 'Holdings tables remain visible on ' + label)
                check(page.innerText.includes('AAPL'), 'Portfolio chart is empty: ' + label)
                await window.captureFixture('completed-portfolio-' + (label === 'Dip Finder' ? 'dip-finder' : 'weight'))
              } else {
                check(!headings().includes('Options'), 'Options remain visible on Stocks')
                check(panel.getBoundingClientRect().height >= 300, 'Stocks must use the available height')
              }
            }
          }
          if (tab.id === 'settings') {
            const settingsPage = visiblePage(tab.id)
            check(settingsPage.querySelectorAll('.app-dash-card').length === 18, 'Settings dashboard must prepare all 18 charts')
            check(settingsPage.querySelector('.app-dashboard').getBoundingClientRect().height > 0, 'App dashboard must be the default Settings view')
            settingsPage.querySelector('[data-settings-category="data"]').click()
            await wait()
            check(visiblePage(tab.id).querySelectorAll('meter').length === 3, 'Cache diagnostics must be ready on first visit')
            check(visiblePage(tab.id).querySelector('input[type="number"]')?.value === '256', 'Saved cache limits must be available without a first-visit load')
            check(!visiblePage(tab.id).innerText.includes('Remote'), 'Settings must not offer remote access')
            check(visiblePage(tab.id).innerText.includes('Backups & saved data'), 'Desktop data controls must remain available')
          }
          if (scenario === 'populated' && ['dashboard', 'dashboard-lite', 'news', 'youtube', 'settings'].includes(tab.id)) {
            await paint()
            check(visiblePage(tab.id), 'Capture page changed: ' + tab.id)
            await window.captureFixture('completed-' + tab.id)
          }
        }
        if (scenario === 'populated') {
          await selectPage(TABS.find(tab => tab.id === 'amzn'))
          const checkReload = async mobile => {
            const button = document.querySelector('.reload-button')
            const fill = () => button.querySelector('.reload-button__fill')
            const width = button.getBoundingClientRect().width
            check(!button.disabled && !fill(), 'The idle reload button must have no progress bar')
            const until = async (test, message) => {
              const deadline = Date.now() + 15000
              while (!test() && Date.now() < deadline) await wait()
              check(test(), message)
            }
            let releaseCurrent, releaseOthers
            const current = new Promise(resolve => { releaseCurrent = resolve })
            const others = new Promise(resolve => { releaseOthers = resolve })
            holdReload = (method, request) => {
              if (method === 'amzn' && request?.force) return current
              if (method === 'globalMarkets') return others
            }
            try {
              await client.invalidateQueries({ queryKey: ['globalMarkets'], refetchType: 'none' })
              const beforeReload = calls.length
              if (mobile) button.click()
              else {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5' }))
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', repeat: true }))
              }
              await until(() => fill()?.hasAttribute('data-waiting'), 'The current-page reload must show a waiting bar')
              check(button.disabled && button.getAttribute('aria-busy') === 'true', 'The control must be busy during reload')
              check(button.nextElementSibling.textContent === 'Reloading the current page', 'Announce the current-page phase')
              check(getComputedStyle(fill()).animationName === 'reload-progress-sweep', 'The waiting bar must animate')
              check(button.getBoundingClientRect().width === width, 'The button width must stay fixed while reloading')
              releaseCurrent()
              await until(() => button.title.startsWith('Checking other pages'), 'Announce the other-page checks')
              check(parseFloat(fill()?.style.width) > 0, 'The bar must advance as checks finish')
              check(button.getBoundingClientRect().width === width, 'The button width must stay fixed while checking other pages')
              releaseOthers()
              await until(() => !button.disabled && !fill(), 'The control must return to idle when reload finishes')
              const reloadCalls = calls.slice(beforeReload)
              check(reloadCalls.filter(call => call.method === 'amzn' && call.request.force).length === 1, 'Reload must force the focused page exactly once')
              check(!reloadCalls.some(call => call.method !== 'amzn' && call.request?.force), 'Background page checks must retain service caches')
            } finally {
              releaseCurrent()
              releaseOthers()
              holdReload = undefined
            }
          }
          await checkReload(false)
          if (reloadOnly) {
            document.documentElement.setAttribute('data-terminal-mobile', '')
            await window.resizeFixture(402, 874)
            rendered.render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
            await wait()
            check(document.querySelector('.mobile-topbar .reload-button'), 'The mobile header must have a reload button')
            await checkReload(true)
            document.documentElement.removeAttribute('data-terminal-mobile')
            await window.resizeFixture(1400, 950)
            rendered.render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
          }
          await paint(); await window.captureFixture('focused-reload')
          const old = client.getQueryData(['quotes', 'AAPL'])
          client.setQueryData(['quotes', 'AAPL'], { ...old, meta: { ...old.meta, freshness: 'stale', failureReason: 'Synthetic provider outage; previous snapshot preserved', fetchedAt: Date.now() - 120000 } })
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await wait()
          ;[...document.querySelectorAll('[data-result-index]')].find(button => button.querySelector('span')?.textContent === 'Dashboard').click()
          await wait(); await paint()
          check(visiblePage('dashboard'), 'Stale fixture did not select Dashboard')
          check(visiblePage('dashboard').querySelector('[aria-label="Synthetic provider outage; previous snapshot preserved"]'), 'Stale fixture did not expose the panel outage warning')
          await window.captureFixture('completed-stale-dashboard')
        }
        if (scenario === 'persisted' && !startupOnly) {
          for (const tab of TABS.filter(tab => tab.implemented)) {
            console.log('Interaction fixture: ' + tab.id)
            await selectPage(tab)
            const record = { page: tab.id, subtabs: [], selects: [], toggles: [], sorts: 0, searches: [], settingsControls: [], userRequests: [], excluded: [] }
            const before = calls.length
            const contexts = [null, ...(subtabLabels[tab.id] ?? [])]
            for (const label of contexts) {
              let page = visiblePage(tab.id)
              if (label) {
                const button = [...page.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent.trim() === label || button.textContent.trim().startsWith(label + ' ('))
                check(button, 'Missing subtab ' + tab.id + '/' + label)
                button.click(); await wait()
                record.subtabs.push(label); page = visiblePage(tab.id)
              }
              check(!document.body.innerText.includes('This page could not render'), 'Subtab crashed: ' + tab.id + '/' + label)
              if (tab.id !== 'settings') check(!page.querySelector('[aria-label="Data freshness"]'), 'Inline data diagnostics on ' + tab.id + '/' + label)
              for (const button of [...page.querySelectorAll('button[aria-pressed]')].filter(button => button.getBoundingClientRect().height > 0 && !button.disabled)) {
                const wasPressed = button.getAttribute('aria-pressed') === 'true'
                button.click(); await new Promise(resolve => setTimeout(resolve, 20))
                check(!document.body.innerText.includes('This page could not render'), 'Toggle crashed: ' + tab.id + '/' + button.textContent)
                if (button.isConnected && button.getAttribute('aria-pressed') !== String(wasPressed)) button.click()
                record.toggles.push({ context: label, label: button.textContent.trim() })
              }
              for (const select of [...page.querySelectorAll('select')].filter(select => select.getBoundingClientRect().height > 0 && !select.disabled)) {
                const original = select.value
                const options = [...select.options].filter(option => !option.disabled).map(option => option.value)
                for (const value of options) {
                  select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 20))
                  check(!document.body.innerText.includes('This page could not render'), 'Selection crashed: ' + tab.id + '/' + value)
                }
                select.value = original; select.dispatchEvent(new Event('change', { bubbles: true }))
                record.selects.push({ context: label, label: select.getAttribute('aria-label') ?? select.title ?? '', values: options })
              }
              for (const button of page.querySelectorAll('th button')) {
                if (button.getBoundingClientRect().height === 0 || button.disabled) continue
                button.click(); button.click(); record.sorts++
              }
              for (const input of [...page.querySelectorAll('input')].filter(input => /filter|search/i.test(input.placeholder) && !/ticker|symbol/i.test(input.placeholder) && input.getBoundingClientRect().height > 0)) {
                const original = input.value
                const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
                setValue.call(input, 'fixture-no-match'); input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 20))
                check(!document.body.innerText.includes('This page could not render'), 'Filter crashed: ' + tab.id)
                setValue.call(input, original); input.dispatchEvent(new Event('input', { bubbles: true }))
                record.searches.push(input.placeholder)
              }
            }
            await wait()
            if (tab.id === 'settings') {
              const page = visiblePage(tab.id)
              for (const checkbox of page.querySelectorAll('input[type="checkbox"]')) {
                if (checkbox.disabled) continue
                const label = checkbox.closest('label').textContent.replace('✓', '').trim()
                checkbox.click(); await new Promise(resolve => setTimeout(resolve, 20)); checkbox.click(); await new Promise(resolve => setTimeout(resolve, 20))
                record.settingsControls.push(label)
              }
              const button = [...page.querySelectorAll('button')].find(button => button.textContent.trim() === 'Move Down')
              if (button && !button.disabled) { button.click(); await wait(); record.settingsControls.push('Move Down') }
              const up = [...page.querySelectorAll('button')].find(button => button.textContent.trim() === 'Move Up')
              if (up && !up.disabled) { up.click(); await wait(); record.settingsControls.push('Move Up') }
              record.excluded = ['Backup/import/export/reset and destructive maintenance actions: service probes only; no UI dialog assertion', 'Reset Order', 'Clipboard-copy actions', 'Drag reordering']
            }
            check(!document.body.innerText.includes('This page could not render'), 'Interaction crashed: ' + tab.id)
            record.userRequests = [...new Set(calls.slice(before).map(call => call.method).filter(method => !['startupPriority', 'mcpStatus', 'apiUsage', 'mutateSettings'].includes(method)))]
            if (tab.id !== 'settings') record.excluded = ['Form submission/new arbitrary ticker or filter combinations', 'Export/clipboard/external links', 'Chart pointer/drawing/drag gestures', 'Financial edits and destructive actions']
            coverage.push(record)
          }
          await selectPage(TABS.find(tab => tab.id === 'portfolio'))
          ;[...visiblePage('portfolio').querySelectorAll('button')].find(button => button.textContent.trim() === 'Stocks').click(); await wait()
          const research = visiblePage('portfolio').querySelector('button[title="Research AAPL"]')
          check(research, 'Populated portfolio research handoff missing')
          research.click(); await wait(); await wait()
          check(visiblePage('stocks') && useStocksPage.getState().symbol === 'AAPL', 'Portfolio ticker handoff did not select Stocks/AAPL')
          coverage.find(row => row.page === 'portfolio').tickerHandoff = 'Research AAPL → Stocks/AAPL'
          await window.reportFixture(coverage)
        }
        memory.stop(); rendered.unmount(); client.clear(); useDataHealth.setState({ startup: null }); calls = []
        await wait()
      }
      if (reloadOnly) return 'PASS: Desktop F5 and mobile refresh report progress through both reload phases and return to idle'
      if (mainPageOnly) return 'PASS: default and saved launch pages, all-page startup, protected startup content, shared Obscure controls and save without navigation'
      if (startupOnly) return 'PASS: every route is prepared for empty, populated and restored sessions; empty selection screens, thumbnail cooldowns, first visits and F5 reload verified'
      return 'PASS: all ' + TABS.filter(tab => tab.implemented).length + ' routes after completed startup, empty and populated portfolios, persisted Options/ETF/video selections, initial News/video media and no first-visit loads; visible subtab/select/filter/sort sweep recorded separately'
    }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.png': 'dataurl', '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(directory, 'renderer.js'), renderer.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh"></div><script>
    window.addEventListener('error', event => console.error(event.error?.stack || event.message));
    window.fixtureTemplates = ${JSON.stringify(templates)};
    window.api = new Proxy({platform:'win32', onLiveStatusChanged:undefined, queryCacheMemoryScale: () => 0.25}, {get: (target, key) => key in target ? target[key] : String(key).startsWith('on') ? () => () => {} : request => window.fixtureHandler(key, request)});
    </script><script src="renderer.js"></script></body></html>`)
  await writeFile(join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('captureFixture',name=>ipcRenderer.invoke('capture-fixture',name));contextBridge.exposeInMainWorld('resizeFixture',(width,height)=>ipcRenderer.invoke('resize-fixture',width,height));contextBridge.exposeInMainWorld('reportFixture',data=>ipcRenderer.invoke('report-fixture',data));`)
  await writeFile(join(directory, 'main.cjs'), `const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('fs');const path=require('path');
    app.setPath('userData',${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:1400,height:950,webPreferences:{backgroundThrottling:false,preload:${JSON.stringify(join(directory, 'preload.cjs'))}}});
      ipcMain.handle('capture-fixture',async(_event,name)=>{if(!/^[a-z-]+$/.test(name))throw Error('Invalid capture name');fs.writeFileSync(path.join(${JSON.stringify(screenshots)},name+'.png'),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());});
      ipcMain.handle('resize-fixture',(_event,width,height)=>window.setContentSize(width,height));
      ipcMain.handle('report-fixture',async(_event,data)=>fs.writeFileSync(path.join(${JSON.stringify(screenshots)},'readiness-interactions.json'),JSON.stringify(data,null,2)));
      window.webContents.on('console-message',event=>console.log(event.message));
      try{await window.loadFile(${JSON.stringify(join(directory, 'index.html'))}); console.log(await window.webContents.executeJavaScript('window.runReadinessProbe()'));app.exit(0)}catch(error){console.error(error);app.exit(1)}});`)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data) => { output += data; process.stdout.write(data) })
    child.stderr.on('data', (data) => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Completed-startup UI probe timed out: ' + output)) }, 240_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
} finally {
  assert(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
