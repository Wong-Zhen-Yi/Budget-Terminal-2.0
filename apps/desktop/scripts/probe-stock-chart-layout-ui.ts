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
    plugins: [{
      name: 'inspect-real-charts',
      setup(build) {
        build.onResolve({ filter: /^lightweight-charts$/ }, () => ({ path: 'charts', namespace: 'inspect-charts' }))
        build.onLoad({ filter: /.*/, namespace: 'inspect-charts' }, () => ({
          resolveDir: root,
          contents: `
            export * from ${JSON.stringify(resolve(root, '../../node_modules/lightweight-charts/dist/lightweight-charts.production.mjs'))}
            import { createChart as create } from ${JSON.stringify(resolve(root, '../../node_modules/lightweight-charts/dist/lightweight-charts.production.mjs'))}
            export function createChart(...args) {
              const chart = create(...args)
              chart.performance = { replacements: 0, updates: 0, candleReplacements: 0 }
              const add = chart.addSeries.bind(chart)
              chart.addSeries = (...args) => {
                const series = add(...args)
                const set = series.setData.bind(series), update = series.update.bind(series)
                const candle = args[0].type === 'Candlestick'
                series.setData = (...args) => { chart.performance.replacements++; if (candle) chart.performance.candleReplacements++; return set(...args) }
                series.update = (...args) => { chart.performance.updates++; return update(...args) }
                return series
              }
              window.lastChart = chart
              return chart
            }
          `,
        }))
      },
    }],
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { PriceChart } from './src/charts/PriceChart'
        import { CandlestickChart } from './src/components/charts/CandlestickChart'
        import { MiniChart } from './src/components/chartsworkstation/MiniChart'
        import { MainWorkspace } from './src/components/chartsworkstation/MainWorkspace'
        import { useChartsStore } from './src/stores/charts'
        import { applyEquityMarketUpdate } from './src/api/equityStream'
        import { queryKeys } from './src/api/client'
        import { StocksPage } from './src/pages/StocksPage'
        import { useStocksPage } from './src/stores/stocks'
        import { emptyStocksPayload, buildStocksStats } from './electron/shared/stocks'
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
          const assertPosition = () => {
            const scale = window.lastChart.timeScale()
            const fraction = scale.logicalToCoordinate(candles.length - 1) / scale.width()
            check(Math.abs(fraction - 0.65) < 0.02, 'Latest bar must leave 35% right space: ' + fraction)
          }
          assertPosition()
          const requestsBeforeToggles = historyRequests.length
          for (const [volume, rsi] of [[false, false], [false, true], [true, true], [true, false], [false, true], [false, false], [true, false]]) {
            const state = useChartsStore.getState()
            if (state.indicators.volume !== volume) await click('Volume')
            if (useChartsStore.getState().indicators.rsi !== rsi) await click('RSI')
            check(window.lastChart.panes().length === 1 + Number(volume) + Number(rsi), 'Disabled panes must disappear for volume=' + volume + ', RSI=' + rsi)
            assertPosition()
          }
          check(historyRequests.length === requestsBeforeToggles, 'Indicator toggles must reuse loaded data')
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
          const performanceBefore = { ...window.lastChart.performance }
          applyEquityMarketUpdate(client, { quotes: [{ symbol: 'AAPL', price: 250, change: 25, absChange: 50, currency: 'USD', priceBasis: 'equity-perp-mark', changeBasis: '24h', source: 'Hyperliquid equity perp (xyz:AAPL)' }],
            candles: [{ symbol: 'AAPL', market: 'xyz:AAPL', interval: '1d', candle: { ...last, close: 181, high: 182 } }] })
          await settle()
          check(document.body.innerText.includes('Hyperliquid equity perp (xyz:AAPL)'), 'Chart and mark sources must be visible')
          check(document.body.innerText.includes('250.00'), 'Streamed mark must update the rendered header')
          check(client.getQueryData(key).data.candles.at(-1).close === 181, 'Actual streamed candle must update separately from the mark')
          check(window.lastChart.performance.candleReplacements === performanceBefore.candleReplacements, 'A live candle must not replace the full chart history')
          check(window.lastChart.performance.updates > performanceBefore.updates, 'A live candle must use incremental chart updates')
          useChartsStore.getState().setAutoFollow(false)
          useChartsStore.getState().setSymbol('NVDA'); await settle()
          assertPosition()
          check(historyRequests.filter(request => request.symbol === 'NVDA').length === 1, 'New ticker requests history once')
          useChartsStore.getState().setSymbol('AAPL'); await settle()
          check(historyRequests.filter(request => request.symbol === 'AAPL').length === 1, 'Returning to AAPL must reuse its prepared chart')
          check(!document.body.innerText.includes('Loading AAPL'), 'Cached ticker switch must not wait on another load')
          check(client.getQueryData(key).data.stats.price === 250, 'Switching back retains the streamed mark')
          window.finishProbe = () => app.unmount()
          return 'PASS: Charts 35% right space, all volume/RSI pane combinations, SMA, styles, replay, focus, live updates and ticker switches with Auto off'
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
          const scale = window.lastChart.timeScale()
          check(Math.abs(scale.logicalToCoordinate(candles.length - 1) / scale.width() - 0.65) < 0.02, 'Stocks must share the 35% right space')
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
        window.runSharedLayoutProbe = async () => {
          const app = createRoot(document.getElementById('root'))
          const data = { symbol: 'AAPL', candles, indicators: { ma200: [], rsi: [], rsiMa: [] } }
          let componentName = ''
          const position = () => {
            const scale = window.lastChart.timeScale()
            const ratio = scale.logicalToCoordinate(79) / scale.width()
            check(Math.abs(ratio - 0.65) < 0.02, 'Shared chart right spacing ' + componentName + ': ' + ratio + ', range ' + JSON.stringify(scale.getVisibleLogicalRange()))
          }
          for (const component of [<CandlestickChart candles={candles} />, <MiniChart payload={data} style="candles" active />, <PriceChart payload={data} indicators={{ volume: true, rsi: true, ma200: true }} />]) {
            componentName = component.type.name
            app.render(component); await settle(); position()
            const host = window.lastChart.chartElement().parentElement
            host.style.flex = 'none'; host.style.width = '700px'; host.style.height = '500px'
            await settle(); position()
            check(window.lastChart.timeScale().width() < 700, 'Auto-size must follow the smaller host')
          }
          for (const [volume, rsi] of [[false, true], [false, false], [true, false], [true, true]]) {
            app.render(<PriceChart payload={data} indicators={{ volume, rsi, ma200: true }} />)
            await settle()
            check(window.lastChart.panes().length === 1 + Number(volume) + Number(rsi), 'Dashboard hidden pane must disappear')
            position()
          }
          app.unmount()
          return 'PASS: shared candle charts, Multi Charts and Dashboard spacing, resize and complete indicator pane removal'
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
      const window = new BrowserWindow({ show: true, width: 1600, height: 950, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        require('node:fs').writeFileSync(${JSON.stringify(join(root, 'out/hyperliquid-charts-smoke.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
        await window.webContents.executeJavaScript('window.finishProbe()')
        console.log(await window.webContents.executeJavaScript('window.runStocksProbe()'))
        require('node:fs').writeFileSync(${JSON.stringify(join(root, 'out/stocks-ticker-switches-smoke.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
        await window.webContents.executeJavaScript('window.finishProbe()')
        console.log(await window.webContents.executeJavaScript('window.runSharedLayoutProbe()'))
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Charts UI probe timed out')) }, 60_000)
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
