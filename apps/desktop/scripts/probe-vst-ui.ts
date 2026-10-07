import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-vst-ui-'))
const screenshot = join(root, 'out/vst-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build before this probe')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { VstPage } from './src/pages/VstPage'
      import { vstFixture } from './scripts/fixtures/vst'
      import { emptyVstPayload } from './electron/shared/vst'
      import { buildTasks } from './src/api/prefetch'
      import { useReloadAll } from './src/api/queries'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 200))
      const text = () => document.body.innerText
      const button = label => [...document.querySelectorAll('button')].find(button => button.textContent === label)
      window.checkVstLayout = () => {
        const chart = document.querySelector('[data-vst-financial-chart]')
        const svg = chart.querySelector('svg')
        const bounds = chart.getBoundingClientRect()
        const drawn = svg.getBoundingClientRect()
        check(drawn.top >= bounds.top && drawn.bottom <= bounds.bottom + 1, 'Financial chart escaped its allocated height')
        check(drawn.bottom <= chart.nextElementSibling.getBoundingClientRect().top + 1, 'Financial chart overlaps its footer')
        const dates = [...svg.querySelectorAll('text')].filter(label => /^[0-9]{4}-Q[1-4]$/.test(label.textContent))
        check(dates.length >= 2, 'Financial chart date axis missing')
        for (const label of dates) check(label.getBoundingClientRect().bottom <= bounds.bottom + 1, 'Financial chart date labels clipped')
        const bars = [...svg.querySelectorAll('rect')]
        check(bars.length === 16 && svg.getAttribute('aria-label').includes('grouped bar chart'), 'Quarterly financial grouped bars missing')
        const baseline = [...svg.querySelectorAll('line')].find(line => line.getAttribute('stroke-width') === '1.4')
        const zero = Number(baseline.getAttribute('y1'))
        let negativeBars = 0
        for (const bar of bars) {
          const box = bar.getBBox()
          check(box.y >= 0 && box.y + box.height <= drawn.height, 'Negative financial values plotted outside the chart')
          if (Math.abs(box.y - zero) < 0.01 && box.height > 1) negativeBars++
        }
        check(negativeBars === 2, 'Financial losses were not shown below zero')
        const legend = document.querySelector('[data-vst-financial-legend]').textContent
        for (const label of ['Revenue', 'Net income', 'Operating cash flow', 'Free cash flow']) check(legend.includes(label), 'Financial chart legend missing ' + label)
        const mix = document.querySelector('[data-vst-generation-chart]')
        check(mix.querySelector('svg').getBoundingClientRect().bottom <= mix.nextElementSibling.getBoundingClientRect().top + 1, 'Generation donut overlaps fuel table')
      }
      let calls = 0, mode = 'success', lastRequest, opened = '', copied = '', navigation, releaseLoading
      window.api.vst = async request => {
        calls++; lastRequest = request;
        if (mode === 'waiting') await new Promise(resolve => { releaseLoading = resolve })
        const data = mode === 'failed' ? emptyVstPayload() : vstFixture()
        if (mode === 'partial') { data.earnings = null; data.progress.earnings = 'unavailable' }
        if (mode === 'operations-failed') { data.operations = null; data.progress.operations = 'unavailable' }
        const block = mode === 'operations-failed' ? 'operations' : 'earnings'
        const errors = mode === 'success' || mode === 'waiting' ? [] : [{ symbol: block, source: 'fixture', operation: 'vst-' + block, reason: 'HTTP 503' }]
        return { data, errors, meta: { source: 'VST UI fixture', fetchedAt: Date.now(), freshness: mode === 'waiting' || mode === 'success' ? 'fresh' : mode === 'partial' || mode === 'operations-failed' ? 'partial' : 'failed', failureReason: errors.length ? block + ': HTTP 503' : undefined } }
      }
      window.api.openExternal = async url => { opened = url }
      window.api.writeClipboard = async contents => { copied = contents }
      function Page() {
        const reload = useReloadAll()
        window.reloadVst = reload
        return <VstPage onStatusChange={() => {}} onNavigate={(tab, symbol) => { navigation = [tab, symbol] }} />
      }
      const host = createRoot(document.getElementById('root'))
      const render = () => host.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
      window.runProbe = async () => {
        const task = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'vst')
        await task.run(client, 9)
        check(lastRequest.background && lastRequest.backgroundOrder === 9, 'VST did not use startup background priority')
        render(); await settle()
        check(calls === 1, 'First visit re-fetched warmed VST content')
        check(text().includes('VST — Vistra Energy') && text().includes('Ongoing ops. adjusted EBITDA'), 'VST headline or EBITDA metrics missing')
        check(text().includes('Retail') && text().includes('2026 Q2') && text().includes('Approximately 94%'), 'Segment or guidance period missing')
        check(document.querySelectorAll('canvas').length > 0, 'Stock chart did not render')
        check(text().toLowerCase().includes('annual management guidance') && text().includes('$6,800') && text().includes('$3,925'), 'Annual guidance missing')
        check(text().includes('Retail electricity · ERCOT') && text().includes('$2,253') && text().includes('$4,017'), 'Consolidated revenue breakdown missing')
        check(text().includes('Natural gas') && text().includes('27,988') && text().includes('Nuclear') && text().includes('12,410') && text().includes('Coal & lignite') && text().includes('Solar'), 'Fuel generation breakdown missing')
        check(text().includes('Not disclosed') && text().includes('Vistra does not disclose revenue by fuel type.'), 'Undisclosed fuel revenue was presented as reported')
        window.checkVstLayout()
        const range = button('3M'); range.click(); await settle()
        check(calls === 1, 'Chart range triggered a provider fetch')
        button('Charts').click(); check(navigation.join(':') === 'charts:VST', 'Charts navigation lost ticker')
        button('Fundamentals').click(); check(navigation.join(':') === 'fundamentals:VST', 'Fundamentals navigation lost ticker')
        button('Investor relations').click(); check(opened.includes('investor.vistracorp.com'), 'IR link failed')
        button('Earnings release').click(); check(opened.includes('Vistra-Reports'), 'Disclosure source link failed')
        button('Quarterly filing').click(); check(opened.includes('vistra-20260630.htm'), 'Revenue/generation source link failed')
        button('Export snapshot').click(); await settle(); check(JSON.parse(copied).symbol === 'VST', 'Snapshot export failed')
        button('Refresh').click(); await settle(); check(lastRequest.force, 'Refresh did not force service request')
        mode = 'partial'; await client.invalidateQueries({ queryKey: ['vst', 2], refetchType: 'none' }); let startupError = ''; try { await task.run(client, 10) } catch (error) { startupError = String(error) }; check(startupError.includes('HTTP 503') && client.getQueryData(['vst', 2]).data.market, 'Partial startup was treated as ready or discarded useful content'); button('Refresh').click(); await settle()
        check(text().includes('HTTP 503') && text().includes('Vistra announces generation update'), 'Partial failure hid healthy panels')
        mode = 'operations-failed'; button('Refresh').click(); await settle()
        check(text().includes('operations: HTTP 503') && text().includes('Approximately 94%') && text().includes('Vistra announces generation update'), 'Operations outage hid earnings or market panels')
        mode = 'failed'; button('Refresh').click(); await settle()
        check(text().includes('failed') && button('Export snapshot').disabled, 'Total failure was treated as ready')
        mode = 'waiting'; button('Refresh').click(); await settle()
        check(text().includes('Loading VST') && button('Refreshing...').disabled, 'Loading state missing')
        mode = 'success'; releaseLoading(); await settle()
        check(!document.querySelector('[role=alert]'), 'Successful refresh did not recover')
        await window.reloadVst(); await settle(); check(lastRequest.force, 'Global F5 refresh did not force VST')
        host.render(null); await settle(); const before = calls; render(); await settle()
        check(calls === before, 'Returning to VST triggered initial loading again')
        check(client.getQueryData(['vst', 2]).meta.freshness === 'fresh' && text().includes('Vistra announces generation update') && !document.querySelector('[role=alert]'), 'Final populated VST state did not settle')
        return 'PASS: startup warming, chart bounds/dates/negative values/legend, revenue/fuel disclosure, sources, navigation, export, refresh/F5, source outages, recovery and revisit'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><meta charset="UTF-8"><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = { platform: "win32" };</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1500, height: 1050, webPreferences: { backgroundThrottling: false, offscreen: true } });
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        await new Promise(resolve => setTimeout(resolve, 300));
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript("document.querySelector('[data-vst-generation-chart]').scrollIntoView({ block: 'center' })");
        await new Promise(resolve => setTimeout(resolve, 100));
        fs.writeFileSync(${JSON.stringify(join(root, 'out/vst-energy-smoke.png'))}, (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript("document.querySelector('[data-vst-financial-chart]').scrollIntoView({ block: 'center' })");
        await new Promise(resolve => setTimeout(resolve, 100));
        fs.writeFileSync(${JSON.stringify(join(root, 'out/vst-financial-smoke.png'))}, (await window.webContents.capturePage()).toPNG());
        window.setSize(720, 850); await new Promise(resolve => setTimeout(resolve, 300));
        if (await window.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth')) throw Error('VST layout overflows at narrow width');
        await window.webContents.executeJavaScript('window.checkVstLayout()');
        await window.webContents.executeJavaScript("document.querySelector('[data-vst-financial-chart]').scrollIntoView({ block: 'center' })");
        await new Promise(resolve => setTimeout(resolve, 100));
        fs.writeFileSync(${JSON.stringify(join(root, 'out/vst-smoke-narrow.png'))}, (await window.webContents.capturePage()).toPNG());
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
    const timeout = setTimeout(() => { child.kill(); reject(new Error('VST UI probe timed out')) }, 45_000)
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
