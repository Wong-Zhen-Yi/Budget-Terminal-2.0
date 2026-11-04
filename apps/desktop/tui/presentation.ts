import { describe, safeText, wrapLines } from './model.js'

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
  const date = new Date(typeof value === 'number' || typeof value === 'string' ? value : NaN)
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

export function dataTable(operation: string | undefined, result: unknown): DataTable | undefined {
  const data = record(record(result).data)
  if (operation === 'portfolio') {
    const portfolios = array(data.portfolios).map(record)
    const rows = portfolios.flatMap(portfolio => {
      const positions = Object.values(record(portfolio.holdings)).map(record)
      return positions.length ? positions.map(position => ({
        cells: [safeText(position.ticker), safeText(portfolio.name), number(position.shares, 4), number(position.avgPrice), number(typeof position.shares === 'number' && typeof position.avgPrice === 'number' ? position.shares * position.avgPrice : null)],
        symbol: safeText(position.ticker), detail: { portfolio: portfolio.name, ...position, cashBalance: portfolio.cashBalance, marginDebt: portfolio.marginDebt, options: portfolio.options },
      })) : [{ cells: ['--', safeText(portfolio.name), '--', '--', '--'], detail: portfolio }]
    })
    return { title: `${portfolios.length} portfolios · ${rows.filter(row => row.cells[0] !== '--').length} positions · Cost excludes cash/options; no live valuation implied`, columns: ['TICKER', 'PORTFOLIO', 'SHARES', 'AVG COST', 'COST BASIS'], sizes: [9, 20, 13, 13, 15], rows }
  }
  if (operation === 'quotes') {
    const rows = Object.values(record(data.holdings)).map(record).map(quote => ({
      cells: [safeText(quote.symbol), number(quote.price), percent(quote.change), safeText(quote.currency), quote.priceBasis === 'equity-perp-mark' ? 'PERP / 24h' : 'STOCK / close'], symbol: safeText(quote.symbol), detail: quote,
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
  return undefined
}

function detailLines(value: unknown): string[] {
  const item = record(value)
  return Object.entries(item).flatMap(([key, entry]) => {
    if (/token|password|secret|api.?key|authorization|cookie|sourcePath/i.test(key)) return []
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
  return [...lines, `DETAIL ${selected + 1}/${table.rows.length} · Space: full detail / chart`, ...wrapLines(detail.slice(0, 3), width)].slice(0, height)
}

export function compactDetail(result: unknown, width: number): string[] {
  const data = record(record(result).data)
  return wrapLines(detailLines(data), width)
}
