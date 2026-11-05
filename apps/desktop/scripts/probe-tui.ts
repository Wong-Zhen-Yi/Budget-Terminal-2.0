import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, safeText, wrapLines } from '../tui/model.js'
import { catalog } from '../mcp/catalog.js'
import { bucketCandles, chartCandles, renderChart } from '../tui/chart.js'
import { dataTable, dataTables, dateText, portfolioSummary, renderTable } from '../tui/presentation.js'
import { desktopPages } from '../tui/workspaces.js'
import { TABS } from '../electron/shared/contract.js'
import { WORKSPACES } from '../electron/shared/navigation.js'

const candles = Array.from({ length: 150 }, (_, index) => {
  const open = 100 + index * 0.3 + Math.sin(index / 5) * 5
  return { time: 1_700_000_000 + index * 86_400, open, high: open + 2, low: open - 2, close: open + (index % 2 ? 1 : -1), volume: 1000 + index * 10 }
})
const clean = chartCandles([candles[1], candles[0], candles[1], { ...candles[2], close: NaN }, { ...candles[3], high: -1 }])
assert.deepEqual(clean, [candles[0], candles[1]], 'Candles must be valid, ordered and deduplicated')
const buckets = bucketCandles(candles, 20)
assert.equal(buckets.length, 20)
assert.equal(buckets[0].open, candles[0].open)
assert.equal(buckets.at(-1)!.close, candles.at(-1)!.close)
assert.equal(buckets.reduce((sum, bar) => sum + bar.volume, 0), candles.reduce((sum, bar) => sum + bar.volume, 0))
assert.equal(Math.max(...buckets.map(bar => bar.high)), Math.max(...candles.map(bar => bar.high)))
const state = { mode: 'candles' as const, bars: 100, cursor: 149, inspect: true }
const plotted = renderChart(candles, 100, 20, state).join('\n')
assert(plotted.includes('CANDLES') && plotted.includes('◆') && plotted.includes('VOL') && plotted.includes('UTC'))
assert(plotted.includes('OHLC groups'), 'Dense windows must disclose aggregation')
assert(plotted.includes('◂'), 'Close price must be labelled at its chart position')
for (const width of [32, 40, 80, 100, 120, 180]) {
  for (const height of [10, 14, 20, 35]) {
    for (const mode of ['candles', 'line'] as const) {
      for (const cursor of [0, 32, 149]) {
        const frame = renderChart(candles, width, height, { ...state, mode, cursor })
        assert.equal(frame.length, height, `Chart must use exactly its ${width}×${height} allocation`)
        assert(frame.every(line => Array.from(line).length <= width), 'Chart must fit without relying on renderer clipping')
        assert(frame.some(line => line.includes('◆')), 'Inspection marker must stay visible when panning or resizing')
        assert(!/NaN|Infinity/.test(frame.join('')))
      }
    }
  }
}
const spacious = renderChart(candles.slice(-10), 100, 25, { ...state, bars: 10, cursor: 9, inspect: false })
const priceRows = spacious.filter(line => /[│┤]/.test(line) && !line.includes('wick')).slice(0, 16)
assert(priceRows.every(line => !/[█░]{2}/.test(line)), 'Candle bodies must have breathing room')
assert(priceRows.filter(line => /^\s*[\d,.]+ ┤/.test(line)).length < priceRows.length / 2, 'Price ticks must be sparse')
assert(renderChart(candles, 100, 25, { ...state, mode: 'line' }).some(line => /[\u2801-\u28ff]/.test(line)), 'Line charts must use sub-cell resolution')
const intraday = candles.slice(0, 10).map((bar, index) => ({ ...bar, time: 1_700_000_000 + index * 60 }))
assert(renderChart(intraday, 100, 20, state).some(line => line.includes('22:13') && line.includes('22:22')), 'Intraday ticks must show hours and minutes')
for (const sample of [candles.slice(0, 1), candles.map(bar => ({ ...bar, volume: 0 })), candles.map(bar => ({ ...bar, open: 0.0002, close: 0.0002, low: 0.0001, high: 0.0003 }))]) {
  const frame = renderChart(sample, 80, 20, state).join('\n')
  assert(!/NaN|Infinity|undefined/.test(frame), 'Single bars, zero volume and fractional prices must render safely')
}
const flat = renderChart(candles.map(bar => ({ ...bar, open: 5, high: 5, low: 5, close: 5 })), 80, 15, { ...state, mode: 'line', cursor: -50 }).join('\n')
assert(!/NaN|Infinity/.test(flat), 'Flat series must keep a finite price scale')
assert(renderChart([], 80, 20, state).join('').includes('No valid'))
assert(renderChart(candles, 20, 8, state).join('').includes('Enlarge'))
const quoteTable = dataTable('quotes', { data: { holdings: { AAPL: { symbol: 'AAPL', price: 123, change: 2, currency: 'USD', priceBasis: 'equity-perp-mark' } } } })!
assert(quoteTable.rows[0].cells.includes('PERP / 24h'))
assert(renderTable(quoteTable, 0, 120, 20).join('').includes('SELECTED RECORD'))

assert.equal(safeText('\x1b[2Jhello\r\n'), ' [2Jhello  ')
assert.deepEqual(wrapLines(['abcdef', ''], 3), ['abc', 'def', ''])
assert.deepEqual(wrapLines(['ab'], 0), ['a', 'b'])
assert(!describe({ apiKey: 'private', token: 'private', shares: 12 }).join('\n').includes('private'))

const pages = desktopPages(new Date('2026-11-05T12:00:00Z'))
assert.deepEqual(new Set(pages.map(page => page.id)), new Set(TABS.filter(page => page.implemented).map(page => page.id)))
for (const page of pages) {
  if (page.operation) {
    const entry = catalog.find(entry => entry.operation === page.operation)!
    assert(entry.tool.annotations?.readOnlyHint)
    assert(entry.validate({ request: page.request }), page.id + ': invalid startup request ' + JSON.stringify(entry.validate.errors))
  }
  const group = WORKSPACES.find(group => group.pages.includes(page.id))
  if (group) assert.equal(page.workspace, group.label)
}
const book = { id: 'demo', name: 'Demo', tickers: ['AAPL', 'EUR'], holdings: { AAPL: { ticker: 'AAPL', shares: 10, avgPrice: 100, includeInWeight: true }, EUR: { ticker: 'EUR', shares: 2, avgPrice: 20, includeInWeight: true } }, cashBalance: 500, marginDebt: 100, includeCashInWeight: true, options: [] }
const portfolioResult = { data: { portfolios: [book], activeId: 'demo' } }
const quoteResult = { data: { holdings: { AAPL: { symbol: 'AAPL', price: 123, change: 2, currency: 'USD', priceBasis: 'equity-perp-mark' }, EUR: { symbol: 'EUR', price: 30, currency: 'EUR' } } } }
const positions = dataTable('portfolio', portfolioResult, { quotes: quoteResult })!
assert.equal(positions.rows[0].cells[4], '1,230.00')
assert.equal(positions.rows[0].cells[5], '230.00')
assert.equal(positions.rows[0].cells[6], '--', 'Missing USD marks must withhold weights')
assert.equal(positions.rows[1].cells[4], '--', 'Foreign currency must not become a USD valuation')
assert(portfolioSummary(portfolioResult, { quotes: quoteResult }).join(' ').includes('Totals withheld'))
const usdQuotes = { data: { holdings: { ...quoteResult.data.holdings, EUR: { symbol: 'EUR', price: 30, currency: 'USD' } } } }
assert(portfolioSummary(portfolioResult, { quotes: usdQuotes }).join(' ').includes('1,690.00'), 'Counted cash and margin must match desktop totals')
assert.equal(dateText(1_700_000_000), dateText(1_700_000_000_000), 'Quote seconds and retrieval milliseconds must agree')
const sections = dataTables('globalMarkets', { data: { rows: [{ symbol: 'SPY', name: 'S&P 500', lastClose: 600 }], history: { rows: [{ date: '2026-11-05', close: 600 }] }, sourcePath: 'private-path' } })
assert.equal(sections.length, 2)
assert(sections[0].columns.includes('LAST CLOSE'))
assert(!describe({ nested: { sourcePath: 'private-path', apiKey: 'private-key' } }).join('').includes('private'))
assert(!JSON.stringify(dataTables('stocks', { data: { stats: { sourcePath: 'private-path', price: 123 } } })).includes('private-path'))

if (!process.argv.includes('--fixture')) {
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--fixture', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 20_000 })
  assert.equal(child.status, 0, child.stderr || child.stdout)
  assert.match(child.stdout, /TUI keyboard smoke passed/)
  console.log(process.argv.includes('--charts-only')
    ? 'TUI chart probes passed: OHLC aggregation, responsive layouts, sparse axes, close markers, volume, smooth lines, flat/empty charts, preload, cursor/zoom/timeframes, symbol switching, stale-request cancellation and terminal restoration.'
    : 'TUI probes passed: compact tables, details, OHLC aggregation, flat/empty charts, line/candlestick rendering, chart preload, cursor/zoom/timeframes, typed tickers, stale-request cancellation, menu filtering, read-only commands, resizing and terminal restoration.')
} else {
  const directory = await mkdtemp(join(tmpdir(), 'bt-tui-'))
  process.env.APPDATA = join(directory, 'roaming')
  process.env.LOCALAPPDATA = join(directory, 'local')
  process.env.BUDGET_TERMINAL_DATA_DIR = join(directory, 'data')
  const calls: string[] = []
  const requests: Array<{ name: string; arguments: { request: Record<string, unknown> } }> = []
  const token = 'a'.repeat(64)
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`)
    let body = ''
    request.on('data', chunk => { body += String(chunk) })
    request.on('end', () => {
      const parsed = JSON.parse(body) as (typeof requests)[number]
      const { name } = parsed
      const entry = catalog.find(entry => entry.tool.name === name)!
      assert(entry?.validate(parsed.arguments), name + ': invalid bridge request')
      calls.push(name)
      requests.push(parsed)
      response.setHeader('Content-Type', 'application/json')
      const fixture = {
        data: name === 'budget_terminal_charts_history' ? { symbol: parsed.arguments.request.symbol, candles, stats: { source: 'Fixture stock history', priceSource: 'Fixture equity perp', priceBasis: 'equity-perp-mark', changeBasis: '24h' } }
          : name === 'budget_terminal_quotes' ? { holdings: { AAPL: { symbol: 'AAPL', price: 123, change: 2, currency: 'USD', source: 'Offline fixture', priceBasis: 'equity-perp-mark' }, MSFT: { symbol: 'MSFT', price: 234, change: -1, currency: 'USD' } }, missing: [] }
          : { symbol: 'DEMO', price: 123, portfolios: [{ id: 'demo', name: 'Demo', tickers: ['TEST'], holdings: { TEST: { ticker: 'TEST', shares: 10, avgPrice: 100, includeInWeight: true } }, cashBalance: 500, marginDebt: 100, includeCashInWeight: true, options: [] }, { id: 'empty', name: 'Empty book', tickers: [], holdings: {}, cashBalance: 80, marginDebt: 0, includeCashInWeight: true, options: [] }], rows: [{ symbol: 'TEST', name: 'Fixture company', price: 123 }], title: '\x1b]0;injected\x07', apiKey: 'fixture-secret' },
        meta: { freshness: 'fresh', source: 'Offline fixture', fetchedAt: 1_700_000_000_000 }, errors: [],
      }
      const send = () => response.end(JSON.stringify(name === 'budget_terminal_crypto' ? { error: 'Fixture provider unavailable' } : fixture))
      if (parsed.arguments.request.symbol === 'SLOW') setTimeout(send, 200)
      else send()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  await mkdir(join(directory, 'data/.mcp'), { recursive: true })
  await writeFile(join(directory, 'data/.mcp/runtime.json'), JSON.stringify({ version: 1, port: address.port, token, pid: process.pid }))
  let screen = ''
  let raw = false
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((text: string) => { screen += text; return true }) as typeof process.stdout.write
  Object.defineProperty(process.stdout, 'isTTY', { value: true })
  Object.defineProperty(process.stdin, 'isTTY', { value: true })
  Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true })
  Object.defineProperty(process.stdout, 'rows', { value: 30 })
  process.stdin.setRawMode = ((value: boolean) => { raw = value; return process.stdin })
  const key = (name: string, text?: string, ctrl = false) => process.stdin.emit('keypress', text, { name, ctrl })
  const frame = () => screen.split('\x1b[H\x1b[2J').at(-1) ?? ''
  const type = (text: string) => { for (const char of text) key(char, char) }
  const command = (text: string) => { key('/', '/'); type(text); key('return') }
  const page = (text: string) => { key('p', 'p'); type(text.split(' / ').at(-1)!.split(' ')[0]); key('return') }
  const waitFor = async (check: () => boolean) => {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`TUI fixture timed out: ${frame()}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    await import('../tui/main.js')
    if (process.argv.includes('--charts-only')) {
      await waitFor(() => calls.includes('budget_terminal_charts_history'))
      Object.defineProperty(process.stdout, 'columns', { value: 120 })
      command('chart AAPL')
      await waitFor(() => frame().includes('CANDLES') && frame().includes('AAPL'))
      for (const label of ['Fixture stock history', 'Fixture equity perp', 'VOL', 's Symbol', '◂', 'OHLC groups']) assert(frame().includes(label), label)
      assert(!frame().includes('Fetched:'), 'Chart diagnostics belong in Settings')
      assert.equal(frame().split('\r\n').length, 30)
      key('return')
      key('left')
      assert(frame().includes('INSPECT') && frame().includes('◆'))
      key('home')
      assert(frame().includes('2023-11-14 22:13 UTC'))
      key('end')
      assert(frame().includes('2024-04-11 22:13 UTC'))
      key('up')
      assert(frame().includes('70/150 bars'))
      key('escape')
      key('c', 'c')
      assert(frame().includes('CLOSE PRICE') && /[\u2801-\u28ff]/.test(frame()))
      const chartCalls = calls.filter(name => name === 'budget_terminal_charts_history').length
      key('t', 't')
      type('1Y')
      key('space', ' ')
      type('Day')
      key('space', ' ')
      await waitFor(() => calls.filter(name => name === 'budget_terminal_charts_history').length === chartCalls + 1)
      key('s', 's')
      type('SLOW')
      key('return')
      await waitFor(() => requests.some(request => request.arguments.request.symbol === 'SLOW'))
      key('s', 's')
      type('FAST')
      key('return')
      await waitFor(() => frame().includes('FAST') && frame().includes('CLOSE PRICE'))
      await new Promise(resolve => setTimeout(resolve, 250))
      assert(frame().includes('FAST'), 'Late responses must not replace the selected chart')
      for (const width of [40, 80, 120]) {
        Object.defineProperty(process.stdout, 'columns', { value: width })
        process.stdout.emit('resize')
        assert(frame().split('\r\n').every(line => Array.from(line.replace(/\x1b\[[0-9;]*m/g, '')).length <= width))
        assert(frame().includes('VOL') && frame().includes('◂'))
      }
      process.once('exit', () => {
        assert.equal(raw, false)
        assert(screen.includes('\x1b[?1049l'))
        originalWrite('TUI keyboard smoke passed\n')
      })
    } else {
      await waitFor(() => pages.filter(page => page.operation && !page.sourceId).every(page => calls.includes(catalog.find(entry => entry.operation === page.operation)!.tool.name)) && calls.includes('budget_terminal_quotes'))
      await new Promise(resolve => setTimeout(resolve, 100))
      page('Settings')
      assert(screen.includes('Needs attention'))
      page('My money / Portfolio')
      assert(frame().includes('Cash 500.00 counted'))
      key('b', 'b')
      type('Empty')
      key('return')
      assert(frame().includes('Empty book'))
      assert(frame().includes('Net value 80.00'))
      key('b', 'b')
      type('Demo')
      key('return')
      for (const operation of ['portfolio', 'quotes', 'charts_history', 'news_page', 'crypto', 'personal_finance']) assert(calls.includes(`budget_terminal_${operation}`))
      assert.equal(calls.filter(name => name === 'budget_terminal_economic').length, 1, 'Bonds must share Economic startup data')
      for (const name of ['news_page', 'calendar_month', 'youtube']) {
        assert.deepEqual(requests.find(request => request.name === `budget_terminal_${name}`)?.arguments.request.tickers, ['TEST'], 'Startup feeds must use saved tickers')
      }
      assert(raw)
      assert(!screen.includes('fixture-secret'))
      assert(!screen.includes('\x1b]0;injected'))
      key('space', ' ')
      assert(frame().includes('> Refresh this workspace'))
      key('space', ' ')
      await waitFor(() => calls.filter(name => name === 'budget_terminal_portfolio').length === 2)
      key('space', ' ')
      key('down')
      key('down')
      key('space', ' ')
      assert(frame().includes('Choose a ticker for Company research'))
      assert(frame().includes('TEST'), 'Saved portfolio symbols must be available without typing')
      key('down')
      key('down')
      key('space', ' ')
      await waitFor(() => calls.filter(name => name === 'budget_terminal_stocks').length === 3)
      assert.equal(requests.filter(request => request.name === 'budget_terminal_stocks').at(-1)?.arguments.request.symbol, 'AAPL')
      await new Promise(resolve => setTimeout(resolve, 100))
      key('space', ' ')
      key('down')
      key('down')
      key('down')
      key('space', ' ')
      assert(frame().includes('Choose a read-only research service'))
      assert(!frame().includes('mutatePortfolio'))
      const entries = catalog.filter(entry => entry.tool.annotations?.readOnlyHint && !['settings', 'screenshot'].includes(entry.operation))
      for (let index = 0; index < entries.findIndex(entry => entry.operation === 'crypto'); index++) key('down')
      key('space', ' ')
      assert(frame().includes('Default request'))
      key('left')
      assert(frame().includes('Choose a read-only research service'))
      key('space', ' ')
      key('space', ' ')
      await waitFor(() => calls.filter(name => name === 'budget_terminal_crypto').length === 2)
      await new Promise(resolve => setTimeout(resolve, 100))
      assert(frame().includes('This page could not load'))
      page('Overview / Dictionary')
      assert(frame().includes('Offline Dictionary'))
      key('f', 'f')
      type('candlestick')
      key('return')
      assert(frame().includes('Filter: candlestick'))
      key('return')
      assert(frame().includes('RECORD DETAILS'))
      key('escape')
      page('Research / Browser')
      assert(frame().includes('shared Chromium'))
      key('w', 'w')
      type('Macro')
      key('return')
      assert(frame().includes('Macro & events'))
      key('return')
      assert(frame().includes('[Global]'))
      assert(frame().includes('Fixture company'))
      const beforeVisit = calls.length
      page('My money / Personal Finance')
      assert(frame().includes('Personal Finance'))
      assert.equal(calls.length, beforeVisit, 'Preloaded page switches must not make first-visit requests')
      // Commands still accept spaces after navigating preloaded desktop pages.
      page('Research / Tool console')
      key('space', ' ')
      key('left')
      assert(!frame().includes('> Refresh this workspace'))
      key('end')
      Object.defineProperty(process.stdout, 'columns', { value: 40 })
      process.stdout.emit('resize')
      key('/', '/')
      for (const char of 'quote AAPL') key(char, char)
      key('return')
      await waitFor(() => calls.filter(name => name === 'budget_terminal_quotes').length === 3)
      await new Promise(resolve => setTimeout(resolve, 100))
      key('/', '/')
      for (const char of 'tool mutatePortfolio {}') key(char, char)
      key('return')
      assert(screen.includes('read-only'))
      assert(!calls.some(name => name.includes('mutate')))
      Object.defineProperty(process.stdout, 'columns', { value: 120 })
      process.stdout.emit('resize')
      command('chart AAPL')
      await waitFor(() => frame().includes('CANDLES') && frame().includes('AAPL'))
      assert(frame().includes('Fixture stock history'))
      assert(frame().includes('Fixture equity perp'))
      assert(frame().includes('VOL'))
      assert(frame().includes('s Symbol'))
      assert(frame().includes('◂'))
      assert(!frame().includes('Fetched:'), 'Chart request diagnostics belong in Settings')
      assert(frame().split('\r\n').length <= 30, 'Chart workspace must fit its viewport')
      key('c', 'c')
      assert(frame().includes('CLOSE PRICE'))
      key('return')
      key('left')
      assert(frame().includes('INSPECT'))
      assert(frame().includes('◆'))
      key('home')
      assert(frame().includes('2023-11-14 22:13 UTC'), 'Home must inspect the original first candle')
      key('end')
      assert(frame().includes('2024-04-11 22:13 UTC'), 'End must inspect the original latest candle')
      key('up')
      assert(frame().includes('70/150 bars'))
      key('escape')
      key('t', 't')
      assert(frame().includes('Chart range'))
      type('1Y')
      key('space', ' ')
      assert(frame().includes('Interval for 1Y'))
      type('Day')
      key('space', ' ')
      await waitFor(() => requests.filter(request => request.name === 'budget_terminal_charts_history' && request.arguments.request.symbol === 'AAPL').length === 2)
      key('s', 's')
      type('SLOW')
      key('return')
      await waitFor(() => requests.some(request => request.arguments.request.symbol === 'SLOW'))
      key('s', 's')
      type('FAST')
      key('return')
      await waitFor(() => frame().includes('FAST') && frame().includes('CLOSE PRICE'))
      await new Promise(resolve => setTimeout(resolve, 250))
      assert(frame().includes('FAST'), 'An older response must not replace the requested symbol')
      const chartCalls = calls.filter(name => name === 'budget_terminal_charts_history').length
      command('chart BAD!')
      assert(frame().includes('valid chart ticker'))
      assert.equal(calls.filter(name => name === 'budget_terminal_charts_history').length, chartCalls)
      command('chart FAST')
      await waitFor(() => frame().includes('FAST') && frame().includes('CLOSE PRICE'))
      command('quote AAPL MSFT')
      await waitFor(() => frame().includes('PERP / 24h'))
      assert(frame().includes('SELECTED RECORD'))
      key('down')
      key('return')
      assert(frame().includes('RECORD DETAILS'))
      assert(frame().includes('MSFT'))
      key('escape')
      page('Research / Stocks')
      key('s', 's')
      type('IBM')
      key('return')
      await waitFor(() => requests.some(request => request.name === 'budget_terminal_stocks' && request.arguments.request.symbol === 'IBM') && frame().includes('Fixture company'))
      assert(frame().includes('[Stocks]'), 'Ticker changes must stay on their desktop page')
      key(']', ']')
      assert(frame().includes('Section 2/'), 'Multi-collection responses must expose section navigation')
      key('space', ' ')
      type('zzzznoaction')
      assert(frame().includes('No matches'))
      key('space', ' ')
      key('left')
      Object.defineProperty(process.stdout, 'columns', { value: 40 })
      process.stdout.emit('resize')
      assert(frame().split('\r\n').every(line => Array.from(line.replace(/\x1b\[[0-9;]*m/g, '')).length <= 40))
      process.once('exit', () => {
        assert.equal(raw, false)
        assert(screen.includes('\x1b[?1049l'))
        originalWrite('TUI keyboard smoke passed\n')
      })
    }
  } finally {
    server.closeAllConnections()
    server.close()
    await rm(directory, { recursive: true, force: true })
  }
  key('space', ' ')
  key('end')
  key('space', ' ')
}
