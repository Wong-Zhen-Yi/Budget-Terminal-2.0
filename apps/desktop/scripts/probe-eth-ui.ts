import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-eth-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build before the ETH UI probe')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { EthPage } from './src/pages/EthPage'
      import { buildTasks } from './src/api/prefetch'
      const check = (ok, message) => { if (!ok) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 130))
      const DAY = 86400000, end = Date.UTC(2026, 10, 19), now = Date.now()
      const daily = Array.from({ length: 90 }, (_, i) => ({
        day: end - (89-i)*DAY, mainnetTps: 20+i, layer2Tps: 250+2*i,
        gasThroughputMgasPerSecond: i === 88 ? undefined : { mainnet: 10+i/10, layer2: 80+i },
        feesPaidUsdPerDay: i === 88 ? { mainnet: 0, layer2: 0 } : { mainnet: 400000+i*100, layer2: 150000+i*200 },
        stablecoinSupplyUsd: { mainnet: 150e9+i*1e8, layer2: 14e9+i*1e7 },
      })).filter((_, i) => i !== 80)
      const fixture = { data: {
        ecosystem: Array.from({ length: 40 }, (_, i) => ({ asOf: now-180000+i*100, tps: 350+i })),
        mainnet: { asOf: now-180000, tps: 24.2, blockTimeSeconds: 12, medianTransactionFeeUsd: .7448 }, daily,
      }, errors: [], meta: { source: 'fixture', fetchedAt: now, freshness: 'fresh' } }
      let calls = 0, request, statuses, rejectSource = false
      window.api.eth = async value => { calls++; request = value; return fixture }
      window.api.openExternal = async () => { if (rejectSource) throw Error('Fixture opening failure') }
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } })
      const host = createRoot(document.getElementById('root'))
      const render = () => host.render(<QueryClientProvider client={client}><EthPage onStatusChange={value => { statuses = value }} /></QueryClientProvider>)
      const button = text => [...document.querySelectorAll('button')].find(e => e.textContent === text)
      const inspector = () => document.querySelector('.eth-inspector')
      const key = async (chart, name) => { chart.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); await settle() }
      const selected = () => document.querySelector('.eth-crosshair')?.getAttribute('data-day')
      const synced = () => check([...document.querySelectorAll('.eth-crosshair')].every(e => e.getAttribute('data-day') === selected()), 'Charts selected different UTC dates')
      window.runProbe = async () => {
        const tasks = buildTasks(undefined, { hiddenTabs: ['eth'], favoriteTabs: [] }, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 11, earningsYear: 2026, ipoYear: 2026 })
        const task = tasks.find(task => task.tab === 'eth')
        check(task, 'Hidden ETH missing from startup preloading')
        await task.run(client, 7)
        check(request.background && request.backgroundOrder === 7, 'ETH startup lost background priority')
        render(); await settle()
        check(calls === 1, 'Visiting warmed ETH fetched again')
        check(document.querySelectorAll('.eth-chart-card').length === 4, 'Four metrics not visible together')
        check(document.querySelectorAll('.eth-plot svg').length === 4, 'Metric charts missing')
        check(document.querySelectorAll('.eth-saved').length === 4, 'Delayed recent samples are not labelled')
        check(document.querySelector('.eth-chart-total strong').textContent === '537', 'Latest TPS aggregate is wrong')
        check(inspector().textContent.includes('79.7%'), 'Selected L2 share is wrong')
        const charts = [...document.querySelectorAll('.eth-plot svg')]
        await key(charts[1], 'Home'); synced()
        check(Number(selected()) === end-29*DAY, 'Home did not select first UTC date')
        check(inspector().querySelector('h3').textContent === 'Gas throughput', 'Chart interaction did not select inspector metric')
        await key(charts[1], 'End'); await key(charts[1], 'ArrowLeft'); synced()
        check(inspector().textContent.includes('No gas throughput observation for this date.'), 'Missing metric was replaced with another date')
        check(document.querySelectorAll('.eth-chart-total strong')[1].textContent === '—', 'Missing metric was displayed as zero')
        button('Fees paid').click(); await settle()
        check(document.querySelectorAll('.eth-chart-total strong')[2].textContent === '$0', 'Zero fee reading was discarded')
        check(inspector().textContent.includes('zero total') && !inspector().textContent.includes('NaN'), 'Zero-total share was fabricated')
        await key(charts[0], 'End'); button('Compare').click(); await settle()
        check(inspector().textContent.includes('Change since Oct 21'), 'Comparison baseline date missing')
        check(inspector().querySelector('.eth-comparison').textContent.includes('+29') && inspector().querySelector('.eth-comparison').textContent.includes('+58'), 'Comparison changes are wrong')
        await key(charts[0], 'Home')
        check(inspector().textContent.includes('No earlier observation'), 'Comparison invented an earlier baseline')
        button('Breakdown').click(); button('90D').click(); await settle(); await key(charts[0], 'Home')
        check(Number(selected()) === end-89*DAY, '90D range did not extend timeline')
        button('30D').click(); await settle(); synced()
        check(Number(selected()) === end, 'Range contraction retained an out-of-range date')
        check(charts[0].querySelectorAll('.eth-data-segment').length === 2, 'Chart connected across a missing UTC date')
        check(charts[3].querySelectorAll('.eth-area-l1,.eth-area-l2').length === 0 && charts[3].querySelectorAll('.eth-line-l1,.eth-line-l2').length === 4, 'Stablecoin layers were stacked')
        const rect = charts[2].getBoundingClientRect()
        charts[2].dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.right-1, clientY: rect.top+20, bubbles: true })); await settle(); synced()
        check(inspector().querySelector('h3').textContent === 'Fees paid', 'Pointer date selection did not select the chart')
        rejectSource = true; button('Data by growthepie ↗').click(); await settle()
        check(document.querySelector('.eth-source [role="status"]').textContent.includes('Could not open'), 'Source-link failure hidden')
        rejectSource = false; button('Data by growthepie ↗').click(); await settle()
        client.setQueryData(['eth'], { ...fixture, errors: [{ source: 'fixture', operation: 'eth', reason: 'Unavailable history' }], meta: { ...fixture.meta, freshness: 'partial' }, data: { ...fixture.data, daily: [] } }); await settle()
        check(document.querySelectorAll('.eth-chart-card .eth-empty').length === 4 && !document.querySelector('.eth-plot svg'), 'Unavailable history fabricated chart data')
        check(statuses[0].envelope.meta.freshness === 'partial', 'Settings lost partial-data diagnostics')
        client.setQueryData(['eth'], fixture); await settle()
        button('Transactions per second').click(); await settle()
        host.render(null); await settle(); render(); await settle()
        check(calls === 1, 'Revisiting ETH fetched warmed data again')
        window.verifyLayout = fit => {
          const page = document.querySelector('.eth-page')
          check(document.documentElement.scrollWidth <= innerWidth, 'Document horizontal overflow')
          check(page.scrollWidth <= page.clientWidth+1, 'ETH horizontal overflow')
          if (fit) check(page.scrollHeight <= page.clientHeight+1, 'ETH vertical overflow '+page.scrollHeight+'/'+page.clientHeight+' '+JSON.stringify([...document.querySelector('.eth-inspector').children].map(e=>[e.className,e.getBoundingClientRect().height,getComputedStyle(e).marginTop,getComputedStyle(e).marginBottom])))
          for (const element of document.querySelectorAll('.eth-inspector,.eth-chart-card,.eth-snapshot')) {
            check(element.scrollWidth <= element.clientWidth+1, 'Panel horizontal clipping: '+element.className)
            check(element.scrollHeight <= element.clientHeight+1, 'Panel vertical clipping: '+element.className+' '+element.scrollHeight+'/'+element.clientHeight)
          }
          for (const svg of document.querySelectorAll('.eth-plot svg')) {
            check(Math.abs(svg.viewBox.baseVal.width-svg.getBoundingClientRect().width)<2, 'Chart text stretched horizontally')
            check(Math.abs(svg.viewBox.baseVal.height-svg.getBoundingClientRect().height)<2, 'Chart text stretched vertically')
          }
        }
        return 'PASS: ETH startup, linked UTC selection, keyboard/pointer controls, ranges, comparison, missing/zero data, separate stablecoin lines, stale readings, source errors, diagnostics and revisit'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><meta charset="utf-8"><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="position:absolute;top:144px;left:64px;width:calc(100vw - 64px);height:calc(100vh - 144px);display:flex"></div><script>window.api = { platform: "win32" };</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const fs = require('node:fs')
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))})
    app.disableHardwareAcceleration()
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1920, height: 1034, frame: false, enableLargerThanScreen: true, webPreferences: { backgroundThrottling: false, offscreen: true } })
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        for (const [name, width, height, fit] of [['normal',1856,890,true],['app',1536,856,true],['compact',1376,758,true],['small',1040,680,true],['narrow',720,850,false],['phone',500,850,false]]) {
          window.setContentSize(width+64,height+144)
          await new Promise(resolve => setTimeout(resolve,350))
          const result = await window.webContents.executeJavaScript('try { window.verifyLayout('+fit+'); "PASS" } catch(e) { e.message }')
          fs.writeFileSync(${JSON.stringify(join(root, 'out/eth-'))} + name + '.png', (await window.webContents.capturePage({x:64,y:144,width,height},{stayHidden:true,stayAwake:true})).toPNG())
          await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.textContent==='Compare').click()")
          await new Promise(resolve => setTimeout(resolve,130))
          const compare = await window.webContents.executeJavaScript('try { window.verifyLayout('+fit+'); "PASS" } catch(e) { e.message }')
          if (compare !== 'PASS') fs.writeFileSync(${JSON.stringify(join(root, 'out/eth-'))} + name + '-compare.png', (await window.webContents.capturePage({x:64,y:144,width,height},{stayHidden:true,stayAwake:true})).toPNG())
          await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.textContent==='Breakdown').click()")
          if (compare !== 'PASS') throw Error(name+' compare: '+compare)
          if (result !== 'PASS') throw Error(name+': '+result)
        }
        console.log('PASS: ETH normal, compact, small and narrow layouts')
        app.exit(0)
      } catch(error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: scratch, LOCALAPPDATA: scratch }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(scratch, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('ETH UI probe timed out')) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  assert(relative(tmpdir(), scratch) && !relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
