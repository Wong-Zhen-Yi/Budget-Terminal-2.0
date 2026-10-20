import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-quant-ui-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { QuantPage } from './src/pages/QuantPage'
        import { DEFAULT_QUANT_PAGE_SETTINGS } from './electron/shared/quant'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 240))
        const body = () => document.body.innerText
        const click = (text) => {
          const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text)
          check(button && !button.disabled, 'Missing or disabled button: ' + text)
          button.click()
        }
        const choose = async (label, value) => {
          const select = document.querySelector('select[aria-label="' + label + '"]')
          select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        }
        const input = async (label, value) => {
          const element = document.querySelector('input[aria-label="' + label + '"]')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
          element.dispatchEvent(new Event('input', { bubbles: true })); await settle()
        }
        const row = (ticker, rank, score, momentum, rsi) => ({ ticker, name: ticker === 'NVDA' ? 'NVIDIA Corporation' : ticker === 'MSFT' ? 'Microsoft Corporation' : 'The Coca-Cola Company', exchange: 'NASDAQ',
          rank, composite: score, lastPrice: 125 + rank * 12.45, marketCap: 50e9, medianDollarVolume: 80e6,
          momentum1m: momentum / 4, momentum3m: momentum / 2, momentum6m: momentum, momentum12m: momentum * 1.8,
          volatilityPct: 20 + rank, sharpe: 2.5 - rank / 2, maxDrawdownPct: -8.3 - rank, zScore: 1.2 - rank / 4, rsi, observations: 400 })
        const pairRow = (left, right, rank, stationaryAt, spreadZ) => ({ left, right, rank, stationaryAt, spreadZ,
          correlation: .91, hedgeRatio: 1.24, halfLife: rank === 1 ? 8.5 : 30, hurst: .32, dickeyFuller: -3.8, score: 85 - rank * 10, observations: 400 })
        const payload = { rows: [row('NVDA', 1, 92, 34, 71), row('MSFT', 2, 81, 22, 58), row('KO', 3, 42, -6, 30)],
          pairs: [pairRow('KO', 'PEP', 1, '1%', 2.3), pairRow('MSFT', 'AAPL', 2, '', .8)], source: 'fixture', universeSize: 12,
          sourcedAt: new Date().toISOString(), startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), errors: { BAD: 'Insufficient history' }, universeFromCache: false }
        const envelope = (data, freshness = 'fresh') => ({ data, meta: { source: 'fixture', freshness, fetchedAt: Date.now(), failureReason: freshness === 'failed' ? 'Offline' : undefined }, errors: [] })
        let releaseLatest
        let releaseScan
        let releasePair
        let requests = []
        let pairRequests = []
        let clipboard = ''
        let clipboardFails = false
        let saved = { quantPage: { ...DEFAULT_QUANT_PAGE_SETTINGS } }
        let statuses = []
        window.api.settings = async () => envelope(saved)
        window.api.mutateSettings = async (mutation) => { saved = { quantPage: mutation.value }; return envelope(saved) }
        window.api.writeClipboard = async (text) => { if (clipboardFails) throw Error('Clipboard locked'); clipboard = text }
        window.api.quantScan = async (request) => {
          if (request.latestOnly) return new Promise(resolve => { releaseLatest = resolve })
          requests.push(request)
          return new Promise(resolve => { releaseScan = resolve })
        }
        window.api.quantPair = async (request) => {
          pairRequests.push(request)
          return new Promise(resolve => { releasePair = resolve })
        }
        const statusChange = (panels) => { statuses = panels }
        const model = (left, right) => ({ ...payload.pairs[0], left, right, intercept: 2.5, latestZ: 2.3,
          points: Array.from({ length: 150 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
            spreadZ: Math.sin(index / 8) * 1.8 + index / 200, leftIndexed: 100 + index / 5 + Math.sin(index / 9) * 4,
            rightIndexed: 100 + index / 6 + Math.sin(index / 10) * 3, rollingCorrelation: .9 })) })
        window.checkLayout = async () => {
          await settle()
          const page = document.querySelector('.quant-page')
          check(page.scrollWidth <= page.clientWidth + 1, 'Page has horizontal overflow at ' + innerWidth)
          check(getComputedStyle(page).overflowY === 'auto', 'Workspace must remain vertically scrollable')
          check(getComputedStyle(page).getPropertyValue('--quant-highlight').trim() === '#e8b477', 'Quant stylesheet missing')
          const cell = page.querySelector('tbody td:last-child')
          check(cell && parseFloat(getComputedStyle(cell).fontSize) >= 16, 'Research table text must stay at least 16px')
          const heading = page.querySelector('h2')
          check(heading && parseFloat(getComputedStyle(heading).fontSize) >= 18, 'Research headings must stay at least 18px')
          const control = page.querySelector('select')
          check(control && parseFloat(getComputedStyle(control).fontSize) >= 16, 'Filter controls must stay at least 16px')
          check([...page.querySelectorAll('tbody td')].every(cell => cell.scrollWidth <= cell.clientWidth + 1), 'Larger table text is clipped')
          const status = page.querySelector('.quant-status')
          check(status.querySelector('span:nth-child(2)').getBoundingClientRect().bottom <= status.getBoundingClientRect().bottom + 1, 'Wrapped status text must not overlap the navigation')
          return 'Layout OK at ' + innerWidth + 'px'
        }
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><QuantPage onStatusChange={statusChange} /></QueryClientProvider>)
          await settle()
          check(requests.length === 0 && statuses[0].loading && body().includes('Restoring the latest'), 'Startup latest-result readiness')
          releaseLatest(envelope(null)); await settle()
          check(!statuses[0].loading && body().includes('Start with the universe'), 'Empty state after latest restore')
          click('Run scan'); await settle()
          check(body().includes('Scanning…') && requests.length === 1, 'Scan pending state')
          releaseScan(envelope(payload)); await settle()
          check(document.querySelectorAll('tbody tr').length === 3 && body().includes('1 ticker(s) returned incomplete'), 'Ranked rows and partial coverage')
          check(document.querySelector('[aria-label="Factor detail for NVDA"]'), 'Default factor inspector')
          click('MSFT'); await settle()
          check(document.querySelector('[aria-label="Factor detail for MSFT"]'), 'Instrument selection')
          document.querySelectorAll('th')[0].click(); await settle()
          check(document.querySelector('tbody tr').textContent.includes('KO'), 'Sortable factor matrix')
          await choose('Quant screener filter', 'oversold')
          check(document.querySelectorAll('tbody tr').length === 1 && document.querySelector('[aria-label="Factor detail for KO"]'), 'Oversold preset and selection fallback')
          await input('Quant ticker search', 'ZZZ')
          check(body().includes('No matching instruments'), 'Search empty state')
          click('Reset'); await settle()
          check(document.querySelectorAll('tbody tr').length === 3 && requests.length === 1, 'Reset must not re-scan')
          click('Export to LLM'); await settle()
          check(clipboard.includes('# Quant Screener & Pairs Export') && clipboard.includes('NVDA') && body().includes('Copied 3 screener row(s)'), 'LLM export')
          clipboardFails = true; click('Export to LLM'); await settle()
          check(body().includes('Export failed: Clipboard locked'), 'Clipboard error must be visible')
          clipboardFails = false
          click('Force universe refresh ↗'); await settle()
          check(requests[1].forceUniverseRefresh === true && document.querySelectorAll('tbody tr').length === 3, 'Force refresh and pending result retention')
          releaseScan(envelope(null, 'failed')); await settle()
          check(body().includes('Scan failed: Offline') && document.querySelectorAll('tbody tr').length === 3, 'Failed refresh retains snapshot')
          check(statuses[0].envelope.meta.freshness === 'failed', 'Failed readiness state must remain visible')
          document.querySelector('#quant-tab-pairs').click(); await settle()
          check(document.querySelectorAll('tbody tr').length === 2 && body().includes('Two assets. One relationship.'), 'Pairs workspace')
          const analyseButton = () => [...document.querySelectorAll('button')].find(button => button.textContent.includes('Analyse pair'))
          check(analyseButton().disabled, 'Blank pair must not submit')
          await input('Long ticker', 'ko'); await input('Short ticker', 'ko')
          check(analyseButton().disabled && body().includes('Choose two different tickers'), 'Identical pair validation')
          await input('Short ticker', 'pep')
          click('Analyse pair'); await settle()
          check(pairRequests[0].left === 'KO' && pairRequests[0].right === 'PEP' && body().includes('Fitting the relationship'), 'Custom model pending and normalized tickers')
          releasePair(envelope(model('KO', 'PEP'))); await settle()
          check(document.querySelector('[aria-label="Pair model for KO and PEP"]') && document.querySelectorAll('.quant-pair-detail svg').length >= 2 && body().includes('short the spread'), 'Pair charts, diagnostics and directional interpretation')
          await choose('Quant pair filter', 'stationary')
          check(document.querySelectorAll('tbody tr').length === 1 && requests.length === 2, 'Stationary filter without scan')
          click('KO / PEP'); await settle()
          check(pairRequests.length === 2, 'A pair ticker click must submit exactly one model request')
          releasePair(envelope(null, 'failed')); await settle()
          check(body().includes('Pair analysis failed: Offline') && document.querySelector('[aria-label="Pair model for KO and PEP"]'), 'Pair failure retains prior model')
          await choose('Quant pair filter', 'all')
          click('MSFT / AAPL'); await settle()
          check(pairRequests.length === 3, 'Pair selection must not duplicate model requests')
          releasePair(envelope(model('MSFT', 'AAPL'))); await settle()
          check(saved.quantPage.activeTab === 'pairs' && saved.quantPage.pairLeft === 'MSFT', 'Persist research controls')
          click('Export to LLM'); await settle()
          check(clipboard.includes('## Inspected pair') && clipboard.includes('MSFT'), 'Export includes pair model')
          check(body().includes('Scan failed: Offline'), 'Export notice must not hide a scan failure')
          await window.checkLayout()
          return 'PASS: startup restore, manual/forced scans, partial coverage, sorting, filters, search, factor inspection, pair validation/model/charts, failures, retained snapshots, settings and export'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find((file) => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const { mkdir, writeFile } = require('node:fs/promises')
    const { join } = require('node:path')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { backgroundThrottling: false } })
      const capture = async (name) => {
        if (!process.env.QUANT_SCREENSHOT_DIR) return
        await mkdir(process.env.QUANT_SCREENSHOT_DIR, { recursive: true })
        await writeFile(join(process.env.QUANT_SCREENSHOT_DIR, name + '.png'), (await window.webContents.capturePage()).toPNG())
      }
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        await capture('quant-pairs')
        await window.webContents.executeJavaScript('document.querySelector("#quant-tab-screener").click()')
        console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
        await capture('quant-screener')
        for (const width of [1024, 768, 480]) {
          window.setSize(width, 850)
          console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
          await window.webContents.executeJavaScript('document.querySelector("#quant-tab-pairs").click()')
          console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
          await capture('quant-pairs-' + width)
          await window.webContents.executeJavaScript('document.querySelector("#quant-tab-screener").click()')
        }
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Quant UI probe timed out')) }, 45_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
