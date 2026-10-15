import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-valuation-ui-'))
const screenshot = join(root, 'out', 'valuation-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { ValuationPage } from './src/pages/ValuationPage'
        import { deriveValuationSuggestions } from './electron/shared/valuation'
        import { useValuationPage } from './src/stores/valuation'
        import { queryKeys } from './src/api/client'
        import { queryFreshness } from './src/api/queryPersistence'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 100))
        const text = () => document.body.innerText
        const calls = []
        let mode = 'fresh'
        let release
        let hold = false
        let panels = []
        let unhandled = []
        window.addEventListener('unhandledrejection', event => unhandled.push(String(event.reason)))
        const status = next => { panels = next }
        const fixture = symbol => {
          const metrics = {
            ticker: symbol, companyName: symbol === 'NVDA' ? 'NVIDIA Corporation' : 'Nebius Group N.V.',
            price: 186, previousClose: 180, currency: 'USD', financialCurrency: 'USD', currencyMismatch: false,
            basisType: 'FCF', basisValue: 5, fcfPerShare: 5, eps: 4, beta: 1.2,
            sector: 'Technology', industry: 'Software', marketCap: 10e9, freeCashFlow: 5e8,
            pe: 46.5, forwardPe: 30, ps: 8, pb: 4, evEbitda: 20, fcfYield: 5,
            earningsYield: 2.2, peg: 1.5, dividendYield: 0, revenueGrowth: 15,
            cash: 1e9, debt: 5e8, netDebt: -5e8, netMargin: 10
          }
          const trends = {
            labels: ['2021','2022','2023','2024','2025'], revenue: [1e9,2e9,3e9,4e9,5e9],
            fcf: [1e8,2e8,3e8,4e8,5e8], eps: [1,2,3,3.5,4], fcfPerShare: [1,2,3,4,5],
            perShareApproximate: false, perShareSource: 'Reported shares', comparableHistoryPoints: 5
          }
          return {
            ticker: symbol, metrics, trends, suggestions: deriveValuationSuggestions(metrics, trends, 'FCF'),
            priceHistory: Array.from({ length: 60 }, (_, i) => ({ date: new Date(2021, i, 1).toISOString().slice(0,10), close: 50+i*2.3 })),
            peerRows: [], peerWarnings: [], customPeers: [], market: null,
            sources: { quote: 'Fixture quotes', statements: 'Fixture statements', computed: 'Computed', suggestions: 'Derived' },
            provenance: [], generatedAt: Date.now()
          }
        }
        window.api.valuation = async request => {
          calls.push(request)
          if (hold) await new Promise(resolve => { release = resolve })
          if (mode === 'reject') throw Error('IPC disconnected')
          const failure = mode === 'fresh' ? '' : 'Yahoo quote request timed out'
          const data = fixture(request.symbol)
          if (mode === 'failed') { data.generatedAt = 0; data.metrics = { ...data.metrics, price: null, basisValue: null } }
          return { data, meta: { freshness: mode, source: 'Fixture valuation', fetchedAt: Date.now(), failureReason: failure }, errors: failure ? [{ source: 'Yahoo Finance', operation: 'quote', reason: failure }] : [] }
        }
        const fill = async (label, value) => {
          const field = document.querySelector('input[aria-label="' + label + '"]')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value)
          field.dispatchEvent(new Event('input', { bubbles: true })); await settle()
        }
        const click = async label => {
          const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label)
          check(button && !button.disabled, 'Missing or disabled button: ' + label)
          button.click(); await settle()
        }
        window.runProbe = async () => {
          useValuationPage.setState({ ticker: 'NVDA', activeTab: 'main', assumptionsByTicker: {}, notesByTicker: {}, customPeersByTicker: {} })
          // Same cache key/freshness as startup prefetch: opening the page reuses it.
          await client.fetchQuery({ queryKey: queryKeys.valuation('NVDA', []), queryFn: () => window.api.valuation({ symbol: 'NVDA', background: true }), staleTime: queryFreshness(queryKeys.valuation('NVDA', [])) })
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><ValuationPage onStatusChange={status} /></QueryClientProvider>)
          await settle()
          check(calls.length === 1 && text().includes('Loaded valuation data for NVDA'), 'Startup snapshot did not render ready without refetching')
          await fill('Valuation ticker', 'NBIS')
          check(document.querySelector('h1').textContent.includes('NVDA'), 'Draft ticker relabelled old data')
          hold = true
          await click('Load')
          check(calls.length === 2 && calls[1].force && calls[1].symbol === 'NBIS', 'Ticker switch must make exactly one forced request')
          check(text().includes('Loading NBIS valuation data') && panels[0].loading, 'Forced ticker load missing query loading state')
          check(!document.querySelector('h1').textContent.includes('NVIDIA'), 'Previous company visible under new ticker')
          check(document.querySelector('section').textContent.includes('Nothing loaded'), 'Unloaded ticker showed a solved valuation')
          hold = false; release(); await settle()
          check(text().includes('NBIS · Nebius Group N.V.') && text().includes('Loaded valuation data for NBIS'), 'Ticker load did not complete')
          hold = true; mode = 'reject'
          await click('Load')
          check(panels[0].loading && text().includes('Refreshing NBIS'), 'Same-ticker refresh missing loading state')
          hold = false; release(); await settle()
          check(panels[0].error?.message === 'IPC disconnected', 'Refresh rejection not reported to status bar')
          check(text().includes('REFRESH FAILED') && text().includes('Valuation load failed: IPC disconnected'), 'Refresh rejection hidden behind cached success')
          check(document.querySelector('h1').textContent.includes('Nebius'), 'Rejected refresh discarded usable data')
          check(!unhandled.length, 'Unhandled refresh rejection: ' + unhandled.join(', '))
          mode = 'stale'; await click('Load')
          check(text().includes('Showing cached valuation data for NBIS') && !text().includes('Loaded valuation data for NBIS'), 'Stale result reported success')
          mode = 'partial'; await click('Load')
          check(text().includes('Showing incomplete valuation data for NBIS'), 'Partial result reported success')
          mode = 'failed'; await fill('Valuation ticker', 'MISSING'); await click('Load')
          check(text().includes('Valuation load failed: Yahoo quote request timed out'), 'Failed envelope not visible')
          check(!document.querySelector('section').textContent.includes('Undervalued'), 'Failed ticker displayed saved-assumption verdict')
          mode = 'fresh'; await fill('Valuation ticker', 'NBIS'); await click('Load')
          check(!panels[0].error && text().includes('Loaded valuation data for NBIS') && !text().includes('IPC disconnected'), 'Successful retry did not clear failure')
          for (const name of ['Scenarios', 'Peers', 'Risk', 'Trends', 'Notes', 'Sources', 'Main']) await click(name)
          await click('Peers'); await fill('Custom peer ticker', 'MSFT')
          const before = calls.length
          await click('Add')
          check(calls.length === before+1 && calls.at(-1).force && calls.at(-1).customPeers.includes('MSFT'), 'Peer edit must make exactly one forced request')
          await click('Main')
          check(!unhandled.length, 'Unhandled page rejection')
          return 'PASS: startup cache, ticker switch, single forced load, refresh progress, rejection, cached data, partial data, failed ticker, recovery, peer edit, and all tabs'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = {}</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1600, height: 950, webPreferences: { backgroundThrottling: false, offscreen: true } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        require('node:fs').writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
        window.setSize(1280, 720)
        await new Promise(resolve => setTimeout(resolve, 200))
        if (await window.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth')) throw Error('Minimum window layout overflows')
        console.log('PASS: minimum supported window size and screenshot')
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Valuation UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshot: ' + screenshot)
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
