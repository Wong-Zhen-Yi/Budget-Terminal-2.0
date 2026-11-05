import type { Key } from 'node:readline'
import type { Candle, ChartsInterval, PortfolioPayload, Quote } from '../electron/shared/contract.js'
import { buildPositionRows, summarizePortfolio } from '../electron/shared/portfolioMath.js'
import { candleColors, candlesticks, validCandles } from './candlesticks.js'
import { createAgentsPanel } from './agents.js'
import type { AgentsFactory } from './agents.js'

export interface TuiHistory {
  candles: Candle[]
  source: string
  currency: string
  stale: boolean
}

const intervals: ChartsInterval[] = ['1 Hour', '1 Day', '1 Week']

export interface PortfolioServices {
  read: () => Promise<PortfolioPayload>
  quotes: (symbols: string[], force: boolean) => Promise<{ quotes: Record<string, Quote>; staleCount: number; missing: string[] }>
  history: (symbol: string, interval: ChartsInterval, force: boolean) => Promise<TuiHistory>
  close: () => void
}

async function services(): Promise<PortfolioServices> {
  const store = await import('../electron/services/portfolioStore.js')
  const provider = await import('../electron/services/yahoo/quotes.js')
  const charts = await import('../electron/services/yahoo/chartsPage.js')
  const { cache } = await import('../electron/services/cache.js')
  return {
    read: () => { store.resetStoreCache(); return store.readPortfolios() },
    quotes: provider.getQuotes,
    history: async (symbol, interval, force) => {
      const result = await charts.getChartsHistory({ symbol, interval, range: interval === '1 Hour' ? '3M' : interval === '1 Week' ? '5Y' : '1Y', force })
      return {
        candles: result.payload.candles,
        source: result.payload.stats?.market ? `Hyperliquid ${result.payload.stats.market} perpetual` : 'Yahoo stock history',
        currency: result.payload.stats?.currency || 'USD',
        stale: result.stale,
      }
    },
    close: () => { void cache.close() },
  }
}

// Saved labels must never inject terminal control sequences.
const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
const number = (value: number | null) => value === null || !Number.isFinite(value)
  ? '--' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function startPortfolioTui(provided?: PortfolioServices, agentsFactory?: AgentsFactory) {
  const input = process.stdin
  const output = process.stdout
  const wasRaw = input.isRaw
  let closed = false
  let agentsVisible = false
  const agents = createAgentsPanel(draw, agentsFactory)
  let backend = provided
  let payload: PortfolioPayload | undefined
  let quotes: Record<string, Quote> = {}
  let selectedId: string | null = null
  let offset = 0
  let obscure = false
  let options = false
  let chart = false
  let tickerIndex = 0
  let intervalIndex = 1
  let barLimit = 40
  const histories = new Map<string, TuiHistory>()
  const pending = new Set<string>()
  const chartErrors = new Set<string>()
  let loading = false
  let message = ''
  let updated = ''
  const numeric = (value: number | null) => obscure ? '****' : number(value)

  const currentPortfolio = () => payload?.portfolios.find(item => item.id === selectedId)
  const chartKey = (symbol: string, interval: ChartsInterval) => `${symbol}:${interval}`

  async function loadHistory(symbol: string, interval: ChartsInterval, force = false) {
    if (!backend || closed) return
    const key = chartKey(symbol, interval)
    if (pending.has(key) || (!force && (histories.has(key) || chartErrors.has(key)))) return
    pending.add(key)
    chartErrors.delete(key)
    draw()
    try {
      const history = await backend.history(symbol, interval, force)
      if (!closed) histories.set(key, { ...history, candles: validCandles(history.candles) })
    } catch {
      if (!closed) chartErrors.add(key)
    } finally {
      pending.delete(key)
      draw()
    }
  }

  function loadSelectedChart() {
    const tickers = currentPortfolio()?.tickers ?? []
    tickerIndex = Math.max(0, Math.min(tickerIndex, tickers.length - 1))
    if (tickers[tickerIndex]) void loadHistory(tickers[tickerIndex], intervals[intervalIndex])
  }

  function draw() {
    if (closed) return
    const width = Math.max(1, output.columns || 80)
    const height = Math.max(1, output.rows || 24)
    if (agentsVisible) {
      output.write('\x1b[48;2;8;11;18m\x1b[38;2;213;222;233m\x1b[H\x1b[2J' + agents.render(width, height).join('\r\n'))
      return
    }
    const portfolio = payload?.portfolios.find(item => item.id === selectedId)
    const lines = ['BT TUI  |  Portfolio  [F2/A] Agents', '[Left/Right] portfolio  [R] refresh  [H] hide/reveal', chart ? '[C] table [Up/Down] ticker [1/2/3] hour/day/week [+/-] zoom [Q] exit' : '[C] candles  [Tab] holdings/options  [Up/Down] rows  [Q] exit', '']
    if (portfolio) {
      const index = payload!.portfolios.indexOf(portfolio)
      lines.push(`${index + 1}/${payload!.portfolios.length}  ${clean(portfolio.name)}${portfolio.readOnly ? ' (combined)' : ''}  |  USD`)
      const rows = buildPositionRows(portfolio, quotes)
      const summary = summarizePortfolio(portfolio, rows)
      lines.push(`Net value ${numeric(summary.complete ? summary.total : null)}   Stock P&L ${numeric(summary.complete ? summary.stockPnl : null)}`)
      lines.push(`Cash ${numeric(portfolio.cashBalance)}   Margin ${numeric(portfolio.marginDebt)}   Positions ${obscure ? '****' : rows.length}`)
      lines.push(loading ? 'Refreshing prices...' : message || (updated ? `Prices checked ${updated}` : ''))
      let body: string[]
      if (chart) {
        const symbol = portfolio.tickers[tickerIndex]
        const interval = intervals[intervalIndex]
        const key = chartKey(symbol ?? '', interval)
        const history = histories.get(key)
        lines.push(`CANDLESTICKS  ${clean(symbol ?? 'No holdings')}  |  ${interval}  |  ${clean(history?.currency ?? '')}`)
        if (!symbol) lines.push('Add holdings in the desktop Portfolio page to view charts.')
        else if (!history) lines.push(pending.has(key) ? 'Loading OHLC history...' : 'Chart unavailable. Press R to retry.')
        else {
          lines.push(`${clean(history.source)}${chartErrors.has(key) ? ' | Refresh failed; previous candles' : history.stale ? ' | Saved candles; current history unavailable' : ''}${pending.has(key) ? ' | Refreshing' : ''}`)
          const last = history.candles.at(-1)
          if (last) lines.push(`O ${numeric(last.open)}  H ${numeric(last.high)}  L ${numeric(last.low)}  C ${numeric(last.close)}`)
          lines.push(...candlesticks(history.candles, width - 1, height - lines.length, barLimit, obscure))
        }
        const frame = lines.slice(0, height).map(line => candleColors(clean(line).slice(0, Math.max(0, width - 1))))
        output.write('\x1b[48;2;8;11;18m\x1b[38;2;213;222;233m\x1b[H\x1b[2J' + frame.join('\r\n'))
        return
      } else if (options) {
        lines.push('OPTIONS (saved contracts; no live option marks)', 'Ticker     Strategy     Expiry       Strike  Contracts  Premium  Status')
        body = portfolio.options.map(row => `${clean(row.ticker).padEnd(10)} ${clean(row.strategy).padEnd(12)} ${clean(row.expiry).padEnd(10)} ${numeric(row.strike).padStart(8)} ${numeric(row.contracts).padStart(9)} ${numeric(row.premium).padStart(8)} ${clean(row.status)}`)
      } else {
        lines.push('HOLDINGS  (* excluded from allocation/totals)')
        const wide = width >= 110
        lines.push(wide ? 'Ticker         Shares     Avg cost        Price     Value USD      P&L USD    Day %  Weight %' : 'Ticker         Shares        Price     Value USD      P&L USD')
        body = rows.map(row => {
          const ticker = clean(row.ticker) + (row.includeInWeight ? '' : '*')
          return wide
            ? `${ticker.padEnd(11)} ${numeric(row.shares).padStart(9)} ${numeric(row.avgPrice).padStart(12)} ${numeric(row.price).padStart(12)} ${numeric(row.marketValue).padStart(13)} ${numeric(row.dollarGain).padStart(12)} ${numeric(row.changePercent).padStart(8)} ${numeric(row.weight).padStart(9)}`
            : `${ticker.padEnd(11)} ${numeric(row.shares).padStart(9)} ${numeric(row.price).padStart(12)} ${numeric(row.marketValue).padStart(13)} ${numeric(row.dollarGain).padStart(12)}`
        })
        const sources = [...new Set(rows.map(row => row.priceSource).filter(Boolean))]
        lines[7] += sources.length ? ` | ${sources.join(', ')}` : ''
      }
      if (!body.length) body = [options ? 'No option contracts saved.' : 'No holdings yet. Add positions in the desktop Portfolio page.']
      const available = Math.max(1, height - lines.length - 1)
      offset = Math.max(0, Math.min(offset, body.length - available))
      lines.push(...body.slice(offset, offset + available))
      if (body.length > available) lines.push(`Rows ${offset + 1}-${Math.min(body.length, offset + available)} of ${body.length}`)
    } else {
      lines.push(loading ? 'Opening saved portfolios...' : message || 'No portfolios available. Press R to retry.')
    }
    const frame = lines.slice(0, height).map(line => clean(line).slice(0, Math.max(0, width - 1)))
    output.write('\x1b[48;2;8;11;18m\x1b[38;2;213;222;233m\x1b[H\x1b[2J' + frame.join('\r\n'))
  }

  async function refresh(force = false) {
    if (loading || closed) return
    loading = true
    message = ''
    draw()
    try {
      backend ??= await services()
      if (closed) { backend.close(); return }
      const next = await backend.read()
      if (closed) return
      payload = next
      if (!next.portfolios.some(item => item.id === selectedId)) selectedId = next.activeId ?? next.portfolios[0]?.id ?? null
      if (!next.portfolios.some(item => item.id === selectedId)) selectedId = next.portfolios[0]?.id ?? null
      draw()
      // Warm all saved portfolios before the user switches to them.
      const symbols = [...new Set(next.portfolios.flatMap(item => item.tickers))]
      // The chart page warms at startup, independently of quote availability.
      for (const symbol of symbols) void loadHistory(symbol, '1 Day', force)
      if (chart && intervals[intervalIndex] !== '1 Day') {
        const symbol = currentPortfolio()?.tickers[tickerIndex]
        if (symbol) void loadHistory(symbol, intervals[intervalIndex], force)
      }
      const result = await backend.quotes(symbols, force)
      if (closed) return
      quotes = result.quotes
      message = [result.missing.length ? `${result.missing.length} price(s) unavailable; -- means unknown.` : '', result.staleCount ? `${result.staleCount} saved price(s); current marks unavailable.` : ''].filter(Boolean).join(' ')
      updated = new Date().toLocaleTimeString()
    } catch {
      // Raw provider errors can contain request URLs and local paths.
      message = payload ? 'Refresh failed. Showing previous prices. Press R to retry.' : 'Could not open saved portfolios. Press R to retry.'
    } finally {
      loading = false
      draw()
    }
  }

  function close() {
    if (closed) return
    closed = true
    input.off('keypress', keypress)
    output.off('resize', draw)
    process.off('SIGINT', close)
    process.off('SIGTERM', close)
    process.off('exit', close)
    input.setRawMode(Boolean(wasRaw))
    input.pause()
    output.write('\x1b[0m\x1b[?25h\x1b[?1049l')
    // Flush the chat before ending the process, including interrupted run details.
    const saving = agents.close().finally(() => backend?.close())
    if (!provided) {
      const deadline = setTimeout(() => process.exit(1), 5000)
      void saving.then(() => { clearTimeout(deadline); process.exit(0) }, () => {
        clearTimeout(deadline)
        process.stderr.write('Agents history could not be saved. Check local storage before reopening.\n')
        process.exit(1)
      })
    } else void saving.catch(() => {})
  }

  function keypress(_text: string | undefined, key: Key) {
    if (key.ctrl && key.name === 'c') { close(); return }
    if (key.name === 'f1') { agentsVisible = false; draw(); return }
    if (key.name === 'f2' || (!agentsVisible && key.name === 'a')) { agentsVisible = true; draw(); return }
    if (agentsVisible) { agents.keypress(_text, key); return }
    if (key.name === 'q') { close(); return }
    if (key.name === 'r') { void refresh(true); return }
    if (key.name === 'h') obscure = !obscure
    if (key.name === 'c') { chart = !chart; if (chart) loadSelectedChart() }
    if (key.name === 'tab') { chart = false; options = !options; offset = 0 }
    if (key.name === 'up') { if (chart) tickerIndex -= 1; else offset -= 1 }
    if (key.name === 'down') { if (chart) tickerIndex += 1; else offset += 1 }
    if (chart && ['1', '2', '3'].includes(key.name ?? '')) intervalIndex = Number(key.name) - 1
    if (chart && (_text === '+' || _text === '=')) barLimit = Math.max(5, Math.min(barLimit, Math.floor(((output.columns || 80) - 14) / 2)) - 5)
    if (chart && _text === '-') barLimit = Math.min(200, barLimit + 5)
    if ((key.name === 'left' || key.name === 'right') && payload?.portfolios.length) {
      const count = payload.portfolios.length
      const index = payload.portfolios.findIndex(item => item.id === selectedId)
      selectedId = payload.portfolios[(index + (key.name === 'left' ? -1 : 1) + count) % count].id
      offset = 0
      tickerIndex = 0
    }
    if (chart) loadSelectedChart()
    draw()
  }

  input.setRawMode(true)
  input.on('keypress', keypress)
  output.on('resize', draw)
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
  process.on('exit', close)
  input.resume()
  output.write('\x1b[?1049h\x1b[?25l')
  void refresh()
  void agents.start()
  return { close }
}
