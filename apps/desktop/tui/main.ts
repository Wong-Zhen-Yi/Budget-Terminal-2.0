import { emitKeypressEvents } from 'node:readline'
import type { Key } from 'node:readline'
import { invokeBridge } from '../mcp/runtime.js'
import { catalog } from '../mcp/catalog.js'
import { safeText, wrapLines } from './model.js'
import { CHARTS_INTERVALS, CHARTS_RANGES } from '../electron/shared/contract.js'
import { chartCandles, renderChart } from './chart.js'
import type { ChartState } from './chart.js'
import { array, clip, compactDetail, dataTables, envelopeLines, portfolioSummary, record, renderTable } from './presentation.js'
import { desktopPages, initialPageId } from './workspaces.js'
import type { PageDefinition } from './workspaces.js'
import { DICTIONARY_ENTRIES } from '../electron/shared/dictionary.js'

interface View extends Omit<PageDefinition, 'operation'> { operation?: string; result?: unknown; section?: number; filter?: string; loading?: boolean; error?: string; updated?: string; revision?: number; abort?: AbortController }
interface MenuItem { label: string; activate: () => void }
interface ActionMenu { title: string; items: MenuItem[]; selected: number; filter: string }
const symbols = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA']
const knownSymbols = new Set(symbols)
const views: View[] = [...desktopPages(), { id: 'tool-console', name: 'Tool console', workspace: 'Research', lines: ['Read-only research commands', '', 'Space: browse research services', '/: chart AAPL, quote AAPL MSFT, stock AAPL, tools, tool <name> <JSON>', 'p: find a page | w: workspaces | f: filter rows | s: page ticker', '[: previous data section | ]: next data section | d: complete response'] }]
let active = views.findIndex(view => view.id === initialPageId)
let portfolioQuotes: unknown
let portfolioId: string | undefined
let portfolioFeedTickers: string | undefined
let scroll = 0
let selected = 0
let detailOpen = false
let responseOpen = false
const charts = views.find(view => view.id === 'charts')!
const research = views.find(view => view.id === 'tool-console')!
const chart: ChartState = { mode: 'candles', bars: 100, cursor: 0, inspect: false }
let command: string | undefined
const menus: ActionMenu[] = []
let closed = false
const controller = new AbortController()
const output = process.stdout

function sourceView(view: View): View { return views.find(item => item.id === view.sourceId) ?? view }
function tablesFor(view: View) {
  const source = sourceView(view)
  if (view.id === 'dictionary') return dataTables('dictionary', { data: { entries: DICTIONARY_ENTRIES } })
  const tables = dataTables(source.operation, source.result, { quotes: portfolioQuotes, portfolioId })
  if (view.id === 'dashboard' || view.id === 'dashboard-2') {
    for (const id of ['news', 'global']) {
      const page = views.find(item => item.id === id)!
      if (page.result) tables.push(...dataTables(page.operation, page.result))
    }
  }
  return tables
}
function tableFor(view: View) {
  const tables = tablesFor(view)
  const table = tables[(view.section ?? 0) % Math.max(1, tables.length)]
  if (!table || !view.filter) return table
  const query = view.filter.toLowerCase()
  return { ...table, title: `Filter: ${safeText(view.filter)} | ${table.title}`, rows: table.rows.filter(row => row.cells.some(cell => cell.toLowerCase().includes(query))) }
}
function navigate(view: View) {
  active = views.indexOf(view)
  scroll = 0
  selected = 0
  detailOpen = false
  chart.inspect = false
  menus.length = 0
}
function pageMenu(workspace?: string) {
  openMenu(workspace || 'Find a desktop page', views.filter(view => !workspace || view.workspace === workspace).map(view => ({
    label: workspace ? view.name : view.workspace + ' / ' + view.name,
    activate: () => navigate(view),
  })))
}
function workspaceMenu() {
  openMenu('Desktop workspaces', [...new Set(views.map(view => view.workspace))].map(workspace => ({ label: workspace, activate: () => pageMenu(workspace) })))
}
function portfolioMenu() {
  const books = array(record(record(views.find(view => view.id === 'portfolio')?.result).data).portfolios).map(record)
  openMenu('Choose a saved portfolio', books.map(book => ({ label: safeText(book.name), activate: () => { portfolioId = String(book.id); selected = 0; menus.length = 0 } })))
}

function loadPortfolioFeeds(result: unknown) {
  if (closed) return
  const tickers = [...new Set(array(record(record(result).data).portfolios).flatMap(book => array(record(book).tickers)).filter((ticker): ticker is string => typeof ticker === 'string' && /^[A-Za-z0-9.^=:_-]{1,30}$/.test(ticker)))]
  const signature = JSON.stringify(tickers)
  if (signature === portfolioFeedTickers) return
  portfolioFeedTickers = signature
  for (const id of ['news', 'calendar', 'youtube']) {
    const view = views.find(item => item.id === id)!
    void load(view, { ...view.request, tickers })
  }
}

function settings() {
  return ['Budget Terminal TUI', '', 'Read-only access to the existing local Budget Terminal services.', 'No broker orders or saved-record edits are issued.', 'Every supported data page starts loading at launch.', 'p: find a page | w: workspaces | f: filter rows | [ / ]: sections', 'Pages with desktop-only interactions explain how to open them.', 'The background desktop renderer also preloads all implemented pages.', 'Open the desktop Settings for detailed page and provider diagnostics.', '', 'Portfolio mark diagnostics:', ...envelopeLines(portfolioQuotes), '', ...views.filter(view => view.operation && !view.sourceId).sort((a, b) => Number(Boolean(b.error)) - Number(Boolean(a.error))).flatMap(view => [
    `${view.name}: ${view.loading ? 'Loading' : view.error ? 'Needs attention' : 'Loaded'}${view.updated ? ` | ${view.updated}` : ''}`,
    ...envelopeLines(view.result),
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
  const source = sourceView(view)
  const result = view.id === 'dictionary' ? { data: { entries: DICTIONARY_ENTRIES } } : source.result
  const tables = tablesFor(view)
  const table = tableFor(view)
  if (table) selected = Math.max(0, Math.min(selected, table.rows.length - 1))
  let body: string[]
  if (menu) {
    const wrapped = wrapLines(menuLines, width)
    const offset = Math.max(0, wrapLines(menuLines.slice(0, menu.selected + 1), width).length - contentRoom)
    body = [menu.title, `Filter: ${menu.filter || '(type to filter)'} · ${items.length} choices`, ...wrapped.slice(offset, offset + contentRoom)]
    if (!items.length) body.push('No matches. Backspace clears the filter; Left goes back.')
  } else if (detailOpen) {
    const lines = compactDetail(responseOpen ? result : table?.rows[selected] ? { data: table.rows[selected].detail } : result, width)
    const details = [...lines, ...envelopeLines(result)]
    scroll = Math.min(scroll, Math.max(0, details.length - room + 1))
    body = [`${responseOpen ? 'FULL RESPONSE DATA' : 'RECORD DETAILS'} · Esc back`, ...details.slice(scroll, scroll + Math.max(1, room - 1))]
  } else if (view === charts) {
    const data = record(record(view.result).data)
    const stats = record(data.stats)
    const candles = chartCandles(data.candles)
    const sources = [`History: ${safeText(stats.source || record(record(view.result).meta).source || '--')}`,
      ...(stats.priceSource ? [`Quote: ${safeText(stats.priceSource)} · ${safeText(stats.priceBasis || '--')} · ${safeText(stats.changeBasis || '--')}`] : [])]
    body = [
      `${safeText(view.request?.symbol)} ${safeText(stats.currency)}  ${safeText(view.request?.range)} / ${safeText(view.request?.interval)}  [s Symbol] [t Timeframe] [c Style]`,
      ...(candles.length ? renderChart(candles, width, Math.max(1, room - 1 - sources.length), chart) : [view.loading ? 'Loading price history… Other workspaces remain available.' : 'No chart data. Press s to choose a ticker, or Space for actions.']),
      ...sources,
    ]
  } else if (table && result) {
    const summary = source.operation === 'portfolio' && !view.section ? portfolioSummary(result, { quotes: portfolioQuotes, portfolioId }) : []
    const section = tables.length > 1 ? ['Section ' + ((view.section ?? 0) + 1) + '/' + tables.length + ' | [ / ] switch sections'] : []
    body = [...summary, ...section, ...renderTable(table, selected, width, Math.max(1, room - summary.length - section.length))]
  } else {
    const lines = wrapLines(view.name === 'Settings' ? settings() : result ? ['No tabular records returned. Press d for full response data.'] : source.error ? ['This page could not load. Press r to retry; Settings has diagnostics.'] : view.lines.length ? view.lines : [source.loading ? 'Loading data… Other workspaces remain available.' : 'No records returned. Space opens actions.'], width)
    scroll = Math.min(scroll, Math.max(0, lines.length - room))
    body = lines.slice(scroll, scroll + room)
  }
  const siblings = views.filter(item => item.workspace === view.workspace)
  const tabs = siblings.map(item => item === view ? `[${item.name}]` : item.name).join('  ')
  const shortTabs = siblings.map(item => item === view ? `[${item.name}]` : item.name.slice(0, 3)).join(' ')
  const rows = [
    ` BT / ${view.workspace} / ${view.name}${width >= 90 ? '    p: pages  w: workspaces  Space: actions' : ''}`,
    tabs.length <= width ? tabs : shortTabs.length <= width ? shortTabs : `← ${views[(active + views.length - 1) % views.length].name}  [${view.name}]  ${views[(active + 1) % views.length].name} →`,
    '─'.repeat(width),
    ...body.slice(0, room),
  ]
  while (rows.length < height - 2) rows.push('')
  rows.push(command !== undefined ? `> ${safeText(command).slice(-Math.max(1, width - 2))}` : '─'.repeat(width), command !== undefined ? 'Enter apply · Esc cancel · Backspace edit' : menu ? '↑↓ choose · Space select · ← back · Type filter' : detailOpen ? '↑↓ scroll · Esc back · Space actions' : view === charts && chart.inspect ? 'INSPECT ←→ candle · ↑↓ zoom · Esc workspaces · Space actions' : '←→ pages · ↑↓ rows/scroll · Space actions · Enter detail/inspect · q quit')
  output.write('\x1b[H\x1b[2J' + rows.slice(0, height).map((row, index) => index === 0 ? `\x1b[1;38;2;47;111;208m${clip(row, width)}\x1b[0m` : clip(row, width)).join('\r\n'))
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
    { label: sourceView(views[active]).operation ? 'Refresh this workspace' : 'Refresh data workspaces', activate: () => {
      menus.length = 0
      if (sourceView(views[active]).operation) void load(sourceView(views[active]))
      else for (const view of views) if (view.operation && !view.sourceId) void load(view)
    } },
    { label: 'Quotes - choose ticker', activate: () => selectTicker('quote') },
    { label: 'Company research - choose ticker', activate: () => selectTicker('stock') },
    { label: 'Browse research services', activate: serviceMenu },
    { label: 'Chart a ticker', activate: () => selectTicker('chart') },
    { label: 'Type a ticker for chart…', activate: () => { menus.length = 0; command = 'chart ' } },
    ...(tableFor(views[active])?.rows[selected] ? [{ label: 'Open selected record details', activate: () => { menus.length = 0; detailOpen = true; responseOpen = false; scroll = 0 } }] : []),
    ...(tableFor(views[active])?.rows[selected]?.symbol ? [{ label: 'Chart selected ticker', activate: () => {
      const symbol = tableFor(views[active])!.rows[selected].symbol!
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
    { label: 'Find a desktop page', activate: () => pageMenu() },
    { label: 'Choose a workspace', activate: workspaceMenu },
    { label: 'Filter rows / dictionary terms', activate: () => { menus.length = 0; command = 'find ' } },
    ...(views[active].request?.symbol && views[active] !== charts ? [{ label: 'Change this page ticker', activate: () => { menus.length = 0; command = 'symbol ' } }] : []),
    ...(sourceView(views[active]).operation === 'portfolio' ? [{ label: 'Choose a saved portfolio', activate: portfolioMenu }] : []),
    { label: 'Return to content', activate: () => { menus.length = 0 } },
    { label: 'Quit Budget Terminal TUI', activate: close },
  ])
}

async function load(view: View, request?: Record<string, unknown>) {
  if (!view.operation || (view.loading && !request)) return
  if (request) {
    view.request = request; view.result = undefined; view.lines = []; view.section = 0
    if (sourceView(views[active]) === view) { selected = 0; scroll = 0 }
  }
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
      const tickers = [...new Set(array(record(record(result).data).portfolios).flatMap(book => array(record(book).tickers)).filter((ticker): ticker is string => typeof ticker === 'string' && /^[A-Za-z0-9.^=:_-]{1,30}$/.test(ticker)))]
      for (const ticker of tickers) knownSymbols.add(ticker.toUpperCase())
      if (view.id === 'portfolio') loadPortfolioFeeds(result)
      draw()
      const quotes = tickers.length ? await invokeBridge('budget_terminal_quotes', { request: { holdings: tickers } }, { signal: AbortSignal.any([controller.signal, view.abort.signal]), timeoutMs: 120_000 }) : undefined
      if (closed || revision !== view.revision) return
      portfolioQuotes = quotes
      const quoteMeta = record(record(quotes).meta)
      if (['failed', 'partial', 'stale'].includes(String(quoteMeta.freshness))) view.error = `Portfolio marks ${quoteMeta.freshness}; see Settings.`
    }

    if (closed || revision !== view.revision) return
    const envelope = result as { meta?: { freshness?: string }; errors?: unknown }
    if (envelope.meta?.freshness === 'failed' || envelope.meta?.freshness === 'partial' || envelope.meta?.freshness === 'stale') view.error = `Data ${envelope.meta.freshness}; see response details.`
    if (view === charts) chart.cursor = Math.max(0, chartCandles(record(record(result).data).candles).length - 1)
    view.updated = new Date().toLocaleTimeString()
  } catch (error) {
    if (closed || revision !== view.revision) return
    view.error = safeText(error instanceof Error ? error.message : error)
    if (view.id === 'portfolio') loadPortfolioFeeds(view.result)
    view.lines = [...view.lines, '', `Request failed: ${view.error}`, 'Press Space and choose Refresh to retry. Check Settings for connection details.']
  } finally { if (revision === view.revision) view.loading = false; draw() }
}

async function runCommand(text: string) {
  const [verb, ...args] = text.trim().split(/\s+/)
  const current = views[active]
  if (verb === 'find') { current.filter = args.join(' '); selected = 0; draw(); return }
  if (verb === 'symbol' && current.request?.symbol) {
    const symbol = (args[0] || '').toUpperCase()
    if (/^[A-Z0-9.^=:_-]{1,30}$/.test(symbol)) { knownSymbols.add(symbol); await load(current, { ...current.request, symbol }) }
    else { command = 'symbol '; draw() }
    return
  }
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
    research.error = undefined
    if (verb === 'tools') {
      research.result = undefined
      research.operation = undefined
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
  console.log('BT: desktop workspaces, portfolio valuations, data tables and charts. p finds pages; w chooses a workspace; b chooses a portfolio; [ / ] changes data sections. Arrows navigate; Space actions; Enter details. Charts: s ticker, t timeframe, c style, Enter inspect, +/- zoom. / commands: chart AAPL, quote AAPL MSFT, stock AAPL. q quits.')
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
    else if (text === 'r' || key.name === 'f5') void load(sourceView(view))
    else if (text === 'p') pageMenu()
    else if (text === 'w') workspaceMenu()
    else if (text === 'f') command = 'find '
    else if (text === 's' && view !== charts && view.request?.symbol) command = 'symbol '
    else if (text === 'b' && sourceView(view).operation === 'portfolio') portfolioMenu()
    else if (text === '[' || text === ']') {
      const count = tablesFor(view).length
      if (count) view.section = ((view.section ?? 0) + (text === ']' ? 1 : count - 1)) % count
      selected = 0; scroll = 0; detailOpen = false
    }
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
    else if (!detailOpen && tableFor(view)) {
      const maximum = Math.max(0, tableFor(view)!.rows.length - 1)
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
  const portfolio = views.find(view => view.id === 'portfolio')!
  const dependentPages = ['news', 'calendar', 'youtube']
  void load(portfolio)
  for (const view of views) if (view.operation && !view.sourceId && view !== portfolio && !dependentPages.includes(view.id)) void load(view)
}
