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
import { dataTable, renderTable } from '../tui/presentation.js'

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

if (!process.argv.includes('--fixture')) {
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--fixture'], { encoding: 'utf8', timeout: 20_000 })
  assert.equal(child.status, 0, child.stderr || child.stdout)
  assert.match(child.stdout, /TUI keyboard smoke passed/)
  console.log('TUI probes passed: compact tables, details, OHLC aggregation, flat/empty charts, line/candlestick rendering, chart preload, cursor/zoom/timeframes, typed tickers, stale-request cancellation, menu filtering, read-only commands, resizing and terminal restoration.')
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
      calls.push(name)
      requests.push(parsed)
      response.setHeader('Content-Type', 'application/json')
      const fixture = {
        data: name === 'budget_terminal_charts_history' ? { symbol: parsed.arguments.request.symbol, candles, stats: { source: 'Fixture stock history', priceSource: 'Fixture equity perp', priceBasis: 'equity-perp-mark', changeBasis: '24h' } }
          : name === 'budget_terminal_quotes' ? { holdings: { AAPL: { symbol: 'AAPL', price: 123, change: 2, currency: 'USD', source: 'Offline fixture', priceBasis: 'equity-perp-mark' }, MSFT: { symbol: 'MSFT', price: 234, change: -1, currency: 'USD' } }, missing: [] }
          : { symbol: 'DEMO', price: 123, portfolios: [{ name: 'Demo', tickers: ['TEST'], holdings: { TEST: { ticker: 'TEST', shares: 10, avgPrice: 100 } } }], title: '\x1b]0;injected\x07', apiKey: 'fixture-secret' },
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
  const waitFor = async (check: () => boolean) => {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`TUI fixture timed out: ${frame()}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    await import('../tui/main.js')
    await waitFor(() => calls.length === 6 && screen.includes('Offline fixture'))
    await new Promise(resolve => setTimeout(resolve, 100))
    key('left')
    assert(screen.includes('Needs attention'))
    key('right')
    for (const operation of ['portfolio', 'quotes', 'charts_history', 'news_page', 'crypto', 'personal_finance']) assert(calls.includes(`budget_terminal_${operation}`))
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
    await waitFor(() => calls.includes('budget_terminal_stocks'))
    assert.equal(requests.find(request => request.name === 'budget_terminal_stocks')?.arguments.request.symbol, 'AAPL')
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
    assert(frame().includes('Fixture provider unavailable'))
    // Return from Research to Markets with workspace arrows, then check the
    // optional text commands still accept spaces normally.
    for (let index = 0; index < 5; index++) key('left')
    assert(frame().includes('[Markets]'))
    key('space', ' ')
    key('left')
    assert(!frame().includes('> Refresh this workspace'))
    key('end')
    Object.defineProperty(process.stdout, 'columns', { value: 40 })
    process.stdout.emit('resize')
    key('/', '/')
    for (const char of 'quote AAPL') key(char, char)
    key('return')
    await waitFor(() => calls.filter(name => name === 'budget_terminal_quotes').length === 2)
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
    key('c', 'c')
    assert(frame().includes('CLOSE PRICE'))
    key('return')
    key('left')
    assert(frame().includes('INSPECT'))
    assert(frame().includes('◆'))
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
    key('left')
    assert(frame().includes('[Markets]'))
    assert(frame().includes('SELECTED RECORD'))
    key('down')
    key('return')
    assert(frame().includes('RECORD DETAILS'))
    assert(frame().includes('MSFT'))
    key('escape')
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
  } finally {
    server.closeAllConnections()
    server.close()
    await rm(directory, { recursive: true, force: true })
  }
  key('space', ' ')
  key('end')
  key('space', ' ')
}
