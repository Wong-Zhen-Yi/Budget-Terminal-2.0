import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-semiconductors-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build before this probe')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { SemiconductorsPage } from './src/pages/SemiconductorsPage'
      import { semiconductorFixture } from './scripts/fixtures/semiconductors'
      import { SEMICONDUCTOR_CATALOG } from './electron/shared/semiconductorCatalog'
      import { buildTasks } from './src/api/prefetch'
      import { useReloadAll } from './src/api/queries'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 250))
      const text = () => document.body.innerText
      const button = label => [...document.querySelectorAll('button')].find(button => button.textContent === label)
      let calls = 0, mode = 'success', request, opened, navigation, releaseLoading
      window.api.semiconductors = async input => {
        calls++; request = input
        if (mode === 'waiting') await new Promise(resolve => { releaseLoading = resolve })
        const data = semiconductorFixture()
        if (mode === 'partial' || mode === 'failed') data.rows.forEach(row => {
          row.profile = null; row.progress.profile = 'unavailable'
          if (mode === 'failed') { row.market = null; row.news = []; row.progress.market = 'unavailable'; row.progress.news = 'unavailable' }
        })
        const errors = mode === 'partial' || mode === 'failed' ? [{ symbol: 'NVDA', source: 'fixture', operation: 'semiconductors-profile', reason: 'HTTP 503' }] : []
        return { data, errors, meta: { source: 'Semiconductor UI fixture', fetchedAt: Date.now(), freshness: mode === 'failed' ? 'failed' : mode === 'partial' ? 'partial' : 'fresh', failureReason: errors.length ? 'HTTP 503' : undefined } }
      }
      window.api.openExternal = async url => { opened = url }
      function Page() {
        window.reloadSemiconductors = useReloadAll()
        return <SemiconductorsPage onStatusChange={() => {}} onNavigate={(tab, symbol) => { navigation = [tab, symbol] }} />
      }
      const host = createRoot(document.getElementById('root'))
      const render = () => host.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
      const input = (element, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const table = () => document.querySelector('[data-semiconductor-universe] section')
      const selectCompany = async symbol => {
        const row = [...table().querySelectorAll('tbody tr')].find(row => row.children[0].textContent === symbol)
        check(row, 'Company row missing: ' + symbol); row.click(); await settle()
      }
      window.runProbe = async () => {
        const task = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'semiconductors')
        check(task, 'Semiconductor startup task missing')
        await task.run(client, 9)
        check(request.background && request.backgroundOrder === 9, 'Startup priority missing')
        render(); await settle()
        check(calls === 1, 'First visit refetched warmed data')
        check(text().includes('Semiconductors') && text().includes('U.S. supply chain') && text().includes('NVIDIA · company research'), 'Headline or initial company missing')
        check(table().querySelectorAll('tbody tr').length === SEMICONDUCTOR_CATALOG.length, 'Catalog table incomplete')
        check(document.querySelectorAll('[data-subsector]').length === 8, 'Eight supply-chain stages missing')
        check(document.querySelectorAll('[data-subsector-performance] button').length === 8, 'Subsector daily performance missing')
        check([...document.querySelectorAll('[data-subsector-performance] button')].every(button => button.innerText.includes('quotes')), 'Performance coverage missing')
        check(document.querySelectorAll('svg').length >= 2, 'Price and comparison charts missing')
        for (const selector of ['[data-semiconductor-price-chart]', '[data-semiconductor-comparison-chart]']) {
          const chart = document.querySelector(selector)
          check(chart.querySelector('svg').getBoundingClientRect().bottom <= chart.nextElementSibling.getBoundingClientRect().top, 'Chart overlaps the following content')
        }
        check(text().includes('Company news fixture'), 'Industry news missing')
        button('Detailed columns').click(); await settle()
        check(table().innerText.includes('Revenue YoY') && table().innerText.includes('Gross margin'), 'Detailed fundamentals missing')
        button('Detailed columns').click(); await settle()
        const search = document.querySelector('[aria-label="Search semiconductor companies"]')
        input(search, 'micron'); await settle()
        check(table().querySelectorAll('tbody tr').length === 1, 'Search did not filter')
        await selectCompany('MU')
        button('MU Focus').click(); check(navigation[0] === 'mu', 'MU Focus link failed')
        button('Charts').click(); check(navigation.join(':') === 'charts:MU', 'Charts navigation lost ticker')
        button('Stocks').click(); check(navigation.join(':') === 'stocks:MU', 'Stocks navigation lost ticker')
        button('Fundamentals').click(); check(navigation.join(':') === 'fundamentals:MU', 'Fundamentals navigation lost ticker')
        button('Annual report').click(); check(opened.startsWith('https://www.sec.gov/Archives/edgar/'), 'Source link failed')
        input(search, ''); await settle()
        const memoryButton = document.querySelector('[data-subsector="memory"]')
        memoryButton.click(); await settle()
        check(table().querySelectorAll('tbody tr').length === SEMICONDUCTOR_CATALOG.filter(company => company.group === 'memory').length, 'Subsector filter failed')
        check(memoryButton.getAttribute('aria-pressed') === 'true', 'Selected subsector missing pressed state')
        check(table().innerText.includes('Memory · companies'), 'Filtered table title missing')
        document.querySelector('[data-subsector="equipment"]').click(); await settle()
        check(!table().innerText.includes('NVIDIA') && text().includes('Applied Materials · company research'), 'Subsector selection left unrelated company research')
        button('All subsectors').click(); await settle()
        const tickerHeader = [...table().querySelectorAll('th')].find(header => header.textContent.includes('Ticker'))
        tickerHeader.click(); await settle()
        tickerHeader.click(); await settle()
        check(table().querySelector('tbody tr').children[0].textContent === 'ACLS', 'Ticker sorting failed')
        await selectCompany('AVGO')
        button('AVGO Focus').click(); check(navigation[0] === 'avgo', 'AVGO Focus link failed')
        button('3M').click(); await settle()
        document.querySelector('[aria-label="Remove AMD from comparison"]').click(); await settle()
        const select = document.querySelector('[aria-label="Add comparison company"]')
        select.value = 'TXN'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        check(document.querySelector('[aria-label="Remove TXN from comparison"]') && select.disabled, 'Comparison selection or four-stock limit failed')
        button('Compare').click(); await settle()
        check(text().includes('Revenue YoY') && document.querySelector('[aria-label="Remove TXN from comparison"]'), 'Comparison view lost selection or financials')
        button('News & earnings').click(); await settle()
        button('Upcoming earnings').click(); await settle()
        check(text().includes('Date · New York') && text().includes('Dates can change'), 'Earnings estimates missing')
        button('Latest news').click(); await settle()
        check(text().includes('Company news fixture'), 'News view missing headlines')
        button('Companies').click(); await settle()
        check(table().querySelectorAll('tbody tr').length === SEMICONDUCTOR_CATALOG.length, 'Companies view lost catalog')
        button('Supply chain').click(); await settle()
        check(document.querySelector('[aria-label="Remove TXN from comparison"]'), 'View switching reset comparison')
        check(calls === 1, 'Company selection, filters or comparison triggered a provider fetch')
        mode = 'partial'; await client.invalidateQueries({ queryKey: ['semiconductors'], refetchType: 'none' })
        let startupError; try { await task.run(client, 10) } catch (error) { startupError = error }
        check(startupError?.state === 'degraded' && client.getQueryData(['semiconductors', 1]).data.rows[0].market, 'Partial startup treated as ready or discarded content')
        await selectCompany('NVDA')
        check(text().includes('HTTP 503') && text().includes('Company news fixture'), 'Partial outage hid warning or healthy news')
        mode = 'failed'; button('Refresh').click(); await settle()
        check(request.force && text().includes('failed') && table().querySelectorAll('tbody tr').length === SEMICONDUCTOR_CATALOG.length, 'Forced refresh or total-outage membership failed')
        check([...document.querySelectorAll('[data-subsector-performance] .num')].every(value => value.textContent === '--'), 'Outage turned missing returns into zero')
        mode = 'waiting'; button('Refresh').click(); await settle()
        check(button('Refreshing...').disabled && text().includes('Loading company quotes'), 'Loading progress missing')
        mode = 'success'; releaseLoading(); await settle()
        check(!document.querySelector('[role=alert]'), 'Recovery did not clear warning')
        await window.reloadSemiconductors(); await settle(); check(request.force, 'Global F5 did not force refresh')
        host.render(null); await settle(); const before = calls; render(); await settle()
        check(calls === before, 'Returning to page triggered an initial fetch')
        return 'PASS: startup warming, full catalog, supply-chain stages, performance coverage, linked research, view switching, detailed columns, search, sorting, ticker links, sources, comparisons, no selection fetches, forced refresh/F5, loading, partial/total outages, recovery and revisit'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><meta charset="utf-8"><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = { platform: "win32" };</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1920, height: 1200, webPreferences: { backgroundThrottling: false, offscreen: true } });
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        await window.webContents.executeJavaScript('document.querySelector("[data-subsector=design]").click()');
        await new Promise(resolve => setTimeout(resolve, 300));
        fs.writeFileSync(${JSON.stringify(join(root, 'out/semiconductors-smoke.png'))}, (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript('document.querySelector("[data-semiconductors-page]").scrollTop = 800');
        await new Promise(resolve => setTimeout(resolve, 300));
        fs.writeFileSync(${JSON.stringify(join(root, 'out/semiconductors-research-smoke.png'))}, (await window.webContents.capturePage()).toPNG());
        window.setSize(720, 850);
        await window.webContents.executeJavaScript('document.querySelector("[data-semiconductors-page]").scrollTop = 0');
        await new Promise(resolve => setTimeout(resolve, 300));
        if (await window.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth')) throw Error('Page overflows at narrow width');
        fs.writeFileSync(${JSON.stringify(join(root, 'out/semiconductors-smoke-narrow.png'))}, (await window.webContents.capturePage()).toPNG());
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
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Semiconductor UI probe timed out')) }, 60_000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => { clearTimeout(timeout); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${join(root, 'out/semiconductors-smoke.png')}`)
} finally {
  const resolved = relative(tmpdir(), scratch)
  assert(resolved && !resolved.startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
