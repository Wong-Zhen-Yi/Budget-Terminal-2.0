import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-heatmap-ui-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { HeatmapPage } from './src/pages/HeatmapPage'
        import { useRefreshHeatmap } from './src/api/heatmapQueries'
        import { buildIntervalSummaries } from './electron/shared/heatmap'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 180))
        const body = () => document.body.innerText
        let calls = 0
        let mode = 'loading'
        let progress = null
        let finishLoad
        let lastForce = false
        let navigated = ''
        let status
        const holdings = [
          { symbol: 'AAA', name: 'Alpha', sector: 'Information Technology', weight: 0.5, price: 110, changes: { live: 10, '1d': 10, '1y': 30 } },
          { symbol: 'BBB', name: 'Beta', sector: 'Financials', weight: 0.3, price: 180, changes: { live: -10, '1d': -10, '1y': -20 } },
          { symbol: 'MISS', name: 'No history', sector: 'Unclassified', weight: 0.2, price: null, changes: {} },
        ]
        const summaries = buildIntervalSummaries(holdings)
        const preview = (payload, rows) => ({ ...payload, holdings: rows, intervalSummaries: buildIntervalSummaries(rows),
          quoteCoverage: rows.filter(row => row.changes.live !== undefined).length })
        window.api.heatmapProgress = async etf => progress?.etf === etf ? progress : null
        window.api.heatmap = async ({ etf, force }) => {
          calls += 1; lastForce = Boolean(force)
          if (etf === 'NDX') await new Promise(resolve => setTimeout(resolve, 80))
          const payload = { etf, ticker: etf === 'NDX' ? 'QQQ' : etf === 'DJI' ? 'DIA' : 'SPY',
            fundName: 'Index fixture', issuer: 'Issuer fixture', asOfDate: '14-Oct-2026', sourceUrl: 'https://example.invalid',
            priceSource: 'Yahoo Finance', priceAsOfDate: '2026-10-15',
            holdings: mode === 'failed' ? [] : holdings, holdingsLoaded: mode === 'failed' ? 0 : 3, quoteCoverage: mode === 'failed' ? 0 : 2,
            weightedDayMove: summaries.live.weightedMove, strongest: summaries.live.strongest, weakest: summaries.live.weakest,
            intervalSummaries: summaries, fetchedAt: Date.now() }
          if (mode === 'loading') {
            progress = preview(payload, holdings.map(row => ({ ...row, price: null, changes: {} })))
            await new Promise(resolve => { finishLoad = resolve })
            progress = null
          }
          return { data: payload, meta: { source: payload.priceSource, freshness: mode, fetchedAt: Date.now(),
            failureReason: mode === 'failed' ? 'Yahoo offline' : mode === 'stale' ? 'Yahoo refresh failed; showing cached prices' : 'MISS has no usable daily history' }, errors: [] }
        }
        const click = async (text) => { [...document.querySelectorAll('button')].find(button => button.textContent === text).click(); await settle() }
        let refreshHeatmap
        function Probe() {
          refreshHeatmap = useRefreshHeatmap()
          return <HeatmapPage onStatusChange={(panels) => { status = panels[0] }} onNavigate={(tab, symbol) => { navigated = tab + ':' + symbol }} />
        }
        const refresh = async () => { void refreshHeatmap('SPY').catch(() => {}); await settle() }
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>)
          await settle()
          await new Promise(resolve => setTimeout(resolve, 600))
          check(body().includes('0/3') && body().includes('Loading S&P 500 heatmap') && document.querySelector('[title^="AAA"]'), 'Holdings must render before any price history finishes')
          progress = preview(progress, [holdings[0], ...holdings.slice(1).map(row => ({ ...row, price: null, changes: {} }))])
          await new Promise(resolve => setTimeout(resolve, 650))
          check(body().includes('1/3') && body().includes('Loading S&P 500 heatmap') && status.loading, 'Tiles and quote coverage must populate during loading')
          check(client.getQueryState(['heatmap', 'SPY', 'yahoo-v2']).fetchStatus === 'fetching' && !client.getQueryData(['heatmap', 'SPY', 'yahoo-v2']), 'Preview must not mark the completed query ready')
          mode = 'partial'; finishLoad(); await settle()
          check(calls === 1 && body().includes('Yahoo Finance') && body().includes('2026-10-15'), 'Provider and actual price date')
          check(body().includes('Live') && !body().includes('DefeatBeta'), 'Yahoo provider label and Live control')
          check(body().includes('2/3') && body().includes('MISS has no usable daily history'), 'Partial coverage must stay visible')
          check(body().includes('Sector coverage: 2/3') && body().includes('Unclassified: MISS'), 'Missing sector classification must stay visible')
          await click('1Y')
          check(calls === 1 && body().includes('1Y Change'), 'Interval changes must reuse loaded history')
          const tile = [...document.querySelectorAll('[title]')].find(element => element.title.startsWith('AAA'))
          check(tile, 'AAA tile missing')
          tile.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await settle()
          check(navigated === 'charts:AAA', 'Double-click navigation')
          await click('Nasdaq 100')
          check(calls === 2 && body().includes('(QQQ)'), 'Nasdaq button')
          await click('S&P 500')
          check(calls === 2, 'Switching back must reuse its query')
          mode = 'loading'; await refresh()
          await new Promise(resolve => setTimeout(resolve, 600))
          check(body().includes('2/3') && status.loading, 'Refresh retains the existing map while new quotes are pending')
          mode = 'partial'; finishLoad(); await settle()
          check(!status.loading, 'Refresh clears loading only after the final result')
          mode = 'stale'; await refresh()
          check(lastForce && calls === 4 && body().includes('Yahoo refresh failed') && body().includes('2/3'), 'Stale Yahoo data must retain coverage and show its reason')
          mode = 'failed'; await refresh()
          check(status.error?.message.includes('Yahoo offline') && body().includes('2/3') && !status.loading, 'Failed refresh must report diagnostics and retain the previous map')
          mode = 'fresh'; await refresh()
          check(body().includes('2/3') && status.envelope.meta.freshness === 'fresh' && !status.error, 'Recovery and status propagation')
          for (const tile of document.querySelectorAll('[title^="AAA"], [title^="BBB"]')) {
            for (const label of tile.querySelectorAll('.text-white, .num')) {
              check(label.scrollWidth <= label.clientWidth && label.scrollHeight <= label.clientHeight, 'Heatmap labels must fit their tiles')
            }
          }
          return 'PASS: progressive holdings and quote batches, readiness, Yahoo date, coverage, intervals, index cache, navigation, refresh, stale data and recovery'
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
        require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-heatmap-defeatbeta.png'))}, (await window.webContents.capturePage()).toPNG())
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Heatmap UI probe timed out')) }, 30_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  if (directory.startsWith(join(tmpdir(), 'budget-heatmap-ui-'))) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
