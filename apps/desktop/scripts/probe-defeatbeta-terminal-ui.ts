import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-terminal-ui-'))
try {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { DefeatBetaPage } from './src/pages/DefeatBetaPage'
      import { buildTasks } from './src/api/prefetch'
      import { DEFEATBETA_SECTIONS } from './electron/shared/defeatbetaTerminal'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 120))
      const body = () => document.body.innerText
      const calls = []
      let failure = false, navigated = ''
      const statements = []
      for (const year of [2024, 2025]) for (const period of ['annual', 'quarterly']) for (const [item, value] of Object.entries({ total_revenue: 1000, free_cash_flow: 100, diluted_eps: 5, gross_profit: 600, operating_income: 300, ebitda: 350, net_income_common_stockholders: 200 })) {
        statements.push({ item_name: item, item_value: value * (year === 2025 ? 1.2 : 1), report_date: year + '-09-30', period_type: period, finance_type: item === 'free_cash_flow' ? 'cash_flow' : 'income_statement' })
      }
      for (const [item, value] of Object.entries({ free_cash_flow: 120, diluted_eps: 6, total_revenue: 1200 })) statements.push({ item_name: item, item_value: value, report_date: 'TTM', period_type: 'quarterly' })
      const fixture = {
        prices: Array.from({ length: 260 }, (_, i) => ({ report_date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), open: 100 + i / 10 + (i % 2 ? 0.3 : -0.3), high: 100 + i / 10 + 0.6, low: 100 + i / 10 - 0.6, close: 100 + i / 10, volume: 1000 + i })),
        profile: [{ sector: 'Technology', long_business_summary: 'Apple fixture company', web_site: 'https://apple.com' }],
        statements, officers: [{ name: 'Fixture executive', title: 'CEO' }], shares: [{ report_date: '2025-01-01', shares_outstanding: 10 }],
        news: [{ title: 'Fixture news', publisher: 'Test', link: 'https://example.com/news', report_date: '2026-10-16' }],
        transcripts: [{ fiscal_year: 2025, fiscal_quarter: 4, report_date: '2025-10-30', transcripts: [{ speaker: 'CEO', content: 'Fixture transcript paragraph' }] }],
        filings: [{ form: '10-K', filing_date: '2025-10-30', url: 'https://www.sec.gov/Archives/fixture' }, { form: '4', filing_date: '2025-10-29' }],
        breakdown: [{ breakdown: 'segments', breakdown_name: 'Revenue by Segment', period_type: 'trailing', report_date: '2025-09-30', series_name: 'Products', value: 800, currency: 'USD' }],
      }
      window.api.defeatbetaTerminal = async request => {
        calls.push(request)
        return { data: { symbol: request.symbol, section: request.section, rows: fixture[request.section] || [], publishedAt: Date.now(), financialCurrency: 'USD', companyName: request.symbol + ' company' },
          meta: { source: 'fixture', freshness: failure && request.section === 'prices' ? 'failed' : 'fresh', fetchedAt: Date.now(), failureReason: failure ? 'Fixture offline' : undefined }, errors: [] }
      }
      window.api.openExternal = async url => { window.lastUrl = url }
      const click = async label => { const b = [...document.querySelectorAll('button')].find(entry => entry.textContent === label); check(b, 'Missing ' + label); b.click(); await settle() }
      const tab = async index => { document.querySelectorAll('[role=tab]')[index].click(); await settle() }
      window.runProbe = async () => {
        const tasks = buildTasks(undefined, { hiddenTabs: ['defeatbeta'] }, { stocks: '', fundamentals: '' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).filter(task => task.tab === 'defeatbeta')
        check(tasks.length === DEFEATBETA_SECTIONS.length, 'Every section must warm even for a hidden unvisited page')
        await Promise.all(tasks.map(task => task.run(client, 3)))
        check(calls.length === 12 && calls.every(request => request.background && request.backgroundOrder === 3), 'Startup keys and priority')
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><DefeatBetaPage active onStatusChange={() => {}} onNavigate={(page, symbol) => { navigated = page + ':' + symbol }} /></QueryClientProvider>)
        await settle()
        check(calls.length === 12, 'Opening warmed page must not fetch again')
        check(document.querySelectorAll('[role=tab]').length === 10 && document.querySelector('[data-candlestick-canvas] canvas'), 'Tabs and candlestick chart')
        const chart = document.querySelector('[data-terminal-price-chart]')
        check(chart.dataset.candleCount === '260', 'Real OHLC candlesticks must be plotted')
        check(chart.querySelector('[data-candlestick-canvas]').getBoundingClientRect().width > chart.getBoundingClientRect().width * 0.95, 'Chart must fill its panel')
        const range = label => chart.querySelector('[aria-label="Chart time range"]').querySelectorAll('button')[[...chart.querySelectorAll('[aria-label="Chart time range"] button')].findIndex(button => button.textContent === label)]
        range('1M').click(); await settle()
        check(range('1M').getAttribute('aria-pressed') === 'true' && chart.textContent.includes('21 sessions'), 'Selected range must be visible and use cached data')
        check(chart.querySelector('button[aria-label="MA200"]').textContent.includes('115.95'), 'Short ranges must retain MA200 from the full history')
        chart.querySelector('button[aria-label="MA10"]').click(); await settle()
        check(chart.querySelector('button[aria-label="MA10"]').getAttribute('aria-pressed') === 'false', 'MA toggle')
        chart.querySelector('button[aria-label="MA10"]').click(); await settle()
        const canvas = chart.querySelector('[data-candlestick-canvas]')
        const rect = canvas.getBoundingClientRect()
        const target = document.elementFromPoint(rect.left + rect.width * 0.45, rect.top + 80)
        const mouse = { bubbles: true, view: window, clientX: rect.left + rect.width * 0.45, clientY: rect.top + 80 }
        target.dispatchEvent(new MouseEvent('mouseenter', mouse))
        target.dispatchEvent(new MouseEvent('mousemove', mouse)); await settle()
        check(chart.querySelector('[data-chart-readout]').textContent.includes('Historical session'), 'Crosshair must update the OHLC and volume readout')
        target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })); await settle()
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -80 })); await settle()
        check(chart.textContent.includes('Custom view') && range('1M').getAttribute('aria-pressed') === 'false', 'Manual zoom must clear the selected preset')
        await click('Reset view'); check(range('1M').getAttribute('aria-pressed') === 'true', 'Reset must restore selected range')
        check(calls.length === 12, 'Chart interaction must not fetch data')
        await tab(1); check(body().includes('Apple fixture company') && body().includes('Fixture executive'), 'Profile and officers')
        await tab(2); check(body().includes('Total Revenue') && body().includes('2025-09-30'), 'Statement matrix')
        const select = document.querySelector('select[aria-label="Financial statement"]'); select.value = 'cash_flow'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        check(body().includes('Free Cash Flow'), 'Statement selector')
        await tab(3); check(body().includes('P/E') && body().includes('20.98x'), 'Valuation multiple')
        await tab(4); check(body().includes('20%'), 'Growth YoY')
        await tab(5); check(body().includes('60%'), 'Profit margins')
        await tab(6); check(body().includes('Model value per share') && document.querySelector('svg'), 'DCF calculation')
        const discount = document.querySelector('input[aria-label="Discount rate (%)"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(discount, '1'); discount.dispatchEvent(new Event('input', { bubbles: true })); await settle()
        check(body().includes('Requires positive TTM'), 'Invalid discount guard')
        await tab(7); check(body().includes('Fixture news'), 'News list'); await click('Earnings transcripts'); check(body().includes('Fixture transcript paragraph'), 'Transcript reader')
        await tab(8); check(!body().includes('2025-10-29') && body().includes('10-K'), 'Important filings filter')
        document.querySelector('input[type=checkbox]').click(); await settle(); check(body().includes('2025-10-29'), 'All filings filter')
        await tab(9); check(body().includes('Products') && body().includes('800'), 'Revenue breakdown')
        check(calls.length === 12, 'Subtabs must not load on first selection')
        await tab(0); await click('Open charts ↗'); check(navigated === 'charts:AAPL', 'Charts navigation')
        const ticker = document.querySelector('input[aria-label="DefeatBeta ticker"]')
        const setTicker = async value => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(ticker, value); ticker.dispatchEvent(new Event('input', { bubbles: true })); await settle(); await click('Load ticker') }
        await setTicker('NVDA'); check(calls.filter(request => request.symbol === 'NVDA').length === 12 && body().includes('NVDA company'), 'Ticker search must load every section for the new symbol')
        await setTicker('AAPL'); check(calls.filter(request => request.symbol === 'AAPL').length === 12, 'Returning to cached ticker must reuse sections')
        await setTicker('^BAD'); check(body().includes('Enter a US equity ticker') && calls.length === 24, 'Invalid ticker must keep existing data')
        failure = true; await click('Refresh dataset'); check(body().includes('Previously loaded data remains visible') && body().includes('125.9'), 'Failed refresh retains data')
        check(document.querySelector('[data-candlestick-canvas] canvas').getBoundingClientRect().width > 0 && document.documentElement.scrollWidth <= 1300, 'Visible chart and no page overflow')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true })); await settle(); check(body().includes('Revenue breakdown'), 'Keyboard tabs')
        failure = false; await setTicker('AAPL'); await click('Refresh dataset'); await tab(0)
        check(document.querySelector('[role=tab][aria-selected=true]').textContent.includes('Overview'), 'Final overview selection')
        return 'PASS: full-width candlesticks, range presets, MA toggles, crosshair, reset, startup warm-up, ten tabs, navigation and failed refresh'
      }
    ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))!
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script>window.api={};window.probeErrors=[];window.addEventListener("error",event=>window.probeErrors.push(event.message))</script><script src="renderer.js"></script>')
  const screenshot = resolve(root, '../../output/playwright/defeatbeta-terminal.png')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const { mkdirSync, writeFileSync } = require('node:fs')
    app.disableHardwareAcceleration()
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { backgroundThrottling: false, offscreen: true } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        window.webContents.debugger.attach('1.3')
        for (const width of [760, 1920]) {
          await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 1080, deviceScaleFactor: 1, mobile: false })
          await new Promise(resolve => setTimeout(resolve, 200))
          const sizing = await window.webContents.executeJavaScript('({ viewport: innerWidth, root: document.getElementById("root").getBoundingClientRect().width, width: document.documentElement.scrollWidth, chart: document.querySelector("[data-candlestick-canvas]").getBoundingClientRect().width, canvas: document.querySelector("[data-candlestick-canvas] canvas").getBoundingClientRect().width })')
          if (sizing.width > width || sizing.canvas < sizing.chart * 0.8) throw Error('Chart resize/overflow failure at ' + width + ': ' + JSON.stringify(sizing))
          const errors = await window.webContents.executeJavaScript('window.probeErrors')
          if (errors.length) throw Error('Renderer errors: ' + errors.join('; '))
          const candlePixels = await window.webContents.executeJavaScript('(() => { const canvas = document.querySelector("[data-candlestick-canvas] canvas"); const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data; let count = 0; for (let index = 0; index < pixels.length; index += 4) { if ((pixels[index] === 38 && pixels[index + 1] === 194 && pixels[index + 2] === 129) || (pixels[index] === 240 && pixels[index + 1] === 85 && pixels[index + 2] === 78)) count++; } return count; })()')
          if (candlePixels < 20) throw Error('Candles did not repaint after resize to ' + width)
        }
        window.webContents.invalidate()
        await new Promise(resolve => setTimeout(resolve, 300))
        mkdirSync(${JSON.stringify(resolve(root, '../../output/playwright'))}, { recursive: true })
        writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG())
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('DefeatBeta UI probe timed out')) }, 40_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshot:', screenshot)
} finally {
  assert(directory.startsWith(join(tmpdir(), 'budget-terminal-ui-')))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
