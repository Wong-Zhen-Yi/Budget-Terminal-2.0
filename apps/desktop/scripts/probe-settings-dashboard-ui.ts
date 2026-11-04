import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-settings-dashboard-'))
const screenshots = join(root, 'out/maintenance')
const electron = createRequire(import.meta.url)('electron') as string
const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
delete env.ELECTRON_RUN_AS_NODE
try {
  await mkdir(screenshots, { recursive: true })
  const assets = join(root, 'out/renderer/assets')
  const stylesheet = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(stylesheet, 'Build the app before running this probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, stylesheet)))
  await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { AppDashboard } from './src/components/settings/AppDashboard'
    import { useDataHealth } from './src/stores/dataHealth'
    import { queryKeys } from './src/api/client'
    import { DEFAULT_CACHE_SETTINGS } from './electron/shared/cachePolicy'
    import './src/styles/settings.css'
    const check = (value, message) => { if (!value) throw Error(message) }
    const wait = () => new Promise(resolve => setTimeout(resolve, 80))
    const envelope = data => ({ data, errors: [], meta: { source: 'Synthetic fixture', freshness: 'fresh', fetchedAt: Date.now() } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(queryKeys.portfolio, envelope({ portfolios: [{ readOnly: false, holdings: { PRIVATE: {} } }]}))
    client.setQueryData(queryKeys.personalFinance, envelope({ cash: [{ amount: 987654.32 }], debt: [{ amount: -500 }], recurringBills: [] }))
    client.setQueryData(queryKeys.cards, envelope({ customCards: [{}, {}] }))
    client.setQueryData(queryKeys.articles, envelope({ articles: [{}, {}, {}] }))
    client.setQueryData(queryKeys.agents, envelope({ messages: [] }))
    client.setQueryData(['stocks', 'SYNTHETIC'], envelope({}))
    useDataHealth.setState({ startup: { planned: 5, durationMs: 1000,
      pages: { stocks: { state: 'ready' }, charts: { state: 'loading' }, news: { state: 'degraded' }, crypto: { state: 'failed' }, agents: { state: 'idle' } },
      timings: [{ tab: 'stocks', label: 'Stocks', durationMs: 8400, failed: false }] },
      records: { fixture: { page: 'stocks', label: 'Feed', source: 'Fixture', fetchedAt: Date.now(), freshness: 'fresh', failureReason: '', errors: [] } } })
    const partition = { bytes: 10485760, entries: 20, expiredEntries: 2, evictions: 1 }
    let fail = false
    window.api.apiUsage = async () => {
      if (fail) throw Error('synthetic private error must not appear')
      return { sampledAt: Date.now(), providers: ['Yahoo', 'CoinGecko', 'Hyperliquid', 'Alt.me', 'DefeatBeta'].map((label, index) => ({ id: label, label, inFlight: index, ...(index === 0 ? { queued: 2 } : {}), latencyMs: { p50: 200, p95: 600, samples: 20 }, requestCount: index * 10, windowSeconds: 60 })) }
    }
    window.api.cacheStatus = async () => envelope({ settings: DEFAULT_CACHE_SETTINGS, service: { market: partition, assets: partition, hits: 90, misses: 10, errors: 4 } })
    window.api.mcpStatus = async () => ({ available: true, diagnostics: { activity: [{ state: 'success' }, { state: 'failed' }] } })
    window.api.appMetrics = async () => envelope({ memory: [{ at: Date.now(), mainMiB: 100, rendererMiB: 300, otherMiB: 50 }], backup: { state: 'available', bytes: 524288, savedAt: Date.now() } })
    let refresh
    let cleared = false
    const interval = window.setInterval
    const clear = window.clearInterval
    window.setInterval = (callback, ms, ...args) => { if (ms === 5000) refresh = callback; return interval(callback, ms, ...args) }
    window.clearInterval = id => { cleared = true; return clear(id) }
    let settings = { hiddenTabs: [], obscuredTabs: ['portfolio', 'personal-finance'], lastBackupAt: Date.now() }
    const root = createRoot(document.getElementById('root'))
    const render = () => root.render(<QueryClientProvider client={client}><div className="settings-page"><header className="settings-toolbar"><nav className="settings-tabs"><button aria-pressed="true">App dashboard</button><button>Workspace</button><button>Privacy</button><button>Data &amp; storage</button><button>Integrations</button><button>Diagnostics</button></nav></header><div className="settings-dashboard-host"><AppDashboard settings={settings} /></div></div></QueryClientProvider>)
    render()
    window.checkLayout = async () => {
      await wait()
      check(document.querySelectorAll('.app-dash-card').length === 18, 'Expected all 18 chart cards')
      const targets = [document.documentElement, document.body, document.querySelector('.settings-dashboard-host'), document.querySelector('.app-dashboard')]
      for (const target of targets) check(target.scrollHeight <= target.clientHeight + 1 && target.scrollWidth <= target.clientWidth + 1, 'Desktop dashboard must have no scrollbar: ' + target.className)
      for (const card of document.querySelectorAll('.app-dash-card')) {
        const rect = card.getBoundingClientRect()
        check(rect.bottom <= innerHeight && rect.right <= innerWidth, 'Chart clipped outside viewport')
        check(card.scrollHeight <= card.clientHeight + 1, 'Chart content overflows: ' + card.textContent)
      }
      check(!document.body.textContent.includes('987,654'), 'Private balance exposed')
      check(!document.body.textContent.includes('PRIVATE'), 'Private ticker exposed')
      check(document.body.textContent.includes('Protected in Settings'), 'Privacy placeholder missing')
      check(document.body.textContent.includes('90.0%'), 'Hit rate must use hits / (hits + misses), excluding load errors')
      check(!document.querySelector('.app-dash-heading') && !document.body.textContent.includes('Your terminal, in numbers.'), 'Removed heading returned')
      check(document.querySelector('.app-dash-latency'), 'Provider latency must render real samples')
      check(!document.body.textContent.includes('not collected'), 'Unimplemented telemetry placeholder returned')
      check(document.body.textContent.includes('0.5'), 'Current automatic backup size missing')
      check(document.querySelectorAll('.app-dash-line').length === 2, 'Request and memory charts must render from first sample')
      check(document.querySelector('.app-dash-line svg').getAttribute('aria-label').includes('Active 10, Known queued 2'), 'Missing queues must not block active counts or fabricate queue totals')
      check(!document.querySelector('svg [stroke-dasharray="NaN"]'), 'Invalid chart geometry')
      return 'PASS: 18 cards, no scrolling or clipping, privacy and real metrics'
    }
    window.checkBehavior = async () => {
      await refresh(); await wait()
      check(document.querySelector('.app-dash-line polyline'), 'Second sample must draw activity history')
      fail = true; await refresh(); await wait()
      check(document.body.textContent.includes('Providers updates unavailable'), 'Provider failure missing')
      check(document.querySelector('.app-dash-line polyline'), 'Failed refresh lost saved sample')
      check(!document.body.textContent.includes('synthetic private error'), 'Raw error leaked')
      settings = { ...settings, obscuredTabs: [] }; render(); await wait()
      check(document.body.textContent.includes('987,654.3'), 'Unprotected saved balance missing')
      check(document.body.textContent.includes('-500'), 'Negative saved balance discarded')
      check(document.querySelector('.app-dash-bar-signed'), 'Negative balances need signed scale')
      client.clear(); useDataHealth.setState({ startup: null, records: {} }); await refresh(); await wait()
      check(!document.querySelector('[stroke-dasharray*="NaN"]'), 'Empty data produced invalid geometry')
      root.unmount(); check(cleared, 'Dashboard must clear its sampling interval')
      return 'PASS: history, failures, diagnostics, negative balances, empty data and cleanup'
    }
  ` }, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', outfile: join(directory, 'ui.js') })
  await writeFile(join(directory, 'index.html'), `<html><head><link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="ui.css"><style>*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;font-family:Arial;background:#080d14;color:#d5e5f5}#root{display:flex;padding-top:94px;padding-left:64px}button{font:inherit}</style></head><body><div id="root"></div><script>window.api={}</script><script src="ui.js"></script></body></html>`)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const fs = require('node:fs/promises')
    app.disableHardwareAcceleration()
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        for (const [width, height] of [[1600,1000],[1920,1080],[1366,768]]) {
          window.setContentSize(width, height)
          console.log(width + 'x' + height + ': ' + await window.webContents.executeJavaScript('window.checkLayout()'))
          if (width === 1600) await fs.writeFile(${JSON.stringify(join(screenshots, 'settings-dashboard.png'))}, (await window.webContents.capturePage()).toPNG())
        }
        console.log(await window.webContents.executeJavaScript('window.checkBehavior()'))
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const result = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
    const child = spawn(electron, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', chunk => { text += chunk })
    child.stderr.on('data', chunk => { text += chunk })
    const timer = setTimeout(() => { child.kill(); reject(Error('Dashboard UI probe timed out: ' + text)) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, text }) })
  })
  assert.equal(result.code, 0, result.text)
  console.log(result.text.trim())
} finally {
  assert(resolve(directory).startsWith(resolve(tmpdir()) + sep), 'Cleanup must stay inside the temporary directory')
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
