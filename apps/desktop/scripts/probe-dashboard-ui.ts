import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-dashboard-ui-'))
const bundle = await build({
  stdin: {
    resolveDir: resolve(import.meta.dirname, '..'), loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { MacroBar } from './src/components/dashboard/MacroBar'
      import { useMacroCharts } from './src/api/dashboardQueries'
      import { useReloadAll } from './src/api/queries'
      import { queryKeys } from './src/api/client'
      import { MACRO_SYMBOLS } from './electron/shared/contract'
      import { DashboardPage } from './src/pages/DashboardPage'
      import { useDashboard } from './src/stores/dashboard'
      import { NEWS_REFRESH_MS } from './src/api/refreshRates'
      import { heatColor } from './src/components/charts/Treemap'
      import { PositionsTable } from './src/components/portfolio/PositionsTable'
      import { buildPositionRows } from './electron/shared/portfolioMath'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 150))
      const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
      const calls = []
      const fixture = symbol => ({data: {symbol, candles: Array.from({length: 40}, (_, i) => ({close: 100 + Math.sin(i) * 5 + i / 3}))}, meta: {freshness: 'fresh'}})
      window.api.chart = async request => { calls.push(request); return fixture(request.symbol) }
      const macro = Object.fromEntries(MACRO_SYMBOLS.map((entry, i) => [entry.label, {price: 100 + i, change: i % 2 ? -0.5 : 0.5}]))
      let reload
      function Shell() {
        const charts = useMacroCharts()
        reload = useReloadAll()
        return <MacroBar macro={macro} loading={false} charts={charts} />
      }
      const root = createRoot(document.getElementById('root'))
      window.checkLayout = () => {
        check(document.documentElement.scrollWidth <= innerWidth, 'Horizontal overflow')
        for (const svg of document.querySelectorAll('svg')) {
          check(svg.getBoundingClientRect().height >= 20, 'Collapsed sparkline')
          const points = svg.querySelector('polyline').getAttribute('points')
          check(!/NaN|Infinity/.test(points), 'Invalid chart coordinates')
        }
        return 'PASS: layout at ' + innerWidth
      }
      window.checkDashboardLayout = () => {
        const left = document.querySelector('.dashboard-holdings').getBoundingClientRect()
        const agentPanel = document.querySelector('.dashboard-agents-column')
        const center = agentPanel.getBoundingClientRect()
        const rightPanel = document.querySelector('.dashboard-heatmap-column')
        const right = rightPanel.getBoundingClientRect()
        check(document.documentElement.scrollWidth <= innerWidth, 'Dashboard 2 horizontal overflow')
        check(center.height > 300, 'Central Agents pane collapsed')
        check(!document.querySelector('.dashboard-macro'), 'Dashboard 2 must not show SPY/DXY/VIX/GLD/WTI sparklines')
        check(!document.querySelector('.dashboard-options, .dashboard-options-column, [aria-label="Options ticker"]'), 'Dashboard 2 must not show options panels or obsolete ticker controls')
        check(agentPanel.querySelector('.agents-embedded textarea'), 'Agents must occupy the center pane')
        check(agentPanel.scrollWidth <= agentPanel.clientWidth, 'Embedded Agents horizontal overflow')
        check(agentPanel.querySelector('.agents-composer').getBoundingClientRect().bottom <= center.bottom + 1, 'Keep the Agents composer inside its panel')
        check(rightPanel.querySelector('section h2').textContent === 'Portfolio Heatmap', 'Portfolio heatmap must occupy the right pane')
        check(rightPanel.scrollWidth <= rightPanel.clientWidth, 'Heatmap panel horizontal overflow')
        check(rightPanel.querySelector('.portfolio-heatmap-map').getBoundingClientRect().height >= 100, 'Heatmap tiles must retain usable height')
        check(!document.body.textContent.includes('Live News Feed'), 'Dashboard 2 must no longer show a live news feed')
        const pie = document.querySelector('.dashboard-holdings .dashboard-portfolio-pie')
        check(pie && pie.querySelector('svg path'), 'Portfolio pie must replace analyst targets below holdings')
        check(!document.querySelector('.dashboard-holdings').textContent.includes('Analyst Price Targets'), 'Remove Dashboard 2 analyst targets')
        check(pie.scrollWidth <= pie.clientWidth, 'Portfolio pie horizontal overflow')
        const pieSvg = pie.querySelector('svg').getBoundingClientRect()
        const pieBounds = pie.getBoundingClientRect()
        check(pieSvg.height >= 100 && pieSvg.bottom <= pieBounds.bottom, 'Pie chart must fit inside its panel')
        if (innerWidth > 1200) {
          check(left.right < center.left && center.right < right.left, 'Agents must be between holdings and the portfolio heatmap')
          check(Math.abs(center.top - left.top) < 2 && Math.abs(right.top - left.top) < 2, 'No empty macro strip above heatmap or Agents')
        }
        return 'PASS: Dashboard 2 layout at ' + innerWidth
      }
      window.runDashboard2Probe = async () => {
        root.render(null); await settle()
        const envelope = data => ({data, meta: {freshness: 'fresh', fetchedAt: Date.now(), source: 'fixture'}, errors: []})
        const books = ['AAPL', 'MSFT'].map(ticker => ({id: ticker, name: ticker + ' Portfolio', tickers: [ticker], holdings: {[ticker]: {ticker, shares: 1, avgPrice: 90, includeInWeight: true}}, cashBalance: 100, includeCashInWeight: true, marginDebt: 0, options: [], readOnly: false}))
        useDashboard.setState({symbol: 'AAPL', portfolioId: null, leftWidth: 400, optionsWidth: 320, agentsWidth: 400})
        client.setQueryData(queryKeys.portfolio, envelope({portfolios: books, activeId: 'AAPL', sourcePath: ''}))
        for (const ticker of ['AAPL', 'MSFT']) {
          client.setQueryData(queryKeys.quotes([ticker]), envelope({holdings: {[ticker]: {price: 100, change: 1, absChange: 1}}, macro}))
        }
        const agentState = {portfolioProposal: null, model: null, thinking: null, models: [], connected: false, busy: false, autonomy: false, objective: '', intervalMinutes: 15, runsRemaining: 0, nextRunAt: null, messages: [], error: '', navigation: null}
        client.setQueryData(queryKeys.agents, envelope(structuredClone(agentState)))
        const agentCommands = [], optionsCalls = [], targetCalls = []
        window.api.targets = async request => { targetCalls.push(request); return envelope({targets: []}) }
        let agentReads = 0
        window.api.agentsStatus = async () => { agentReads++; return envelope(agentState) }
        window.api.agentsCommand = async command => {
          agentCommands.push(command)
          if (command.type === 'connect') agentState.connected = true
          if (command.type === 'send') agentState.messages.push(
            {id: 'user', role: 'user', text: command.text, at: Date.now()},
            {id: 'reply', role: 'assistant', text: '## Portfolio research ready\\n\\nReview your **holdings** and news together.', at: Date.now()})
          return envelope(structuredClone(agentState))
        }
        window.api.options = async request => { optionsCalls.push(request); return envelope({buckets: []}) }
        client.removeQueries({queryKey: ['chart']})
        const chartCallsBefore = calls.length
        const newsCalls = [], intervals = [], returnCalls = []
        let reported
        window.api.onPortfolioChanged = () => () => {}
        window.api.news = async request => { newsCalls.push(request); return envelope({items: []}) }
        window.api.returns = async request => {
          returnCalls.push(request)
          return request.window === '1w'
            ? {data: {returns: {}}, meta: {freshness: 'failed', fetchedAt: Date.now(), failureReason: 'Test heatmap history unavailable'}, errors: []}
            : envelope({returns: Object.fromEntries(request.tickers.map(ticker => [ticker, 5]))})
        }
        const originalInterval = window.setInterval
        window.setInterval = (callback, delay, ...args) => {
          if (delay === NEWS_REFRESH_MS) intervals.push(callback)
          return originalInterval(callback, delay, ...args)
        }
        const render = () => root.render(<QueryClientProvider client={client}><div data-page-id="dashboard-2" className="flex h-full flex-col"><DashboardPage newsFocused onStatusChange={panels => { reported = panels }} /></div></QueryClientProvider>)
        render(); await settle()
        window.setInterval = originalInterval
        check(newsCalls.length === 0 && intervals.length === 0, 'Removed news feed must not fetch or install a polling timer')
        check(returnCalls.length === 0, 'Live heatmap must use startup quotes without fetching history on first visit')
        const heatmap = document.querySelector('.dashboard-portfolio-heatmap')
        check(heatmap.querySelector('[title="AAPL  +1.00%"]'), 'Warm quote changes must render as portfolio heatmap tiles')
        check(heatmap.textContent.includes('Sector coverage: 1/1'), 'Offline classification coverage must be visible')
        check(reported.some(panel => panel.label === 'Agents' && panel.envelope), 'Aggregate Agents health with Dashboard 2 holdings')
        check(!reported.some(panel => ['News', 'Options', 'Targets'].includes(panel.label) || panel.label.endsWith('history')), 'Removed panels must not affect Dashboard 2 health')
        check(agentReads === 0 && agentCommands.length === 0, 'Opening embedded Agents must use its startup cache without connecting automatically')
        check(calls.length === chartCallsBefore && optionsCalls.length === 0 && targetCalls.length === 0, 'Removed sparklines, options and targets must not fetch on Dashboard 2')
        const pie = document.querySelector('.dashboard-portfolio-pie')
        check([...pie.querySelectorAll('svg title')].map(title => title.textContent).join('|') === 'AAPL 50.0%|CASH 50.0%', 'Pie uses the selected holdings and counted cash')
        const agentPanel = document.querySelector('.dashboard-agents-column')
        const agentButton = text => [...agentPanel.querySelectorAll('button')].find(button => button.textContent === text)
        agentButton('Connect Codex').click(); await settle()
        check(agentCommands.at(-1).type === 'connect', 'Embedded Agents can connect explicitly')
        const composer = document.getElementById('dashboard-agent-message')
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(composer, 'Review my portfolio news')
        composer.dispatchEvent(new Event('input', {bubbles: true})); await settle()
        agentPanel.querySelector('form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})); await settle()
        check(agentCommands.at(-1).text === 'Review my portfolio news' && agentPanel.querySelector('.agents-prose strong'), 'Embedded chat sends messages and formats replies')
        check(!document.getElementById('agent-message') && document.querySelector('label[for="dashboard-agent-message"]'), 'Embedded form controls have scoped IDs and labels')
        agentButton('Controls').click(); await settle()
        check(!document.getElementById('dashboard-agent-controls').hidden && getComputedStyle(agentPanel.querySelector('.agents-chat')).display === 'none', 'Controls fit inside the narrow Agents pane')
        agentButton('Controls').click(); await settle()
        const heatmapButton = label => [...heatmap.querySelectorAll('button')].find(button => button.textContent === label)
        heatmapButton('1D').click(); await settle()
        check(returnCalls.length === 1 && returnCalls[0].window === '1d' && heatmap.querySelector('[title="AAPL  +5.00%"]'), 'Explicit historical interval updates tile returns')
        check(reported.some(panel => panel.label === 'Heatmap returns' && panel.enabled && panel.envelope), 'Historical heatmap health must reach the dashboard footer')
        heatmapButton('1W').click(); await settle()
        check(heatmap.textContent.includes('Test heatmap history unavailable'), 'Historical heatmap failures must stay visible')
        check(reported.some(panel => panel.label === 'Heatmap returns' && panel.envelope?.meta.freshness === 'failed'), 'Report historical heatmap failures')
        heatmapButton('Live').click(); await settle()
        check(heatmap.querySelector('[title="AAPL  +1.00%"]'), 'Live restores quote changes without another history fetch')
        heatmap.querySelector('[title="AAPL  +1.00%"]').dispatchEvent(new MouseEvent('mouseover', {bubbles: true})); await settle()
        const selector = document.querySelector('.dashboard-holdings select')
        selector.value = 'MSFT'; selector.dispatchEvent(new Event('change', {bubbles: true})); await settle()
        check(heatmap.querySelector('[title="MSFT  +1.00%"]') && !heatmap.querySelector('[title^="AAPL "]'), 'Heatmap follows the selected portfolio using warm quotes')
        check(pie.textContent.includes('MSFT') && !pie.textContent.includes('AAPL'), 'Pie follows the selected portfolio')
        client.setQueryData(queryKeys.quotes(['MSFT']), envelope({holdings: {MSFT: {price: 300, change: -2, absChange: -6}}, macro})); await settle()
        check(pie.querySelector('svg title').textContent === 'MSFT 75.0%', 'Pie updates with quote changes without another request')
        const falling = heatmap.querySelector('[title="MSFT  -2.00%"]')
        const red = document.createElement('div'); red.style.background = heatColor(-2)
        check(falling && falling.style.background === red.style.background, 'Quote updates recolor losing holdings red')
        client.setQueryData(queryKeys.quotes(['MSFT']), envelope({holdings: {MSFT: {price: 300, change: -2, absChange: -6, sector: 'Financial Services'}}, macro})); await settle()
        check(heatmap.textContent.includes('Sector: Financials'), 'Provider sectors must reach tiles and normalize aliases without a new request')
        const unknownBook = {...books[1], tickers: ['UNKNOWNTICKER'], holdings: {UNKNOWNTICKER: {ticker: 'UNKNOWNTICKER', shares: 1, avgPrice: 90, includeInWeight: true}}}
        client.setQueryData(queryKeys.quotes(['UNKNOWNTICKER']), envelope({holdings: {UNKNOWNTICKER: {price: 100, change: 1, absChange: 1}}, macro}))
        client.setQueryData(queryKeys.portfolio, envelope({portfolios: [unknownBook], activeId: 'MSFT'})); await settle()
        check(heatmap.textContent.includes('Sector coverage: 0/1') && heatmap.textContent.includes('Unclassified: UNKNOWNTICKER'), 'Unresolved sectors must stay visible')
        client.setQueryData(queryKeys.portfolio, envelope({portfolios: books, activeId: 'MSFT'})); await settle()
        client.setQueryData(queryKeys.quotes(['MSFT']), envelope({holdings: {}, macro})); await settle()
        check(!pie.querySelector('svg') && pie.textContent.includes('Allocation unavailable') && pie.textContent.includes('MSFT'), 'Missing prices must not produce a misleading normalized pie')
        check(heatmap.textContent.includes('Market marks missing') && !heatmap.querySelector('[title^="MSFT "]'), 'Heatmap must not hide missing valuation coverage')
        client.setQueryData(queryKeys.quotes(['MSFT']), envelope({holdings: {MSFT: {price: 100, change: 1, absChange: 1}}, macro})); await settle()
        client.setQueryData(queryKeys.portfolio, envelope({portfolios: [{...books[1], tickers: [], holdings: {}}], activeId: 'MSFT'})); await settle()
        check(heatmap.textContent.includes('No holdings to map') && newsCalls.length === 0, 'Cash-only portfolio must show an honest empty heatmap and never start news')
        client.setQueryData(queryKeys.portfolio, envelope({portfolios: books, activeId: 'AAPL', sourcePath: ''})); await settle()
        window.checkDashboardLayout()
        return 'PASS: Dashboard 2 portfolio pie, central Agents and right-side portfolio heatmap, live quotes, historical intervals, missing/empty holdings, combined health, portfolio switching and no removed-news requests'
      }
      window.runProbe = async () => {
        for (const entry of MACRO_SYMBOLS) client.setQueryData(queryKeys.chart(entry.symbol, '1 Day'), fixture(entry.symbol))
        root.render(<QueryClientProvider client={client}><Shell /></QueryClientProvider>)
        await settle()
        check(calls.length === 0, 'Warm cache must avoid first-visit fetches')
        check(document.querySelectorAll('svg').length === 5, 'Five macro sparklines')
        for (const svg of document.querySelectorAll('svg')) {
          check(svg.getAttribute('aria-label').includes('30 trading sessions'), 'History range label')
          check(svg.querySelector('polyline').getAttribute('points').split(' ').length === 30, 'Last 30 closes')
        }
        await reload(); await settle()
        check(calls.length === 5 && calls.every(call => call.force), 'F5 refreshes every sparkline')
        root.render(<MacroBar macro={macro} loading={false} charts={MACRO_SYMBOLS.map((entry, i) => ({data: { ...fixture(entry.symbol), meta: {freshness: 'stale'} }, isLoading: false, isError: false}))} />)
        await settle()
        check(document.querySelectorAll('svg').length === 5 && !document.body.textContent.includes('Stale history'), 'Retain stale charts without yellow text')
        check(document.querySelectorAll('[title*="stale"]').length === 5, 'Stale history remains available in tooltips')
        root.render(<MacroBar macro={macro} loading={false} charts={MACRO_SYMBOLS.map(() => ({isLoading: true, isError: false}))} />)
        await settle()
        check(document.body.textContent.includes('Loading history'), 'Visible loading state')
        root.render(<MacroBar macro={macro} loading={false} charts={MACRO_SYMBOLS.map(() => ({isLoading: false, isError: true}))} />)
        await settle()
        check(document.body.textContent.includes('History unavailable'), 'Visible failure state')
        root.render(<MacroBar macro={macro} loading={false} charts={MACRO_SYMBOLS.map(entry => ({data: { ...fixture(entry.symbol), data: {candles: [{close: 100}, {close: NaN}, {close: 100}]} }, isLoading: false, isError: false}))} />)
        await settle(); window.checkLayout()
        const pegTickers = ['PEGHIGH', 'PEGLOW', 'PEGMISSING', 'PEGFUND', 'PEGONE', 'PEGBELOW', 'PEGABOVE', 'PEGZERO']
        const pegBook = {id: 'peg', name: 'PEG', readOnly: false, tickers: pegTickers,
          holdings: Object.fromEntries(pegTickers.map(ticker => [ticker, {ticker, shares: 1, avgPrice: 90, includeInWeight: true}])),
          cashBalance: 0, marginDebt: 0, options: [], includeCashInWeight: true}
        const pegQuotes = Object.fromEntries(pegTickers.map(ticker => [ticker, {symbol: ticker, price: 100, change: 1, absChange: 1}]))
        const pegFacts = Object.fromEntries(pegTickers.map((ticker, index) => [ticker, {ticker,
          quoteType: index === 3 ? 'ETF' : 'EQUITY', size: 1e10, sizeType: 'marketCap', targetMeanPrice: 120,
          pegRatio: [2.345, -0.75, null, null, 1, 0.75, 1.01, 0][index]}]))
        const noop = () => {}
        root.render(<PositionsTable portfolio={pegBook} rows={buildPositionRows(pegBook, pegQuotes, pegFacts)} loading={false}
          onSetShares={noop} onSetAvgPrice={noop} onToggleWeight={noop} onRemove={noop} />)
        await settle()
        const pegHeader = [...document.querySelectorAll('th')].find(header => header.textContent.includes('PEG Ratio'))
        check(pegHeader, 'Portfolio stock table must include PEG Ratio')
        const pegColumn = [...pegHeader.parentElement.children].indexOf(pegHeader)
        const pegCell = ticker => [...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes(ticker)).children[pegColumn].textContent
        check(pegCell('PEGHIGH') === '2.35' && pegCell('PEGLOW') === '-0.75', 'Reported PEG ratios must render with two decimals and preserve negatives')
        check(pegCell('PEGMISSING') === '--' && pegCell('PEGFUND') === 'N/A', 'Missing stock PEG and fund inapplicability must be distinct')
        const pegValue = ticker => [...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes(ticker)).children[pegColumn].querySelector('span')
        check(pegValue('PEGONE').classList.contains('text-up'), 'PEG of exactly 1.0 must be green')
        check(['PEGHIGH', 'PEGABOVE'].every(ticker => pegValue(ticker).classList.contains('text-down')), 'PEG above 1.0 must be red')
        check(['PEGBELOW', 'PEGZERO', 'PEGLOW'].every(ticker => pegValue(ticker).classList.contains('text-green-300')), 'All PEG values below 1.0 must use brighter green')
        check(['PEGMISSING', 'PEGFUND'].every(ticker => pegValue(ticker).classList.contains('text-text-dim')), 'Missing and fund PEG values must remain muted')
        check(getComputedStyle(pegValue('PEGBELOW')).color !== getComputedStyle(pegValue('PEGONE')).color, 'The built stylesheet must render distinct green shades')
        check(document.querySelector('[aria-label="PEGHIGH shares"]') && document.querySelector('[aria-label="Remove PEGHIGH"]'), 'PEG column must preserve portfolio editing controls')
        pegHeader.click(); await settle()
        check(document.querySelector('tbody tr').textContent.includes('PEGHIGH'), 'PEG sorts numerically descending')
        check([...document.querySelectorAll('tbody tr')].slice(-2).every(row => /PEGMISSING|PEGFUND/.test(row.textContent)), 'Missing PEG values stay last when sorted descending')
        pegHeader.click(); await settle()
        check(document.querySelector('tbody tr').textContent.includes('PEGLOW'), 'PEG sorts numerically ascending')
        check([...document.querySelectorAll('tbody tr')].slice(-2).every(row => /PEGMISSING|PEGFUND/.test(row.textContent)), 'Missing PEG values stay last in both sort directions')
        root.render(<QueryClientProvider client={client}><Shell /></QueryClientProvider>)
        for (let attempt = 0; attempt < 20 && document.querySelectorAll('svg').length !== 5; attempt++) await settle()
        check(document.querySelectorAll('svg').length === 5, 'Remounted history ready')
        return 'PASS: portfolio PEG column, threshold colours, distinct green shades, formatting, missing/fund values, numeric sorting and editing; five sparklines, startup cache, F5, stale/loading/failure states and flat/invalid history'
      }
    `,
  },
  bundle: true, jsx: 'automatic', write: false, format: 'iife',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': resolve(import.meta.dirname, '../src'), '@shared': resolve(import.meta.dirname, '../electron/shared') },
})
const assets = resolve(import.meta.dirname, '../out/renderer/assets')
const css = (await readdir(assets)).find(file => file.endsWith('.css'))!
await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%}body{margin:0;padding:12px;box-sizing:border-box;background:#0e1520}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
await writeFile(join(directory, 'main.cjs'), `
  const { app, BrowserWindow } = require('electron')
  const { writeFileSync } = require('node:fs')
  app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
  app.whenReady().then(async () => {
    const window = new BrowserWindow({show: false, width: 1440, height: 240, webPreferences: {backgroundThrottling: false}})
    try {
      await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
      console.log(await window.webContents.executeJavaScript('window.runProbe()'))
      await new Promise(resolve => setTimeout(resolve, 250))
      for (const width of [1680, 1000, 700]) {
        window.setSize(width, 240)
        await new Promise(resolve => setTimeout(resolve, 150))
        console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
        writeFileSync(${JSON.stringify(directory)} + '/dashboard-' + width + '.png', (await window.webContents.capturePage()).toPNG())
      }
      window.setSize(1680, 900)
      await new Promise(resolve => setTimeout(resolve, 150))
      console.log(await window.webContents.executeJavaScript('window.runDashboard2Probe()'))
      for (const width of [1680, 1100, 700]) {
        window.setSize(width, 900)
        await window.webContents.executeJavaScript('document.documentElement.classList.toggle("browser-mode", ' + (width <= 1200) + ')')
        await new Promise(resolve => setTimeout(resolve, 150))
        console.log(await window.webContents.executeJavaScript('window.checkDashboardLayout()'))
        writeFileSync(${JSON.stringify(directory)} + '/dashboard-2-' + width + '.png', (await window.webContents.capturePage()).toPNG())
      }
      app.exit(0)
    } catch (error) {console.error(error); app.exit(1)}
  })
`)
const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
delete env.ELECTRON_RUN_AS_NODE
const output = await new Promise<{code: number | null; text: string}>((resolveRun, reject) => {
  const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
  let text = ''
  child.stdout.on('data', chunk => { text += chunk })
  child.stderr.on('data', chunk => { text += chunk })
  const timer = setTimeout(() => { child.kill(); reject(Error('Dashboard UI probe timed out')) }, 30_000)
  child.on('error', error => { clearTimeout(timer); reject(error) })
  child.on('exit', code => { clearTimeout(timer); resolveRun({code, text}) })
})
assert.equal(output.code, 0, output.text)
console.log(output.text.trim())
console.log(`Screenshots: ${directory}`)
