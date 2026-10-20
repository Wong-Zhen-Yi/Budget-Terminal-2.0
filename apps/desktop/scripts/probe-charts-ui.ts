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
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { MainWorkspace } from './src/components/chartsworkstation/MainWorkspace'
        import { useChartsStore } from './src/stores/charts'
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
        window.api.chartsHistory = async request => envelope({
          symbol: request.symbol, intervalLabel: request.interval, rangeLabel: request.range,
          interval: '1d', candles, stats: null,
          indicators: { ma50: candles.map(row => ({ time: row.time, value: row.close - 24.5 })), ma200: [], rsi: [], rsiMa: [] },
        })
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
          app.unmount()
          return 'PASS: real Charts canvas, 50-day SMA default, toggle, persistence, price styles, replay and focus'
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
