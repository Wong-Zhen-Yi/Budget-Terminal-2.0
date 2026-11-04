import { emitKeypressEvents } from 'node:readline'
import type { Key } from 'node:readline'
import { invokeBridge } from '../mcp/runtime.js'
import { catalog } from '../mcp/catalog.js'
import { safeText, wrapLines } from './model.js'
import { CHARTS_INTERVALS, CHARTS_RANGES } from '../electron/shared/contract.js'
import { chartCandles, renderChart } from './chart.js'
import type { ChartState } from './chart.js'
import { clip, compactDetail, dataTable, envelopeLines, record, renderTable } from './presentation.js'

interface View { name: string; operation?: string; request?: Record<string, unknown>; result?: unknown; lines: string[]; loading?: boolean; error?: string; updated?: string; revision?: number; abort?: AbortController }
interface MenuItem { label: string; activate: () => void }
interface ActionMenu { title: string; items: MenuItem[]; selected: number; filter: string }
const symbols = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA']
const knownSymbols = new Set(symbols)
const views: View[] = [
  { name: 'Portfolio', operation: 'portfolio', request: {}, lines: [] },
  { name: 'Markets', operation: 'quotes', request: { holdings: symbols }, lines: [] },
  { name: 'Charts', operation: 'chartsHistory', request: { symbol: 'SPY', interval: '1 Day', range: '1Y' }, lines: [] },
  { name: 'News', operation: 'newsPage', request: { tickers: symbols }, lines: [] },
  { name: 'Crypto', operation: 'crypto', request: {}, lines: [] },
  { name: 'Finance', operation: 'personalFinance', request: {}, lines: [] },
  { name: 'Research', lines: ['RESEARCH DESK', 'Space opens chart, quote, company and service actions.', 'Menus support typing to filter. Pick Type another ticker to enter any symbol.', '', 'Optional commands (press /):', 'chart AAPL          Interactive candlesticks / line and volume', 'quote AAPL MSFT     Compact price comparison with instrument labels', 'stock AAPL          Detailed company research', 'tool <name> <JSON>  Any read-only service; tools lists available names', '', 'Tables: Up/Down selects a row; Enter opens all details; Esc returns.', 'Wide terminals show selected record details beside the table.', 'Charts: s symbol · t range/interval · c style · +/- zoom', 'Enter inspects candles: Left/Right candle, Up/Down zoom, Esc leaves.', 'Source dates and instrument labels stay with the data.'] },
  { name: 'Settings', lines: [] },
]
let active = 0
let scroll = 0
let selected = 0
let detailOpen = false
let responseOpen = false
const charts = views[2]
const research = views.find(view => view.name === 'Research')!
const chart: ChartState = { mode: 'candles', bars: 100, cursor: 0, inspect: false }
let command: string | undefined
const menus: ActionMenu[] = []
let closed = false
const controller = new AbortController()
const output = process.stdout

function settings() {
  return ['Budget Terminal TUI', '', 'Read-only access to the existing local Budget Terminal services.', 'No broker orders or saved-record edits are issued.', 'Every terminal workspace starts loading at launch.', 'The background desktop renderer also preloads all implemented pages.', 'Open the desktop Settings for detailed page and provider diagnostics.', '', ...views.filter(view => view.operation).flatMap(view => [
    `${view.name}: ${view.loading ? 'Loading' : view.error ? 'Needs attention' : 'Loaded'}${view.updated ? ` | ${view.updated}` : ''}`,
    ...(view.error ? [view.error, 'Select this workspace, press Space, then choose Refresh.'] : []),
  ])]
}

function draw() {
  if (closed) return
  const width = Math.max(1, output.columns || 100)
  const height = Math.max(1, output.rows || 30)
  const view = views[active]
  const menu = menus.at(-1)
  const items = menu ? filteredItems(menu) : []
  if (menu) menu.selected = Math.max(0, Math.min(menu.selected, items.length - 1))
  const menuLines = items.map((item, index) => `${index === menu?.selected ? '> ' : '  '}${item.label}`)
  const room = Math.max(1, height - 5)
  const contentRoom = menu ? Math.max(1, room - 2) : room
  const table = dataTable(view.operation, view.result)
  if (table) selected = Math.max(0, Math.min(selected, table.rows.length - 1))
  let body: string[]
  if (menu) {
    const wrapped = wrapLines(menuLines, width)
    const offset = Math.max(0, wrapLines(menuLines.slice(0, menu.selected + 1), width).length - contentRoom)
    body = [menu.title, `Filter: ${menu.filter || '(type to filter)'} · ${items.length} choices`, ...wrapped.slice(offset, offset + contentRoom)]
    if (!items.length) body.push('No matches. Backspace clears the filter; Left goes back.')
  } else if (detailOpen) {
    const lines = compactDetail(responseOpen ? view.result : table?.rows[selected] ? { data: table.rows[selected].detail } : view.result, width)
    const details = [...lines, ...envelopeLines(view.result)]
    scroll = Math.min(scroll, Math.max(0, details.length - room + 1))
    body = [`${responseOpen ? 'FULL RESPONSE DATA' : 'RECORD DETAILS'} · Esc back`, ...details.slice(scroll, scroll + Math.max(1, room - 1))]
  } else if (view === charts) {
    const data = record(record(view.result).data)
    const stats = record(data.stats)
    const candles = chartCandles(data.candles)
    body = [
      `${safeText(view.request?.symbol)} ${safeText(stats.currency)}  ${safeText(view.request?.range)} / ${safeText(view.request?.interval)}  [s Symbol] [t Timeframe] [c Style]`,
      ...(candles.length ? renderChart(candles, width, Math.max(1, room - 4), chart) : [view.loading ? 'Loading price history… Other workspaces remain available.' : 'No chart data. Press s to choose a ticker, or Space for actions.']),
      `History: ${safeText(stats.source || record(record(view.result).meta).source || '--')} ${safeText(stats.market || '')}`,
      `Quote: ${safeText(stats.priceSource || '--')} · ${safeText(stats.priceBasis || '--')} · change basis ${safeText(stats.changeBasis || '--')}`,
      `${safeText(record(record(view.result).meta).freshness || '--')} · ${envelopeLines(view.result)[1]} · d full data`,
      ...(view.error ? [`Chart warning: ${view.error} · Settings has request diagnostics.`] : []),
    ]
  } else if (table && view.result) {
    body = [...renderTable(table, selected, width, Math.max(1, room - 3)), ...envelopeLines(view.result).slice(0, 3)]
  } else {
    const lines = wrapLines(view.name === 'Settings' ? settings() : view.result ? [...compactDetail(view.result, width), ...envelopeLines(view.result)] : view.lines.length ? view.lines : [view.loading ? 'Loading data… Other workspaces remain available.' : 'Space opens actions.'], width)
    scroll = Math.min(scroll, Math.max(0, lines.length - room))
    body = lines.slice(scroll, scroll + room)
  }
  const tabs = views.map((item, index) => index === active ? `[${item.name}]` : item.name).join('  ')
  const shortTabs = views.map((item, index) => index === active ? `[${item.name}]` : item.name.slice(0, 3)).join(' ')
  const rows = [
    ` BT / BUDGET TERMINAL${width >= 65 ? '                            Space: actions  /: command' : ''}`,
    tabs.length <= width ? tabs : shortTabs.length <= width ? shortTabs : `← ${views[(active + views.length - 1) % views.length].name}  [${view.name}]  ${views[(active + 1) % views.length].name} →`,
    '─'.repeat(width),
    ...body.slice(0, room),
  ]
  while (rows.length < height - 2) rows.push('')
  rows.push(command !== undefined ? `> ${safeText(command).slice(-Math.max(1, width - 2))}` : '─'.repeat(width), command !== undefined ? 'Enter apply · Esc cancel · Backspace edit' : menu ? '↑↓ choose · Space select · ← back · Type filter' : detailOpen ? '↑↓ scroll · Esc back · Space actions' : view === charts && chart.inspect ? 'INSPECT ←→ candle · ↑↓ zoom · Esc workspaces · Space actions' : '←→ pages · ↑↓ rows/scroll · Space actions · Enter detail/inspect · q quit')
  output.write('\x1b[H\x1b[2J' + rows.slice(0, height).map((row, index) => index === 0 ? `\x1b[1;36m${clip(row, width)}\x1b[0m` : clip(row, width)).join('\r\n'))
}

function filteredItems(menu: ActionMenu): MenuItem[] { return menu.items.filter(item => item.label.toLowerCase().includes(menu.filter.toLowerCase())) }
function openMenu(title: string, items: MenuItem[]) {
  menus.push({ title, items, selected: 0, filter: '' })
}

function selectTicker(verb: 'quote' | 'stock' | 'chart') {
  openMenu(verb === 'chart' ? 'Chart a ticker' : verb === 'quote' ? 'Choose a ticker for Quotes' : 'Choose a ticker for Company research', [...[...knownSymbols].map(symbol => ({
    label: symbol,
    activate: () => { menus.length = 0; void runCommand(`${verb} ${symbol}`) },
  })), { label: 'Type another ticker…', activate: () => { menus.length = 0; command = `${verb} ` } }])
}

function timeframeMenu() {
  openMenu('Chart range', CHARTS_RANGES.map(range => ({ label: range, activate: () => {
    openMenu(`Interval for ${range}`, CHARTS_INTERVALS.map(interval => ({ label: interval, activate: () => {
      menus.length = 0
      chart.inspect = false
      void load(charts, { ...charts.request, range, interval })
    } })))
  } })))
}

function zoom(factor: number) {
  const count = chartCandles(record(record(charts.result).data).candles).length
  chart.bars = Math.max(10, Math.min(Math.max(10, count), Math.round(chart.bars * factor)))
}

function serviceMenu() {
  const entries = catalog.filter(entry => entry.tool.annotations?.readOnlyHint && !['settings', 'screenshot'].includes(entry.operation))
  openMenu('Choose a read-only research service', entries.map(entry => ({
    label: entry.operation,
    activate: () => {
      // Offer only schema-valid presets; services with complex requests retain
      // their optional command entry rather than silently using invalid arguments.
      const candidates = [
        { label: 'Default request', request: {} },
        ...[...knownSymbols].map(symbol => ({ label: symbol, request: { symbol } })),
        { label: 'Market tickers', request: { tickers: [...knownSymbols] } },
        { label: 'Market holdings', request: { holdings: [...knownSymbols] } },
      ].filter(candidate => entry.validate({ request: candidate.request }))
      openMenu(entry.operation, candidates.length ? candidates.map(candidate => ({
        label: candidate.label,
        activate: () => { menus.length = 0; void runCommand(`tool ${entry.operation} ${JSON.stringify(candidate.request)}`) },
      })) : [{ label: 'Custom request required: open command entry', activate: () => { menus.length = 0; command = `tool ${entry.operation} ` } }, { label: 'Back', activate: () => { menus.pop() } }])
    },
  })))
}

function showActions() {
  openMenu('Actions', [
    { label: views[active].operation ? 'Refresh this workspace' : 'Refresh data workspaces', activate: () => {
      menus.length = 0
      if (views[active].operation) void load(views[active])
      else for (const view of views) if (view.operation) void load(view)
    } },
    { label: 'Quotes - choose ticker', activate: () => selectTicker('quote') },
    { label: 'Company research - choose ticker', activate: () => selectTicker('stock') },
    { label: 'Browse research services', activate: serviceMenu },
    { label: 'Chart a ticker', activate: () => selectTicker('chart') },
    { label: 'Type a ticker for chart…', activate: () => { menus.length = 0; command = 'chart ' } },
    ...(dataTable(views[active].operation, views[active].result)?.rows[selected] ? [{ label: 'Open selected record details', activate: () => { menus.length = 0; detailOpen = true; responseOpen = false; scroll = 0 } }] : []),
    ...(dataTable(views[active].operation, views[active].result)?.rows[selected]?.symbol ? [{ label: 'Chart selected ticker', activate: () => {
      const symbol = dataTable(views[active].operation, views[active].result)!.rows[selected].symbol!
      menus.length = 0
      void runCommand(`chart ${symbol}`)
    } }] : []),
    ...(views[active] === charts ? [
      { label: 'Set chart range / interval', activate: timeframeMenu },
      { label: 'Toggle candlestick / line chart', activate: () => { menus.length = 0; chart.mode = chart.mode === 'candles' ? 'line' : 'candles' } },
      { label: 'Inspect chart candles', activate: () => { menus.length = 0; chart.inspect = true } },
      { label: 'Zoom in', activate: () => { menus.length = 0; zoom(0.7) } },
      { label: 'Zoom out', activate: () => { menus.length = 0; zoom(1.4) } },
      { label: 'Fit all candles', activate: () => { menus.length = 0; chart.bars = chartCandles(record(record(charts.result).data).candles).length } },
    ] : []),
    { label: 'Return to content', activate: () => { menus.length = 0 } },
    { label: 'Quit Budget Terminal TUI', activate: close },
  ])
}

async function load(view: View, request?: Record<string, unknown>) {
  if (!view.operation || (view.loading && !request)) return
  if (request) { view.request = request; view.result = undefined; view.lines = []; selected = 0; scroll = 0 }
  view.abort?.abort()
  view.abort = new AbortController()
  const revision = (view.revision ?? 0) + 1
  view.revision = revision
  view.loading = true
  view.error = undefined
  draw()
  try {
    const result = await invokeBridge(`budget_terminal_${view.operation.replace(/[A-Z]/g, char => '_' + char.toLowerCase())}`, { request: { ...view.request } }, { signal: AbortSignal.any([controller.signal, view.abort.signal]), timeoutMs: 120_000 })
    if (closed || revision !== view.revision) return
    view.result = result
    view.lines = []
    if (view.operation === 'portfolio') {
      const payload = result as { data?: { portfolios?: Array<{ tickers?: string[] }> } }
      for (const portfolio of payload.data?.portfolios ?? []) {
        for (const ticker of portfolio.tickers ?? []) if (/^[A-Za-z0-9.^=:_-]{1,30}$/.test(ticker)) knownSymbols.add(ticker.toUpperCase())
      }
    }
    const envelope = result as { meta?: { freshness?: string }; errors?: unknown }
    if (envelope.meta?.freshness === 'failed' || envelope.meta?.freshness === 'partial' || envelope.meta?.freshness === 'stale') view.error = `Data ${envelope.meta.freshness}; see response details.`
    if (view === charts) chart.cursor = Math.max(0, chartCandles(record(record(result).data).candles).length - 1)
    view.updated = new Date().toLocaleTimeString()
  } catch (error) {
    if (closed || revision !== view.revision) return
    view.error = safeText(error instanceof Error ? error.message : error)
    view.lines = [...view.lines, '', `Request failed: ${view.error}`, 'Press Space and choose Refresh to retry. Check Settings for connection details.']
  } finally { if (revision === view.revision) view.loading = false; draw() }
}

async function runCommand(text: string) {
  const [verb, ...args] = text.trim().split(/\s+/)
  detailOpen = false
  chart.inspect = false
  active = views.indexOf(research)
  scroll = 0
  try {
    if (verb === 'chart') {
      const symbol = (args[0] || '').toUpperCase()
      if (!/^[A-Z0-9.^=:_-]{1,30}$/.test(symbol)) throw new Error('Enter a valid chart ticker, for example: chart AAPL')
      knownSymbols.add(symbol)
      active = views.indexOf(charts)
      await load(charts, { ...charts.request, symbol })
      return
    }
    // A new research command owns the pane, including local lists and errors.
    research.abort?.abort()
    research.revision = (research.revision ?? 0) + 1
    research.loading = false
    if (verb === 'tools') {
      research.result = undefined
      research.lines = catalog.filter(entry => entry.tool.annotations?.readOnlyHint && !['settings', 'screenshot'].includes(entry.operation)).map(entry => `${entry.operation}: ${entry.tool.description?.split('. ')[0]}`)
      draw()
      return
    }
    let operation: string
    let request: Record<string, unknown>
    if (verb === 'quote' || verb === 'stock') {
      if (!args.length || args.some(symbol => !/^[A-Za-z0-9.^=:_-]{1,30}$/.test(symbol))) throw new Error('Enter a ticker, for example: quote AAPL MSFT')
      operation = verb === 'quote' ? 'quotes' : 'stocks'
      request = verb === 'quote' ? { holdings: args.map(symbol => symbol.toUpperCase()) } : { symbol: args[0].toUpperCase() }
    } else if (verb === 'tool') {
      operation = args[0]
      request = JSON.parse(args.slice(1).join(' ') || '{}') as Record<string, unknown>
    } else throw new Error('Commands: chart <ticker>, quote <tickers>, stock <ticker>, tools, tool <name> <request JSON>')
    const entry = catalog.find(item => item.operation === operation)
    if (!entry?.tool.annotations?.readOnlyHint || ['settings', 'screenshot'].includes(operation)) throw new Error('Choose an available read-only research tool. Enter tools to list them.')
    if (!entry.validate({ request })) throw new Error('Invalid request for this tool. Check its request schema in apps/desktop/mcp/schemas.json.')
    if (operation === 'chartsHistory') { active = views.indexOf(charts); await load(charts, request); return }
    research.operation = operation
    await load(research, request)
  } catch (error) { research.result = undefined; research.lines = [safeText(error instanceof Error ? error.message : error)]; draw() }
}

function close() {
  if (closed) return
  closed = true
  controller.abort()
  for (const view of views) view.abort?.abort()
  process.stdin.setRawMode(false)
  process.stdin.pause()
  output.write('\x1b[?25h\x1b[?1049l')
  process.exit(0)
}

if (process.argv.includes('--help')) {
  console.log('BT: compact tables, record details and charts. Arrows navigate; Space actions; Enter details. Charts: s ticker, t timeframe, c style, Enter inspect, +/- zoom. / commands: chart AAPL, quote AAPL MSFT, stock AAPL. q quits.')
} else if (!process.stdin.isTTY || !output.isTTY) {
  console.error('Budget Terminal TUI needs an interactive terminal. Run BT in PowerShell or Windows Terminal.')
  process.exitCode = 1
} else {
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  output.write('\x1b[?1049h\x1b[?25l')
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  output.on('resize', draw)
  process.stdin.on('keypress', (text: string | undefined, key: Key) => {
    const view = views[active]
    if (key.ctrl && key.name === 'c') return close()
    if (command !== undefined) {
      if (key.name === 'escape') command = undefined
      else if (key.name === 'return') { const value = command; command = undefined; void runCommand(value) }
      else if (key.name === 'backspace') command = Array.from(command).slice(0, -1).join('')
      else if (key.ctrl && key.name === 'u') command = ''
      else if (text && !key.ctrl && !key.meta) command = (command + text.replace(/[\x00-\x1f\x7f-\x9f]/g, '')).slice(0, 4096)
    } else if (menus.length) {
      const menu = menus.at(-1)!
      const items = filteredItems(menu)
      if (key.name === 'up') menu.selected = items.length ? (menu.selected + items.length - 1) % items.length : 0
      else if (key.name === 'down') menu.selected = items.length ? (menu.selected + 1) % items.length : 0
      else if (key.name === 'home') menu.selected = 0
      else if (key.name === 'end') menu.selected = Math.max(0, items.length - 1)
      else if (key.name === 'escape' || key.name === 'left') menus.pop()
      else if (key.name === 'space' || text === ' ' || key.name === 'return' || key.name === 'right') items[menu.selected]?.activate()
      else if (key.name === 'backspace') { menu.filter = menu.filter.slice(0, -1); menu.selected = 0 }
      else if (text && !key.ctrl && !key.meta) { menu.filter = (menu.filter + safeText(text)).slice(0, 80); menu.selected = 0 }
    } else if (key.name === 'space' || text === ' ') showActions()
    else if (text === 'q') return close()
    else if (text === '/') command = ''
    else if (text === 'r') void load(views[active])
    else if (key.name === 'escape') { detailOpen = false; chart.inspect = false; scroll = 0 }
    else if (text === 'd' || (key.name === 'return' && view !== charts)) { detailOpen = !detailOpen; responseOpen = text === 'd'; scroll = 0 }
    else if (view === charts && !detailOpen && text === 's') command = 'chart '
    else if (view === charts && !detailOpen && text === 't') timeframeMenu()
    else if (view === charts && !detailOpen && text === 'c') chart.mode = chart.mode === 'candles' ? 'line' : 'candles'
    else if (view === charts && !detailOpen && key.name === 'return') chart.inspect = !chart.inspect
    else if (view === charts && !detailOpen && (text === '+' || text === '=')) zoom(0.7)
    else if (view === charts && !detailOpen && text === '-') zoom(1.4)
    else if (view === charts && !detailOpen && chart.inspect && ['left', 'right', 'up', 'down', 'home', 'end'].includes(key.name || '')) {
      const count = chartCandles(record(record(view.result).data).candles).length
      if (key.name === 'left') chart.cursor = Math.max(0, chart.cursor - 1)
      else if (key.name === 'right') chart.cursor = Math.min(Math.max(0, count - 1), chart.cursor + 1)
      else if (key.name === 'up') zoom(0.7)
      else if (key.name === 'down') zoom(1.4)
      else if (key.name === 'home') chart.cursor = 0
      else if (key.name === 'end') chart.cursor = Math.max(0, count - 1)
    }
    else if (key.name === 'tab' || key.name === 'right' || key.name === 'left') { active = (active + (key.shift || key.name === 'left' ? views.length - 1 : 1)) % views.length; scroll = 0; selected = 0; detailOpen = false; chart.inspect = false }
    else if (!detailOpen && dataTable(view.operation, view.result)) {
      const maximum = Math.max(0, dataTable(view.operation, view.result)!.rows.length - 1)
      const step = key.name === 'pagedown' || key.name === 'pageup' ? Math.max(1, (output.rows || 30) - 10) : 1
      if (key.name === 'down' || key.name === 'pagedown') selected = Math.min(maximum, selected + step)
      else if (key.name === 'up' || key.name === 'pageup') selected = Math.max(0, selected - step)
      else if (key.name === 'home') selected = 0
      else if (key.name === 'end') selected = maximum
    }
    else if (key.name === 'down') scroll++
    else if (key.name === 'up') scroll = Math.max(0, scroll - 1)
    else if (key.name === 'pagedown') scroll += Math.max(1, (output.rows || 30) - 7)
    else if (key.name === 'pageup') scroll = Math.max(0, scroll - Math.max(1, (output.rows || 30) - 7))
    else if (key.name === 'home') scroll = 0
    else if (key.name === 'end') scroll = Number.MAX_SAFE_INTEGER
    draw()
  })
  draw()
  for (const view of views) if (view.operation) void load(view)
}
