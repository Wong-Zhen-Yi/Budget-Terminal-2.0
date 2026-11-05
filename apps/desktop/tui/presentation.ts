import { describe, privateField, safeText, wrapLines } from './model.js'
import type { Portfolio, Quote } from '../electron/shared/contract.js'
import { buildPositionRows, summarizePortfolio } from '../electron/shared/portfolioMath.js'

export type RecordValue = Record<string, unknown>
export interface DataRow { cells: string[]; detail: unknown; symbol?: string }
export interface DataTable { title: string; columns: string[]; sizes: number[]; rows: DataRow[] }
export function record(value: unknown): RecordValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {} }
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
export function number(value: unknown, decimals = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }) : '--'
}
function percent(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${number(value)}%` : '--' }
export function clip(text: unknown, width: number): string {
  const chars = Array.from(safeText(text))
  return chars.length > Math.max(0, width) ? chars.slice(0, Math.max(0, width - 1)).join('') + (width > 0 ? '…' : '') : chars.join('')
}
function pad(text: unknown, width: number): string { return clip(text, width).padEnd(width) }
export function dateText(value: unknown): string {
  const date = new Date(typeof value === 'number' ? Math.abs(value) < 100_000_000_000 ? value * 1000 : value : typeof value === 'string' ? value : NaN)
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '--'
}

export function envelopeLines(result: unknown): string[] {
  const envelope = record(result)
  const meta = record(envelope.meta)
  return [
    `Source: ${safeText(meta.source || '--')}  |  ${safeText(meta.freshness || '--')}`,
    `Fetched: ${dateText(meta.fetchedAt)}${meta.asOf ? `  Observation: ${dateText(meta.asOf)}` : ''}`,
    ...(meta.failureReason ? [`Warning: ${safeText(meta.failureReason)}`] : []),
    ...array(envelope.errors).map(error => { const item = record(error); return `${safeText(item.source || 'Warning')}: ${safeText(item.reason || error)}` }),
    ...(envelope.response ? describe({ response: envelope.response }) : []),
  ]
}

export interface TableContext { quotes?: unknown; portfolioId?: string }

export function portfolioBook(result: unknown, portfolioId?: string): Portfolio | undefined {
  const data = record(record(result).data)
  const books = array(data.portfolios) as Portfolio[]
  return books.find(book => book.id === (portfolioId ?? data.activeId)) ?? books[0]
}

export function portfolioSummary(result: unknown, context: TableContext = {}): string[] {
  const book = portfolioBook(result, context.portfolioId)
  if (!book) return ['No saved portfolios. Create a portfolio in the desktop app.']
  const quotes = record(record(record(context.quotes).data).holdings) as Record<string, Quote>
  const summary = summarizePortfolio(book, buildPositionRows(book, quotes))
  return [
    `${safeText(book.name)} | ${summary.positionCount} positions | USD | b: choose portfolio`,
    `Net value ${summary.complete ? number(summary.total) : '--'} | Stock P&L ${summary.complete ? number(summary.stockPnl) : '--'} | Cash ${number(book.cashBalance)}${book.includeCashInWeight ? ' counted' : ' excluded'} | Margin ${number(book.marginDebt)}`,
    ...(summary.complete ? [] : [`Missing USD marks: ${summary.missingTickers.join(', ')}. Totals withheld.`]),
    'Equity marks may use PERP / 24h; options are available in full saved-record details.',
  ]
}

export function dataTable(operation: string | undefined, result: unknown, context: TableContext = {}): DataTable | undefined {
  const data = record(record(result).data)
  if (operation === 'dictionary') {
    return { title: 'Offline Dictionary · f: find terms · Enter: read definition and sections', columns: ['TERM', 'CATEGORY', 'DEFINITION'], sizes: [30, 25, 55],
      rows: array(data.entries).map(record).map(entry => ({ cells: [safeText(entry.term), safeText(entry.category), safeText(entry.definition)], detail: entry })),
    }
  }
  if (operation === 'portfolio') {
    const book = portfolioBook(result, context.portfolioId)
    const quotes = record(record(record(context.quotes).data).holdings) as Record<string, Quote>
    const rows = book ? buildPositionRows(book, quotes).map(position => ({
      cells: [position.ticker, number(position.shares, 4), number(position.avgPrice), number(position.price), number(position.marketValue), number(position.dollarGain), percent(position.weight), quotes[position.ticker] ? quoteBasis(record(quotes[position.ticker])) : '--'],
      symbol: position.ticker, detail: { ...position, quote: quotes[position.ticker], portfolio: book.name },
    })) : []
    return { title: 'Stock positions · USD · Weight and P&L use desktop portfolio calculations', columns: ['TICKER', 'SHARES', 'AVG COST', 'MARK', 'VALUE', 'P&L', 'WEIGHT', 'BASIS'], sizes: [9, 11, 11, 11, 13, 12, 9, 16], rows }
  }
  if (operation === 'quotes') {
    const rows = Object.values(record(data.holdings)).map(record).map(quote => ({
      cells: [safeText(quote.symbol), number(quote.price), percent(quote.change), safeText(quote.currency), quoteBasis(quote)], symbol: safeText(quote.symbol), detail: quote,
    }))
    return { title: `${rows.length} quotes${array(data.missing).length ? ` · Missing: ${array(data.missing).map(safeText).join(', ')}` : ''} · Select a row for source / instrument details`, columns: ['TICKER', 'PRICE', 'CHANGE', 'CCY', 'BASIS'], sizes: [10, 15, 12, 6, 18], rows }
  }
  if (operation === 'newsPage') {
    const rows = array(data.articles).map(record).map(article => ({ cells: [safeText(article.ticker), dateText(article.publishedAt).slice(5, 16), safeText(article.title), safeText(article.source)], detail: article }))
    return { title: `${rows.length} headlines · Space opens full article details and source URL`, columns: ['TICKER', 'PUBLISHED UTC', 'HEADLINE', 'SOURCE'], sizes: [10, 14, 48, 20], rows }
  }
  if (operation === 'crypto') {
    const rows = Object.values(record(data.quotes)).map(record).map(quote => ({ cells: [safeText(quote.symbol), number(quote.price), percent(quote.changePct), 'SPOT', number(quote.volume, 0)], detail: quote }))
    for (const item of array(record(data.hyperliquid).markets)) {
      const market = record(item)
      rows.push({ cells: [safeText(market.symbol), number(market.markPrice), percent(market.changePct), 'PERP', number(market.volume24hUsd, 0)], detail: market })
    }
    return { title: `${rows.length} markets · Spot and perpetual instruments remain separate · Volumes USD`, columns: ['SYMBOL', 'PRICE USD', '24H CHANGE', 'TYPE', 'VOLUME'], sizes: [12, 16, 13, 7, 19], rows }
  }
  if (operation === 'personalFinance') {
    const rows: DataRow[] = []
    for (const [key, label] of [['cash', 'Cash'], ['debt', 'Debt'], ['recurringBills', 'Bill']]) {
      for (const entry of array(data[key]).map(record)) rows.push({ cells: [label, safeText(entry.desc), number(entry.amount), safeText(entry.currency || 'SGD'), safeText(entry.frequency || '--')], detail: entry })
    }
    const goal = record(data.goal)
    return { title: goal.title ? `Goal: ${safeText(goal.title)} · ${number(goal.targetAmount)} ${safeText(goal.currency)}` : `${rows.length} finance records · Cash and debt in SGD; bills retain their own currency`, columns: ['TYPE', 'DESCRIPTION', 'AMOUNT', 'CCY', 'FREQUENCY'], sizes: [8, 28, 15, 6, 12], rows }
  }
  if (operation === 'calendarMonth') {
    const rows = ['companyEvents', 'economicEvents', 'marketHolidays'].flatMap(key => array(data[key]).map(record).map(item => ({
      cells: [safeText(item.date), safeText(item.ticker || item.market || 'Economy'), safeText(item.event || item.name), safeText(item.importance || item.detail || '')], detail: item,
    }))).sort((a, b) => a.cells[0].localeCompare(b.cells[0]))
    return { title: `${rows.length} calendar events`, columns: ['DATE', 'TICKER / MARKET', 'EVENT', 'DETAIL'], sizes: [12, 17, 40, 25], rows }
  }
  return undefined
}

function quoteBasis(quote: RecordValue): string {
  return quote.priceBasis === 'equity-perp-mark' ? 'PERP / 24h' : quote.priceBasis === 'published-close' ? 'STOCK / close' : safeText(quote.changeBasis || 'Unspecified')
}

function label(key: string): string { return safeText(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toUpperCase() }

/** Tables for service collections, retaining their own units and original row details. */
export function dataTables(operation: string | undefined, result: unknown, context: TableContext = {}): DataTable[] {
  const dedicated = dataTable(operation, result, context)
  if (dedicated) return [dedicated]
  if (!operation || !result) return []
  const data = record(record(result).data)
  const tables: DataTable[] = []
  const visit = (value: RecordValue, path = '', depth = 0) => {
    for (const [key, entry] of Object.entries(value)) {
      if (privateField(key)) continue
      const title = path ? `${path} / ${label(key)}` : label(key)
      if (Array.isArray(entry) && entry.some(item => item && typeof item === 'object' && !Array.isArray(item))) {
        const items = entry.map(record)
        const keys = [...new Set(items.flatMap(item => Object.keys(item)))].filter(field => !privateField(field) && items.some(item => item[field] !== null && typeof item[field] !== 'object'))
        const priority = ['ticker', 'symbol', 'name', 'title', 'date', 'price', 'lastClose', 'changePct', 'marketCap', 'volume', 'source']
        keys.sort((a, b) => (priority.includes(a) ? priority.indexOf(a) : 100) - (priority.includes(b) ? priority.indexOf(b) : 100))
        const columns = keys.slice(0, 6)
        if (!columns.length) continue
        tables.push({ title: `${title} · ${items.length} records · Enter: complete record`, columns: columns.map(label), sizes: columns.map(field => /name|title/.test(field) ? 32 : 16),
          rows: items.map(item => ({ cells: columns.map(field => typeof item[field] === 'number' ? number(item[field], Number.isInteger(item[field]) ? 0 : 4) : safeText(item[field] ?? '--')), detail: item,
            symbol: typeof (item.ticker ?? item.symbol) === 'string' ? String(item.ticker ?? item.symbol) : undefined })),
        })
      } else if (entry && typeof entry === 'object' && !Array.isArray(entry) && depth < 2) visit(record(entry), title, depth + 1)
    }
  }
  visit(data)
  tables.sort((a, b) => Number(b.title.startsWith('ROWS ')) - Number(a.title.startsWith('ROWS ')))
  const metrics = Object.entries(data).flatMap(([key, value]) => {
    if (privateField(key) || Array.isArray(value)) return []
    const entries = value && typeof value === 'object' ? Object.entries(record(value)).map(([field, entry]) => [`${label(key)} / ${label(field)}`, entry] as const) : [[label(key), value] as const]
    return entries.filter(([field, entry]) => !privateField(field) && (entry === null || typeof entry !== 'object')).map(([field, entry]) => ({ cells: [field, typeof entry === 'number' ? number(entry, Number.isInteger(entry) ? 0 : 4) : safeText(entry ?? '--')], detail: { metric: field, value: entry } }))
  })
  if (metrics.length) tables.push({ title: 'OVERVIEW · Reported units retained in metric names · d: full data', columns: ['METRIC', 'VALUE'], sizes: [40, 45], rows: metrics })
  return tables
}

function detailLines(value: unknown): string[] {
  const item = record(value)
  return Object.entries(item).flatMap(([key, entry]) => {
    if (privateField(key)) return []
    if (entry && typeof entry === 'object') return describe({ [key]: entry })
    const formatted = /^(asOf|publishedAt|fetchedAt|expiresAt)$/.test(key) ? dateText(entry) : typeof entry === 'number' ? number(entry, Number.isInteger(entry) ? 0 : 4) : safeText(entry)
    return [`${key}: ${formatted}`]
  })
}

export function renderTable(table: DataTable, selected: number, width: number, height: number): string[] {
  const side = width >= 112
  const tableWidth = side ? Math.floor(width * 0.63) : width
  const sizes = [...table.sizes]
  while (sizes.reduce((sum, size) => sum + size, 0) + sizes.length * 2 + 2 > tableWidth && Math.max(...sizes) > 5) {
    const index = sizes.indexOf(Math.max(...sizes))
    sizes[index]--
  }
  const rowLine = (cells: string[], prefix = '  ') => prefix + cells.map((cell, index) => pad(cell, sizes[index])).join('  ')
  const room = Math.max(1, height - (side ? 4 : 8))
  const start = Math.max(0, Math.min(selected - Math.floor(room / 2), table.rows.length - room))
  const lines = [clip(table.title, tableWidth), rowLine(table.columns), '─'.repeat(Math.min(tableWidth, sizes.reduce((sum, size) => sum + size, 0) + sizes.length * 2))]
  for (let index = start; index < Math.min(table.rows.length, start + room); index++) lines.push(rowLine(table.rows[index].cells, index === selected ? '› ' : '  '))
  if (!table.rows.length) lines.push('No records returned. Space opens actions.')
  const detail = table.rows[selected] ? detailLines(table.rows[selected].detail) : []
  if (side) {
    const right = ['SELECTED RECORD', ...wrapLines(detail, width - tableWidth - 3)]
    return Array.from({ length: Math.min(height, Math.max(lines.length, right.length)) }, (_, index) => pad(lines[index] || '', tableWidth) + ' │ ' + (right[index] || ''))
  }
  return [...lines, ...(table.rows.length ? [`DETAIL ${selected + 1}/${table.rows.length} · Enter: full detail`, ...wrapLines(detail.slice(0, 3), width)] : [])].slice(0, height)
}

export function compactDetail(result: unknown, width: number): string[] {
  const data = record(record(result).data)
  return wrapLines(detailLines(data), width)
}
