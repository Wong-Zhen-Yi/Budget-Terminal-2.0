import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-ipo-ui-'))
const screenshot = join(root, 'out', 'ipo-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: 'tsx', contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { IpoPage } from './src/pages/IpoPage'
        import { api, queryKeys } from './src/api/client'
        import { queryFreshness } from './src/api/queryPersistence'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 250))
        const text = () => document.body.innerText
        const refresh = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Refresh')
        window.runProbe = async () => {
          // Simulate startup prefetch before the user ever opens this page.
          await Promise.all([
            client.prefetchQuery({ queryKey: queryKeys.ipoUpcoming, queryFn: () => api.ipoUpcoming({}), staleTime: queryFreshness(queryKeys.ipoUpcoming) }),
            client.prefetchQuery({ queryKey: queryKeys.ipoCompleted(new Date().getFullYear()), queryFn: () => api.ipoCompleted({}), staleTime: queryFreshness(queryKeys.ipoCompleted(new Date().getFullYear())) })
          ])
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><IpoPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle()
          check(window.upcomingCalls === 1 && window.completedCalls === 1, 'Opening a startup-loaded page must not fetch again')
          check(text().includes('Waiting Company') && text().includes('Scheduled Company'), 'Scheduled or pending IPO missing')
          check(text().includes('TBD') && text().includes('not scheduled'), 'Undated filings must be distinguished from scheduled IPOs')
          check(text().includes('1 scheduled IPO(s)') && text().includes('1 pending filing(s)'), 'Status counts filings as scheduled listings')
          const tables = [...document.querySelectorAll('table')]
          check(tables.length === 2, 'Independent completed/upcoming tables missing')
          check(tables[1].querySelector('tbody tr').innerText.includes('Scheduled Company'), 'Scheduled dates should sort above TBD')
          check(tables[1].innerText.includes('Filed'), 'Filing date column missing')
          check(tables[1].querySelector('th:nth-child(4)').getBoundingClientRect().width >= 230, 'Company column collapsed')
          check(refresh().getBoundingClientRect().right <= innerWidth, 'Refresh button outside viewport')
          check(tables[1].closest('section').getBoundingClientRect().right <= innerWidth, 'Upcoming pane outside viewport')
          const copies = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Copy')
          copies[1].click()
          await settle()
          check(window.copied.includes('TBD\\t') && window.copied.includes('Filed'), 'Copy loses pending filing information')
          const sources = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Source')
          sources[1].click()
          check(window.opened === 'https://stockanalysis.com/ipos/filings/', 'Wrong source link')
          refresh().click()
          await settle()
          check(window.forcedUpcoming && window.forcedCompleted, 'Refresh must force both independent feeds')
          window.fail = true
          refresh().click()
          await settle()
          check(text().includes('Refresh failed; showing stale cache'), 'Refresh failure must remain visible')
          check(text().includes('Waiting Company') && text().includes('Completed Company'), 'Failure erased available rows')
          check(document.documentElement.scrollWidth <= innerWidth, 'Page overflows instead of scrolling table locally')
          return 'PASS: startup-prefetched page, scheduled and TBD filings, counts, date sorting, readable company column, copy, source, forced refresh and stale failure'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', outfile: join(directory, 'renderer.js'),
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  for (const file of bundle.outputFiles) await writeFile(file.path, file.contents)
  await writeFile(join(directory, 'index.html'), `
    <html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex;min-width:0"></div>
    <script>
      window.upcomingCalls = 0; window.completedCalls = 0;
      const year = new Date().getFullYear();
      const base = { source: 'StockAnalysis Pending IPO Filings', sourceUrl: 'https://stockanalysis.com/ipos/filings/', fetchedAt: Date.now(), fromCache: false, cacheAgeSeconds: 0, stale: false, warning: '' };
      const common = { exchange: '--', priceRange: '$10.00', sharesOffered: '2,000,000', dealSize: '--', marketCap: '--', revenue: '--' };
      const rows = [
        { ...common, date: '', dateDisplay: 'TBD', filingDate: year + '-01-01', symbol: 'WAIT', company: 'Waiting Company' },
        { ...common, date: year + '-12-31', dateDisplay: 'Dec 31, ' + year, symbol: 'NEXT', company: 'Scheduled Company' }
      ];
      const envelope = data => ({ data, meta: { source: data.source, fetchedAt: Date.now(), freshness: 'fresh' }, errors: [] });
      window.api = {
        ipoUpcoming: async request => {
          window.upcomingCalls++; window.forcedUpcoming = request.force;
          const result = envelope({ ...base, rows, endDate: year + '-12-31', estimatedDates: true });
          if (window.fail) {
            result.data.stale = true; result.data.warning = 'All upstream calendars unavailable';
            result.meta.freshness = 'stale'; result.errors = [{ source: 'ipo', reason: result.data.warning }];
          }
          return result;
        },
        ipoCompleted: async request => {
          window.completedCalls++; window.forcedCompleted = request.force;
          return envelope({ ...base, year, rows: [{ date: year + '-01-01', dateDisplay: 'Jan 01, ' + year, symbol: 'DONE', company: 'Completed Company', ipoPrice: '$10.00', currentPrice: '$11.00', returnPct: '10%' }] });
        },
        writeClipboard: async content => { window.copied = content },
        openExternal: async url => { window.opened = url }
      };
    </script><script src="renderer.js"></script></body></html>
  `)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe().catch(error => { throw Error(error.stack) })'));
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG());
        app.exit(0);
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('IPO UI probe timed out')) }, 40_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${screenshot}`)
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
