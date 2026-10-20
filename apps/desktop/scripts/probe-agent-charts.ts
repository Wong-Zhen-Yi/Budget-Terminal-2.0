import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { parseAgentCandlestick, agentChartInstructions } from '../electron/shared/agentCharts.js'
import { agentHistoryCandles, agentHistoryStart } from '../src/lib/agentChartHistory.js'

assert.deepEqual(parseAgentCandlestick('{"title":"Apple history","symbol":" aapl "}'), { title: 'Apple history', symbol: 'AAPL' })
for (const symbol of ['^GSPC', 'BRK-B', 'BTC-USD', 'GC=F', 'EURUSD=X', '0700.HK']) assert(parseAgentCandlestick(JSON.stringify({ title: 'History', symbol })))
for (const symbol of ['', 'https://example.com', '../private', 'C:\\private', '<script>', 'AAPL SPY', 'A'.repeat(33)]) assert.equal(parseAgentCandlestick(JSON.stringify({ title: 'History', symbol })), null)
assert.equal(parseAgentCandlestick('{"title":"Missing reference"}'), null)
assert(agentChartInstructions.includes('Never truncate') && agentChartInstructions.includes('Max daily history'))
const base = { time: 1, open: -2, high: 0, low: -3, close: -1, volume: 0 }
assert.deepEqual(agentHistoryCandles([{ ...base, time: 2 }, base, { ...base, time: 2, close: 0 }, { ...base, time: 3, high: -4 }, { ...base, time: 4, open: Infinity }, { ...base, time: NaN }]), [base, { ...base, time: 2, close: 0 }])
const dates = ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-31'].map(value => ({ ...base, time: Date.parse(value) / 1000 }))
assert.equal(agentHistoryStart(dates, '1M'), 1, 'Month-end shortcuts clamp to the leap day, not March 2')
assert.equal(agentHistoryStart(dates, '1D'), 3)
assert.equal(agentHistoryStart(dates, 'Max'), 0)
assert.equal(agentHistoryStart(dates, 'YTD'), 0)

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-agent-charts-'))
try {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: String.raw`
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { AgentMarkdown } from './src/components/agents/AgentMarkdown'
      import { warmAgentWorkspace } from './src/api/agentsQueries'
      import { agentChartSymbols } from './src/lib/agentChartReferences'
      import { queryKeys } from './src/api/client'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 160))
      const fence = (symbol, marker = '\x60\x60\x60') => marker + 'candlestick\n' + JSON.stringify({ title: 'Full price history', symbol }) + '\n' + marker
      const root = createRoot(document.getElementById('root'))
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
      const candles = Array.from({ length: 12000 }, (_, index) => ({ time: Date.UTC(1990, 0, index + 1) / 1000, open: 100 + index / 100, high: 102 + index / 100, low: 99 + index / 100, close: 101 + index / 100, volume: 1000 }))
      let reads = 0, commands = 0, requests = [], failure = '', gate = null, text = fence('AAPL')
      const messages = [
        { role: 'assistant', text: fence('AAPL') + '\n' + fence('AAPL', '~~~~') },
        { role: 'assistant', text: fence('MSFT').split('\n').map(line => '> ' + line).join('\n') },
        { role: 'user', text: fence('NVDA') },
        { role: 'assistant', text: '\x60\x60\x60\x60text\n' + fence('GOOG') + '\n\x60\x60\x60\x60' },
        { role: 'assistant', text: fence('https://example.com') },
      ]
      const envelope = (data, freshness = 'fresh') => ({ data, meta: { source: 'Synthetic fixture, not live prices', freshness, fetchedAt: Date.now() }, errors: freshness === 'failed' || freshness === 'stale' ? [{ reason: 'Synthetic provider outage' }] : [] })
      window.api.agentsStatus = async () => { reads++; return envelope({ messages }) }
      window.api.agentsCommand = async () => { commands++; throw Error('Charts must never start inference') }
      window.api.chartsHistory = async request => {
        requests.push({ ...request })
        if (gate) await gate
        const intraday = request.interval.includes('Minute') || request.interval.includes('Hour')
        const rows = failure === 'failed' || failure === 'empty' ? [] : failure === 'invalid' ? candles.map(row => ({ ...row, high: -1 })) : failure === 'mixed' ? [{ ...candles[0], high: -1 }, ...candles.slice(1)] : intraday ? candles.slice(-60).map((row, index) => ({ ...row, time: candles.at(-1).time + index * 60 })) : candles
        return envelope({ symbol: request.symbol, intervalLabel: request.interval, rangeLabel: request.range, interval: 'fixture', candles: rows, stats: { currency: 'USD' }, indicators: { ma50: [], ma200: [], rsi: [], rsiMa: [] } }, ['empty', 'invalid', 'mixed'].includes(failure) ? 'fresh' : failure || 'fresh')
      }
      const render = async () => {
        root.render(<QueryClientProvider client={client}><div className="agents-page"><AgentMarkdown text={text} /></div></QueryClientProvider>)
        await settle(); await settle()
      }
      const card = () => document.querySelector('.agents-market-chart')
      const click = async label => {
        const button = [...card().querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label)
        check(button && !button.disabled, 'Missing/disabled ' + label); button.click(); await settle()
      }
      const select = async (label, value) => {
        const input = card().querySelector('[aria-label="' + label + '"]'); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); await settle(); await settle()
      }
      const visible = () => Number(card().querySelector('[data-visible-bars]').dataset.visibleBars)
      window.runProbe = async () => {
        check(JSON.stringify(agentChartSymbols(messages)) === JSON.stringify(['AAPL', 'MSFT']), 'Match actual Markdown fences, quotes, deduplicate; ignore user text, code examples and unsafe references')
        await warmAgentWorkspace(client, 8)
        check(reads === 1 && requests.length === 2 && requests.every(request => request.background && request.backgroundOrder === 8 && request.range === 'Max'), 'Warm every restored chat symbol before first page visit, in the background lane')
        await render()
        check(requests.length === 2 && commands === 0 && card().querySelectorAll('canvas').length > 0, 'First visit paints real chart canvas from startup cache without fetching or inference')
        check(card().querySelector('[data-history-count]').dataset.historyCount === '12000' && visible() === 12000, 'All 12,000 bars loaded AND visible by default; no 200-bar or minimum-spacing truncation')
        check(card().querySelector('[aria-pressed=true]').textContent === 'Max', 'Default Max range')
        const count = requests.length
        for (const range of ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y']) {
          await click(range)
          check(card().querySelector('[aria-pressed=true]').textContent === range && visible() < 12000, 'Range shortcut changes the real viewport: ' + range)
        }
        check(requests.length === count && card().querySelector('[data-history-count]').dataset.historyCount === '12000', 'Shorter views retain the full source data and need no additional requests')
        await click('Max')
        await click('AAPL zoom in'); check(visible() < 12000, 'Zoom changes real visible logical range')
        const canvas = card().querySelector('.agents-history-canvas')
        const beforePan = card().querySelector('[data-visible-from]').dataset.visibleFrom
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await settle()
        check(card().querySelector('[data-visible-from]').dataset.visibleFrom !== beforePan, 'Keyboard panning moves the viewport')
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await settle()
        check(visible() === 12000 && card().querySelector('[aria-pressed=true]').textContent === 'Max', 'Keyboard Home restores all history')
        await click('1Y')
        const preservedCanvas = card().querySelector('canvas')
        text += '\n\nMore streamed analysis.'; await render()
        check(card().querySelector('canvas') === preservedCanvas && card().querySelector('[aria-pressed=true]').textContent === '1Y', 'Streaming must preserve the chart instance and selected timeframe')
        await select('AAPL chart style', 'line')
        check(card().querySelector('[aria-pressed=true]').textContent === '1Y', 'Switching price style preserves the view')
        const details = card().querySelector('details'); details.open = true; await settle()
        check(details.querySelectorAll('tbody tr').length === 100 && details.textContent.includes('12,000'), 'Exact full-history table is lazily paginated, not 12,000 DOM rows')
        await click('Last')
        check(details.querySelector('tbody').textContent.includes(String(candles.at(-1).close)), 'Last page includes exact latest OHLC')
        details.open = false; await settle()
        await select('AAPL candle interval', '1 Week')
        check(requests.at(-1).range === 'Max' && card().querySelector('[aria-pressed=true]').textContent === 'Max', 'New intervals also load full history and reset to Max')
        await select('AAPL candle interval', '1 Month')
        check(requests.at(-1).range === 'Max', 'Monthly history is Max too')
        await select('AAPL candle interval', '1 Minute')
        check(card().textContent.includes('at most 6 days') && card().querySelector('[data-history-count]').dataset.historyCount === '60', 'Intraday provider retention is disclosed, never mislabeled as all daily history')
        await select('AAPL candle interval', '1 Day')
        check(visible() === 12000 && requests.length === count + 3, 'Returning to daily reuses full-history cache')
        failure = 'stale'; await client.invalidateQueries({ queryKey: queryKeys.chartsHistory('AAPL', '1 Day', 'Max') }); await settle()
        check(card().textContent.includes('Stale cached history; coverage may be incomplete'), 'Stale coverage remains visible')
        failure = 'failed'; text = fence('FAIL'); await render()
        check(card().querySelector('[role=alert]').textContent.includes('Synthetic provider outage') && !card().querySelector('[data-history-count]'), 'Provider failures cannot pretend to have full history')
        failure = ''; await click('Retry history')
        check(card().querySelector('[data-history-count]').dataset.historyCount === '12000', 'Failed history can be retried inline')
        let release; gate = new Promise(resolve => { release = resolve }); text = fence('WAIT'); await render()
        check(card().textContent.includes('Loading full available') && !card().querySelector('[data-history-count]'), 'Loading is explicit and cannot show another symbol under the new label')
        release(); gate = null; await settle(); await settle()
        failure = 'failed'
        const failedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        let startupError
        try { await warmAgentWorkspace(failedClient) } catch (error) { startupError = error }
        check(startupError?.state === 'failed' && startupError.message.includes('AAPL'), 'Startup failures identify the chart and keep Agents failed, not silently ready')
        failedClient.clear()
        for (const [mode, expected] of [['empty', 'failed'], ['invalid', 'failed'], ['mixed', 'degraded']]) {
          failure = mode
          const invalidClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
          let problem
          try { await warmAgentWorkspace(invalidClient) } catch (error) { problem = error }
          check(problem?.state === expected, 'Startup validates OHLC coverage for ' + mode + ' data')
          invalidClient.clear()
        }
        failure = ''
        text = '\x60\x60\x60candlestick\n' + JSON.stringify({ title: 'Old saved chart', candles: [{ time: '2026-10-16', open: 1, high: 2, low: 0, close: 1.5 }] }) + '\n\x60\x60\x60'
        await render()
        check(document.body.textContent.includes('Provided data only') && !card(), 'Legacy samples are honestly labeled, not passed off as full history')
        const input = document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'AAPL'); input.dispatchEvent(new Event('input', { bubbles: true })); await settle()
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle()
        check(card() && visible() === 12000, 'Older provided-data charts can be upgraded to full history with an explicit ticker')
        check(commands === 0, 'All interactions are display-only, never Agent sends')
        await client.invalidateQueries({ queryKey: queryKeys.chartsHistory('AAPL', '1 Day', 'Max') }); await settle()
        window.checkLayout = async () => { await settle(); check(document.documentElement.scrollWidth <= innerWidth && visible() === 12000, 'Narrow chat retains full Max view without overflow'); return 'PASS: full-history chart at ' + innerWidth + 'px' }
        return 'PASS: full 12,000-bar native charts, startup preloading/failures, shared cache, range shortcuts, intervals, zoom/pan/keyboard, streaming stability, paginated exact OHLC, provider limits, stale/failed/loading/retry states, safe references and legacy upgrade; no inference'
      }
    ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))!
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>body{margin:0;padding:12px}#root{max-width:950px;margin:auto}</style><div id="root"></div><script>window.api={};window.probeErrors=[];window.addEventListener("error",event=>window.probeErrors.push(event.message))</script><script src="renderer.js"></script>')
  const screenshot = resolve(root, '../../output/playwright/agents-full-history.png')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const { mkdirSync, writeFileSync } = require('node:fs')
    app.disableHardwareAcceleration()
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1100, height: 1000, webPreferences: { backgroundThrottling: false, offscreen: true } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        for (const width of [420, 900, 1600]) {
          window.setSize(width, 1000)
          console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
        }
        const errors = await window.webContents.executeJavaScript('window.probeErrors')
        if (errors.length) throw Error(errors.join('; '))
        window.setSize(1100, 1000)
        await new Promise(resolve => setTimeout(resolve, 250))
        const position = await window.webContents.executeJavaScript('(() => { const box = document.querySelector(".agents-history-canvas").getBoundingClientRect(); return { x: Math.round(box.left + box.width * 0.4), y: Math.round(box.top + box.height * 0.4), readout: document.querySelector(".agents-history-ohlc").textContent, range: document.querySelector("[data-visible-from]").dataset.visibleFrom } })()')
        window.webContents.sendInputEvent({ type: 'mouseMove', x: position.x, y: position.y })
        await new Promise(resolve => setTimeout(resolve, 180))
        const hovered = await window.webContents.executeJavaScript('document.querySelector(".agents-history-ohlc").textContent')
        if (hovered === position.readout) throw Error('Real mouse hover must update crosshair OHLC')
        window.webContents.sendInputEvent({ type: 'mouseWheel', x: position.x, y: position.y, deltaY: -200, deltaX: 0 })
        await new Promise(resolve => setTimeout(resolve, 180))
        const zoomed = await window.webContents.executeJavaScript('document.querySelector("[data-visible-from]").dataset.visibleFrom')
        if (zoomed === position.range) throw Error('Real mouse wheel must zoom the chart')
        window.webContents.sendInputEvent({ type: 'mouseDown', x: position.x, y: position.y, button: 'left', clickCount: 1 })
        await new Promise(resolve => setTimeout(resolve, 40))
        window.webContents.sendInputEvent({ type: 'mouseMove', x: position.x + 10, y: position.y })
        await new Promise(resolve => setTimeout(resolve, 40))
        window.webContents.sendInputEvent({ type: 'mouseMove', x: position.x + 70, y: position.y })
        await new Promise(resolve => setTimeout(resolve, 40))
        window.webContents.sendInputEvent({ type: 'mouseMove', x: position.x + 130, y: position.y, modifiers: ['leftButtonDown'] })
        await new Promise(resolve => setTimeout(resolve, 40))
        window.webContents.sendInputEvent({ type: 'mouseUp', x: position.x + 130, y: position.y, button: 'left', clickCount: 1 })
        await new Promise(resolve => setTimeout(resolve, 180))
        const panned = await window.webContents.executeJavaScript('document.querySelector("[data-visible-from]").dataset.visibleFrom')
        if (panned === zoomed) throw Error('Real mouse drag must pan the chart')
        console.log('PASS: real mouse crosshair OHLC, wheel zoom and drag pan')
        await window.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(button => button.textContent === "Reset view").click()')
        await new Promise(resolve => setTimeout(resolve, 250))
        const pane = await window.webContents.executeJavaScript('(() => { const canvas = [...document.querySelectorAll(".agents-history-canvas canvas")].find(canvas => canvas.getBoundingClientRect().height > 150 && canvas.getBoundingClientRect().width > 100); const box = canvas.getBoundingClientRect(); return { left: Math.round(box.left + 3), right: Math.round(box.right - 3), y: Math.round(box.top + box.height * 0.4) } })()')
        for (const [x, year] of [[pane.left, '1990-'], [pane.right, '2022-']]) {
          window.webContents.sendInputEvent({ type: 'mouseMove', x, y: pane.y })
          await new Promise(resolve => setTimeout(resolve, 180))
          const readout = await window.webContents.executeJavaScript('document.querySelector(".agents-history-ohlc").textContent')
          if (!readout.startsWith(year)) throw Error('Max must expose both ends of the actual full-history plot: ' + readout)
        }
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 })
        await new Promise(resolve => setTimeout(resolve, 180))
        mkdirSync(${JSON.stringify(resolve(root, '../../output/playwright'))}, { recursive: true })
        writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG())
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Agent chart probe timed out')) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshot:', screenshot)
} finally {
  assert(directory.startsWith(join(tmpdir(), 'budget-agent-charts-')))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
