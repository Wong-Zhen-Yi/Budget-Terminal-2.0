import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-charts-ui-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
        import { MainWorkspace } from './src/components/chartsworkstation/MainWorkspace'
        import { useChartsStore } from './src/stores/charts'
        import { applyEquityMarketUpdate } from './src/api/equityStream'
        import { queryKeys } from './src/api/client'
        import { StocksPage } from './src/pages/StocksPage'
        import { useStocksPage } from './src/stores/stocks'
        import { emptyStocksPayload, buildStocksStats } from './electron/shared/stocks'
        import { PortfolioChartsStatus } from './src/components/chrome/PortfolioChartsStatus'
        import { useDashboard } from './src/stores/dashboard'
        import { useDataHealth } from './src/stores/dataHealth'
        import { manageQueryMemory } from './src/api/queryMemory'
        import { useReloadAll } from './src/api/queries'
        useChartsStore.getState().setSymbol('AAPL')
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 250))
        const click = async (label) => {
          const button = [...document.querySelectorAll('button')].find(button => button.textContent === label)
          check(button, 'Missing button: ' + label)
          button.click(); await settle()
        }
        const candles = Array.from({ length: 80 }, (_, index) => ({
          time: 1700000000 + index * 86400, open: 100 + index, high: 102 + index,
          low: 99 + index, close: 101 + index, volume: 1000 + index,
        }))
        const envelope = data => ({ data, meta: { source: 'fixture', freshness: 'fresh', fetchedAt: Date.now() }, errors: [] })
        const historyRequests = []
        window.api.chartsHistory = async request => {
          historyRequests.push(request)
          return envelope({
          symbol: request.symbol, intervalLabel: request.interval, rangeLabel: request.range,
          interval: '1d', candles, stats: { symbol: request.symbol, price: 180, change: 1, absChange: 1, open: 179, high: 181, low: 178, close: 180, volume: 1079,
            currency: 'USD', longName: 'Synthetic equity perp', source: 'Hyperliquid equity perp (xyz:' + request.symbol + ')', market: 'xyz:' + request.symbol, priceSource: 'Hyperliquid equity perp (xyz:' + request.symbol + ')', priceBasis: 'equity-perp-mark', changeBasis: '24h' },
          indicators: { ma50: candles.map(row => ({ time: row.time, value: row.close - 24.5 })), ma200: [], rsi: [], rsiMa: [] },
          })
        }
        window.api.portfolio = async () => envelope({ portfolios: [], activeId: '', mainId: '' })
        window.api.onPortfolioChanged = () => () => {}
        window.runProbe = async () => {
          const app = createRoot(document.getElementById('root'))
          app.render(<QueryClientProvider client={client}><MainWorkspace onStatus={() => {}} /></QueryClientProvider>)
          await settle(); await settle()
          const toggle = () => [...document.querySelectorAll('button')].find(button => button.textContent === '50-day SMA')
          check(toggle()?.getAttribute('aria-pressed') === 'true', 'SMA must be enabled by default')
          check(document.querySelectorAll('canvas').length > 0, 'Real chart canvas must render')
          check(document.body.innerText.includes('MA50 155.50'), 'Latest daily SMA readout')
          await click('50-day SMA')
          check(toggle()?.getAttribute('aria-pressed') === 'false' && !useChartsStore.getState().indicators.ma50, 'SMA toggles off')
          const saved = JSON.parse(localStorage.getItem('budget-terminal:charts'))
          check(saved.state.indicators.ma50 === false, 'Visibility must persist')
          await click('50-day SMA')
          check(toggle()?.getAttribute('aria-pressed') === 'true', 'SMA toggles back on')
          const style = [...document.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'candles'))
          for (const type of ['line', 'area', 'candles']) {
            style.value = type; style.dispatchEvent(new Event('change', { bubbles: true })); await settle()
            check(useChartsStore.getState().chartType === type && toggle()?.getAttribute('aria-pressed') === 'true', 'SMA remains enabled for ' + type)
          }
          await click('Replay')
          check(document.body.innerText.includes('MA50 115.50'), 'Replay SMA must stop at the current bar')
          await click('Close')
          check(document.body.innerText.includes('MA50 155.50'), 'Closing replay restores latest SMA')
          await click('Focus')
          check(document.querySelectorAll('canvas').length > 0, 'Focus mode keeps chart')
          await click('Exit Focus')
          const state = useChartsStore.getState()
          const key = queryKeys.chartsHistory(state.symbol, state.interval, state.range)
          const last = client.getQueryData(key).data.candles.at(-1)
          applyEquityMarketUpdate(client, { quotes: [{ symbol: 'AAPL', price: 250, change: 25, absChange: 50, currency: 'USD', priceBasis: 'equity-perp-mark', changeBasis: '24h', source: 'Hyperliquid equity perp (xyz:AAPL)' }],
            candles: [{ symbol: 'AAPL', market: 'xyz:AAPL', interval: '1d', candle: { ...last, close: 181, high: 182 } }] })
          await settle()
          check(document.body.innerText.includes('Hyperliquid equity perp (xyz:AAPL)'), 'Chart and mark sources must be visible')
          check(document.body.innerText.includes('250.00'), 'Streamed mark must update the rendered header')
          check(client.getQueryData(key).data.candles.at(-1).close === 181, 'Actual streamed candle must update separately from the mark')
          useChartsStore.getState().setSymbol('NVDA'); await settle()
          check(historyRequests.filter(request => request.symbol === 'NVDA').length === 1, 'New ticker requests history once')
          useChartsStore.getState().setSymbol('AAPL'); await settle()
          check(historyRequests.filter(request => request.symbol === 'AAPL').length === 1, 'Returning to AAPL must reuse its prepared chart')
          check(!document.body.innerText.includes('Loading AAPL'), 'Cached ticker switch must not wait on another load')
          check(client.getQueryData(key).data.stats.price === 250, 'Switching back retains the streamed mark')
          window.finishProbe = () => app.unmount()
          return 'PASS: real Charts canvas, SMA, persistence, styles, replay, focus, labelled Hyperliquid source, streamed updates and cached ticker switches'
        }
        window.runStocksProbe = async () => {
          const calls = []
          window.api.stocks = async request => {
            calls.push(request)
            const stock = emptyStocksPayload(request.symbol)
            return envelope({ ...stock, generatedAt: Date.now(), chart: { candles, mfi: [], stats: buildStocksStats(request.symbol, candles) } })
          }
          useStocksPage.getState().setSymbol('AAPL')
          const app = createRoot(document.getElementById('root'))
          app.render(<QueryClientProvider client={client}><StocksPage onStatusChange={() => {}} onNavigate={() => {}} /></QueryClientProvider>)
          await settle(); await settle()
          const submit = async symbol => {
            const input = document.querySelector('input[aria-label="Stock ticker"]')
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, symbol)
            input.dispatchEvent(new Event('input', { bubbles: true })); await settle()
            input.form.requestSubmit(); await settle()
          }
          check(document.querySelectorAll('canvas').length > 0, 'Stocks chart canvas must render')
          await submit('NVDA')
          check(calls.filter(request => request.symbol === 'NVDA').length === 1, 'Stocks ticker switch must load exactly once')
          check(calls.every(request => !request.force), 'Changing Stocks tickers must preserve service caches')
          await submit('AAPL')
          check(calls.filter(request => request.symbol === 'AAPL').length === 1, 'Stocks revisit must reuse its cached query')
          check(document.body.innerText.includes('Loaded AAPL.'), 'Stocks revisit must be ready')
          await submit('AAPL')
          check(calls.at(-1).force === true, 'Explicit same-ticker reload must still refresh data')
          window.finishProbe = () => app.unmount()
          return 'PASS: Stocks canvas, single cached ticker requests, immediate revisits and explicit refresh'
        }
        window.runPortfolioChartsProbe = async () => {
          const prepared = new QueryClient({ defaultOptions: { queries: { retry: false } } })
          const book = (id, tickers, readOnly = false) => ({ id, name: id, tickers, holdings: {}, readOnly, options: [] })
          let books = [book('main', ['AAPL']), book('inactive', ['NVDA']), book('combined', ['AAPL', 'NVDA'], true)]
          window.api.portfolio = async () => envelope({ portfolios: books, activeId: 'main', mainId: 'main' })
          const saveBooks = () => prepared.setQueryData(queryKeys.portfolio, envelope({ portfolios: books, activeId: 'main', mainId: 'main' }))
          saveBooks()
          useDataHealth.getState().setStartup({ durationMs: 0, planned: 0, timings: [] })
          useDashboard.getState().setTimeframe('1 Day')
          useChartsStore.setState({ interval: '1 Day', range: '5Y', multiInterval: '1D' })
          const calls = []
          let failMsft = false
          const originalHistory = window.api.chartsHistory
          window.api.chartsHistory = async request => { calls.push(['history', request]); return originalHistory(request) }
          window.api.chart = async request => {
            calls.push(['dashboard', request])
            return envelope({ symbol: request.symbol, timeframe: request.timeframe, interval: '1d', candles,
              indicators: { ma200: [], rsi: [], rsiMa: [] }, stats: buildStocksStats(request.symbol, candles) })
          }
          window.api.stocks = async request => {
            calls.push(['stocks', request])
            if (failMsft && request.symbol === 'MSFT') return { ...envelope(null), meta: { source: 'fixture', freshness: 'failed', fetchedAt: Date.now(), failureReason: 'Fixture provider outage' } }
            return envelope({ ...emptyStocksPayload(request.symbol), generatedAt: Date.now(),
              chart: { candles, mfi: [], stats: buildStocksStats(request.symbol, candles) } })
          }
          const timers = new Map()
          const setIntervalOriginal = window.setInterval
          const clearIntervalOriginal = window.clearInterval
          window.setInterval = (callback, delay, ...args) => {
            const id = setIntervalOriginal(callback, delay, ...args)
            if (delay >= 60000) timers.set(id, callback)
            return id
          }
          window.clearInterval = id => { timers.delete(id); clearIntervalOriginal(id) }
          const app = createRoot(document.getElementById('root'))
          let reload
          function RefreshOwner() { reload = useReloadAll(); return null }
          const render = (chart = false) => app.render(<QueryClientProvider client={prepared}><div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <RefreshOwner />
            <div style={{ padding: 10 }}><PortfolioChartsStatus enabled /></div>
            {chart ? <MainWorkspace onStatus={() => {}} /> : null}
          </div></QueryClientProvider>)
          const memory = manageQueryMemory(prepared, { maxBytes: 1, maxQueries: 0 })
          const status = () => document.querySelector('[aria-label="Portfolio chart readiness"]')
          try {
            render(); await settle(); await settle()
            check(status()?.textContent === 'Portfolio charts 8/8 ready', 'Every book must prepare holding charts: ' + status()?.textContent)
            check(calls.length === 8 && calls.every(([, request]) => request.background && !request.force), 'Duplicate holdings must share paced background requests')
            books = [...books, book('new', ['MSFT'])]; saveBooks(); await settle()
            check(status()?.textContent === 'Portfolio charts 12/12 ready', 'A new holding must prepare without selecting its page')
            useChartsStore.getState().setInterval('1 Hour'); await settle()
            check(calls.filter(([kind, request]) => kind === 'history' && request.interval === '1 Hour').length === 3, 'New interval must prepare every holding')
            useDashboard.getState().setTimeframe('1 Hour'); await settle()
            check(calls.filter(([kind, request]) => kind === 'dashboard' && request.timeframe === '1 Hour').length === 3, 'New Dashboard timeframe must prepare every holding')
            await memory.sweep()
            check(prepared.getQueryData(queryKeys.stocks('NVDA')), 'Memory pressure must retain an inactive holding chart')
            const beforeRefresh = calls.length
            focusManager.setFocused(false)
            for (const callback of [...timers.values()]) callback()
            await settle()
            check(calls.length > beforeRefresh, 'Holding charts must refresh while the window is unfocused')
            focusManager.setFocused(true)
            const beforeReload = calls.length
            await reload(); await settle()
            check(calls.length > beforeReload && calls.slice(beforeReload).every(([, request]) => request.force), 'Explicit Reload must still bypass provider caches for prepared holdings')
            const previous = prepared.getQueryData(queryKeys.stocks('MSFT'))
            failMsft = true
            await prepared.refetchQueries({ queryKey: queryKeys.stocks('MSFT'), exact: true }); await settle()
            check(prepared.getQueryData(queryKeys.stocks('MSFT')) === previous, 'A provider outage must retain the last usable holding chart')
            check(status()?.textContent.includes('1 failed') && status()?.title.includes('Fixture provider outage'), 'Holding failures must stay visible')
            check(useDataHealth.getState().records['stocks:Portfolio MSFT · Stocks']?.failureReason.includes('Fixture provider outage'), 'Settings must retain the holding failure detail')
            failMsft = false
            await prepared.refetchQueries({ queryKey: queryKeys.stocks('MSFT'), exact: true }); await settle()
            check(status()?.textContent === 'Portfolio charts 12/12 ready', 'Recovered holding must become ready again')
            books = books.map(entry => ({ ...entry, tickers: entry.tickers.filter(symbol => symbol !== 'NVDA') })); saveBooks(); await settle()
            await memory.sweep()
            check(status()?.textContent === 'Portfolio charts 8/8 ready', 'Removed holdings must stop participating')
            check(!prepared.getQueryData(queryKeys.stocks('NVDA')), 'Removed holding queries must be releasable under memory pressure')
            const historyBeforeVisit = calls.filter(([kind]) => kind === 'history').length
            useChartsStore.getState().setSymbol('MSFT'); render(true); await settle()
            check(calls.filter(([kind]) => kind === 'history').length === historyBeforeVisit, 'Opening a prepared holding must not start another history load')
            check(document.querySelectorAll('canvas').length > 0 && document.body.innerText.includes('MSFT'), 'Prepared holding must render its chart immediately')
            window.finishProbe = () => { app.unmount(); memory.stop(); prepared.clear() }
            return 'PASS: all-portfolio chart preparation, deduplication, new/removed holdings, timeframe changes, memory retention, unfocused refresh, outage recovery and ready first visit'
          } catch (error) { app.unmount(); memory.stop(); prepared.clear(); throw error }
          finally { window.setInterval = setIntervalOriginal; window.clearInterval = clearIntervalOriginal; focusManager.setFocused(true) }
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find((file) => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1600, height: 950, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        require('node:fs').writeFileSync(${JSON.stringify(join(root, 'out/hyperliquid-charts-smoke.png'))}, (await window.webContents.capturePage()).toPNG())
        await window.webContents.executeJavaScript('window.finishProbe()')
        console.log(await window.webContents.executeJavaScript('window.runStocksProbe()'))
        require('node:fs').writeFileSync(${JSON.stringify(join(root, 'out/stocks-ticker-switches-smoke.png'))}, (await window.webContents.capturePage()).toPNG())
        await window.webContents.executeJavaScript('window.finishProbe()')
        console.log(await window.webContents.executeJavaScript('window.runPortfolioChartsProbe()'))
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        require('node:fs').writeFileSync(${JSON.stringify(join(root, 'out/portfolio-charts-ready-smoke.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
        await window.webContents.executeJavaScript('window.finishProbe()')
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Charts UI probe timed out')) }, 30_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  if (directory.startsWith(join(tmpdir(), 'budget-charts-ui-'))) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
