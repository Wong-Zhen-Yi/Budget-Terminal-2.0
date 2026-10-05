import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-mu-ui-'))
const screenshot = join(root, 'out/mu-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build before this probe')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { MuPage } from './src/pages/MuPage'
      import { muFixture } from './scripts/fixtures/mu'
      import { emptyMuPayload } from './electron/shared/mu'
      import { buildTasks } from './src/api/prefetch'
      import { useReloadAll } from './src/api/queries'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 200))
      const text = () => document.body.innerText
      const button = label => [...document.querySelectorAll('button')].find(button => button.textContent === label)
      let calls = 0, mode = 'success', lastRequest, opened = '', copied = '', navigation, releaseLoading
      window.api.mu = async request => {
        calls++; lastRequest = request;
        if (mode === 'waiting') await new Promise(resolve => { releaseLoading = resolve })
        const data = mode === 'failed' ? emptyMuPayload() : muFixture()
        if (mode === 'partial') { data.memory = null; data.progress.memory = 'unavailable' }
        const errors = mode === 'success' || mode === 'waiting' ? [] : [{ symbol: 'memory', source: 'fixture', operation: 'mu-memory', reason: 'HTTP 503' }]
        return { data, errors, meta: { source: 'MU UI fixture', fetchedAt: Date.now(), freshness: mode === 'waiting' || mode === 'success' ? 'fresh' : mode === 'partial' ? 'partial' : 'failed', failureReason: errors.length ? 'memory: HTTP 503' : undefined } }
      }
      window.api.openExternal = async url => { opened = url }
      window.api.writeClipboard = async contents => { copied = contents }
      function Page() {
        const reload = useReloadAll()
        window.reloadMu = reload
        return <MuPage onStatusChange={() => {}} onNavigate={(tab, symbol) => { navigation = [tab, symbol] }} />
      }
      const host = createRoot(document.getElementById('root'))
      const render = () => host.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
      window.checkFinancialChart = async () => {
        const panel = [...document.querySelectorAll('section')].find(section => section.querySelector('h2')?.textContent === 'Quarterly financial trends · USD')
        check(panel, 'Financial trends panel missing')
        panel.scrollIntoView({ block: 'start' })
        await settle()
        const svg = panel.querySelector('svg')
        check(svg && svg.querySelectorAll('path').length === 4, 'Financial series missing')
        const frame = svg.parentElement.parentElement.getBoundingClientRect()
        const chart = svg.getBoundingClientRect()
        check(chart.height > 100 && chart.top >= frame.top && chart.bottom <= frame.bottom + 1, 'Financial chart exceeds its allocated height: ' + JSON.stringify({ chart: chart.toJSON(), frame: frame.toJSON() }))
        check(chart.left >= frame.left && chart.right <= frame.right + 1, 'Financial chart exceeds its allocated width')
        const footer = panel.querySelector('section > div').lastElementChild.getBoundingClientRect()
        check(chart.bottom <= footer.top + 1, 'Financial chart overlaps the source footer')
        const ticks = [...svg.querySelectorAll('[data-axis=x]')]
        check(ticks.length > 1, 'Fiscal date labels missing')
        check(ticks.every(tick => tick.getBoundingClientRect().bottom <= frame.bottom + 1), 'Fiscal date labels are clipped')
      }
      window.runProbe = async () => {
        const task = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'mu')
        await task.run(client, 9)
        check(lastRequest.background && lastRequest.backgroundOrder === 9, 'MU did not use startup background priority')
        render(); await settle()
        check(calls === 1, 'First visit re-fetched warmed MU content')
        check(text().includes('MU — Micron Technology') && text().includes('mid-single-digit'), 'MU headline or memory metrics missing')
        check(text().includes('Not disclosed') && text().includes('FY2027 Q1'), 'HBM or guidance period missing')
        check(document.querySelectorAll('canvas').length > 0, 'Stock chart did not render')
        await window.checkFinancialChart()
        const range = button('3M'); range.click(); await settle()
        check(calls === 1, 'Chart range triggered a provider fetch')
        button('Charts').click(); check(navigation.join(':') === 'charts:MU', 'Charts navigation lost ticker')
        button('Fundamentals').click(); check(navigation.join(':') === 'fundamentals:MU', 'Fundamentals navigation lost ticker')
        button('Investor relations').click(); check(opened.includes('investors.micron.com'), 'IR link failed')
        button('p.3').click(); check(opened.endsWith('#page=3'), 'PDF page source link failed')
        button('Export snapshot').click(); await settle(); check(JSON.parse(copied).symbol === 'MU', 'Snapshot export failed')
        button('Refresh').click(); await settle(); check(lastRequest.force, 'Refresh did not force service request')
        mode = 'partial'; button('Refresh').click(); await settle()
        check(text().includes('HTTP 503') && text().includes('Cloud Memory Business Unit'), 'Partial failure hid healthy panels')
        mode = 'failed'; button('Refresh').click(); await settle()
        check(text().includes('failed') && button('Export snapshot').disabled, 'Total failure was treated as ready')
        mode = 'waiting'; button('Refresh').click(); await settle()
        check(text().includes('Loading MU') && button('Refreshing...').disabled, 'Loading state missing')
        mode = 'success'; releaseLoading(); await settle()
        check(!document.querySelector('[role=alert]'), 'Successful refresh did not recover')
        await window.reloadMu(); await settle(); check(lastRequest.force, 'Global F5 refresh did not force MU')
        host.render(null); await settle(); const before = calls; render(); await settle()
        check(calls === before, 'Returning to MU triggered initial loading again')
        check(client.getQueryData(['mu']).meta.freshness === 'fresh' && text().includes('Cloud Memory Business Unit') && !document.querySelector('[role=alert]'), 'Final populated MU state did not settle')
        return 'PASS: startup warming, first visit, chart ranges, PDF/IR links, ticker navigation, export, forced refresh/F5, loading, partial/total outages, recovery and revisit'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = { platform: "win32" };</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1500, height: 1050, webPreferences: { backgroundThrottling: false, offscreen: true } });
      const checkFinancialChart = async () => {
        const error = await window.webContents.executeJavaScript('(async () => { try { await window.checkFinancialChart(); return null } catch (error) { return error.message } })()');
        if (error) throw Error(error);
      };
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        await new Promise(resolve => setTimeout(resolve, 300));
        await checkFinancialChart();
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        window.setSize(720, 850); await new Promise(resolve => setTimeout(resolve, 300));
        if (await window.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth')) throw Error('MU layout overflows at narrow width');
        await checkFinancialChart();
        fs.writeFileSync(${JSON.stringify(join(root, 'out/mu-smoke-narrow.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        console.log('PASS: normal and narrow viewport smoke tests'); app.exit(0);
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
    const timeout = setTimeout(() => { child.kill(); reject(new Error('MU UI probe timed out')) }, 45_000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => { clearTimeout(timeout); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${screenshot}`)
} finally {
  assert(!relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
