import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { emptyHimsPayload, parseHimsReport } from '../electron/shared/hims.js'
import { emptyFundamentalSeriesMap } from '../electron/shared/fundamentalsPage.js'
import { buildStocksStats, normalizeStocksFacts } from '../electron/shared/stocks.js'
import { himsFixtureHtml } from './fixtures/hims.js'
import type { HimsPayload } from '../electron/shared/hims.js'
import type { FundamentalsPagePayload } from '../electron/shared/contract.js'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-hims-ui-'))
const screenshot = join(root, 'out', 'hims-smoke.png')
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
  const candles = Array.from({ length: 750 }, (_, index) => ({
    time: Date.UTC(2023, 11, 15 + index) / 1000, open: 25 + index / 12,
    high: 28 + index / 12, low: 23 + index / 12, close: 26 + index / 12 + Math.sin(index / 17) * 7,
    volume: 25e6 + Math.round(Math.sin(index / 6) * 10e6),
  }))
  const financials = { symbol: 'HIMS', generatedAt: Date.now(), company: { name: 'Hims & Hers Health', currency: 'USD' },
    facts: { marketCap: 100e9 }, quarterly: emptyFundamentalSeriesMap(), annual: emptyFundamentalSeriesMap(),
    sec: { filings: [] }, warnings: [] } as unknown as FundamentalsPagePayload
  financials.sec.filings = [{ form: '10-Q', filedDate: '2026-07-30', reportPeriod: '2026-06-30', description: 'Quarterly report', items: '', accessionNumber: '0001', documentUrl: 'https://www.sec.gov/Archives/edgar/data/1773751/fixture/hims.htm' }]
  for (let index = 0; index < 8; index++) {
    const endDate = new Date(Date.UTC(2024, 9 + index * 3, 0)).toISOString().slice(0, 10)
    for (const key of ['revenue', 'netIncome', 'operatingCashFlow', 'sharesOutstanding'] as const) {
      financials.quarterly[key].push({ endDate, label: endDate, source: 'sec', value: key === 'revenue' ? 500e6 + index * 100e6 : key === 'netIncome' ? -50e6 + index * 75e6 : key === 'sharesOutstanding' ? 900e6 : 300e6 })
    }
  }
  const good: HimsPayload = {
    ...emptyHimsPayload(), fetchedAt: Date.now(), financials,
    progress: { market: 'loaded', financials: 'loaded', earnings: 'loaded' },
    market: { symbol: 'HIMS', ...normalizeStocksFacts('HIMS', {}), generatedAt: Date.now(), missing: [], institutional: [], insiders: [],
      chart: { candles, stats: buildStocksStats('HIMS', candles, 'USD', 'Hims & Hers Health'), mfi: [] },
      news: [{ id: 'news', ticker: 'HIMS', title: 'Hims & Hers quarterly earnings release', source: 'Hims & Hers IR', publishedAt: Date.now(), url: 'https://investors.hims.com/news-releases' }] },
    earnings: { reports: [2026, 2025].map(year => parseHimsReport(himsFixtureHtml(year), 'https://investors.hims.com/news-releases/' + year, year + '-08-10')), warnings: [] },
  }
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { useEffect } from 'react'
      import { QueryClient, QueryClientProvider, dehydrate, hydrate } from '@tanstack/react-query'
      import { HimsPage } from './src/pages/HimsPage'
      import { useReloadAll } from './src/api/queries'
      import { buildTasks } from './src/api/prefetch'
      import { rendererQueryPersister, shouldPersistRemoteQuery, RENDERER_CACHE_BUSTER } from './src/api/queryPersistence'
      let client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const check = (ok, message) => { if (!ok) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 150))
      const text = () => document.body.innerText
      const click = label => {
        const button = [...document.querySelectorAll('button')].find(button => button.textContent.toLowerCase().startsWith(label.toLowerCase()))
        check(button, 'Missing button: ' + label); button.click()
      }
      function Page() {
        const reload = useReloadAll()
        useEffect(() => { window.reloadAll = reload }, [reload])
        return <HimsPage onStatusChange={panels => { window.health = panels }} onNavigate={(id, symbol) => { window.navigation = [id, symbol] }} />
      }
      window.runProbe = async () => {
        const root = createRoot(document.getElementById('root'))
        root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
        await settle()
        check(text().includes('Loading Hims & Hers'), 'Missing initial loading state')
        window.ready = true
        await settle()
        check(text().includes('2.9M') && text().includes('$750M') && text().includes('-$0.37'), 'KPI metrics missing')
        check(document.querySelector('[data-hims-price-range]').dataset.himsPriceRange === '1Y', 'Default range is not 1Y')
        const priceCanvas = () => document.querySelector('[data-hims-price-range] canvas')
        check(priceCanvas()?.width > 0 && priceCanvas()?.height > 0, 'Candlestick chart did not render')
        const yearImage = priceCanvas().toDataURL()
        const yearCount = Number(document.querySelector('[data-hims-price-range]').dataset.himsCandleCount)
        const calls = window.calls
        for (const label of ['1M', '3M', '6M', '1Y', '3Y']) {
          click(label); await settle()
          check(document.querySelector('[data-hims-price-range]').dataset.himsPriceRange === label, 'Range control failed')
        }
        check(Number(document.querySelector('[data-hims-price-range]').dataset.himsCandleCount) > yearCount, 'Range did not change chart data')
        check(priceCanvas().toDataURL() !== yearImage, 'Range selection did not redraw candlestick history')
        check(window.calls === calls, 'Range selection repeated provider load')
        for (const id of ['charts', 'fundamentals', 'options', 'valuation']) {
          click(id); check(JSON.stringify(window.navigation) === JSON.stringify([id, 'HIMS']), 'Ticker shortcut failed')
        }
        click('Hims & Hers earnings release ↗'); check(window.opened.includes('investors.hims.com'), 'Report link failed')
        click('Hims & Hers quarterly earnings release ↗'); check(window.opened.includes('news-releases'), 'News link failed')
        const filing = [...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes('Quarterly report'))
        filing.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        check(window.opened.includes('sec.gov'), 'Filing link failed')
        const select = document.querySelector('select[aria-label="Reporting quarter"]')
        select.value = '2025 Q2'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        check(text().includes('Monthly online revenue per average subscriber'), 'Historical KPI definition did not change')
        check(window.calls === calls, 'Quarter selection repeated provider load')
        select.value = '2026 Q2'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        window.ready = false; click('Refresh'); await settle()
        check(text().includes('Updating cached dashboard') && text().includes('2.9M'), 'Refresh hid cached content or presented another initial load')
        check(!text().includes('Loading Hims & Hers dashboard'), 'Cached refresh is labelled as initial loading')
        window.ready = true; await settle(); check(window.forced, 'Refresh did not force data reload')
        window.forced = false; await window.reloadAll(); await settle(); check(window.forced, 'F5 reload path did not force HIMS')
        window.mode = 'partial'; click('Refresh'); await settle()
        check(text().includes('earnings: Fixture report unavailable'), 'Partial failure is hidden')
        check(text().toLowerCase().includes('financial history') && text().includes('$100B'), 'Partial failure hid healthy sections')
        window.mode = 'reject'; click('Refresh'); await settle()
        check(text().includes('Fixture network offline'), 'Rejected refresh is hidden')
        check(text().includes('$100B'), 'Rejected refresh discarded cached content')
        window.mode = 'failed'; click('Refresh'); await settle()
        check(text().includes('all: Fixture providers unavailable'), 'Failed envelope is hidden')
        check(text().includes('Price history unavailable'), 'Empty market state missing')
        window.mode = 'good'; click('Refresh'); await settle()
        check(!document.querySelector('[role=status]'), 'Recovery left a stale error')
        // Age the snapshot past its TTL. A revisit still reuses it until refresh/startup.
        const saved = client.getQueryData(['hims'])
        client.setQueryData(['hims'], saved, { updatedAt: Date.now() - 10 * 60_000 })
        root.render(<QueryClientProvider client={client}><div /></QueryClientProvider>); await settle()
        const warmCalls = window.calls
        root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); await settle()
        check(window.calls === warmCalls && text().includes('2.9M'), 'Warmed page repeated its first load')
        // Persist through the real IndexedDB adapter and restore into a new client.
        const snapshot = { timestamp: Date.now(), buster: RENDERER_CACHE_BUSTER, clientState: dehydrate(client, { shouldDehydrateQuery: shouldPersistRemoteQuery }) }
        check(snapshot.clientState.queries.some(query => query.queryKey[0] === 'hims'), 'HIMS is excluded from persistence')
        await rendererQueryPersister.persistClient(snapshot)
        let restored
        for (let attempt = 0; attempt < 30 && !restored; attempt++) {
          await settle(); restored = await rendererQueryPersister.restoreClient()
        }
        check(restored, 'HIMS snapshot was not written to IndexedDB')
        root.render(null); await settle(); client.clear()
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        hydrate(client, restored.clientState)
        const restoreCalls = window.calls
        root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); await settle()
        check(window.calls === restoreCalls && text().includes('2.9M') && text().includes('cached'), 'Restored HIMS content triggered another initial load')
        // Startup must still update expired data, including HIMS before its first visit.
        root.render(null); await settle()
        const task = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'hims')
        check(task, 'HIMS startup task is missing'); await task.run(client, 7)
        check(window.calls === restoreCalls + 1 && window.lastRequest.background && window.lastRequest.backgroundOrder === 7, 'Expired HIMS data was not refreshed at startup')
        root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); await settle()
        check(window.calls === restoreCalls + 1 && text().includes('2.9M'), 'First visit repeated the startup load')
        click('1Y'); await settle()
        const priceBox = document.querySelector('[data-hims-price-range]')
        check(priceBox.querySelector('canvas').getBoundingClientRect().bottom <= priceBox.getBoundingClientRect().bottom + 1, 'Price chart overlaps volume: ' + JSON.stringify({ box: priceBox.getBoundingClientRect().toJSON(), svg: priceBox.querySelector('canvas').getBoundingClientRect().toJSON() }))
        check(priceBox.querySelector('canvas').getBoundingClientRect().width <= priceBox.getBoundingClientRect().width, 'Price chart width exceeds its panel: ' + JSON.stringify({ box: priceBox.getBoundingClientRect().toJSON(), svg: priceBox.querySelector('canvas').getBoundingClientRect().toJSON() }))
        check(![...document.querySelectorAll('svg path')].some(path => /NaN|Infinity/.test(path.getAttribute('d') || '')), 'Chart produced invalid paths')
        return 'PASS: loading, cached refresh, expired revisit, IndexedDB restoration, startup warming, metrics, ranges, sources, ticker shortcuts, refresh/F5, partial/offline/failed states and recovery'
      }
    ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', minify: true,
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div>
    <script>
      window.mode = 'good'; window.ready = false; window.calls = 0;
      const good = ${JSON.stringify(good)};
      const empty = ${JSON.stringify(emptyHimsPayload())};
      window.api = { openExternal: async url => { window.opened = url }, hims: async request => {
        window.calls++; window.lastRequest = request; while (!window.ready) await new Promise(resolve => setTimeout(resolve, 50));
        window.forced = request.force;
        if (window.mode === 'reject') throw Error('Fixture network offline');
        const errors = window.mode === 'partial' ? [{ source: 'fixture', operation: 'hims', symbol: 'earnings', reason: 'Fixture report unavailable' }]
          : window.mode === 'failed' ? [{ source: 'fixture', operation: 'hims', symbol: 'all', reason: 'Fixture providers unavailable' }] : [];
        return { data: window.mode === 'failed' ? empty : window.mode === 'partial' ? { ...good, earnings: null, progress: { ...good.progress, earnings: 'unavailable' } } : good,
          meta: { source: 'UI fixture', fetchedAt: Date.now(), freshness: window.mode === 'good' ? 'fresh' : window.mode, failureReason: errors.map(error => error.symbol + ': ' + error.reason).join(' · ') }, errors };
      } };
    </script><script src="renderer.js"></script></body></html>`)
  if (process.argv.includes('--preview')) {
    const { createServer } = await import('node:http')
    const server = createServer(async (request, response) => {
      const name = request.url === '/renderer.js' ? 'renderer.js' : request.url === '/theme.css' ? 'theme.css' : 'index.html'
      response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html')
      response.end(await readFile(join(directory, name)))
    })
    server.listen(5174, '127.0.0.1', () => console.log('HIMS fixture preview: http://localhost:5174'))
    await new Promise<void>(resolveStop => process.once('SIGINT', () => { server.close(); resolveStop() }))
  } else {
    await writeFile(join(directory, 'main.cjs'), `
      const { app, BrowserWindow } = require('electron'); const fs = require('fs');
      app.disableHardwareAcceleration();
      app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ show: false, width: 1500, height: 1100, webPreferences: { backgroundThrottling: false, offscreen: true } });
        try {
          await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
          console.log(await window.webContents.executeJavaScript('window.runProbe()'));
          window.webContents.invalidate(); await new Promise(resolve => setTimeout(resolve, 350));
          fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
          window.setSize(800, 800); await new Promise(resolve => setTimeout(resolve, 200));
          if (await window.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth')) throw Error('Narrow layout overflows');
          console.log('PASS: responsive layout and screenshot'); app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
      });
    `)
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
      const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.on('data', data => { output += data })
      child.stderr.on('data', data => { output += data })
      const timer = setTimeout(() => { child.kill(); reject(new Error('HIMS UI probe timed out')) }, 30_000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
    console.log(result.output.trim())
    console.log(`Screenshot: ${screenshot}`)
  }
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
