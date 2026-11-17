import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-macro-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build first')
  await writeFile(join(scratch, 'theme.css'), (await readFile(join(assets, css), 'utf8')) + '\n' + (await readFile(join(root, 'src/pages/MacroPage.css'), 'utf8')))
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { MacroPage } from './src/pages/MacroPage'
    import { ECONOMIC_SERIES, buildRow, buildYieldCurve } from './electron/shared/economic'
    import { buildTasks } from './src/api/prefetch'
    import { useRefreshEconomic } from './src/api/economicQueries'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
    const check = (value, message) => { if (!value) throw Error(message) }
    const settle = () => new Promise(resolve => setTimeout(resolve, 180))
    let calls = 0, navigation, lastRequest, statuses, failed = false
    const rows = ECONOMIC_SERIES.map(series => buildRow(series, Array.from({length: 36}, (_, i) => [new Date(Date.UTC(2024, i, 1)).toISOString().slice(0,10), 100 + i + i*i/100])))
    const payload = { rows, source: 'fixture', generatedAt: new Date().toISOString(), groups: ['Growth', 'Inflation', 'Labor', 'Rates'], missing: [], unreachable: [], yieldCurve: buildYieldCurve(rows) }
    window.api.economic = async request => { calls++; lastRequest = request; return { data: failed ? { ...payload, rows: [] } : payload, errors: failed ? [{ source: 'fixture', reason: 'HTTP 503' }] : [], meta: { source: 'fixture', freshness: failed ? 'failed' : 'fresh', failureReason: failed ? 'HTTP 503' : undefined, fetchedAt: Date.now() } } }
    const host = createRoot(document.getElementById('root'))
    function Page() { window.refreshMacro = useRefreshEconomic().refresh; return <MacroPage onStatusChange={panels => { statuses = panels }} onNavigate={page => { navigation = page }} /> }
    const render = () => host.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
    window.runProbe = async () => {
      const tasks = buildTasks(undefined, { hiddenTabs: ['macro'], favoriteTabs: [] }, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 11, earningsYear: 2026, ipoYear: 2026 })
      const task = tasks.find(task => task.tab === 'macro'); check(task, 'Hidden Macro missing from startup')
      await task.run(client, 7); check(lastRequest.background && lastRequest.backgroundOrder === 7, 'Startup priority lost')
      await tasks.find(task => task.tab === 'economic').run(client, 8); check(calls === 1, 'Shared cache repeated download')
      render(); await settle(); check(calls === 1, 'First visit fetched warmed content')
      check(document.body.innerText.includes('Cycle compass') && document.querySelector('.macro-chart svg'), 'Macro content or chart missing')
      check(statuses[0].label === 'Macro', 'Settings diagnostic label missing')
      const payroll = [...document.querySelectorAll('.macro-driver')].find(node => node.textContent.includes('Nonfarm'))
      payroll.click(); await settle(); check(payroll.getAttribute('aria-pressed') === 'true', 'Driver selection failed')
      const range = [...document.querySelectorAll('button')].find(node => node.textContent === '1Y'); range.click(); await settle(); check(range.getAttribute('aria-pressed') === 'true' && calls === 1, 'Range change fetched data')
      document.querySelector('nav button').click(); check(navigation === 'economic', 'Research navigation failed')
      client.setQueryData(['economic'], { data: { ...payload, rows: [] }, meta: { source: 'fixture', freshness: 'failed', fetchedAt: Date.now() } }); await settle()
      check(document.body.innerText.includes('No directional signal'), 'Missing data fabricated a signal')
      await window.refreshMacro(true); await settle(); check(lastRequest.force, 'Force refresh not propagated')
      failed = true; await window.refreshMacro(true).catch(() => {}); await settle(); check(document.querySelector('.macro-chart svg'), 'Outage erased history'); check(String(client.getQueryState(['economic']).error).includes('HTTP 503'), 'Settings lost refresh failure')
      failed = false; await window.refreshMacro(true); await settle(); check(!client.getQueryState(['economic']).error, 'Recovery retained error')
      host.render(null); await settle(); const before = calls; render(); await settle(); check(calls === before, 'Revisit repeated download')
      window.verifyLayout = fit => {
        const page = document.querySelector('[data-macro-page]')
        check(document.documentElement.scrollWidth <= innerWidth, 'Document horizontal overflow')
        check(page.scrollWidth <= page.clientWidth + 1, 'Page horizontal overflow')
        if (fit) { check(page.scrollHeight <= page.clientHeight + 1, 'Page vertical overflow'); for (const section of page.querySelectorAll('section')) check(section.scrollHeight <= section.clientHeight + 1, 'Section clipped: ' + section.className) }
      }
      return 'PASS: Macro hidden startup, shared cache, selection, ranges, navigation, missing coverage, refresh and revisit'
    }
` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' }, alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = { platform: "win32" };</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1500, height: 950, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        for (const [name, width, height, fit] of [['normal',1500,950,true],['compact',1280,800,true],['app-content',1040,680,true],['narrow',720,850,false]]) {
          window.setSize(width,height); await new Promise(resolve => setTimeout(resolve,250));
          await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
          await new Promise(resolve => setTimeout(resolve,100));
          fs.writeFileSync(${JSON.stringify(join(root, 'out/macro-'))} + name + '.png', (await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
          const layout = await window.webContents.executeJavaScript('try { window.verifyLayout(' + fit + '); "PASS" } catch(e) { e.message }');
          if (layout !== 'PASS') throw Error(name + ': ' + layout);
        }
        console.log('PASS: normal, compact and narrow layouts'); app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: scratch, LOCALAPPDATA: scratch }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(scratch, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('Macro UI probe timed out')) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  assert(relative(tmpdir(), scratch) && !relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
