import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { emptyHoodPayload, parseHoodReport } from '../electron/shared/hood.js'
import { emptyFundamentalSeriesMap } from '../electron/shared/fundamentalsPage.js'
import { buildStocksStats, normalizeStocksFacts } from '../electron/shared/stocks.js'
import type { HoodPayload } from '../electron/shared/hood.js'
import type { FundamentalsPagePayload } from '../electron/shared/contract.js'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-hood-ui-'))
const screenshot = join(root, 'out', 'hood-smoke.png')
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
  const candles = Array.from({ length: 750 }, (_, index) => ({
    time: Date.UTC(2023, 11, 15 + index) / 1000, open: 25 + index / 12,
    high: 28 + index / 12, low: 23 + index / 12, close: 26 + index / 12 + Math.sin(index / 17) * 7,
    volume: 25e6 + Math.round(Math.sin(index / 6) * 10e6),
  }))
  const financials = { symbol: 'HOOD', generatedAt: Date.now(), company: { name: 'Robinhood Markets', currency: 'USD' },
    facts: { marketCap: 100e9 }, quarterly: emptyFundamentalSeriesMap(), annual: emptyFundamentalSeriesMap(),
    sec: { filings: [] }, warnings: [] } as unknown as FundamentalsPagePayload
  financials.sec.filings = [{ form: '10-Q', filedDate: '2026-07-30', reportPeriod: '2026-06-30', description: 'Quarterly report', items: '', accessionNumber: '0001', documentUrl: 'https://www.sec.gov/Archives/edgar/data/1783879/fixture/hood.htm' }]
  for (let index = 0; index < 8; index++) {
    const endDate = new Date(Date.UTC(2024, 9 + index * 3, 0)).toISOString().slice(0, 10)
    for (const key of ['revenue', 'netIncome', 'operatingCashFlow', 'sharesOutstanding'] as const) {
      financials.quarterly[key].push({ endDate, label: endDate, source: 'sec', value: key === 'revenue' ? 500e6 + index * 100e6 : key === 'netIncome' ? -50e6 + index * 75e6 : key === 'sharesOutstanding' ? 900e6 : 300e6 })
    }
  }
  const good: HoodPayload = {
    ...emptyHoodPayload(), fetchedAt: Date.now(), financials,
    progress: { market: 'loaded', financials: 'loaded', monthly: 'loaded', quarterly: 'loaded' },
    market: { symbol: 'HOOD', ...normalizeStocksFacts('HOOD', {}), generatedAt: Date.now(), missing: [], institutional: [], insiders: [],
      chart: { candles, stats: buildStocksStats('HOOD', candles, 'USD', 'Robinhood Markets'), mfi: [] },
      news: [{ id: 'news', ticker: 'HOOD', title: 'Robinhood quarterly earnings release', source: 'Robinhood IR', publishedAt: Date.now(), url: 'https://investors.robinhood.com/news-releases' }] },
    monthly: parseHoodReport('Funded Customers\t28.6\t28.5\t-\t26.7\t+7%\nTotal Platform Assets\t$383.7\t$355.0\t+8%\t$303.9\t+26%\nNet Deposits\t$4\t$5.6\tNM\t$4.8\tNM', { period: '2026-08', url: 'https://investors.robinhood.com/static-files/month' }, 'monthly'),
    quarterly: parseHoodReport('Total net revenues\t989\t1308\t32%\t1041\t26%\nTransaction-based revenues\t539\t776\t44%\t623\t25%\nNet interest revenues\t357\t389\t9%\t359\t8%\nOther revenues\t93\t143\t54%\t59\t142%\nGold Subscribers (M)\t3.5\t4.8\t39%\t4.3\t12%\nDiluted EPS\t0.42\t0.62\t48%\t0.38\t63%', { period: '2026-06', url: 'https://investors.robinhood.com/static-files/quarter' }, 'quarterly'),
  }
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { useEffect } from 'react'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { HoodPage } from './src/pages/HoodPage'
      import { useReloadAll } from './src/api/queries'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
        return <HoodPage onStatusChange={panels => { window.health = panels }} onNavigate={(id, symbol) => { window.navigation = [id, symbol] }} />
      }
      window.runProbe = async () => {
        const root = createRoot(document.getElementById('root'))
        root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
        await settle()
        check(text().includes('Loading Robinhood'), 'Missing initial loading state')
        window.ready = true
        await settle()
        check(text().includes('28.6M') && text().includes('$383.7B') && text().includes('$0.62'), 'KPI metrics missing')
        check(document.querySelector('[data-hood-price-range]').dataset.hoodPriceRange === '1Y', 'Default range is not 1Y')
        const yearCount = Number(document.querySelector('[data-hood-price-range]').dataset.hoodCandleCount)
        const calls = window.calls
        for (const label of ['1M', '3M', '6M', '1Y', '3Y']) {
          click(label); await settle()
          check(document.querySelector('[data-hood-price-range]').dataset.hoodPriceRange === label, 'Range control failed')
        }
        check(Number(document.querySelector('[data-hood-price-range]').dataset.hoodCandleCount) > yearCount, 'Range did not change chart data')
        check(window.calls === calls, 'Range selection repeated provider load')
        for (const id of ['charts', 'fundamentals', 'options', 'valuation']) {
          click(id); check(JSON.stringify(window.navigation) === JSON.stringify([id, 'HOOD']), 'Ticker shortcut failed')
        }
        click('Robinhood report ↗'); check(window.opened.includes('investors.robinhood.com'), 'Report link failed')
        click('Robinhood quarterly earnings release ↗'); check(window.opened.includes('news-releases'), 'News link failed')
        const filing = [...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes('Quarterly report'))
        filing.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        check(window.opened.includes('sec.gov'), 'Filing link failed')
        click('Refresh'); await settle(); check(window.forced, 'Refresh did not force data reload')
        window.forced = false; await window.reloadAll(); await settle(); check(window.forced, 'F5 reload path did not force HOOD')
        window.mode = 'partial'; click('Refresh'); await settle()
        check(text().includes('monthly: Fixture report unavailable'), 'Partial failure is hidden')
        check(text().toLowerCase().includes('financial history') && text().includes('$0.62'), 'Partial failure hid healthy sections')
        window.mode = 'reject'; click('Refresh'); await settle()
        check(text().includes('Fixture network offline'), 'Rejected refresh is hidden')
        check(text().includes('$0.62'), 'Rejected refresh discarded cached content')
        window.mode = 'failed'; click('Refresh'); await settle()
        check(text().includes('all: Fixture providers unavailable'), 'Failed envelope is hidden')
        check(text().includes('Price history unavailable'), 'Empty market state missing')
        window.mode = 'good'; click('Refresh'); await settle()
        check(!document.querySelector('[role=status]'), 'Recovery left a stale error')
        // Reopening after startup uses the exact warmed query and makes no new request.
        root.render(<QueryClientProvider client={client}><div /></QueryClientProvider>); await settle()
        const warmCalls = window.calls
        root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); await settle()
        check(window.calls === warmCalls && text().includes('28.6M'), 'Warmed page repeated its first load')
        click('1Y'); await settle()
        const priceBox = document.querySelector('[data-hood-price-range]')
        check(priceBox.querySelector('svg').getBoundingClientRect().bottom <= priceBox.getBoundingClientRect().bottom + 1, 'Price chart overlaps volume')
        check(priceBox.querySelector('svg').getBoundingClientRect().width <= priceBox.getBoundingClientRect().width, 'Price chart width exceeds its panel: ' + JSON.stringify({ box: priceBox.getBoundingClientRect().toJSON(), svg: priceBox.querySelector('svg').getBoundingClientRect().toJSON() }))
        check(![...document.querySelectorAll('svg path')].some(path => /NaN|Infinity/.test(path.getAttribute('d') || '')), 'Chart produced invalid paths')
        return 'PASS: loading, warmed mount, metrics, ranges, sources, ticker shortcuts, refresh/F5, partial/offline/failed states and recovery'
      }
    ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div>
    <script>
      window.mode = 'good'; window.ready = false; window.calls = 0;
      const good = ${JSON.stringify(good)};
      const empty = ${JSON.stringify(emptyHoodPayload())};
      window.api = { openExternal: async url => { window.opened = url }, hood: async request => {
        window.calls++; while (!window.ready) await new Promise(resolve => setTimeout(resolve, 50));
        window.forced = request.force;
        if (window.mode === 'reject') throw Error('Fixture network offline');
        const errors = window.mode === 'partial' ? [{ source: 'fixture', operation: 'hood', symbol: 'monthly', reason: 'Fixture report unavailable' }]
          : window.mode === 'failed' ? [{ source: 'fixture', operation: 'hood', symbol: 'all', reason: 'Fixture providers unavailable' }] : [];
        return { data: window.mode === 'failed' ? empty : window.mode === 'partial' ? { ...good, monthly: null, progress: { ...good.progress, monthly: 'unavailable' } } : good,
          meta: { source: 'UI fixture', fetchedAt: Date.now(), freshness: window.mode === 'good' ? 'fresh' : window.mode, failureReason: errors.map(error => error.symbol + ': ' + error.reason).join(' · ') }, errors };
      } };
    </script><script src="renderer.js"></script></body></html>`)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.disableHardwareAcceleration();
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1500, height: 1100, webPreferences: { backgroundThrottling: false } });
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('HOOD UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${screenshot}`)
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
