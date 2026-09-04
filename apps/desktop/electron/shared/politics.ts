import type { PoliticsParty, PoliticsTrade } from './contract.js'

export const POLITICS_PAGE_SIZE = 100
export const POLITICS_CACHE_TTL_MS = 4 * 60 * 60 * 1000
/** Ceiling on an export's page walk; a request for every page still stops at `totalPages`. */
export const POLITICS_EXPORT_MAX_PAGES = 500
/** Capitol Trades sits outside the Yahoo rate gate, so a deep walk paces itself. */
export const POLITICS_EXPORT_PAGE_DELAY_MS = 200

const SECTOR_DATA: Record<string, string[]> = {
  Technology: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'ASML', 'ADBE', 'AMD', 'CRM', 'CSCO'],
  Financials: ['JPM', 'BAC', 'WFC', 'MS', 'GS', 'HSBC', 'RY', 'TD', 'C', 'UBS'],
  Healthcare: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'NVO', 'AZN', 'PFE', 'ABT'],
  'Consumer Cyclical': ['AMZN', 'TSLA', 'HD', 'MCD', 'TM', 'NKE', 'LOW', 'SBUX', 'TJX', 'BKNG'],
  Energy: ['XOM', 'CVX', 'SHEL', 'TTE', 'COP', 'BP', 'PBR', 'EOG', 'SLB', 'MPC'],
  'Communication Services': ['GOOGL', 'META', 'NFLX', 'DIS', 'TMUS', 'VZ', 'T', 'CMCSA', 'AMX', 'BTI'],
  Industrials: ['GE', 'UNP', 'HON', 'RTX', 'LMT', 'CAT', 'BA', 'UPS', 'DE', 'MMM'],
  'Consumer Defensive': ['WMT', 'PG', 'KO', 'PEP', 'COST', 'PM', 'UL', 'EL', 'DEO', 'MO'],
  Utilities: ['NEE', 'DUK', 'SO', 'D', 'EXC', 'AEP', 'SRE', 'PEG', 'ED', 'XEL'],
  'Real Estate': ['PLD', 'AMT', 'EQIX', 'CCI', 'WY', 'PSA', 'SBAC', 'VICI', 'O', 'WELL'],
  'Basic Materials': ['LIN', 'BHP', 'RIO', 'FCX', 'VALE', 'APD', 'NEM', 'SHW', 'CTVA', 'SCCO'],
  Crypto: ['IBIT', 'ETHA', 'BMNR', 'MSTR', 'BITW', 'BSOL', 'CRCL', 'COIN', 'BITQ'],
  Metals: ['GLD', 'SLV', 'GDX', 'GDXJ', 'GLDM', 'SIVR', 'PAAS', 'WPM', 'FNV', 'SBSW'],
}

const SECTOR_KEYWORDS: Record<string, string[]> = {
  Technology: ['tech', 'software', 'hardware', 'chip', 'chips', 'semiconductor', 'cloud', 'ai', 'artificial', 'intelligence', 'data', 'cyber', 'digital', 'computing', 'nvidia', 'apple', 'microsoft', 'google', 'meta', 'amazon'],
  Energy: ['oil', 'gas', 'energy', 'crude', 'opec', 'lng', 'pipeline', 'refinery', 'renewable', 'solar', 'wind', 'exxon', 'chevron', 'shell', 'bp'],
  Financials: ['bank', 'banks', 'banking', 'fed', 'federal', 'reserve', 'rate', 'rates', 'interest', 'loan', 'loans', 'credit', 'mortgage', 'insurance', 'jpmorgan', 'goldman', 'treasury', 'yield', 'yields', 'inflation', 'cpi'],
  Healthcare: ['drug', 'drugs', 'pharma', 'fda', 'trial', 'vaccine', 'biotech', 'clinical', 'cancer', 'therapy', 'health', 'hospital', 'medical', 'pfizer', 'merck', 'johnson', 'approval', 'patent'],
  Consumer: ['retail', 'sales', 'consumer', 'spending', 'walmart', 'amazon', 'target', 'nike', 'starbucks', 'mcdonald', 'restaurant', 'holiday', 'tariff', 'tariffs', 'import', 'exports'],
  Automotive: ['car', 'cars', 'ev', 'electric', 'vehicle', 'vehicles', 'tesla', 'ford', 'gm', 'toyota', 'recall', 'autonomous', 'battery', 'charging'],
  'Real Estate': ['housing', 'home', 'homes', 'mortgage', 'reit', 'property', 'rent', 'rents', 'construction', 'building', 'commercial'],
  'Macro / Rates': ['gdp', 'recession', 'unemployment', 'jobs', 'payroll', 'cpi', 'inflation', 'deflation', 'rate', 'rates', 'fed', 'ecb', 'central', 'policy', 'fiscal', 'tariff', 'tariffs', 'trade', 'sanctions', 'dollar'],
  Geopolitics: ['war', 'conflict', 'sanctions', 'russia', 'china', 'taiwan', 'middle', 'east', 'election', 'government', 'congress', 'senate', 'president', 'white', 'house', 'geopolitical', 'nato', 'opec'],
}

const THEME_BY_TICKER = new Map(
  Object.entries(SECTOR_DATA).flatMap(([theme, tickers]) =>
    tickers.map((ticker) => [ticker, theme] as const),
  ),
)

export interface PoliticsFilters {
  politician: string
  ticker: string
  chamber: string
  party: string
  tradeType: string
  theme: string
}

export interface PoliticsThemeFlow {
  theme: string
  buy: number
  sell: number
  net: number
}

export function parsePoliticsParty(value: unknown): PoliticsParty {
  const party = String(value ?? '').trim().toLowerCase()
  if (party.startsWith('d')) return 'Democrat'
  if (party.startsWith('r')) return 'Republican'
  if (party.startsWith('i')) return 'Independent'
  return 'Unknown'
}

export function normalizePoliticsTradeType(value: unknown): string {
  const text = String(value ?? '').trim()
  const lower = text.toLowerCase()
  if (lower.includes('purchase') || lower.includes('buy')) return 'Purchase'
  if (lower.includes('partial') && (lower.includes('sale') || lower.includes('sell'))) {
    return 'Sale (Partial)'
  }
  if (lower.includes('sale') || lower.includes('sell')) return 'Sale (Full)'
  if (lower.includes('exchange')) return 'Exchange'
  if (!text) return 'Unknown'
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function parsePoliticsAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  const raw = String(value ?? '').trim().toUpperCase()
  if (!raw) return null
  let text = raw.replace(/[$,]/g, '')
  let multiplier = 1
  if (text.endsWith('B')) {
    multiplier = 1_000_000_000
    text = text.slice(0, -1)
  } else if (text.endsWith('M')) {
    multiplier = 1_000_000
    text = text.slice(0, -1)
  } else if (text.endsWith('K')) {
    multiplier = 1_000
    text = text.slice(0, -1)
  }
  const match = text.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? Math.trunc(parsed * multiplier) : null
}

export function formatPoliticsAmount(value: unknown): string {
  const parsed = parsePoliticsAmount(value)
  if (parsed === null) return value === null || value === undefined ? '' : String(value)
  if (parsed >= 1_000_000) return `$${(parsed / 1_000_000).toFixed(1)}M`
  if (parsed >= 1_000) return `$${(parsed / 1_000).toFixed(0)}K`
  return `$${parsed.toLocaleString('en-US')}`
}

export function formatPoliticsFlow(value: number, signed = false): string {
  const magnitude = Math.abs(value)
  const body = magnitude >= 1_000_000
    ? `$${(magnitude / 1_000_000).toFixed(1)}M`
    : magnitude >= 1_000
      ? `$${(magnitude / 1_000).toFixed(0)}K`
      : `$${magnitude.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (!signed || value === 0) return body
  return value > 0 ? `+${body}` : `-${body}`
}

export function inferPoliticsTheme(ticker: unknown, assetDescription: unknown): string {
  const symbol = String(ticker ?? '').trim().toUpperCase()
  const known = THEME_BY_TICKER.get(symbol)
  if (known) return known
  const words = new Set(String(assetDescription ?? '').toUpperCase().match(/[A-Z0-9]+/g) ?? [])
  const hits = Object.entries(SECTOR_KEYWORDS)
    .map(([theme, keywords]) => [
      theme,
      new Set(keywords.map((word) => word.toUpperCase()).filter((word) => words.has(word))).size,
    ] as const)
    .filter((entry) => entry[1] > 0)
    .sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]))
  return hits[0]?.[0] ?? 'Other'
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export function normalizePoliticsTrade(value: unknown): PoliticsTrade | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const ticker = String(row.ticker ?? '').trim().toUpperCase()
  const assetDescription = String(row.assetDescription ?? row.asset_description ?? '')
  const parsedAmount = parsePoliticsAmount(row.amountValue ?? row.amount_value ?? row.amount) ?? 0
  const party = parsePoliticsParty(row.party)
  return {
    politician: String(row.politician ?? ''),
    chamber: String(row.chamber ?? ''),
    party,
    ticker,
    assetDescription,
    theme: String(row.theme ?? '').trim() || inferPoliticsTheme(ticker, assetDescription),
    tradeType: normalizePoliticsTradeType(row.tradeType ?? row.trade_type),
    amount: String(row.amount ?? '') || formatPoliticsAmount(parsedAmount),
    amountValue: parsedAmount,
    transactionDate: String(row.transactionDate ?? row.transaction_date ?? ''),
    disclosureDate: String(row.disclosureDate ?? row.disclosure_date ?? ''),
  }
}

function extractNextPayload(html: string, pushStart: number): string {
  const chunk = html.slice(pushStart)
  const argumentStart = chunk.indexOf('push(')
  if (argumentStart < 0) return ''
  const text = chunk.slice(argumentStart + 5)
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '(') depth += 1
    else if (char === ')') {
      if (depth === 0) {
        end = index
        break
      }
      depth -= 1
    }
  }
  if (end < 0) return ''
  try {
    const payload = JSON.parse(text.slice(0, end)) as unknown
    return Array.isArray(payload) && typeof payload[1] === 'string' ? payload[1] : ''
  } catch {
    return ''
  }
}

export interface PoliticsHtmlParse {
  trades: PoliticsTrade[]
  rawCount: number
  /** Trade count across every page, as reported by the source's paginator. */
  totalCount: number
  totalPages: number
}

const EMPTY_PARSE: PoliticsHtmlParse = { trades: [], rawCount: 0, totalCount: 0, totalPages: 0 }

/** Parse the React Server Component payload used by capitoltrades.com. */
export function parsePoliticsHtml(html: string): PoliticsHtmlParse {
  const marker = html.indexOf('_txId')
  if (marker < 0) return EMPTY_PARSE
  const pushStart = html.lastIndexOf('self.__next_f.push', marker)
  if (pushStart < 0) return EMPTY_PARSE
  const payload = extractNextPayload(html, pushStart)
  const dataMarker = payload.indexOf('"data":[{')
  if (dataMarker < 0) return EMPTY_PARSE
  const arrayStart = payload.indexOf('[', dataMarker)
  if (arrayStart < 0) return EMPTY_PARSE
  let depth = 0
  let arrayEnd = -1
  let inString = false
  let escaped = false
  for (let index = arrayStart; index < payload.length; index += 1) {
    const char = payload[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '[') depth += 1
    else if (char === ']') {
      depth -= 1
      if (depth === 0) {
        arrayEnd = index + 1
        break
      }
    }
  }
  if (arrayEnd < 0) return EMPTY_PARSE
  let raw: unknown
  try {
    raw = JSON.parse(payload.slice(arrayStart, arrayEnd))
  } catch {
    return EMPTY_PARSE
  }
  if (!Array.isArray(raw)) return EMPTY_PARSE
  const trades = raw.flatMap((entry): PoliticsTrade[] => {
    const record = recordOf(entry)
    const politician = recordOf(record.politician)
    const issuer = recordOf(record.issuer)
    const rawTicker = String(issuer.issuerTicker ?? '')
    // Roughly a third of every page is a holding the source has no ticker for — municipal
    // debt, treasuries, LLCs, private funds. Those are real disclosed trades, so they stay.
    const ticker = rawTicker.split(':')[0].trim().toUpperCase()
    const assetDescription = String(issuer.issuerName ?? '')
    const amountValue = parsePoliticsAmount(record.value) ?? 0
    return [{
      politician: `${String(politician.firstName ?? '')} ${String(politician.lastName ?? '')}`.trim() || 'Unknown',
      chamber: String(record.chamber ?? '').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()),
      party: parsePoliticsParty(politician.party),
      ticker,
      assetDescription,
      theme: inferPoliticsTheme(ticker, assetDescription),
      tradeType: normalizePoliticsTradeType(record.txType),
      amount: formatPoliticsAmount(record.value),
      amountValue,
      transactionDate: String(record.txDate ?? '').slice(0, 10),
      disclosureDate: String(record.pubDate ?? '').slice(0, 10),
    }]
  })
  trades.sort((left, right) => right.transactionDate.localeCompare(left.transactionDate))
  // The paginator that follows the data array carries the full result size; without it the
  // page can only guess at the last page from a full-looking batch.
  const totals = /"totalCount":(\d+),"totalPages":(\d+)/.exec(payload)
  return {
    trades,
    rawCount: raw.length,
    totalCount: totals ? Number(totals[1]) : 0,
    totalPages: totals ? Number(totals[2]) : 0,
  }
}

export function filterPoliticsTrades(
  trades: PoliticsTrade[],
  filters: PoliticsFilters,
): PoliticsTrade[] {
  const ticker = filters.ticker.trim().toUpperCase()
  return trades.filter((trade) =>
    (filters.politician === 'All' || trade.politician === filters.politician) &&
    (!ticker || trade.ticker.includes(ticker)) &&
    (filters.chamber === 'All' || trade.chamber === filters.chamber) &&
    (filters.party === 'All' || trade.party === filters.party) &&
    (filters.tradeType === 'All' || trade.tradeType === filters.tradeType) &&
    (filters.theme === 'All' || trade.theme === filters.theme),
  )
}

export function politicsTopCounts(
  trades: PoliticsTrade[],
  key: 'ticker' | 'politician',
  limit = 15,
): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const trade of trades) {
    const value = trade[key].trim()
    if (value && value !== 'Unknown') counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, limit)
}

export function buildPoliticsThemeFlow(trades: PoliticsTrade[]): PoliticsThemeFlow[] {
  const flow = new Map<string, { buy: number; sell: number }>()
  for (const trade of trades) {
    const row = flow.get(trade.theme) ?? { buy: 0, sell: 0 }
    if (trade.tradeType === 'Purchase') row.buy += trade.amountValue
    else if (trade.tradeType === 'Sale (Full)' || trade.tradeType === 'Sale (Partial)') {
      row.sell += trade.amountValue
    }
    flow.set(trade.theme, row)
  }
  return [...flow].map(([theme, value]) => ({
    theme,
    buy: value.buy,
    sell: value.sell,
    net: value.buy - value.sell,
  })).sort((left, right) =>
    (right.buy + right.sell) - (left.buy + left.sell) ||
    Math.abs(right.net) - Math.abs(left.net) ||
    left.theme.localeCompare(right.theme),
  )
}

export function politicsFlowSlices(rows: PoliticsThemeFlow[]): Array<{ label: string; value: number }> {
  const ranked = rows
    .map((row) => ({ label: row.theme, value: row.buy + row.sell }))
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
  const visible = ranked.slice(0, 6)
  const other = ranked.slice(6).reduce((sum, row) => sum + row.value, 0)
  if (other > 0) visible.push({ label: 'Other', value: other })
  return visible
}

export function politicsClipboard(trades: PoliticsTrade[]): string {
  const lines = ['Politician | Chamber | Party | Ticker | Type | Amount | Tx Date | Filed', '-'.repeat(90)]
  for (const trade of trades) {
    lines.push([
      trade.politician,
      trade.chamber,
      trade.party,
      trade.ticker,
      trade.tradeType,
      trade.amount,
      trade.transactionDate,
      trade.disclosureDate,
    ].join(' | '))
  }
  return lines.join('\n')
}
