import type { EconomicPoint } from '../shared/contract.js'

export function parseFredCsv(text: string): EconomicPoint[] {
  const points = new Map<string, number>()
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [rawDate, rawValue] = line.split(',').map((part) => part.trim().replace(/^"|"$/g, ''))
    if (!rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || !rawValue || rawValue === '.') continue
    const value = Number(rawValue)
    if (Number.isFinite(value) && Number.isFinite(Date.parse(rawDate))) points.set(rawDate, value)
  }
  return [...points.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export async function fetchSeriesCsv(seriesId: string, timeoutMs = 15_000): Promise<EconomicPoint[]> {
  const identifier = seriesId.trim().toUpperCase()
  if (!identifier) return []
  if (!/^[A-Z0-9_]+$/.test(identifier)) throw new Error('Invalid FRED series identifier')
  const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${identifier}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'BudgetTerminalElectron/0.1 (personal finance research tool)', Accept: 'text/csv' },
  })
  if (!response.ok) throw new Error(`FRED HTTP ${response.status}`)
  return parseFredCsv(await response.text())
}
