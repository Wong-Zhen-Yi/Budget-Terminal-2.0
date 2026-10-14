import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { pltrFixture } from './fixtures/pltr.js'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-pltr-ui-'))
const screenshot = join(root, 'out/pltr-smoke.png')
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build first')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { useEffect } from 'react'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { PltrPage } from './src/pages/PltrPage'
    import { useReloadAll } from './src/api/queries'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const settle = () => new Promise(resolve => setTimeout(resolve, 180))
    const check = (ok, message) => { if (!ok) throw Error(message) }
    const text = () => document.body.innerText
    const click = label => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().startsWith(label.toLowerCase()))
      check(button, 'Missing button: ' + label); button.click()
    }
    function Page() {
      const reload = useReloadAll()
      useEffect(() => { window.reloadAll = reload }, [reload])
      return <PltrPage onStatusChange={panels => window.health = panels} onNavigate={(...args) => window.navigation = args} />
    }
    const page = <QueryClientProvider client={client}><Page /></QueryClientProvider>
    window.runProbe = async () => {
      const root = createRoot(document.getElementById('root'))
      root.render(page); await settle()
      check(text().includes('Loading PLTR'), 'Initial loading missing')
      window.ready = true; await settle()
      check(text().includes('$1.2B') && text().includes('+50.00%') && text().includes('+30.00%'), 'Financial KPIs incorrect')
      check(text().includes('+$0.07'), 'Daily dollar change lost its cents')
      check(window.health.length === 2 && window.health.every(p => p.envelope), 'Missing independent health panels')
      check(getComputedStyle(document.querySelector('.pltr-tab[aria-selected=true]')).borderBottomColor === 'rgb(47, 111, 208)', 'Selected layout must use the existing blue accent')
      check(getComputedStyle(document.querySelector('.pltr-kpis')).backgroundColor === 'rgb(13, 20, 32)', 'KPI strip must use the existing app surface')
      check(document.querySelectorAll('.pltr-overview-grid > section').length === 3, 'Terminal overview must have three lower panels')
      check(document.querySelector('[aria-label="Revenue & cash generation grouped bar chart"]'), 'Grouped financial chart missing')
      const box = () => document.querySelector('[data-pltr-price-range]')
      check(box().dataset.pltrPriceRange === '1Y' && box().querySelector('canvas')?.width > 0, 'Price chart missing')
      const yearCount = Number(box().dataset.pltrCandleCount)
      const calls = window.calls.length
      click('1M'); await settle(); check(Number(box().dataset.pltrCandleCount) < yearCount, '1M did not trim price history')
      click('3Y'); await settle(); check(Number(box().dataset.pltrCandleCount) > yearCount, '3Y history missing')
      check(window.calls.length === calls, 'Ranges repeated provider load')
      const selectTab = async label => {
        const tab = [...document.querySelectorAll('[role=tab]')].find(tab => tab.textContent === label)
        tab.click(); await settle()
        check(tab.getAttribute('aria-selected') === 'true' && document.querySelector('[role=tabpanel]').getAttribute('aria-labelledby') === tab.id, 'Tab selection/ARIA failed: ' + label)
      }
      await selectTab('Financials'); check(text().includes('Shares Y/Y') && text().includes('R&D'), 'Expanded statements missing')
      await selectTab('Valuation'); check(text().toLowerCase().includes('valuation context'), 'Valuation section missing')
      await selectTab('Ownership'); check(text().toLowerCase().includes('institutional ownership') && text().toLowerCase().includes('insider transactions'), 'Ownership sections missing')
      check(text().includes('Fixture institution') && text().includes('Fixture insider'), 'Ownership data missing')
      await selectTab('News & filings'); check(document.querySelector('[aria-label="Search SEC filings"]'), 'Full filing search missing')
      const filing = [...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes('Quarterly report'))
      filing.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true})); check(window.opened.includes('sec.gov'), 'SEC filing link failed')
      await selectTab('Overview'); check(box().dataset.pltrPriceRange === '3Y', 'Tab switch lost selected chart range')
      check(window.calls.length === calls, 'Switching sections repeated provider loads')
      const overviewTab = document.querySelector('[role=tab][aria-selected=true]')
      overviewTab.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true})); await settle()
      check(document.activeElement.textContent === 'Financials', 'Keyboard tab selection failed')
      await selectTab('Overview')
      for (const id of ['stocks', 'charts', 'fundamentals', 'options', 'valuation']) {
        document.querySelector('button[aria-label="Open PLTR ' + id + '"]').click(); check(JSON.stringify(window.navigation) === JSON.stringify([id, 'PLTR']), 'Ticker shortcut failed')
      }
      [...document.querySelectorAll('button')].find(button => button.textContent.includes('Palantir fixture headline ↗')).click(); check(window.opened.includes('palantir.com'), 'News source failed')
      click('Refresh'); await settle()
      check(window.calls.slice(-2).every(call => call.force && call.symbol === 'PLTR'), 'Refresh must force both sources')
      const reloadCalls = window.calls.length; await window.reloadAll(); await settle()
      check(window.calls.length === reloadCalls + 2 && window.calls.slice(-2).every(call => call.force), 'F5 must refresh both active PLTR queries')
      window.mode = 'partial'; click('Refresh'); await settle()
      check(text().includes('Fixture filings unavailable') && text().includes('$1.2B'), 'Partial data warning or usable panels missing')
      window.mode = 'reject'; click('Refresh'); await settle()
      check(text().includes('Fixture network offline') && text().includes('$1.2B'), 'Refresh failure discarded content or hid error')
      window.mode = 'good'; click('Refresh'); await settle()
      check(!document.querySelector('[role=status]'), 'Recovery retained error')
      window.mode = 'empty'; click('Refresh'); await settle()
      check(text().includes('Fixture providers unavailable') && text().includes('Price history unavailable.') && text().includes('Financial history unavailable.'), 'Complete failure must show warnings and empty states')
      window.mode = 'good'; click('Refresh'); await settle()
      root.render(<div />); await settle()
      const warmCalls = window.calls.length
      root.render(page); await settle()
      check(window.calls.length === warmCalls && text().includes('$1.2B'), 'Warmed mount repeated first-visit load')
      check(![...document.querySelectorAll('svg path')].some(p => /NaN|Infinity/.test(p.getAttribute('d') || '')), 'Invalid chart geometry')
      click('1Y'); await settle()
      const canvas = box().querySelector('canvas').getBoundingClientRect()
      check(canvas.bottom <= box().getBoundingClientRect().bottom + 1, 'Price chart overlaps volume')
      return 'PASS: app theme, Terminal layout, all sections, keyboard tabs, loading, KPIs, ranges, source links, shortcuts, independent health, refresh, partial/offline recovery and warmed mount'
    }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div>
    <script>
      const fixture = ${JSON.stringify(pltrFixture())};
      window.ready = false; window.calls = []; window.mode = 'good';
      const load = async (kind, request) => {
        window.calls.push(request); while (!window.ready) await new Promise(resolve => setTimeout(resolve, 30));
        if (window.mode === 'reject' && kind === 'financials') throw Error('Fixture network offline');
        const partial = window.mode === 'partial' && kind === 'financials';
        const empty = window.mode === 'empty';
        const data = !empty ? fixture[kind] : kind === 'market' ? { ...fixture.market, chart: { candles: [], stats: null }, news: [], institutional: [], insiders: [] } : {
          ...fixture.financials, quarterly: Object.fromEntries(Object.keys(fixture.financials.quarterly).map(key => [key, []])), sec: { ...fixture.financials.sec, filings: [] }
        };
        return { data, meta: { source: 'Synthetic fixture', freshness: empty ? 'failed' : partial ? 'partial' : 'fresh', fetchedAt: Date.now(), failureReason: empty ? 'Fixture providers unavailable' : partial ? 'Fixture filings unavailable' : '' }, errors: [] };
      };
      window.api = { stocks: request => load('market', request), fundamentalsPage: request => load('financials', request), openExternal: async url => window.opened = url };
    </script><script src="renderer.js"></script></body></html>`)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.disableHardwareAcceleration(); app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1500, height: 1100, webPreferences: { backgroundThrottling: false, offscreen: true } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
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
    const timer = setTimeout(() => { child.kill(); reject(Error('PLTR UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshot: ' + screenshot)
} finally {
  assert(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
