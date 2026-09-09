import { cache } from './cache.js'
import { parseTables, textOf } from './etf/html.js'
import { newestFirst, type Sp500Constituent } from '../shared/sp500.js'

export const CONSTITUENTS_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
export function parseConstituents(html: string): Sp500Constituent[] {
  const clean = html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
  const table = parseTables(clean).find((entry) => /id\s*=\s*["']constituents["']/i.test(entry.openTag))
  if (!table) throw new Error('Wikipedia constituents table was not found.')
  const names = ['symbol', 'security', 'gics sector', 'gics sub-industry', 'headquarters location', 'date added', 'cik', 'founded']
  const indices = names.map((name) => table.headers.indexOf(name))
  if (indices.some((index) => index < 0)) throw new Error('Wikipedia constituent columns changed.')
  const rows = table.rows.map((cells): Sp500Constituent => {
    const values = indices.map((index) => textOf(cells[index] ?? ''))
    const [symbol, security, sector, industry, headquarters, added, cik, founded] = values
    const parsed = Date.parse(added)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(added) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === added ? added : null
    return { symbol, security, sector, industry, headquarters, dateAdded: date, cik, founded }
  }).filter((row) => row.symbol && row.security && row.sector)
  if (!rows.length || new Set(rows.map((row) => row.symbol)).size !== rows.length) throw new Error('Wikipedia constituent rows are empty or duplicated.')
  return newestFirst(rows)
}
export function loadConstituents(force = false) {
  return cache.resolveWithStaleFallback('sp500:constituents', 24 * 60 * 60_000, async () => {
    const response = await fetch(CONSTITUENTS_URL, { headers: { 'User-Agent': 'BudgetTerminal/2.0' }, signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`)
    const rows = parseConstituents(await response.text())
    if (rows.length < 400) throw new Error(`Incomplete Wikipedia table (${rows.length} securities).`)
    return { rows, asOf: new Date().toISOString() }
  }, { force })
}
