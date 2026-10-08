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
    import { useDataHealth } from './src/stores/dataHealth'
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
    import { queryFreshness } from './src/api/queryPersistence'
    import { MACRO_SYMBOLS, TABS } from './electron/shared/contract'
    import { DEFAULT_BACKTEST_PAGE_SETTINGS } from './electron/shared/backtest'
    import { DEFAULT_QUANT_PAGE_SETTINGS } from './electron/shared/quant'
    import { DEFAULT_YOUTUBE_PAGE_SETTINGS } from './electron/shared/youtube'
    const check = (condition, message) => { if (!condition) throw Error(message) }
    const wait = () => new Promise(resolve => setTimeout(resolve, 110))
    const visiblePage = id => [...document.querySelectorAll('[data-page-id]')].find(page => page.dataset.pageId === id && page.getBoundingClientRect().height > 0)
    const paint = async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    const subtabLabels = {
      portfolio: ['Positions', 'Pie Chart', 'Portfolio Heatmap', 'Momentum Tracker', 'Portfolio Metrics'],
      calendar: ['Calendar', 'Earnings'], fundamentals: ['Statements', 'SEC Filings'],
      charts: ['Main', 'Multi Charts', 'Compare', 'Relationship', 'Cheat Sheet'],
      valuation: ['Main', 'Scenarios', 'Peers', 'Risk', 'Trends', 'Notes', 'Sources'],
      options: ['Chain', 'Options by Top Volume', 'Options by Strike'], quant: ['Screener', 'Pairs'],
      economic: ['Overview', 'Inflation', 'Labor', 'Growth', 'Rates'],
      bmnr: ['Table', 'Chart'], gold: ['Table', 'Chart'], oil: ['Table', 'Chart'],
    }
    const coverage = []
    const selectPage = async tab => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await wait()
      const choice = [...document.querySelectorAll('[data-result-index]')].find(button => button.textContent.includes(tab.label))
      check(choice, 'Missing route: ' + tab.id)
      choice.click(); await wait(); await wait()
      check(visiblePage(tab.id), 'Wrong visible selected page: ' + tab.id)
    }
    const book = { id: 'main', name: 'Fixture', readOnly: false, tickers: ['AAPL'],
      holdings: { AAPL: { ticker: 'AAPL', shares: 1, avgPrice: 50, includeInWeight: true } },
      cashBalance: 100, marginDebt: 0, includeCashInWeight: true, options: [] }
    const settings = { clockCountry: 'US', time12h: true, tabOrder: TABS.map(tab => tab.id),
      hiddenTabs: [], obscuredTabs: [], favoriteTabs: [], sidebarCollapsed: false, sourcePath: '',
      backtestPage: DEFAULT_BACKTEST_PAGE_SETTINGS, quantPage: DEFAULT_QUANT_PAGE_SETTINGS,
      signalsPage: { filter: 'all', setup: 'all', search: '' }, youtubePage: DEFAULT_YOUTUBE_PAGE_SETTINGS }
    const quote = symbol => ({ symbol, price: 100, absChange: 1, change: 1, currency: 'USD', asOf: Date.now() })
    const candles = [{ time: Math.floor(Date.now() / 1000) - 86400, open: 99, close: 100, high: 101, low: 98, volume: 1000 }]
    const ok = data => ({ data, errors: [], meta: { freshness: 'fresh', source: 'Synthetic readiness fixture', fetchedAt: Date.now() } })
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
    let populated = false, calls = [], fixtureSettings = settings, restoredCurrency = false
    const fixture = (method, request = {}) => {
      if (method === 'mutateSettings') {
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
      if (method === 'signals' || method === 'quantScan' || method === 'technicalScan') return ok(null)
      if (method === 'mcpStatus') return { available: true, tools: 1 }
      if (method === 'apiUsage') return { providers: [], sampledAt: Date.now() }
      let result = structuredClone(window.fixtureTemplates[method])
      if (!result || !('data' in result)) return result
      if (!result.data) result.data = {}
      result.meta = ok(null).meta
      const data = result.data
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
      if (method === 'newsPage') {
        data.articles = [{ id: 'fixture-news', ticker: 'MSFT', title: 'Synthetic readiness headline', source: 'Fixture', summary: 'Synthetic story', publishedAt: Date.now(), time: '', url: 'https://example.com/fixture', imageUrl: 'https://example.com/fixture.png', signals: [], score: 5, category: 'market' }]
      }
      if (method === 'youtube') {
        data.items = [{ ticker: 'AAPL', title: 'Synthetic readiness video', channel: 'Fixture', videoId: 'fixture1', url: 'https://www.youtube.com/watch?v=fixture1', thumbnailUrl: 'https://example.com/video.png', viewCount: 10000, viewCountText: '10K', publishedText: '2026-10-06', publishedDays: 1, publishedDaysText: '1', durationText: '1:00', descriptionSnippet: 'Synthetic' }]
        data.tickersTotal = request.tickers?.length ?? 0; data.fetchedCount = data.tickersTotal
      }
      if (method === 'newsThumbnail' || method === 'youtubeThumbnail') data.dataUri = image
      if (method === 'discoveryUniverse') data.symbols = ['AAPL']
      if (method === 'discovery') { data.symbol = 'AAPL'; data.price = 100; data.previousClose = 99 }
      if (method === 'heatmap') data.etf = request.etf
      if (method === 'fx') data.usdSgd = 1.3
      if (method === 'calendarMonth') { data.year = request.year; data.month = request.month }
      if (method === 'forexHistory' || method === 'forexNews') data.pair = request.pair
      return result
    }
    window.fixtureHandler = (method, request) => { calls.push({ method, request }); return Promise.resolve(fixture(method, request)) }
    window.runReadinessProbe = async () => {
      const element = document.getElementById('root')
      for (const scenario of ['empty', 'populated', 'persisted']) {
        console.log('Completed-startup scenario: ' + scenario)
        populated = scenario !== 'empty'
        const restored = scenario === 'persisted'
        restoredCurrency = restored
        fixtureSettings = { ...settings, youtubePage: { sortColumn: restored ? 3 : -1, sortDescending: restored },
          backtestPage: restored ? { ...DEFAULT_BACKTEST_PAGE_SETTINGS, rows: [{ symbol: 'MSFT', weight: 100 }] } : DEFAULT_BACKTEST_PAGE_SETTINGS }
        useStocksPage.getState().setSymbol(restored ? 'MSFT' : 'AAPL')
        useFundamentalsStore.getState().setSymbol(restored ? 'MSFT' : 'AAPL')
        useChartsStore.setState({ symbol: restored ? 'MSFT' : 'AAPL', interval: restored ? '1 Week' : '1 Day', range: restored ? '5Y' : '1Y' })
        useDashboard.setState({ symbol: restored ? 'MSFT' : 'AAPL', timeframe: restored ? '1 Week' : '1 Day' })
        useValuationPage.getState().setTicker(restored ? 'MSFT' : 'AAPL')
        useProjectionsPage.getState().setSymbol(restored ? 'MSFT' : 'AAPL')
        useCalendarPage.setState({ initialized: restored, year: restored ? 2025 : 2026, month: restored ? 3 : 9, earningsYear: restored ? 2025 : 2026 })
        useIpoPage.setState({ completedYear: restored ? 2025 : 2026 })
        useOptionsPage.setState({ symbol: scenario === 'persisted' ? 'AAPL' : '', expiry: '', loaded: scenario === 'persisted' })
        useEtfPage.setState({ ticker: scenario === 'persisted' ? 'SPY' : '' })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
        client.getQueryCache().subscribe(({query}) => registerSnapshot(query.state.data, queryFreshness(query.queryKey)))
        const rendered = createRoot(element)
        rendered.render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
        const deadline = Date.now() + 15000
        while ((!useDataHealth.getState().startup || useDataHealth.getState().startup.timings.length !== useDataHealth.getState().startup.planned || !useDataHealth.getState().startup.planned) && Date.now() < deadline) await wait()
        await wait()
        const startup = useDataHealth.getState().startup
        check(startup && startup.timings.length === startup.planned, 'Startup failed to complete: ' + scenario)
        check(Object.keys(startup.pages).length === TABS.filter(tab => tab.implemented).length, 'Startup omitted a page state')
        check(!startup.timings.some(task => task.state !== 'ready'), 'Fixture startup failed: ' + JSON.stringify(startup.timings.filter(task => task.state !== 'ready')))
        if (!populated) check(client.getQueryData(['quotes', ''])?.data.macro[MACRO_SYMBOLS[0].label]?.price === 100, 'Empty portfolio macro quotes missing')
        if (populated) {
          check(client.getQueryData(['quotes', 'MSFT']), 'News article quote set was not warmed')
          check(client.getQueryData(['newsThumbnail', 'https://example.com/fixture.png']), 'Initial News media was not warmed')
          check(client.getQueryData(['youtubeThumbnail', 'fixture1', 'https://example.com/video.png']), 'Selected video media was not warmed')
        }
        for (const tab of TABS.filter(tab => tab.implemented)) {
          const before = calls.length
          await selectPage(tab)
          check(!document.body.innerText.includes('This page could not render'), 'Completed page crashed: ' + tab.id)
          if (restored && ['stocks', 'dashboard'].includes(tab.id)) {
            const text = visiblePage(tab.id).innerText
            check(text.includes('123.45 EUR') && text.includes('-2.50 EUR') && !text.includes('$123.45'), 'Foreign quote header mislabeled: ' + tab.id)
          }
          if (restored && tab.id === 'charts') check(visiblePage(tab.id).innerText.includes('100.00 GBp'), 'Charts did not retain the raw pence unit')
          const initial = calls.slice(before).filter(call => !['mcpStatus', 'apiUsage', 'mutateSettings'].includes(call.method))
          check(initial.length === 0, 'First-visit request on ' + scenario + '/' + tab.id + ': ' + JSON.stringify(initial))
          if (scenario === 'populated' && ['dashboard', 'news', 'youtube', 'settings'].includes(tab.id)) {
            await paint()
            check(visiblePage(tab.id), 'Capture page changed: ' + tab.id)
            await window.captureFixture('completed-' + tab.id)
          }
        }
        if (scenario === 'populated') {
          const old = client.getQueryData(['quotes', 'AAPL'])
          client.setQueryData(['quotes', 'AAPL'], { ...old, meta: { ...old.meta, freshness: 'stale', failureReason: 'Synthetic provider outage; previous snapshot preserved', fetchedAt: Date.now() - 120000 } })
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await wait()
          ;[...document.querySelectorAll('[data-result-index]')].find(button => button.textContent.includes('Dashboard')).click()
          await wait(); await paint()
          check(visiblePage('dashboard'), 'Stale fixture did not select Dashboard')
          check(document.querySelector('footer').textContent.includes('Synthetic provider outage'), 'Stale fixture did not expose outage status: ' + document.querySelector('footer').textContent)
          await window.captureFixture('completed-stale-dashboard')
        }
        if (scenario === 'persisted') {
          for (const tab of TABS.filter(tab => tab.implemented)) {
            console.log('Interaction fixture: ' + tab.id)
            await selectPage(tab)
            const record = { page: tab.id, subtabs: [], selects: [], toggles: [], sorts: 0, searches: [], settingsControls: [], userRequests: [], excluded: [] }
            const before = calls.length
            const contexts = [null, ...(subtabLabels[tab.id] ?? [])]
            for (const label of contexts) {
              let page = visiblePage(tab.id)
              if (label) {
                const button = [...page.querySelectorAll('button')].find(button => button.textContent.trim() === label || button.textContent.trim().startsWith(label + ' ('))
                check(button, 'Missing subtab ' + tab.id + '/' + label)
                button.click(); await wait()
                record.subtabs.push(label); page = visiblePage(tab.id)
              }
              check(!document.body.innerText.includes('This page could not render'), 'Subtab crashed: ' + tab.id + '/' + label)
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
            record.userRequests = [...new Set(calls.slice(before).map(call => call.method).filter(method => !['mcpStatus', 'apiUsage', 'mutateSettings'].includes(method)))]
            if (tab.id !== 'settings') record.excluded = ['Form submission/new arbitrary ticker or filter combinations', 'Export/clipboard/external links', 'Chart pointer/drawing/drag gestures', 'Financial edits and destructive actions']
            coverage.push(record)
          }
          await selectPage(TABS.find(tab => tab.id === 'portfolio'))
          ;[...visiblePage('portfolio').querySelectorAll('button')].find(button => button.textContent.trim() === 'Positions').click(); await wait()
          const research = visiblePage('portfolio').querySelector('button[title="Research AAPL"]')
          check(research, 'Populated portfolio research handoff missing')
          research.click(); await wait(); await wait()
          check(visiblePage('stocks') && useStocksPage.getState().symbol === 'AAPL', 'Portfolio ticker handoff did not select Stocks/AAPL')
          coverage.find(row => row.page === 'portfolio').tickerHandoff = 'Research AAPL → Stocks/AAPL'
          await window.reportFixture(coverage)
        }
        rendered.unmount(); client.clear(); useDataHealth.setState({ startup: null }); calls = []
        await wait()
      }
      return 'PASS: all 49 routes after completed startup, empty and populated portfolios, persisted Options/ETF/video selections, initial News/video media and no first-visit loads; visible subtab/select/filter/sort sweep recorded separately'
    }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.png': 'dataurl', '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(directory, 'renderer.js'), renderer.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh"></div><script>
    window.fixtureTemplates = ${JSON.stringify(templates)};
    window.api = new Proxy({platform:'win32'}, {get: (target, key) => key in target ? target[key] : String(key).startsWith('on') ? () => () => {} : request => window.fixtureHandler(key, request)});
    </script><script src="renderer.js"></script></body></html>`)
  await writeFile(join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('captureFixture',name=>ipcRenderer.invoke('capture-fixture',name));contextBridge.exposeInMainWorld('reportFixture',data=>ipcRenderer.invoke('report-fixture',data));`)
  await writeFile(join(directory, 'main.cjs'), `const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('fs');const path=require('path');
    app.setPath('userData',${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:1400,height:950,webPreferences:{backgroundThrottling:false,preload:${JSON.stringify(join(directory, 'preload.cjs'))}}});
      ipcMain.handle('capture-fixture',async(_event,name)=>{if(!/^[a-z-]+$/.test(name))throw Error('Invalid capture name');fs.writeFileSync(path.join(${JSON.stringify(screenshots)},name+'.png'),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());});
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
