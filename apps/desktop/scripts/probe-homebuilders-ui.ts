import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-homebuilders-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build before this probe')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `

      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { HomebuildersPage } from './src/pages/HomebuildersPage'
      import { homebuilderFixture } from './scripts/fixtures/homebuilders'
      import { buildTasks } from './src/api/prefetch'
      import { useRefreshHomebuilders } from './src/api/homebuildersQueries'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } } })
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 180))
      const text = () => document.body.innerText
      const button = label => [...document.querySelectorAll('button')].find(button => button.textContent === label && button.getClientRects().length)
      const table = () => document.querySelector('.homebuilders-universe')
      let calls = 0, mode = 'success', request, opened, navigation
      window.api.homebuilders = async input => {
        calls++; request = input
        const data = homebuilderFixture()
        const failed = mode === 'failed', partial = mode === 'partial'
        if (failed || partial) data.rows.forEach(row => {
          row.profile = null; row.progress.profile = 'unavailable'
          if (failed) { row.market = null; row.news = []; row.progress.market = 'unavailable'; row.progress.news = 'unavailable' }
        })
        return { data, errors: failed || partial ? [{ symbol: 'DHI', source: 'fixture', operation: 'homebuilders-profile', reason: 'HTTP 503' }] : [],
          meta: { source: 'Homebuilder UI fixture', fetchedAt: Date.now(), freshness: failed ? 'failed' : partial ? 'partial' : 'fresh', failureReason: failed || partial ? 'HTTP 503' : undefined } }
      }
      window.api.openExternal = async url => { opened = url }
      function Page() {
        window.reloadHomebuilders = useRefreshHomebuilders()
        return <HomebuildersPage onStatusChange={() => {}} onNavigate={(tab, symbol) => { navigation = [tab, symbol] }} />
      }
      const host = createRoot(document.getElementById('root'))
      const render = () => host.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
      const input = value => {
        const element = document.querySelector('[aria-label="Search homebuilding companies"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const selectCompany = async symbol => {
        const row = [...table().querySelectorAll('tbody tr')].find(row => row.children[0].textContent === symbol)
        check(row, 'Company row missing: ' + symbol); row.click(); await settle()
      }
      const scenarioInput = (label, value) => {
        const element = document.querySelector('[aria-label="' + label + '"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const payment = () => document.querySelector('[aria-label="Monthly principal and interest"]').textContent
      window.checkLayout = () => {
        check(document.documentElement.scrollWidth <= window.innerWidth, 'Document overflows horizontally')
        if (window.innerWidth > 760) {
          const page = document.querySelector('[data-homebuilders-page]')
          check(page.scrollHeight <= page.clientHeight + 1, 'Page scrolls at desktop viewport')
          for (const panel of document.querySelectorAll('.hb-economics:not([hidden]) > *, .hb-stocks-layout > *, .hb-reports-layout > *')) check(panel.getBoundingClientRect().bottom <= window.innerHeight, 'Panel below viewport')
          if (window.innerWidth >= 1000) for (const panel of document.querySelectorAll('.hb-economics:not([hidden]) > *')) check(panel.scrollHeight <= panel.clientHeight + 1, 'Housing economics section requires scrolling')
        }
        for (const selector of ['[data-homebuilder-price-chart]', '[data-homebuilder-comparison-chart]']) {
          const chart = document.querySelector(selector)
          if (!chart) continue
          check(chart.querySelector('svg'), 'Missing chart')
          check(chart.querySelector('svg').getBoundingClientRect().bottom <= chart.nextElementSibling.getBoundingClientRect().top + 1, 'Chart overlaps footnote')
        }
      }
      window.runProbe = async () => {
        const task = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'homebuilders')
        check(task, 'Homebuilder startup task missing')
        await task.run(client, 9)
        check(request.background && request.backgroundOrder === 9, 'Startup priority missing')
        render(); await settle()
        check(calls === 1, 'First visit refetched warmed data')
        check(text().includes('Homebuilders') && text().includes('D.R. Horton'), 'Page or selected company missing')
        check(document.querySelectorAll('.hb-builder-tickers button').length === 10, 'Incomplete builder street')
        check(document.querySelectorAll('.hb-map-point').length === 10, 'Builder capital map missing data')
        check(document.querySelector('.hb-map-point').getAttribute('role') === 'button', 'Capital map is not keyboard accessible')
        check(payment().includes('2,128.97'), 'Initial mortgage payment incorrect')
        scenarioInput('Scenario mortgage rate', '8'); await settle()
        check(payment().includes('2,348.05'), 'Rate scenario did not update payment')
        check(document.querySelector('.hb-buying-power small').innerText.includes('-'), 'Buying power impact missing')
        scenarioInput('Scenario down payment', '100'); await settle()
        check(payment() === '--' && !text().includes('NaN'), 'Invalid scenario produced a misleading payment')
        scenarioInput('Scenario down payment', '20'); scenarioInput('Scenario mortgage rate', '0'); await settle()
        check(payment().includes('888.89'), 'Zero-interest amortization failed')
        scenarioInput('Scenario mortgage rate', '7'); await settle()
        button('15 years').click(); await settle()
        check(payment().includes('2,876.25'), 'Loan term change failed')
        button('30 years').click(); await settle()
        document.querySelector('[aria-label^="Select MHO:"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle()
        check(document.querySelector('.hb-company-name strong').textContent === 'MHO', 'Keyboard map selection failed')
        window.checkLayout()
        button('Stocks & returns').click(); await settle()
        check(table().querySelectorAll('tbody tr').length === 12, 'Incomplete universe')
        check(table().innerText.includes('P/B'), 'Company valuation missing')
        check(text().includes('Stocks & returns'), 'Stock research view missing')
        input('meritage'); await settle()
        check(table().querySelectorAll('tbody tr').length === 1, 'Search failed')
        await selectCompany('MTH')
        button('Housing economics').click(); await settle()
        button('Charts').click(); check(navigation.join(':') === 'charts:MTH', 'Chart navigation lost ticker')
        button('Stocks').click(); check(navigation.join(':') === 'stocks:MTH', 'Stocks navigation lost ticker')
        button('Fundamentals').click(); check(navigation.join(':') === 'fundamentals:MTH', 'Fundamentals navigation lost ticker')
        button('Options').click(); check(navigation.join(':') === 'options:MTH', 'Options navigation lost ticker')
        button('Company investor relations \u2197').click(); check(opened.includes('meritagehomes.com'), 'Issuer source link failed')
        button('Stocks & returns').click(); await settle()
        input(''); button('ETFs').click(); await settle()
        check(table().querySelectorAll('tbody tr').length === 2, 'ETF filter failed')
        await selectCompany('ITB')
        button('Housing economics').click(); await settle()
        check(text().includes('Corporate valuation and margin metrics are omitted'), 'ETF shown with corporate metrics')
        button('Stocks & returns').click(); await settle()
        button('Builders').click(); await settle()
        check(table().querySelectorAll('tbody tr').length === 10, 'Builder filter failed')
        button('All').click(); await settle()
        document.querySelector('[aria-label="Remove LEN from comparison"]').click(); await settle()
        const select = document.querySelector('[aria-label="Add comparison company"]')
        select.value = 'XHB'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        check(select.disabled && document.querySelector('[aria-label="Remove XHB from comparison"]'), 'Comparison selection or limit failed')
        button('3M').click(); await settle()
        button('Reports & news').click(); await settle()
        check(text().includes('Company news fixture'), 'News missing')
        button('Earnings').click(); await settle()
        check(text().includes('New York time') && text().includes('can change'), 'Earnings date caveat missing')
        button('News').click(); await settle()
        check(calls === 1, 'Interactions made provider requests')
        window.checkLayout()
        mode = 'partial'
        let failure; try { await window.reloadHomebuilders() } catch (error) { failure = error }
        check(failure?.state === 'degraded' && client.getQueryData(['homebuilders', 1]).data.rows[0].profile, 'Partial refresh discarded complete snapshot')
        mode = 'failed'
        try { await window.reloadHomebuilders() } catch (error) { failure = error }
        check(request.force && failure?.state === 'failed', 'Forced refresh failure not reported')
        check(client.getQueryData(['homebuilders', 1]).data.rows[0].market, 'Failed refresh lost saved data')
        mode = 'success'; await window.reloadHomebuilders(); await settle()
        check(!document.body.innerText.includes('Page needs attention'), 'Global diagnostics banner restored')
        button('Housing economics').click(); await settle()
        document.querySelector('[aria-label="Select DHI"]').click(); await settle()
        check(payment().includes('2,128.97'), 'View switching reset mortgage scenario')
        const before = calls
        host.render(<QueryClientProvider client={client}><div>Other page</div></QueryClientProvider>); await settle()
        render(); await settle()
        check(calls === before, 'Revisit refetched warm content')
        return 'PASS: buyer scenarios, capital map, startup warming, search, filters, selection, navigation, source links, comparisons, earnings, snapshot retention, failure recovery and revisit'
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
        fs.writeFileSync(${JSON.stringify(join(root, 'out/homebuilders-smoke.png'))}, (await window.webContents.capturePage()).toPNG());
        for (const [width, height] of [[1366, 768], [1024, 768], [720, 850]]) {
          window.setSize(width, height);
          await new Promise(resolve => setTimeout(resolve, 250));
          await window.webContents.executeJavaScript('window.checkLayout()');
          fs.writeFileSync(require('path').join(${JSON.stringify(join(root, 'out'))}, 'homebuilders-' + width + '.png'), (await window.webContents.capturePage()).toPNG());
        }
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
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Homebuilder UI probe timed out')) }, 60_000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => { clearTimeout(timeout); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${join(root, 'out/homebuilders-smoke.png')}`)
} finally {
  const resolved = relative(tmpdir(), scratch)
  assert(resolved && !resolved.startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
