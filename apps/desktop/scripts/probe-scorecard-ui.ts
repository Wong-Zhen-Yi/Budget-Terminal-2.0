import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-scorecard-ui-'))
const screenshots = join(root, 'out/maintenance')
try {
  await mkdir(screenshots, { recursive: true })
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { ScorecardPage } from './src/pages/ScorecardPage'
      import { useScorecard } from './src/stores/scorecard'
      import { normalizeScorecardPreferences } from './electron/shared/scorecard'
      import { queryKeys } from './src/api/client'
      import { buildTasks } from './src/api/prefetch'
      import { assertStartupReady } from './src/api/warmQueue'
      import { scorecardFixture } from './scripts/fixtures/scorecard'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 140))
      const text = () => document.body.innerText
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } } })
      let calls = [], fail = '', partial = '', navigated = '', status = []
      window.api.fundamentalsPage = async request => {
        calls.push(request)
        const data = scorecardFixture(request.symbol, request.symbol === 'MSFT' ? 2 : request.symbol === 'GOOGL' ? .5 : 1)
        if (request.symbol === 'MSFT') data.annual.revenue[1].value = 180e9
        const broken = request.symbol === fail
        return { data, meta: { source: 'Synthetic scorecard fixture', fetchedAt: Date.now(), freshness: broken ? 'failed' : request.symbol === partial ? 'partial' : 'fresh',
          failureReason: broken ? 'Fixture provider offline' : request.symbol === partial ? 'One statement missing' : undefined },
          errors: request.symbol === partial ? [{ source: 'Fixture', operation: 'statements', reason: 'Partial annual coverage' }] : [] }
      }
      const input = (label, value) => {
        const node = document.getElementById(label)
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
        node.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const click = async label => {
        const node = [...document.querySelectorAll('button')].find(button => button.textContent === label)
        check(node && !node.disabled, 'Missing enabled button: ' + label)
        node.click(); await settle()
      }
      const choose = async (label, value) => {
        const node = document.querySelector('select[aria-label="' + label + '"]')
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(node, value)
        node.dispatchEvent(new Event('change', { bubbles: true })); await settle()
      }
      const host = createRoot(document.getElementById('root'))
      window.runProbe = async () => {
        const tasks = buildTasks(undefined, undefined, { stocks: '', fundamentals: '' }, { year: 2026, month: 10, earningsYear: 2026, ipoYear: 2026 }).filter(task => task.tab === 'scorecard')
        check(tasks.length === 3, 'Startup must prepare every configured company before Scorecard is visited')
        await Promise.all(tasks.map(task => task.run(client, 4)))
        check(calls.length === 3 && calls.every(call => call.background && call.backgroundOrder === 4), 'Startup must retain the shared background request lane')
        host.render(<QueryClientProvider client={client}><ScorecardPage onStatusChange={next => { status = next }} onNavigate={(page, symbol) => { navigated = page + ':' + symbol }} /></QueryClientProvider>)
        await settle(); await settle()
        check(calls.length === 3, 'First visit triggered additional initial data loads')
        check(document.querySelectorAll('tbody tr').length === 3 && text().includes('2025-12-31'), 'Initial company rows and fiscal period')
        check(text().includes('25.0%') && text().includes('-10.0%'), 'Signed annual revenue growth')
        check(document.querySelector('.scorecard-bar.is-negative'), 'Negative growth chart must preserve the sign')
        check(status.length === 3 && status.every(panel => panel.envelope && !panel.loading), 'Per-company health must reach the app shell')
        await window.captureFixture('scorecard-desktop')
        await window.resizeFixture(800, 900); await settle()
        check(document.querySelector('.scorecard-page').scrollWidth <= document.querySelector('.scorecard-page').clientWidth + 1, 'Compact page overflows outside the table scroller')
        await window.captureFixture('scorecard-compact')
        await window.resizeFixture(1400, 950); await settle()
        input('scorecard-tickers', 'AMZN, MSFT'); await settle(); await click('Compare')
        check(text().includes('Enter 3–6') && calls.length === 3, 'Invalid input should not mutate or fetch')
        input('scorecard-tickers', 'AMZN, MSFT, GOOGL'); await settle(); await click('Compare')
        const header = [...document.querySelectorAll('th button')].find(button => button.textContent.includes('Market cap'))
        check(header, 'Market cap must be sortable'); header.focus(); header.click(); await settle()
        check(document.querySelector('tbody tr').innerText.startsWith('MSFT'), 'Numeric descending market-cap sort')
        header.click(); await settle()
        check(document.querySelector('tbody tr').innerText.startsWith('GOOGL'), 'Numeric ascending market-cap sort')
        const before = calls.length
        document.querySelector('.scorecard-columns').open = true
        const checkbox = [...document.querySelectorAll('.scorecard-columns label')].find(label => label.textContent.includes('Beta')).querySelector('input')
        checkbox.click(); await settle()
        check([...document.querySelectorAll('th')].some(node => node.textContent.includes('Beta')) && calls.length === before, 'Column choice should not reload financials')
        await choose('Chart metric', 'netCash')
        input('scorecard-name', 'Cloud peers'); await settle(); await click('Save')
        const saved = useScorecard.getState().comparisons[0]
        check(saved.name === 'Cloud peers' && saved.columns.includes('beta') && saved.chartMetric === 'netCash', 'Save comparison content')
        const persisted = localStorage.getItem('budget-terminal:scorecard')
        input('scorecard-tickers', 'AAPL NVDA META'); await settle(); await click('Compare'); await settle()
        check(useScorecard.getState().symbols[0] === 'AAPL' && text().includes('Unsaved changes'), 'New tickers should not overwrite the saved comparison')
        await choose('Saved scorecards', saved.id)
        check(useScorecard.getState().symbols[0] === 'AMZN' && text().includes('Saved locally'), 'Restore named comparison')
        check(calls.length === before + 3, 'Restoring warmed tickers must reuse cached data')
        useScorecard.setState(normalizeScorecardPreferences(null))
        localStorage.setItem('budget-terminal:scorecard', persisted)
        await useScorecard.persist.rehydrate(); await settle()
        check(useScorecard.getState().selectedId === saved.id && useScorecard.getState().chartMetric === 'netCash', 'Comparison must survive persisted state restoration')
        await click('Fundamentals')
        check(navigated.startsWith('fundamentals:'), 'Research navigation handoff')
        fail = 'GOOGL'; await click('Refresh'); await settle()
        check(text().includes('could not refresh') && document.querySelectorAll('tbody tr').length === 3, 'Failed refresh must retain prior rows')
        document.querySelector('.scorecard-sources').open = true; await settle()
        document.querySelectorAll('.scorecard-source details').forEach(node => { node.open = true }); await settle()
        check(text().includes('REFRESH FAILED') && text().includes('Fixture provider offline'), 'Failed refresh reason must be visible')
        fail = ''; partial = 'MSFT'; await click('Refresh'); await settle()
        check(text().includes('PARTIAL') && text().includes('source issues'), 'Partial source coverage must remain visible')
        let degraded = false
        try { assertStartupReady(client.getQueryData(queryKeys.fundamentalsPage('MSFT'))) } catch { degraded = true }
        check(degraded, 'Partial Scorecard startup data must not be marked ready')
        await click('Delete')
        check(!useScorecard.getState().comparisons.length && useScorecard.getState().symbols.length === 3, 'Delete saved preset without clearing the current comparison')
        const missing = scorecardFixture('AMZN'); missing.annual.revenue = []; missing.facts.marketCap = null
        client.setQueryData(queryKeys.fundamentalsPage('AMZN'), { data: missing, meta: { source: 'Synthetic missing fields', fetchedAt: Date.now(), freshness: 'partial' }, errors: [] })
        await settle()
        check(document.querySelector('tbody').innerText.includes('N/A') && text().includes('Annual revenue is unavailable'), 'Missing metrics and annual coverage must not become zero')
        for (const symbol of useScorecard.getState().symbols) {
          const data = scorecardFixture(symbol); data.facts.beta = null
          client.setQueryData(queryKeys.fundamentalsPage(symbol), { data, meta: { source: 'Synthetic missing beta', fetchedAt: Date.now(), freshness: 'fresh' }, errors: [] })
        }
        await choose('Chart metric', 'beta')
        check(text().includes('No comparable values are available'), 'A fully missing metric must not render a made-up chart scale')
        fail = 'FAIL'; input('scorecard-tickers', 'FAIL AMZN MSFT'); await settle(); await click('Compare'); await settle()
        check(document.querySelectorAll('tbody tr').length === 3 && text().includes('Fixture provider offline'), 'An initial company failure must not hide the other companies')
        fail = ''; partial = ''; input('scorecard-tickers', 'AMZN MSFT GOOGL AAPL NVDA META'); await settle(); await click('Compare'); await settle()
        check(document.querySelectorAll('tbody tr').length === 6 && status.length === 6, 'Six-company comparisons must retain all company health states')
        const sixCalls = calls.length
        input('scorecard-tickers', 'AMZN MSFT GOOGL AAPL NVDA META AMD'); await settle(); await click('Compare')
        check(calls.length === sixCalls && document.querySelectorAll('tbody tr').length === 6, 'Reject over-limit comparisons without truncating or fetching')
        for (const column of [...useScorecard.getState().columns]) useScorecard.getState().toggleColumn(column)
        check(useScorecard.getState().columns.length === 1, 'Keep at least one comparison metric visible')
        host.unmount(); client.clear()
        return 'PASS: Scorecard startup background loads and first-visit cache reuse, signed chart, compact layout, validation, numeric sorting, selectable metrics, named comparisons, persistence, navigation, failed refresh retention, and partial/missing-data visibility'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty', '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const stylesheet = (await readdir(assets)).find(file => file.endsWith('.css'))
  assert(stylesheet, 'Run npm run build before the Scorecard UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, stylesheet)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>#root{display:flex}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('captureFixture',name=>ipcRenderer.invoke('capture-fixture',name));contextBridge.exposeInMainWorld('resizeFixture',(width,height)=>ipcRenderer.invoke('resize-fixture',width,height));`)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow, ipcMain } = require('electron')
    const fs = require('fs'), path = require('path')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(join(directory, 'preload.cjs'))} } })
      ipcMain.handle('capture-fixture', async (_event, name) => {
        if (!/^[a-z-]+$/.test(name)) throw Error('Invalid screenshot name')
        fs.writeFileSync(path.join(${JSON.stringify(screenshots)}, name + '.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
      })
      ipcMain.handle('resize-fixture', (_event, width, height) => window.setSize(width, height))
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
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Scorecard UI probe timed out')) }, 60_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Synthetic UI screenshots: ' + join(screenshots, 'scorecard-desktop.png') + ' and ' + join(screenshots, 'scorecard-compact.png'))
} finally {
  const resolvedDirectory = resolve(directory)
  if (dirname(resolvedDirectory) === resolve(tmpdir()) && basename(resolvedDirectory).startsWith('budget-scorecard-ui-')) {
    await rm(resolvedDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
