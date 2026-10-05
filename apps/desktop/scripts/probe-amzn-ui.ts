import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-amzn-ui-'))
const screenshot = join(root, 'out/amzn-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build before this probe')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { AmznPage } from './src/pages/AmznPage'
      import { amznFixture } from './scripts/fixtures/amzn'
      import { emptyAmznPayload } from './electron/shared/amzn'
      import { buildTasks } from './src/api/prefetch'
      import { useReloadAll } from './src/api/queries'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 200))
      const text = () => document.body.innerText
      const button = label => [...document.querySelectorAll('button')].find(button => button.textContent.toLowerCase() === label.toLowerCase())
      let calls = 0, mode = 'success', lastRequest, opened = '', navigation, releaseLoading
      window.api.amzn = async request => {
        calls++; lastRequest = request;
        if (mode === 'waiting') await new Promise(resolve => { releaseLoading = resolve })
        const data = mode === 'failed' ? emptyAmznPayload() : amznFixture()
        if (mode === 'partial') { data.earnings = null; data.progress.earnings = 'unavailable' }
        const errors = mode === 'success' || mode === 'waiting' ? [] : [{ symbol: 'earnings', source: 'fixture', operation: 'amzn-earnings', reason: 'HTTP 503' }]
        return { data, errors, meta: { source: 'AMZN UI fixture', fetchedAt: Date.now(), freshness: mode === 'waiting' || mode === 'success' ? 'fresh' : mode === 'partial' ? 'partial' : mode === 'stale' ? 'stale' : 'failed', failureReason: errors.length ? 'earnings: HTTP 503' : undefined } }
      }
      window.api.openExternal = async url => { opened = url }
      function Page() {
        const reload = useReloadAll()
        window.reloadAmzn = reload
        return <AmznPage onStatusChange={() => {}} onNavigate={(tab, symbol) => { navigation = [tab, symbol] }} />
      }
      const host = createRoot(document.getElementById('root'))
      const render = () => host.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
      window.runProbe = async () => {
        const task = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'amzn')
        await task.run(client, 9)
        check(lastRequest.background && lastRequest.backgroundOrder === 9, 'AMZN did not use startup background priority')
        render(); await settle()
        check(calls === 1, 'First visit re-fetched warmed AMZN content')
        check(text().includes('AMZN · Amazon.com') && text().includes('AWS') && text().includes('Online stores'), 'AMZN headline or segment/category metrics missing')
        check(text().toLowerCase().includes('third quarter 2026') && text().includes('Trailing twelve months'), 'Guidance or cash-flow period missing')
        check(document.querySelectorAll('canvas').length > 0, 'Stock chart did not render')
        for (const chart of document.querySelectorAll('[data-amzn-chart]')) {
          const frame = chart.getBoundingClientRect(), svg = chart.querySelector('svg').getBoundingClientRect()
          check(svg.bottom <= frame.bottom && svg.right <= frame.right, 'Financial chart is clipped by its panel')
        }
        const range = button('3M'); range.click(); await settle()
        check(calls === 1 && document.querySelector('[data-amzn-price-range]').dataset.amznPriceRange === '3M', 'Chart range did not change locally')
        button('Charts').click(); check(navigation.join(':') === 'charts:AMZN', 'Charts navigation lost ticker')
        button('Fundamentals').click(); check(navigation.join(':') === 'fundamentals:AMZN', 'Fundamentals navigation lost ticker')
        button('Investor relations').click(); check(opened.includes('ir.aboutamazon.com'), 'IR link failed')
        button('Earnings release ↗').click(); check(opened.includes('sec.gov/Archives/edgar/data/1018724/'), 'SEC source link failed')
        for (const tab of ['options', 'valuation']) { button(tab).click(); check(navigation.join(':') === tab + ':AMZN', 'Navigation lost AMZN ticker') }
        button('Refresh').click(); await settle(); check(lastRequest.force, 'Refresh did not force service request')
        mode = 'partial'; button('Refresh').click(); await settle()
        check(text().includes('HTTP 503') && text().includes('Amazon announces second-quarter results'), 'Partial failure hid healthy panels')
        mode = 'stale'; button('Refresh').click(); await settle()
        check(text().includes('stale') && text().includes('Online stores'), 'Stale results disappeared')
        mode = 'failed'; button('Refresh').click(); await settle()
        check(text().includes('failed') && !text().includes('Online stores'), 'Total failure was treated as ready')
        mode = 'waiting'; button('Refresh').click(); await settle()
        check(text().includes('Loading AMZN') && button('Refreshing...').disabled, 'Loading state missing')
        mode = 'success'; releaseLoading(); await settle()
        check(!document.querySelector('[role=alert]'), 'Successful refresh did not recover')
        await window.reloadAmzn(); await settle(); check(lastRequest.force, 'Global F5 refresh did not force AMZN')
        host.render(null); await settle(); const before = calls; render(); await settle()
        check(calls === before, 'Returning to AMZN triggered initial loading again')
        check(client.getQueryData(['amzn']).meta.freshness === 'fresh' && text().includes('Amazon announces second-quarter results') && !document.querySelector('[role=alert]'), 'Final populated AMZN state did not settle')
        return 'PASS: startup warming, first visit, chart ranges, SEC/IR links, ticker navigation, forced refresh/F5, loading, partial/total outages, recovery and revisit'
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
      const window = new BrowserWindow({ show: false, width: 1500, height: 1050, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        await new Promise(resolve => setTimeout(resolve, 300));
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        await new Promise(resolve => setTimeout(resolve, 100));
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await window.webContents.executeJavaScript('document.querySelector("[data-amzn-page]").scrollTop = 1000');
        await new Promise(resolve => setTimeout(resolve, 300));
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        await new Promise(resolve => setTimeout(resolve, 100));
        fs.writeFileSync(${JSON.stringify(join(root, 'out/amzn-smoke-details.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await window.webContents.executeJavaScript('document.querySelector("[data-amzn-page]").scrollTop = 0');
        window.setSize(720, 850); await new Promise(resolve => setTimeout(resolve, 300));
        if (await window.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth')) throw Error('AMZN layout overflows at narrow width');
        fs.writeFileSync(${JSON.stringify(join(root, 'out/amzn-smoke-narrow.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
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
    const timeout = setTimeout(() => { child.kill(); reject(new Error('AMZN UI probe timed out')) }, 45_000)
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
