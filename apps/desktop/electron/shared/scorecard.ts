import type { FundamentalSeriesPoint, FundamentalsPagePayload } from './contract.js'

export const SCORECARD_MIN_COMPANIES = 3
export const SCORECARD_MAX_COMPANIES = 6
export const SCORECARD_MAX_SAVED = 20
export const DEFAULT_SCORECARD_SYMBOLS = ['AMZN', 'MSFT', 'GOOGL']

export const SCORECARD_METRICS = [
  { key: 'marketCap', label: 'Market cap', format: 'money', basis: 'Latest market snapshot, USD.' },
  { key: 'revenue', label: 'Revenue · FY', format: 'money', basis: 'Revenue for the latest available fiscal year, USD.' },
  { key: 'revenueGrowth', label: 'Revenue growth · YoY', format: 'percent', basis: 'Latest fiscal-year revenue versus the fiscal year ending 330–400 days earlier. A positive prior-year revenue is required.' },
  { key: 'netMargin', label: 'Net margin · FY', format: 'percent', basis: 'Net income divided by positive revenue for the same fiscal year.' },
  { key: 'fcfMargin', label: 'FCF margin · FY', format: 'percent', basis: 'Free cash flow divided by positive revenue for the same fiscal year.' },
  { key: 'fcfYield', label: 'FCF yield · FY', format: 'percent', basis: 'Latest fiscal-year free cash flow divided by the latest positive market cap. Combines annual cash flow with a market snapshot.' },
  { key: 'trailingPe', label: 'P/E · TTM', format: 'multiple', basis: 'Provider-reported trailing-twelve-month P/E. Nonpositive multiples are not meaningful and are hidden.' },
  { key: 'forwardPe', label: 'Forward P/E', format: 'multiple', basis: 'Provider-reported forward P/E based on forecast earnings. Nonpositive multiples are hidden.' },
  { key: 'priceToSales', label: 'Price / sales · TTM', format: 'multiple', basis: 'Provider-reported trailing price-to-sales ratio. Nonpositive multiples are hidden.' },
  { key: 'evEbitda', label: 'EV / EBITDA · TTM', format: 'multiple', basis: 'Latest enterprise value divided by provider-reported EBITDA. Requires positive EBITDA and nonnegative enterprise value.' },
  { key: 'freeCashFlow', label: 'Free cash flow · FY', format: 'money', basis: 'Free cash flow for the same fiscal year as the revenue column, USD.' },
  { key: 'netCash', label: 'Net cash', format: 'money', basis: 'Latest provider-reported cash less total debt, USD. Negative values indicate net debt.' },
  { key: 'beta', label: 'Beta', format: 'multiple', basis: 'Provider-reported beta; estimation windows may vary.' },
] as const

export type ScorecardMetricKey = (typeof SCORECARD_METRICS)[number]['key']
export const DEFAULT_SCORECARD_COLUMNS: ScorecardMetricKey[] = ['marketCap', 'revenue', 'revenueGrowth', 'netMargin', 'fcfMargin', 'fcfYield', 'trailingPe', 'forwardPe']

export interface ScorecardComparison {
  id: string
  name: string
  symbols: string[]
  columns: ScorecardMetricKey[]
  chartMetric: ScorecardMetricKey
}

export interface ScorecardPreferences {
  symbols: string[]
  columns: ScorecardMetricKey[]
  chartMetric: ScorecardMetricKey
  comparisons: ScorecardComparison[]
  selectedId: string
}

export function parseScorecardSymbols(input: string): { symbols: string[]; error: string } {
  const symbols = [...new Set(input.toUpperCase().split(/[\s,;]+/).filter(Boolean))]
  const invalid = symbols.find(symbol => !/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(symbol))
  if (invalid) return { symbols: [], error: `Invalid ticker: ${invalid.slice(0, 30)}. Use letters, numbers, dots, or hyphens.` }
  if (symbols.length < SCORECARD_MIN_COMPANIES || symbols.length > SCORECARD_MAX_COMPANIES) {
    return { symbols: [], error: `Enter ${SCORECARD_MIN_COMPANIES}–${SCORECARD_MAX_COMPANIES} different company tickers.` }
  }
  return { symbols, error: '' }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export function isScorecardMetric(value: unknown): value is ScorecardMetricKey {
  return SCORECARD_METRICS.some(metric => metric.key === value)
}

function normalizeColumns(value: unknown): ScorecardMetricKey[] {
  const columns = Array.isArray(value) ? [...new Set(value.filter(isScorecardMetric))] : []
  return columns.length ? columns : [...DEFAULT_SCORECARD_COLUMNS]
}

function normalizeSymbols(value: unknown): string[] {
  const parsed = parseScorecardSymbols(Array.isArray(value) ? value.filter(item => typeof item === 'string').join(',') : '')
  return parsed.error ? [...DEFAULT_SCORECARD_SYMBOLS] : parsed.symbols
}

/** Treat persisted UI settings as untrusted; do not restore arbitrary fields or huge lists. */
export function normalizeScorecardPreferences(input: unknown): ScorecardPreferences {
  const value = object(input)
  const comparisons: ScorecardComparison[] = []
  const names = new Set<string>()
  for (const item of Array.isArray(value.comparisons) ? value.comparisons.slice(0, SCORECARD_MAX_SAVED) : []) {
    const entry = object(item)
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : ''
    const id = typeof entry.id === 'string' ? entry.id.slice(0, 100) : ''
    if (!name || !id || names.has(name.toLowerCase()) || comparisons.some(saved => saved.id === id)) continue
    names.add(name.toLowerCase())
    comparisons.push({ id, name, symbols: normalizeSymbols(entry.symbols), columns: normalizeColumns(entry.columns),
      chartMetric: isScorecardMetric(entry.chartMetric) ? entry.chartMetric : 'revenueGrowth' })
  }
  return {
    symbols: normalizeSymbols(value.symbols),
    columns: normalizeColumns(value.columns),
    chartMetric: isScorecardMetric(value.chartMetric) ? value.chartMetric : 'revenueGrowth',
    comparisons,
    selectedId: typeof value.selectedId === 'string' && comparisons.some(saved => saved.id === value.selectedId) ? value.selectedId : '',
  }
}

export interface ScorecardRow {
  symbol: string
  name: string
  sector: string
  fiscalEnd: string | null
  statementSources: string[]
  currencyNote: string
  issues: string[]
  values: Record<ScorecardMetricKey, number | null>
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positive(value: unknown): number | null {
  const result = finite(value)
  return result !== null && result > 0 ? result : null
}

function ratio(top: number | null, bottom: number | null): number | null {
  return top === null || bottom === null || bottom <= 0 ? null : finite(top / bottom * 100)
}

/** Reuse USD-normalized statements, never formatted strings or mixed-period margins. */
export function buildScorecardRow(symbol: string, payload?: FundamentalsPagePayload, now = Date.now()): ScorecardRow {
  const row: ScorecardRow = { symbol, name: symbol, sector: '', fiscalEnd: null, statementSources: [], currencyNote: '', issues: [],
    values: Object.fromEntries(SCORECARD_METRICS.map(metric => [metric.key, null])) as ScorecardRow['values'] }
  if (!payload || payload.symbol !== symbol) return row
  row.name = payload.company.name || symbol
  row.sector = payload.company.sector
  row.currencyNote = payload.currencyNote ?? ''
  row.issues = [...payload.warnings]
  if (payload.displayCurrency !== 'USD' || payload.currencyVersion !== 2) {
    row.issues.push('USD-normalized financials are unavailable. Refresh to load comparable data.')
    return row
  }
  const valid = (point: FundamentalSeriesPoint) => /^\d{4}-\d{2}-\d{2}$/.test(point.endDate)
    && Number.isFinite(Date.parse(point.endDate)) && Date.parse(point.endDate) <= now && finite(point.value) !== null
  const revenue = payload.annual.revenue.filter(valid).sort((a, b) => a.endDate.localeCompare(b.endDate))
  const latest = revenue.at(-1)
  const fiscalValue = (points: FundamentalSeriesPoint[]) => {
    const point = latest ? points.find(entry => valid(entry) && entry.endDate === latest.endDate) : undefined
    if (point) row.statementSources.push(point.source)
    return point ? finite(point.value) : null
  }
  const prior = latest ? revenue.filter(point => {
    const days = (Date.parse(latest.endDate) - Date.parse(point.endDate)) / 86_400_000
    return days >= 330 && days <= 400
  }).at(-1) : undefined
  const netIncome = fiscalValue(payload.annual.netIncome)
  const freeCashFlow = fiscalValue(payload.annual.freeCashFlow)
  const facts = payload.facts
  const cash = finite(facts.totalCash)
  const debt = finite(facts.totalDebt)
  const enterpriseValue = finite(facts.enterpriseValue)
  const ebitda = positive(facts.ebitda)
  row.fiscalEnd = latest?.endDate ?? null
  if (latest) row.statementSources.push(latest.source)
  row.statementSources = [...new Set(row.statementSources)]
  row.values = {
    marketCap: positive(facts.marketCap),
    revenue: latest?.value ?? null,
    revenueGrowth: latest && prior ? ratio(latest.value - prior.value, prior.value) : null,
    netMargin: ratio(netIncome, latest?.value ?? null),
    fcfMargin: ratio(freeCashFlow, latest?.value ?? null),
    fcfYield: ratio(freeCashFlow, positive(facts.marketCap)),
    trailingPe: positive(facts.trailingPe),
    forwardPe: positive(facts.forwardPe),
    priceToSales: positive(facts.priceToSales),
    evEbitda: enterpriseValue !== null && enterpriseValue >= 0 && ebitda !== null ? finite(enterpriseValue / ebitda) : null,
    freeCashFlow,
    netCash: cash !== null && debt !== null ? finite(cash - debt) : null,
    beta: finite(facts.beta),
  }
  if (!latest) row.issues.push('Annual revenue is unavailable; fiscal-year comparisons cannot be calculated.')
  return row
}

export function scorecardBarDomain(values: Array<number | null>): { min: number; max: number; zero: number } {
  const available = values.filter((value): value is number => finite(value) !== null)
  const min = Math.min(0, ...available)
  const max = Math.max(0, ...available)
  const span = max - min || 1
  return { min, max: min + span, zero: min === 0 ? 0 : -min / span * 100 }
}
