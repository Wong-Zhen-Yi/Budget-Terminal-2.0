import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-etf-ui-'))
try {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { EtfPage } from './src/pages/EtfPage'
      import { useEtfPage } from './src/stores/etf'
      import { buildTasks } from './src/api/prefetch'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 200))
      const body = () => document.body.innerText
      const click = async text => {
        const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text)
        check(button, 'Missing button: ' + text); button.click(); await settle()
      }
      const type = async (label, value) => {
        const input = document.querySelector('input[aria-label="' + label + '"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true })); await settle()
      }
      const envelope = (data, freshness = 'fresh', failureReason) => ({ data, errors: [], meta: { source: 'ETF fixture provider', freshness, failureReason, fetchedAt: Date.now() } })
      const holdings = [{ symbol: 'AAA', name: 'Alpha Holdings', weight: 0.6, sector: 'Technology' }, { symbol: 'BBB', name: 'Beta Holdings', weight: 0.3, sector: 'Energy' }]
      let fundCalls = 0, directoryCalls = 0, basketCalls = 0, mode = 'fresh', directoryOffline = false, navigated = '', panels
      window.api.etfHoldings = async ({ ticker, force }) => {
        fundCalls++
        await new Promise(resolve => setTimeout(resolve, ticker === 'QQQ' ? 80 : 10))
        return envelope({ ticker, fundName: ticker + ' Research Fund', issuer: 'Official issuer', asOfDate: '2026-10-15', expenseRatio: '0.03%', netAssets: '818.71B', holdings: mode === 'failed' ? [] : holdings, sectorBreakdown: [{ sector: 'Technology', percent: 60 }, { sector: 'Energy', percent: 30 }], sourceUrl: 'https://example.invalid', isPartial: ticker === 'QQQ', coverageNote: ticker === 'QQQ' ? 'Public holdings snapshot; may not include the full fund.' : '', fetchedAt: Date.now() }, mode === 'failed' ? 'failed' : ticker === 'QQQ' ? 'partial' : mode, mode === 'failed' ? 'Issuer unavailable' : mode === 'stale' ? 'Issuer refresh failed; saved data' : undefined)
      }
      window.api.etfAum = async () => {
        directoryCalls++
        if (directoryOffline) return envelope({ rows: [], totalCount: 0, missingCount: 0, fetchedAt: Date.now() }, 'failed', 'Directory offline')
        return envelope({ rows: [{ ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', category: 'Equity', netAssets: 818e9 }, { ticker: 'QQQ', name: 'Invesco Nasdaq 100', category: 'Equity', netAssets: 489e9 }, { ticker: 'BND', name: 'Vanguard Total Bond Market', category: 'Fixed Income', netAssets: null }, ...Array.from({ length: 90 }, (_, i) => ({ ticker: 'TEST' + i, name: 'Test Fund ' + i, category: 'Equity', netAssets: i * 1000 }))], totalCount: 93, missingCount: 1, source: 'Stock Analysis', fetchedAt: Date.now() })
      }
      window.api.etfArbitrage = async ({ ticker }) => {
        basketCalls++
        return envelope({ ticker, generatedAt: Date.now(), etfPrice: 100, etfMovePct: 1, basketMovePct: 0.8, gapPctPoints: 0.2, gapBps: 20, signal: 'ETF rich vs basket', quoteCoverage: 2, totalHoldings: 2, quotedWeight: 0.9, loadedWeight: 0.9, rows: [{ symbol: 'AAA', name: 'Alpha', weight: 0.6, price: 100, movePct: 1, normalizedWeight: 1, contributionPct: 1 }] })
      }
      let clipboard = ''
      window.api.writeClipboard = async text => { clipboard = text }
      window.api.openExternal = async () => {}
      window.runProbe = async () => {
        check(useEtfPage.getState().ticker === 'SPY', 'New sessions must select a usable default fund')
        useEtfPage.setState({ ticker: 'SPY', subtab: 'holdings' })
        const startup = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 10, earningsYear: 2026, ipoYear: 2026 }).filter(task => task.tab === 'etf')
        check(startup.length === 2, 'Startup must include both directory and default fund before the page is visited')
        await Promise.all(startup.map(task => task.run(client, 0)))
        check(fundCalls === 1 && directoryCalls === 1 && basketCalls === 0, 'Startup must warm the fund without basket quote fan-out')
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><EtfPage onStatusChange={value => { panels = value }} onNavigate={(tab, symbol) => { navigated = tab + ':' + symbol }} /></QueryClientProvider>)
        await settle()
        check(fundCalls === 1 && directoryCalls === 1 && basketCalls === 0, 'First visit after startup must reuse the already-ready fund and directory')
        check(body().includes('ETF Explorer') && body().includes('SPY Research Fund') && body().includes('90.0%'), 'Default fund, heading and allocation metrics')
        check(document.querySelectorAll('.etf-fund-row').length === 60, 'Directory must page rather than render thousands of rows')
        await click('Next'); check(document.querySelectorAll('.etf-fund-row').length === 33, 'Directory pagination')
        await type('Search ETFs', 'vanguard')
        check(document.querySelectorAll('.etf-fund-row').length === 1 && body().includes('Vanguard Total Bond Market'), 'Search by fund name and pagination reset')
        check(fundCalls === 1 && directoryCalls === 1, 'Local search must not request provider data')
        await type('Search ETFs', '')
        const qqq = document.querySelector('.etf-quick-funds button:nth-child(2)'); qqq.click(); await settle()
        check(fundCalls === 2 && body().includes('QQQ Research Fund') && body().includes('Partial holdings'), 'Switch ticker and clearly identify partial coverage')
        await click('SPY')
        check(fundCalls === 2 && body().includes('SPY Research Fund'), 'Switching back must use the cached query without force')
        await click('Basket analysis')
        check(basketCalls === 0 && body().includes('Opening this view does not call Yahoo'), 'Analysis tab must not automatically request quotes')
        await click('Run basket analysis')
        check(basketCalls === 1 && body().includes('+20.0 bps'), 'Explicit basket analysis')
        await click('Holdings & exposure 2')
        check(fundCalls === 2 && basketCalls === 1, 'Tab switching must reuse snapshots')
        await type('Filter holdings by ticker or name', 'alpha')
        check(body().includes('Alpha Holdings') && !document.querySelector('.etf-holdings-table').innerText.includes('Beta Holdings'), 'Holding filtering')
        await click('Copy table')
        check(clipboard.includes('AAA') && !clipboard.includes('BBB'), 'Export only visible holdings')
        document.querySelector('.etf-holdings-table tbody tr').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await settle()
        check(navigated === 'charts:AAA', 'Holding double-click navigation')
        mode = 'failed'; await click('Refresh holdings')
        check(body().includes('Saved holdings remain visible') && body().includes('Alpha Holdings') && body().includes('Issuer unavailable'), 'Failed refresh preserves last-good data with visible error')
        mode = 'stale'; await click('Refresh holdings')
        check(body().includes('STALE') && body().includes('saved data'), 'Stale provider response remains explicit')
        mode = 'fresh'; await click('Refresh holdings')
        check(!body().includes('Saved holdings remain visible') && panels[0].envelope.meta.freshness === 'fresh', 'Recovery and status propagation')
        directoryOffline = true; await click('Refresh list')
        check(body().includes('Directory offline') && document.querySelectorAll('.etf-fund-row').length > 0 && body().includes('SPY Research Fund'), 'Directory failure preserves the browser and does not blank holdings')
        await type('ETF ticker', '!!'); await click('Open ETF')
        check(body().includes('Enter a valid ETF ticker'), 'Invalid input is actionable and does not call a provider')
        directoryOffline = false; await click('Refresh list')
        await type('Filter holdings by ticker or name', '')
        await type('ETF ticker', 'SPY'); await click('Open ETF')
        return 'PASS: startup/default fund readiness with no first-visit loads, directory paging and local search, ticker cache, explicit-only quotes, partial coverage, export, navigation, last-good failure recovery, directory isolation and input validation'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-etf-explorer.png'))}, (await window.webContents.capturePage()).toPNG())
        window.setSize(1000, 800)
        await new Promise(resolve => setTimeout(resolve, 250))
        const overflow = await window.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth')
        if (overflow) throw Error('ETF workspace overflows at 1000px')
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('ETF UI probe timed out')) }, 40_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
