import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { combineSofiReports, emptySofiPayload, parseSofiReport, sofiBookRatios } from '../electron/shared/sofi.js'
import { buildStocksStats, normalizeStocksFacts } from '../electron/shared/stocks.js'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-sofi-ui-'))
const screenshot = join(root, 'out', 'sofi-smoke.png')
const reportUrl = 'https://www.sec.gov/Archives/edgar/data/1818874/000181887426000050/a2026q2earningsrelease.htm'
const report = parseSofiReport(await readFile(new URL('./fixtures/sofi-2026-q2.html', import.meta.url), 'utf8'), reportUrl, '2026-07-29')
const quarters = combineSofiReports([report])
const end = Date.parse('2026-10-02T00:00:00Z') / 1000
const candles = Array.from({ length: 1095 }, (_, index) => {
  const price = 8 + index / 64 + Math.sin(index / 20)
  return { time: end - (1094 - index) * 86400, open: price, high: price + 0.3, low: price - 0.3, close: price, volume: 1_000_000 }
})
const payload = emptySofiPayload()
payload.market = { symbol: 'SOFI', ...normalizeStocksFacts('SOFI', { companyName: 'SoFi Technologies', marketCap: 32e9, pe: 41 }),
  chart: { candles, stats: buildStocksStats('SOFI', candles, 'USD', 'SoFi Technologies'), mfi: [] },
  news: [], institutional: [], insiders: [], missing: [], generatedAt: Date.now() }
payload.price = 25
payload.changePct = 2
payload.priceAsOf = Date.now()
payload.reports = { quarters, releases: [{ url: reportUrl, publishedAt: '2026-07-29', endDate: '2026-06-30' }],
  filings: [{ form: '8-K', accessionNumber: '0001818874-26-000050', filedDate: '2026-07-29', reportPeriod: '2026-06-30',
    description: 'Earnings release', items: '2.02', documentUrl: reportUrl }], notes: report.notes, warnings: [] }
payload.valuation = sofiBookRatios(25, quarters.at(-1))
payload.progress = { market: 'loaded', reports: 'loaded' }
payload.fetchedAt = Date.now()

try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build before the UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { SofiPage } from './src/pages/SofiPage'
      import { PageCache } from './src/components/chrome/PageCache'
      import { buildTasks } from './src/api/prefetch'
      import { useReloadAll } from './src/api/queries'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const check = (ok, message) => { if (!ok) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 150))
      const text = () => document.body.innerText
      let select
      const report = panels => { window.panels = panels }
      const renderPage = id => id === 'sofi' ? <SofiPage onStatusChange={report} /> : <div>Overview fixture</div>
      function Shell() {
        const [active, setActive] = useState('sofi'); select = setActive
        window.reloadAll = useReloadAll()
        return <div style={{display:'flex',flexDirection:'column',height:'100vh',width:'100%'}}>
          <nav><button onClick={() => setActive('overview')}>Overview</button> <button onClick={() => setActive('sofi')}>SOFI</button></nav>
          <PageCache activeTab={active} visibleIds={['overview','sofi']} renderPage={renderPage} />
        </div>
      }
      const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label)
      const refresh = async () => { button('Refresh').click(); await settle() }
      window.runProbe = async () => {
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Shell /></QueryClientProvider>)
        await settle()
        check(text().includes('Loading SOFI dashboard'), 'Missing initial loading state')
        window.ready = true
        await new Promise(resolve => setTimeout(resolve, 350))
        check(text().includes('$25.00') && text().includes('2.91x') && text().includes('3.41x'), 'Price and book multiples failed')
        check(text().includes('$8.58') && text().includes('$7.34') && text().includes('2026-06-30'), 'Book values and dates failed')
        check(document.querySelectorAll('thead th').length === 9, 'Missing eight-quarter table')
        check(document.querySelectorAll('tbody tr').length === 21, 'Missing operating and segment metrics')
        check(document.querySelectorAll('svg').length === 9, 'Missing dashboard charts')
        check([...document.querySelectorAll('svg')].every(svg => svg.getBoundingClientRect().height > 120), 'A chart collapsed vertically')
        document.querySelector('[aria-label="Members source for Q2 2026"]').click()
        check(window.opened.includes('a2026q2earningsrelease.htm'), 'Metric source link failed')
        const pricePanel = () => [...document.querySelectorAll('section')].find(panel => panel.querySelector('h2')?.textContent === 'SOFI price · USD')
        const path = () => pricePanel().querySelector('path')?.getAttribute('d')
        const yearPath = path(), beforeRange = window.calls
        for (const range of ['1M','3M','6M','1Y','3Y']) { button(range).click(); await settle(); check(path(), 'Empty price range '+range) }
        button('1M').click(); await settle()
        check(path() !== yearPath, 'Range selection did not change price history')
        check(window.calls === beforeRange, 'Price ranges repeated provider requests')
        window.forced = false
        await window.reloadAll(); await settle()
        check(window.forced, 'Global reload did not force the SOFI provider')
        window.mode = 'stale'; await refresh()
        check(window.forced && text().includes('cached'), 'Forced refresh or stale warning missing')
        check(text().includes('2.91x') && document.querySelectorAll('thead th').length === 9, 'Stale data disappeared')
        window.mode = 'partial'; await refresh()
        check(text().includes('Reports unavailable') && text().includes('$25.00'), 'Partial outage hid market data')
        check(window.panels.some(panel => panel.label === 'SOFI reported quarters' && panel.envelope.meta.freshness === 'failed'), 'Missing panel failure status')
        window.mode = 'failed'; await refresh()
        check(text().includes('All providers unavailable') && text().includes('SoFi quarterly reports unavailable'), 'Total failure not visible')
        window.mode = 'success'; await refresh()
        check(!document.querySelector('[role=status]'), 'Failure did not recover')
        // Prepare SOFI through its actual startup task while another page is selected.
        select('overview'); await settle(); client.clear()
        const task = buildTasks(undefined, undefined, {stocks:'AAPL',fundamentals:'AAPL'}, {year:2026,month:9,earningsYear:2026,ipoYear:2026}).find(task => task.tab === 'sofi')
        await task.run(client, 8)
        const beforeVisit = window.calls
        select('sofi'); await settle()
        check(window.calls === beforeVisit, 'First SOFI visit repeated the startup request')
        check(text().includes('2.91x') && !text().includes('Loading SOFI dashboard'), 'First visit was not ready')
        button('1Y').click(); await settle()
        document.querySelector('details').open = true
        check(text().includes('Goodwill adjustment'), 'Book reconciliation missing')
        return 'PASS: loading, price, both book ratios, eight quarters, charts, all price ranges, sources, forced refresh, stale/partial/total failures, recovery and startup readiness'
      }
    ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body>
    <div id="root"></div><script>
    window.ready=false; window.mode='success'; window.calls=0; const good=${JSON.stringify(payload)};
    window.api={openExternal:async url => {window.opened=url},sofi:async request => {
      while(!window.ready) await new Promise(resolve=>setTimeout(resolve,50)); window.calls++;window.forced=request.force;
      const data=structuredClone(good); let errors=[];let freshness='fresh';
      if(window.mode==='stale'){data.progress={market:'stale',reports:'stale'};freshness='stale';errors=[{source:'fixture',symbol:'reports',operation:'sofi-reports',reason:'Refresh failed; showing cached data.'}]}
      if(window.mode==='partial'){data.reports=null;data.progress.reports='unavailable';data.valuation={priceToBook:null,priceToTangibleBook:null,bookAsOf:null};freshness='partial';errors=[{source:'fixture',symbol:'reports',operation:'sofi-reports',reason:'Reports unavailable'}]}
      if(window.mode==='failed'){data.market=null;data.reports=null;data.price=null;data.changePct=null;data.progress={market:'unavailable',reports:'unavailable'};data.valuation={priceToBook:null,priceToTangibleBook:null,bookAsOf:null};freshness='failed';errors=[{source:'fixture',symbol:'reports',operation:'sofi-reports',reason:'All providers unavailable'}]}
      return {data,errors,meta:{source:'SOFI UI fixture',freshness,fetchedAt:Date.now(),failureReason:errors.map(error=>error.reason).join(' · ')}}
    }};
    </script><script src="renderer.js"></script></body></html>`)
  await writeFile(join(directory, 'main.cjs'), `
    const {app,BrowserWindow}=require('electron');const fs=require('fs');
    app.setPath('userData',${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async()=>{
      const window=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{backgroundThrottling:false,offscreen:true}});
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        await new Promise(resolve=>setTimeout(resolve,250));
        fs.writeFileSync(${JSON.stringify(screenshot)},(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
        window.setSize(800,800);await new Promise(resolve=>setTimeout(resolve,250));
        if(await window.webContents.executeJavaScript('document.documentElement.scrollWidth>window.innerWidth'))throw Error('Narrow layout overflows');
        console.log('PASS: responsive layout and screenshot');app.exit(0);
      }catch(error){console.error(error);app.exit(1)}
    });
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('SOFI UI probe timed out')) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${screenshot}`)
} finally {
  assert(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
