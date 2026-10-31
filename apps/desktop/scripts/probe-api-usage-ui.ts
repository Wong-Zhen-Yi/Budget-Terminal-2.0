import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-api-ui-'))
try {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { ApiUsagePanel } from './src/components/settings/ApiUsagePanel'
    import { API_CATALOG } from './src/components/settings/apiCatalog'
    import { TABS } from './electron/shared/contract'
    import { useDataHealth } from './src/stores/dataHealth'
    const check = (value, message) => { if (!value) throw Error(message) }
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    let failed = false
    let throttled = false
    let empty = false
    window.api = { apiUsage: async () => {
      if (failed) throw Error('fixture')
      return { sampledAt: Date.now(), providers: empty ? [] : [
        { id: 'yahoo', label: 'Yahoo', requestCount: 12, percent: 5, windowSeconds: 60, inFlight: 2, queued: 4, softLimit: 240, throttled, cooldownMs: 5000 },
        { id: 'coingecko', label: 'CoinGecko', requestCount: 0, percent: 0, windowSeconds: 60, inFlight: 0, softLimit: 30, throttled: false, cooldownMs: 0 },
        { id: 'hyperliquid', label: 'Hyperliquid', requestCount: 5, percent: 2, windowSeconds: 60, inFlight: 1, softLimit: 300, throttled: false, cooldownMs: 0 },
      ] }
    } }
    useDataHealth.setState({ startup: { durationMs: 1200, planned: 5, timings: [], pageOrder: ['dashboard', 'stocks', 'options', 'news', 'valuation'], pages: {
      dashboard: { state: 'ready' }, stocks: { state: 'loading' }, options: { state: 'failed' }, news: { state: 'degraded' }, valuation: { state: 'idle' },
    } } })
    const host = createRoot(document.getElementById('root'))
    host.render(<ApiUsagePanel />)
    window.runProbe = async () => {
      check(new Set(API_CATALOG.map(api => api.id)).size === API_CATALOG.length, 'Duplicate provider')
      for (const api of API_CATALOG) for (const use of api.uses) for (const page of use.pages) check(TABS.some(tab => tab.id === page), 'Unknown page ' + page)
      await wait(150)
      const providerTable = document.querySelector('table[aria-label="Provider usage"]')
      check(providerTable.textContent.includes('12 / 240') && providerTable.textContent.includes('Last 60s'), 'Missing live count or rolling window')
      check(providerTable.textContent.includes('2 active') && providerTable.textContent.includes('4 queued'), 'Missing activity')
      check(document.querySelector('.api-usage__footer').textContent.includes('1 ready · 1 loading · 2 incomplete · 1 awaiting input'), 'Startup summary must distinguish readiness, loading, failure and idle')
      check(document.querySelector('table[aria-label="Startup status"]').textContent.includes('Failed'), 'Startup failures hidden')
      const startup = useDataHealth.getState().startup
      const pageOrder = () => [...document.querySelectorAll('table[aria-label="Startup status"] tbody th')].map(row => row.textContent)
      check(pageOrder().join('|') === ['options', 'news', 'stocks', 'valuation', 'dashboard'].map(id => TABS.find(tab => tab.id === id).label).join('|'), 'Failed and incomplete pages must precede loading, awaiting input and ready pages')
      useDataHealth.setState({ startup: { ...startup, pages: { ...startup.pages, dashboard: { state: 'failed' }, options: { state: 'ready' } } } })
      await wait(50)
      check(pageOrder()[0] === 'Dashboard' && pageOrder().at(-1) === 'Options', 'Status changes must move new failures to the top and recovered pages below issues')
      check(useDataHealth.getState().startup.pageOrder.join('|') === startup.pageOrder.join('|'), 'Display sorting must not change startup loading priority')
      useDataHealth.setState({ startup: { ...startup, pages: Object.fromEntries(startup.pageOrder.map(id => [id, { state: 'idle' }])) } })
      await wait(50)
      check(document.querySelector('.api-usage__startup .api-usage__badge').textContent.includes('awaiting input'), 'Unconfigured pages must not be marked ready')
      check(pageOrder().join('|') === startup.pageOrder.map(id => TABS.find(tab => tab.id === id).label).join('|'), 'Pages with the same status must retain startup order')
      useDataHealth.setState({ startup }); await wait(50)
      const directory = document.querySelector('.api-usage__directory')
      check(!directory.open, 'Directory must start collapsed')
      directory.querySelector('summary').click(); await wait(50)
      check(directory.open, 'Directory must expand')
      const select = document.querySelector('select')
      select.value = 'crypto'; select.dispatchEvent(new Event('change', { bubbles: true })); await wait(50)
      check(directory.textContent.includes('CoinGecko') && !directory.textContent.includes('SEC EDGAR'), 'Page filtering failed')
      const input = document.querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'no-such-provider')
      input.dispatchEvent(new Event('input', { bubbles: true })); await wait(50)
      check(document.body.textContent.includes('No API dependencies match'), 'Empty search failed')
      failed = true; await wait(2100)
      check(document.querySelector('[role=alert]')?.textContent.includes('last successful snapshot'), 'Poll failure hidden')
      check(providerTable.textContent.includes('12 / 240'), 'Polling failure discarded last sample')
      failed = false; throttled = true; await wait(2100)
      check(!document.querySelector('[role=alert]') && providerTable.textContent.includes('5s cooldown'), 'Recovery or rate-limit state missing')
      empty = true; await wait(2100)
      check(document.body.textContent.includes('No instrumented providers reported usage.'), 'Empty provider snapshot hidden')
      empty = false; throttled = false
      select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true })); await wait(2100)
      directory.querySelector('summary').click(); await wait(100)
      check(!directory.open, 'Directory must collapse again')
      window.checkLayout()
      return 'PASS: live provider activity, startup readiness/failures/idle, directory expand/filter/search, retained samples, rate limits, poll recovery and empty usage'
    }
    window.checkLayout = () => {
      check(document.documentElement.scrollWidth <= innerWidth, 'Page overflows horizontally')
      const panel = document.querySelector('.api-usage')
      check(panel.getBoundingClientRect().right <= innerWidth, 'Panel overflows window')
      return 'PASS: layout at ' + innerWidth + 'px'
    }
    window.checkUnmount = async () => {
      host.unmount()
      return 'PASS: unmount'
    }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' }, alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="theme.css"><style>body{overflow:auto}#root{padding:20px}</style><div id="root"></div><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, width: 1500, height: 900, webPreferences: { backgroundThrottling: false } })
      try {
        await win.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await win.webContents.executeJavaScript('window.runProbe()'))
        if (process.env.API_USAGE_SCREENSHOT) require('node:fs').writeFileSync(process.env.API_USAGE_SCREENSHOT, (await win.webContents.capturePage()).toPNG())
        for (const width of [1024, 768, 480]) {
          win.setSize(width, 900)
          await new Promise(resolve => setTimeout(resolve, 100))
          console.log(await win.webContents.executeJavaScript('window.checkLayout()'))
        }
        console.log(await win.webContents.executeJavaScript('window.checkUnmount()'))
        app.exit(0)
      }
      catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{code: number | null; output: string}>((done, reject) => {
    const child = spawn(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, windowsHide: true })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('UI probe timed out')) }, 30000)
    child.on('error', reject)
    child.on('exit', code => { clearTimeout(timer); done({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output)
} finally { await rm(directory, { recursive: true, force: true }) }
