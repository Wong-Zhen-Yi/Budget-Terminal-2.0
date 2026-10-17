import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-technical-ui-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { TechnicalScreenPage } from './src/pages/TechnicalScreenPage'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 180))
        const body = () => document.body.innerText
        const row = (ticker, matches) => ({ ticker, name: ticker + ' Corp', exchange: 'NASDAQ', marketCap: 5e9, medianDollarVolume: ticker === 'AAA' ? 50e6 : 30e6,
          barDate: '2026-09-25', close: 110, sma50: 105, sma200: 100, previousSma50: 99, previousSma200: 100,
          rsi: 49, projectedRsi: 51, macd: 1, macdSignal: 1.1, macdGap: -0.1, projectedMacdGap: 0.1, matches })
        const payload = { rows: [
          row('AAA', { aboveSma200: true, goldenCross: true, rsiBreakout: false, macdBreakout: false }),
          row('BBB', { aboveSma200: false, goldenCross: false, rsiBreakout: true, macdBreakout: false }),
          row('CCC', { aboveSma200: false, goldenCross: false, rsiBreakout: false, macdBreakout: true }),
          row('EEE', { aboveSma200: true, goldenCross: false, rsiBreakout: false, macdBreakout: false }),
        ], universeCount: 6, scannedCount: 4, errors: { DDD: 'No history' }, excluded: { SPCX: 'Listed recently; 87 of 201 required completed daily bars available.' }, sourcedAt: new Date().toISOString(), completedAt: new Date().toISOString() }
        let calls = 0
        let mode = 'partial'
        let navigated = ''
        window.api.technicalScan = async () => {
          calls += 1
          return mode === 'failed'
            ? { data: null, meta: { source: 'fixture', freshness: 'failed', fetchedAt: Date.now(), failureReason: 'Offline' }, errors: [] }
            : { data: mode === 'empty' ? { ...payload, rows: [], scannedCount: 0, errors: {} } : payload,
                meta: { source: 'fixture', freshness: mode, fetchedAt: Date.now() }, errors: mode === 'partial' ? [{ source: 'fixture', reason: 'No history', operation: 'technicalScan', symbol: 'DDD' }] : [] }
        }
        const choose = async (value) => {
          const select = document.querySelector('select[aria-label="Technical screen"]')
          select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        }
        const clickScan = async () => { [...document.querySelectorAll('button')].find(button => button.textContent === 'Run scan').click(); await settle() }
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TechnicalScreenPage onStatusChange={() => {}} onNavigate={(tab, symbol) => { navigated = tab + ':' + symbol }} /></QueryClientProvider>)
          await settle()
          check(calls === 0 && body().includes('Run a scan to load technical results'), 'Unexpected automatic scan or missing empty state')
          await clickScan()
          check(calls === 1 && document.querySelectorAll('tbody tr').length === 2, 'Above SMA200 screen')
          check(document.querySelector('tbody tr').textContent.includes('AAA'), 'Default volume sort')
          Array.from(document.querySelectorAll('th')).find(header => header.textContent.includes('Ticker')).click(); await settle()
          check(document.querySelector('tbody tr').textContent.includes('EEE'), 'Ticker sort')
          check(body().includes('1 failed'), 'Partial failure count')
          check(body().includes('1 recent listings excluded') && body().includes('SPCX: Listed recently; 87 of 201'), 'Recent listing coverage must remain visible separately from failed requests')
          await choose('goldenCross')
          check(document.querySelectorAll('tbody tr').length === 1 && body().includes('AAA'), 'Golden cross screen')
          await choose('rsiBreakout')
          check(document.querySelectorAll('tbody tr').length === 1 && body().includes('BBB') && body().includes('Estimate:'), 'Projected RSI screen')
          await choose('macdBreakout')
          check(document.querySelectorAll('tbody tr').length === 1 && body().includes('CCC'), 'Projected MACD screen')
          check(calls === 1, 'Preset change triggered a scan')
          const input = document.querySelector('input[aria-label="Search technical results"]')
          const setInput = (value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }
          setInput('ZZZ'); await settle()
          check(body().includes('No matches for this search.'), 'Search empty state')
          setInput(''); await settle()
          document.querySelector('tbody tr').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
          check(navigated === 'stocks:CCC', 'Row navigation')
          mode = 'failed'; await clickScan()
          check(body().includes('Scan failed: Offline') && document.querySelectorAll('tbody tr').length === 1, 'Failed refresh must retain result')
          mode = 'empty'; await clickScan()
          check(body().includes('No stocks matched') && document.querySelectorAll('tbody tr').length === 0, 'Empty result state')
          const cached = { data: { ...payload, completedAt: new Date().toISOString() }, meta: { source: 'fixture', freshness: 'cached', fetchedAt: Date.now() }, errors: [] }
          client.setQueryData(['technicalScreen'], cached); await settle()
          check(document.querySelectorAll('tbody tr').length === 1 && calls === 3, 'Cached result restore')
          client.setQueryData(['technicalScreen'], { ...cached, data: { ...cached.data, completedAt: '2020-01-01T00:00:00Z' } }); await settle()
          check(body().includes('Saved scan expired') && document.querySelectorAll('tbody tr').length === 0, 'Expired cache must be hidden')
          return 'PASS: manual scan, four presets, sorting, search, navigation, failures, empty and cached results'
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
      const window = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { backgroundThrottling: false } })
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Technical UI probe timed out')) }, 30_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  if (directory.startsWith(join(tmpdir(), 'budget-technical-ui-'))) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
