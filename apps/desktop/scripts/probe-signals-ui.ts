import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-signals-ui-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { SignalsPage } from './src/pages/SignalsPage'
        import { evaluateDayTrading } from './electron/shared/dayTrading'
        const now = Date.parse('2026-09-29T13:36:30Z')
        Date.now = () => now
        const open = Date.parse('2026-09-29T13:30:00Z')
        const bars = Array.from({ length: 6 }, (_, i) => ({ timestamp: open + i * 60000, open: 100, high: i === 5 ? 103 : 101, low: 99, close: i === 5 ? 102 : 100, volume: 1000 }))
        let rows = [...evaluateDayTrading('FRESH', bars, now), ...evaluateDayTrading('WAIT', [], now), ...evaluateDayTrading('LATE', bars, now).map(row => ({ ...row, barTime: new Date(open + 60000).toISOString() }))]
        let scans = 0
        let failed = false
        const envelope = () => ({ data: { version: 5, session: '2026-09-29', marketOpen: true, candidates: [{ ticker: 'FRESH' }, { ticker: 'WAIT' }, { ticker: 'LATE' }], results: rows, errors: {}, completedAt: new Date(now).toISOString() }, meta: { freshness: 'fresh', fetchedAt: now, source: 'Fixture' }, errors: [] })
        window.api.signals = async request => {
          if (!request.latestOnly) scans++
          return failed ? { ...envelope(), meta: { freshness: 'failed', fetchedAt: now, failureReason: 'Fixture offline' } } : envelope()
        }
        const settings = { data: { signalsPage: { filter: 'all', setup: 'all', search: '' } }, meta: { freshness: 'fresh' }, errors: [] }
        window.api.settings = async () => settings
        window.api.mutateSettings = async () => settings
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 180))
        const body = () => document.body.innerText
        const refresh = async () => { [...document.querySelectorAll('button')].find(button => button.textContent === 'Refresh now').click(); await settle() }
        let health
        const onStatusChange = panels => { health = panels[0].envelope?.meta.freshness }
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><SignalsPage onStatusChange={onStatusChange} /></QueryClientProvider>)
          await settle()
          check(scans === 1, 'Initial active-session scan')
          check(body().includes('1/3 stocks current') && body().includes('1 awaiting candles · 1 delayed'), 'Feed counts distinguish missing and delayed stocks')
          check(health === 'partial', 'Footer must not report healthy data for unavailable candles')
          check(document.querySelectorAll('tbody tr').length === 6, 'Two setups per stock')
          const choose = async value => {
            const select = document.querySelector('select[aria-label="Status filter"]')
            select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
          }
          await choose('awaiting_data')
          check(document.querySelectorAll('tbody tr').length === 2 && body().includes('Yahoo has not returned a completed candle'), 'Awaiting-candle filter and explanation')
          await choose('all')
          const target = [...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes('FRESH') && row.textContent.includes('VWAP'))
          target.click(); await settle()
          rows = rows.map(row => ({ ...row, id: row.id + ':updated' }))
          await refresh()
          check(scans === 2, 'Manual refresh calls scanner')
          check(document.querySelector('aside h2').textContent.includes('FRESH · VWAP'), 'Selection survives changed signal IDs')
          failed = true; await refresh()
          check(body().includes('Refresh failed: Fixture offline'), 'Failed refresh banner')
          check(![...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('Ready')), 'Failed scan suppresses ready signals')
          failed = false; await refresh()
          await choose('ready')
          check(document.querySelectorAll('tbody tr').length === 1, 'Healthy refresh restores Ready filtering')
          await choose('all')
          check(document.documentElement.scrollWidth <= window.innerWidth, 'Page must not overflow the viewport')
          return 'PASS: feed health, missing/delayed states, filtering, refresh, stable selection and failure recovery'
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
        require('fs').writeFileSync(${JSON.stringify(join(root, 'out', 'signals-smoke.png'))}, (await window.webContents.capturePage()).toPNG())
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Day Trading UI probe timed out')) }, 30_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  if (directory.startsWith(join(tmpdir(), 'budget-signals-ui-'))) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
