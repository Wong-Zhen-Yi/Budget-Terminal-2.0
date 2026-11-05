import assert from 'node:assert/strict'
import { startPortfolioTui } from '../tui/portfolio.js'
import type { Portfolio, Quote } from '../electron/shared/contract.js'
import { candlesticks, validCandles } from '../tui/candlesticks.js'
import { fixtureAgentsBackend, probeTuiAgents, probeTuiAgentsBackend } from './probe-tui-agents.js'

await probeTuiAgents()

const candles = Array.from({ length: 60 }, (_, index) => ({
  time: 1_780_000_000 + index * 86400,
  open: 10 + index, high: 15 + index, low: 8 + index,
  close: index % 3 === 0 ? 12 + index : index % 3 === 1 ? 9 + index : 10 + index,
  volume: 1000,
}))
const chartRequests: string[] = []
let historyFail = false
const plain = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')
assert.equal(validCandles([...candles, candles[0], { ...candles[0], high: -1 }, { ...candles[0], close: NaN }]).length, 60)
const chartLines = candlesticks(candles, 79, 14)
assert(chartLines.some(line => line.includes('█')) && chartLines.some(line => line.includes('▓')))
assert(chartLines.some(line => line.includes('━')))
assert(chartLines.some(line => line.includes('│')))
assert(chartLines.some(line => line.includes('UTC')))
assert(candlesticks([], 79, 14).join('').includes('No OHLC'))
assert(!candlesticks([{ ...candles[0], open: 10, high: 10, low: 10, close: 10 }], 79, 14).join('').includes('NaN'))
for (const [width, height] of [[79, 14], [40, 8], [12, 3], [1, 1], [0, 0]]) {
  const lines = candlesticks(candles, width, height)
  assert(lines.length <= height && lines.every(line => line.length <= width))
}

const tickers = Array.from({ length: 25 }, (_, index) => 'TEST' + index)
const book: Portfolio = {
  id: 'fixture', name: 'Test book', tickers,
  holdings: Object.fromEntries(tickers.map(ticker => [ticker, { ticker, shares: 2, avgPrice: 10, includeInWeight: true }])),
  cashBalance: 100, marginDebt: 20, includeCashInWeight: true, readOnly: false,
  options: [{ rowId: 'option', ticker: 'TEST0', strategy: 'Calls', expiry: '2027-01-15', strike: 30, contracts: 1, premium: 2, status: 'Open', openDate: '2026-01-01', currentPrice: 0, volume: 0, openInterest: 0, impliedVolatility: 0 }],
}
let missing = false
let stale = false
let fail = false
let forced = false
let servicesClosed = false
let requested: string[] = []
const settle = () => new Promise(resolve => setImmediate(resolve))
const fixtureQuotes = Object.fromEntries(tickers.map(symbol => [symbol, { symbol, price: 20, change: 1, absChange: 0.2, currency: 'USD', source: 'Fixture' } as Quote]))

// Exercise the interactive UI using synthetic data, without saved-data or network access.
const input = process.stdin
const output = process.stdout
let screen = ''
let raw = false
const originalWrite = output.write
const originalRaw = input.setRawMode
const originalResume = input.resume
const originalPause = input.pause
const descriptors = ['isTTY', 'columns', 'rows'].map(name => [name, Object.getOwnPropertyDescriptor(output, name)] as const)
const inputTTY = Object.getOwnPropertyDescriptor(input, 'isTTY')
const inputRaw = Object.getOwnPropertyDescriptor(input, 'isRaw')
Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
Object.defineProperty(input, 'isRaw', { configurable: true, value: false })
Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
output.write = ((value: string) => { screen += value; return true }) as typeof output.write
input.setRawMode = ((value: boolean) => { raw = value; return input }) as typeof input.setRawMode
input.resume = () => input
input.pause = () => input
const baseline = input.listenerCount('keypress')
try {
  startPortfolioTui({
    read: async () => {
      if (fail) throw new Error('private path or request URL must not be printed')
      return { portfolios: [book, { ...book, id: 'empty', name: 'Empty book', tickers: [], holdings: {}, options: [] }], activeId: book.id, mainId: book.id, sourcePath: 'never print this path' }
    },
    quotes: async (symbols, force) => { requested = symbols; forced = force; return { quotes: missing ? {} : fixtureQuotes, missing: missing ? tickers : [], staleCount: stale ? 1 : 0 } },
    history: async (symbol, interval, force) => {
      chartRequests.push(`${symbol}:${interval}:${force}`)
      if (historyFail) throw new Error('private chart request URL')
      return { candles, source: 'Fixture OHLC', currency: 'USD', stale: false }
    },
    close: () => { servicesClosed = true },
  }, async () => fixtureAgentsBackend())
  await settle()
  assert(raw)
  assert(screen.includes('Portfolio') && screen.includes('Test book'))
  assert.deepEqual(requested, tickers)
  const frame = () => screen.split('\x1b[H\x1b[2J').at(-1)!
  const press = (name: string) => input.emit('keypress', '', { name })
  press('f2')
  assert(frame().includes('BT TUI  |  Agents'))
  input.emit('keypress', 'q', { name: 'q' })
  assert(raw && frame().includes('q▏'), 'Letters enter chat text rather than invoking portfolio shortcuts')
  press('f1')
  assert(frame().includes('Portfolio'))
  assert.equal(chartRequests.length, tickers.length, 'All daily charts preload without opening the chart')
  press('c')
  assert(frame().includes('CANDLESTICKS  TEST0') && frame().includes('Fixture OHLC'))
  assert(frame().includes('\x1b[38;2;38;194;129m'), 'Up candles use the locked green')
  assert(frame().includes('\x1b[38;2;240;85;78m'), 'Down candles use the locked red')
  press('h')
  assert(frame().includes('O ****  H ****  L ****  C ****'))
  press('h')
  press('down')
  assert(frame().includes('CANDLESTICKS  TEST1'))
  press('1')
  await settle()
  assert(frame().includes('1 Hour') && chartRequests.includes('TEST1:1 Hour:false'))
  input.emit('keypress', '+', { name: '+' })
  press('3')
  await settle()
  assert(frame().includes('1 Week'))
  historyFail = true
  press('r')
  await settle()
  assert(frame().includes('Refresh failed; previous candles'))
  assert(!screen.includes('private chart'))
  historyFail = false
  press('2')
  for (const [width, height] of [[120, 36], [80, 24], [40, 10], [12, 3], [1, 1]]) {
    Object.defineProperty(output, 'columns', { configurable: true, value: width })
    Object.defineProperty(output, 'rows', { configurable: true, value: height })
    output.emit('resize')
    assert(plain(frame()).split('\r\n').length <= height)
    assert(plain(frame()).split('\r\n').every(line => line.length < width))
  }
  Object.defineProperty(output, 'columns', { configurable: true, value: 80 })
  Object.defineProperty(output, 'rows', { configurable: true, value: 24 })
  press('c')
  assert(frame().includes('1,080.00'), 'Net value includes stocks and cash less margin')
  assert(!screen.includes('never print this path'))
  press('h')
  assert(frame().includes('****') && !frame().includes('1,080.00'))
  press('tab')
  assert(frame().includes('OPTIONS') && !frame().includes('30.00'), 'Option values are hidden too')
  press('h')
  assert(frame().includes('30.00'))
  press('tab')
  press('down')
  assert(frame().includes('Rows 2-'))
  press('right')
  assert(frame().includes('Empty book') && frame().includes('No holdings yet'))
  press('left')
  press('r')
  await settle()
  assert(forced)
  missing = true
  press('r')
  await settle()
  assert(frame().includes('Net value --') && frame().includes('price(s) unavailable'))
  missing = false
  stale = true
  press('r')
  await settle()
  assert(frame().includes('saved price(s)'))
  fail = true
  press('r')
  await settle()
  assert(frame().includes('Refresh failed'))
  assert(!screen.includes('private path'))
  for (const [width, height] of [[80, 24], [40, 10], [12, 3], [1, 1]]) {
    Object.defineProperty(output, 'columns', { configurable: true, value: width })
    Object.defineProperty(output, 'rows', { configurable: true, value: height })
    output.emit('resize')
    const frame = screen.split('\x1b[H\x1b[2J').at(-1)!
    assert(frame.split('\r\n').length <= height)
    assert(frame.split('\r\n').every(line => line.length < width))
  }
  input.emit('keypress', 'p', { name: 'p' })
  assert(raw, 'Unassigned shortcuts must do nothing')
  if (process.argv.includes('--ctrl-c')) input.emit('keypress', '\x03', { name: 'c', ctrl: true })
  else input.emit('keypress', 'q', { name: 'q' })
  await settle()
  assert(servicesClosed)
  assert.equal(raw, false)
  assert.equal(input.listenerCount('keypress'), baseline)
  assert(screen.endsWith('\x1b[0m\x1b[?25h\x1b[?1049l'), 'Restore terminal state')
} finally {
  output.write = originalWrite
  input.setRawMode = originalRaw
  input.resume = originalResume
  input.pause = originalPause
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(output, name, descriptor)
    else Reflect.deleteProperty(output, name)
  }
  for (const [name, descriptor] of [['isTTY', inputTTY], ['isRaw', inputRaw]] as const) {
    if (descriptor) Object.defineProperty(input, name, descriptor)
    else Reflect.deleteProperty(input, name)
  }
}
await probeTuiAgentsBackend()
console.log('BT TUI smoke passed: Agents chat, model controls, history persistence, research permissions, candlesticks, privacy, resize and clean exit')
