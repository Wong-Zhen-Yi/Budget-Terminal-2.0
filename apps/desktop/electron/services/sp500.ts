import type { Envelope } from '../shared/contract.js'
import { failed, ok, partial, describeError } from '../shared/envelope.js'
import { addBreadth, emptyBreadth, SP500_SECTORS, symbolKey, type Sp500Data, type Sp500Request,
  type Sp500Point, type Sp500Value, type Sp500Breadth, type Sp500BreadthRequest } from '../shared/sp500.js'
import { cache } from './cache.js'
import { getEtfHoldings } from './etf/holdings.js'
import { textOf } from './etf/html.js'
import { loadConstituents, CONSTITUENTS_URL } from './sp500Constituents.js'
import { paced, yahoo } from './yahoo/client.js'
import { getYahooSeries } from './yahoo/series.js'

export const SPY_URL = 'https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy'
const HOURS6 = 6 * 60 * 60_000
const nowIso = () => new Date().toISOString()
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

// Yahoo daily bars can include the active session. Its exchange close handles early-close days.
export function completedPoints(rows: { date: Date; close?: number | null; adjclose?: number | null }[], adjusted: boolean,
  now = new Date(), regularEnd?: number): Sp500Point[] {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(now))
  const closed = regularEnd ? now.getTime() >= regularEnd * 1000 + 60_000 : hour >= 17
  const dates = new Map<string, number>()
  for (const row of rows) {
    const date = row.date.toISOString().slice(0, 10)
    const close = finite(adjusted ? row.adjclose : row.close)
    if (date > today || (date === today && !closed) || close == null || close <= 0) continue
    dates.set(date, close)
  }
  return [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }))
}
export function loadSp500History(symbol: string, force = false, breadth = false) {
  return cache.resolveWithStaleFallback(`sp500:history:${symbol}:${breadth ? 'breadth' : 'dashboard'}`, HOURS6, async () => {
    const result = await getYahooSeries({
      symbol,
      start: new Date(Date.now() - (breadth ? 550 : 2300) * 86400_000),
      interval: '1d',
      force,
      variant: symbol === '^GSPC' ? 'ohlcv' : 'adjusted',
    })
    const trading = result.meta as { currentTradingPeriod?: { regular?: { end?: number | Date } } } | undefined
    const end = trading?.currentTradingPeriod?.regular?.end
    const points = completedPoints(result.rows.map((row) => ({
      date: new Date(row.time * 1000),
      close: row.close,
      adjclose: row.adjclose,
    })), symbol !== '^GSPC', new Date(), end instanceof Date ? end.getTime() / 1000 : end)
    if (points.length < 2) throw new Error(`No completed ${symbol} history.`)
    return points
  }, { force })
}

export function parseSp500Valuation(html: string): Sp500Value[] {
  // Restrict each metric to a characteristics section: the page also carries glossary definitions.
  const sections = [...html.matchAll(/(?:(?:Fund|Index) Characteristics|<h2\b[^>]*>\s*Yields)[\s\S]*?<\/table>/gi)].map((match) => match[0])
  const specs = [
    ['Price/Earnings Ratio FY1', 'Forward P/E (FY1)', 'ratio', 'Weighted harmonic average of price divided by forecast one-year earnings per share.'],
    ['Price/Book Ratio', 'Price / book', 'ratio', 'Published weighted price-to-book ratio.'],
    ['Index Dividend Yield', 'Index dividend yield', 'percent', 'Weighted indicated annual dividend divided by price; not the fund distribution or SEC yield.'],
  ] as const
  return specs.map(([sourceLabel, label, unit, definition]) => {
    for (const section of sections) {
      const basis = sourceLabel === 'Index Dividend Yield' || /^Index/i.test(section) ? 'Index characteristics' : 'SPY fund characteristics (proxy)'
      const asOf = textOf(section.split(/<table/i)[0]).match(/as of\s+(.+?)(?:$|Fund|Index)/i)?.[1]?.trim() ?? ''
      for (const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => textOf(cell[1]))
        if (!cells[0]?.includes(sourceLabel)) continue
        const raw = cells.at(-1)?.replace(/[%,$\s]/g, '') ?? ''
        const value = raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null
        return { label, value, unit, asOf, basis, definition }
      }
    }
    return { label, value: null, unit, asOf: '', basis: 'Unavailable', definition }
  })
}

export async function getSp500(request: Sp500Request): Promise<Envelope<Sp500Data>> {
  const { part, force = false } = request
  const data: Sp500Data = { asOf: '', source: '', warnings: [] }
  const sources = { constituents: CONSTITUENTS_URL, market: 'Yahoo Finance', history: 'Yahoo Finance', holdings: SPY_URL, valuation: SPY_URL }
  data.source = sources[part] ?? 'S&P500'
  try {
    if (part === 'constituents') {
      const result = await loadConstituents(force)
      data.constituents = result.value.rows
      data.asOf = result.value.asOf
      if (result.stale) data.warnings.push('Wikipedia refresh failed; showing stale constituents.')
    } else if (part === 'holdings') {
      const result = await getEtfHoldings('SPY', force, false)
      data.holdings = { rows: result.holdings, partial: result.isPartial }
      data.asOf = result.asOfDate
      data.source = result.sourceUrl || SPY_URL
      if (result.isPartial) data.warnings.push(result.coverageNote || 'Only partial holdings are available.')
      const cached = cache.get('etf-holdings:SPY', { allowStale: true })
      if (cached && cached.ageSeconds * 1000 > HOURS6) data.warnings.push('Holdings refresh failed; showing stale holdings.')
    } else if (part === 'market') {
      const result = await cache.resolveWithStaleFallback('sp500:market', 60_000, async () => {
        const quotes = await paced(() => yahoo.quote(['^GSPC', '^VIX']))
        return quotes.map((quote) => ({ symbol: quote.symbol, price: finite(quote.regularMarketPrice),
          change: finite(quote.regularMarketChangePercent), asOf: quote.regularMarketTime?.toISOString() ?? '' }))
      }, { force })
      data.market = result.value
      data.asOf = result.value.find((row) => row.symbol === '^GSPC')?.asOf ?? ''
      if (result.stale) data.warnings.push('Market refresh failed; showing stale quotes.')
    } else if (part === 'history') {
      data.history = {}
      const symbols = ['^GSPC', 'SPY', 'RSP', ...SP500_SECTORS.map(([symbol]) => symbol)]
      // The shared rate gate bounds Yahoo concurrency; independent failures keep other charts usable.
      const results = await Promise.allSettled(symbols.map((symbol) => loadSp500History(symbol, force)))
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          data.history![symbols[index]] = result.value.value
          if (result.value.stale) data.warnings.push(`${symbols[index]}: stale history.`)
        } else data.warnings.push(`${symbols[index]}: ${describeError(result.reason)}`)
      })
      data.asOf = data.history['^GSPC']?.at(-1)?.date ?? ''
    } else if (part === 'valuation') {
      const result = await cache.resolveWithStaleFallback('sp500:valuation', 24 * 60 * 60_000, async () => {
        const response = await fetch(SPY_URL, { headers: { 'User-Agent': 'BudgetTerminal/2.0' }, signal: AbortSignal.timeout(25_000) })
        if (!response.ok) throw new Error(`State Street HTTP ${response.status}`)
        const values = parseSp500Valuation(await response.text())
        if (values.every((value) => value.value == null)) throw new Error('State Street characteristics could not be read.')
        return values
      }, { force })
      data.valuation = result.value
      data.asOf = result.value.find((row) => row.asOf)?.asOf ?? ''
      if (result.stale) data.warnings.push('Valuation refresh failed; showing stale characteristics.')
    } else throw new Error('Unknown S&P500 data section.')
    return data.warnings.length ? partial(data, data.warnings.map((reason) => ({ source: data.source, reason, operation: part })), data.source)
      : ok(data, data.source)
  } catch (error) { return failed(data, describeError(error), data.source) }
}

export class Sp500BreadthScanner {
  private scan: Sp500Breadth = { id: '', state: 'idle', completed: 0, total: 0, failed: 0, startedAt: '', completedAt: '', result: null, error: '' }
  constructor(private readonly constituents = loadConstituents, private readonly history = loadSp500History) {}
  read(request: Sp500BreadthRequest): Sp500Breadth {
    if (request.action === 'cancel' && request.id === this.scan.id && this.scan.state === 'running') {
      this.scan.state = 'cancelled'
      this.scan.completedAt = nowIso()
    }
    if (request.action === 'start' && this.scan.state !== 'running') {
      const fresh = this.scan.state === 'complete' && Date.now() - Date.parse(this.scan.completedAt) < HOURS6
      if (!fresh || request.force) {
        this.scan = { id: crypto.randomUUID(), state: 'running', completed: 0, total: 0, failed: 0,
          startedAt: nowIso(), completedAt: '', result: null, error: '' }
        void this.run(this.scan, request.force ?? false)
      }
    }
    return structuredClone(this.scan)
  }
  private async run(scan: Sp500Breadth, force: boolean): Promise<void> {
    try {
      const [constituents, index] = await Promise.all([this.constituents(force), this.history('^GSPC', force)])
      if (scan.state !== 'running') return
      if (index.stale || constituents.stale) throw new Error('A fresh index session and constituent list are required for a breadth scan.')
      const sessions = index.value.map((row) => row.date)
      const result = emptyBreadth(sessions.at(-1)!, constituents.value.rows.length)
      scan.total = result.total
      scan.result = result
      let next = 0
      const worker = async () => {
        while (scan.state === 'running' && next < scan.total) {
          const row = constituents.value.rows[next++]
          try {
            const history = await this.history(symbolKey(row.symbol), force, true)
            if (scan.state !== 'running') return
            if (history.stale) scan.failed++
            else addBreadth(result, history.value, sessions)
          } catch { if (scan.state !== 'running') return; scan.failed++ }
          scan.completed++
        }
      }
      await Promise.all([worker(), worker(), worker()])
      if (scan.state === 'running') { scan.state = 'complete'; scan.completedAt = nowIso() }
    } catch (error) {
      if (scan.state === 'running') { scan.state = 'failed'; scan.error = describeError(error); scan.completedAt = nowIso() }
    }
  }
}
const breadth = new Sp500BreadthScanner()
export async function getSp500Breadth(request: Sp500BreadthRequest): Promise<Envelope<Sp500Breadth>> {
  const result = breadth.read(request)
  return result.state === 'failed' ? failed(result, result.error, 'Yahoo Finance / current Wikipedia constituents') : ok(result, 'Yahoo Finance / current Wikipedia constituents')
}
