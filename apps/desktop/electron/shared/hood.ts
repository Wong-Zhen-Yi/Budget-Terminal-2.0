import type { BackgroundRequest, FundamentalsPagePayload, StocksPayload } from './contract.js'

export const HOOD_BLOCKS = ['market', 'financials', 'monthly', 'quarterly'] as const
export type HoodBlock = (typeof HOOD_BLOCKS)[number]
export type HoodUnit = 'USD' | 'count' | 'USD/share' | 'USD/user'

export interface HoodRequest extends BackgroundRequest { force?: boolean }

export interface HoodMetric {
  id: string
  label: string
  unit: HoodUnit
  value: number | null
  previous: number | null
  yearAgo: number | null
  /** Preserve provider comparisons, including NM, NA, and multiples such as 15x. */
  change: string
  yearChange: string
}

export interface HoodReport {
  period: string
  publishedAt: string
  sourceUrl: string
  previousPeriod: string
  yearAgoPeriod: string
  metrics: HoodMetric[]
  notes: string[]
}

export interface HoodPayload {
  symbol: 'HOOD'
  market: StocksPayload | null
  financials: FundamentalsPagePayload | null
  monthly: HoodReport | null
  quarterly: HoodReport | null
  progress: Record<HoodBlock, 'loaded' | 'partial' | 'stale' | 'unavailable'>
  fetchedAt: number
}

export function emptyHoodPayload(): HoodPayload {
  return { symbol: 'HOOD', market: null, financials: null, monthly: null, quarterly: null,
    progress: { market: 'unavailable', financials: 'unavailable', monthly: 'unavailable', quarterly: 'unavailable' }, fetchedAt: 0 }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const plain = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

export interface HoodDocument { period: string; url: string }

/** Read year/section membership, rather than guessing the next release's URL. */
export function discoverHoodDocument(html: string, kind: 'monthly' | 'quarterly'): HoodDocument {
  // Quarter-end press releases contain quarterly totals. The separate monthly
  // metrics table is the only source for monthly volumes and comparisons.
  const heading = kind === 'monthly' ? /^Monthly Metrics PDF$/i : /^Press Release$/i
  let year = 0
  let section = false
  const documents: HoodDocument[] = []
  for (const token of html.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>|<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (token[1] !== undefined) {
      const title = plain(token[1])
      if (/^20\d{2}$/.test(title)) { year = Number(title); section = false }
      else section = heading.test(title)
      continue
    }
    if (!year || !section) continue
    const label = plain(token[3])
    const month = MONTHS.findIndex(name => name.slice(0, 3).toLowerCase() === label.toLowerCase().slice(0, 3))
    const quarter = /^Q([1-4])$/i.exec(label)
    if (kind === 'monthly' ? month < 0 : !quarter) continue
    const url = new URL(token[2].replace(/&amp;/g, '&'), 'https://investors.robinhood.com').href
    if (new URL(url).hostname !== 'investors.robinhood.com') continue
    documents.push({ period: `${year}-${String(kind === 'monthly' ? month + 1 : Number(quarter![1]) * 3).padStart(2, '0')}`, url })
  }
  const latest = documents.sort((a, b) => b.period.localeCompare(a.period))[0]
  if (!latest) throw new Error(`Robinhood ${kind} report links could not be found.`)
  return latest
}

export function hoodNumber(text: string, scale = 1): number | null {
  const clean = text.trim().replace(/[$,\s]/g, '').replace(/[−–]/g, '-')
  if (!/^(?:[+-]?\d+(?:\.\d+)?|\(\d+(?:\.\d+)?\))$/.test(clean)) return null
  const value = Number(clean.startsWith('(') ? `-${clean.slice(1, -1)}` : clean) * scale
  return Number.isFinite(value) ? value : null
}

interface MetricSpec { id: string; label: string; pattern: RegExp; unit: HoodUnit; scale: number; section?: string }
const monthlySpecs: MetricSpec[] = [
  { id: 'customers', label: 'Funded customers', pattern: /^Funded Customers/i, unit: 'count', scale: 1e6 },
  { id: 'assets', label: 'Total platform assets', pattern: /^(?:Total Platform Assets|Assets Under Custody)/i, unit: 'USD', scale: 1e9 },
  { id: 'deposits', label: 'Net deposits · monthly', pattern: /^Net Deposits/i, unit: 'USD', scale: 1e9 },
  { id: 'equities', label: 'Equity trading volume', pattern: /^Equity\s*\(\$B\)/i, unit: 'USD', scale: 1e9, section: 'Total Trading Volumes' },
  { id: 'options', label: 'Options contracts', pattern: /^Options Contracts\s*\(M\)/i, unit: 'count', scale: 1e6, section: 'Total Trading Volumes' },
  { id: 'crypto', label: 'Crypto volume · total', pattern: /^Crypto\s*\(\$B\)/i, unit: 'USD', scale: 1e9, section: 'Total Trading Volumes' },
  { id: 'appCrypto', label: 'Crypto volume · Robinhood App', pattern: /^Robinhood App(?:\s*\(\$B\))?/i, unit: 'USD', scale: 1e9, section: 'Total Trading Volumes' },
  { id: 'bitstamp', label: 'Crypto volume · Bitstamp', pattern: /^Bitstamp(?:\s*\(\$B\))?/i, unit: 'USD', scale: 1e9, section: 'Total Trading Volumes' },
  { id: 'events', label: 'Event contracts', pattern: /^Event Contracts\s*\(B\)/i, unit: 'count', scale: 1e9, section: 'Total Trading Volumes' },
  { id: 'margin', label: 'Margin balances', pattern: /^Margin Book/i, unit: 'USD', scale: 1e9 },
  { id: 'cash', label: 'Cash and deposits', pattern: /^Cash and Deposits/i, unit: 'USD', scale: 1e9 },
  { id: 'sweep', label: 'Cash sweep', pattern: /^(?:Gold )?Cash Sweep/i, unit: 'USD', scale: 1e9 },
]
const quarterlySpecs: MetricSpec[] = [
  { id: 'revenue', label: 'Total net revenue', pattern: /^Total net revenues/i, unit: 'USD', scale: 1e6 },
  { id: 'netIncome', label: 'Net income', pattern: /^Net income(?:\s*\(loss\))?/i, unit: 'USD', scale: 1e6 },
  { id: 'eps', label: 'Diluted EPS', pattern: /^(?:Diluted EPS|Diluted(?: earnings| net (?:income|loss))?(?: \(loss\))? per share|Diluted)/i, unit: 'USD/share', scale: 1 },
  { id: 'ebitda', label: 'Adjusted EBITDA · non-GAAP', pattern: /^Adjusted EBITDA(?:\s*\(non-GAAP\))?/i, unit: 'USD', scale: 1e6 },
  { id: 'gold', label: 'Gold subscribers', pattern: /^(?:Robinhood )?Gold Subscribers(?:\s*\(M\))?/i, unit: 'count', scale: 1e6 },
  { id: 'arpu', label: 'ARPU', pattern: /^(?:Average Revenue [Pp]er User(?:\s*\(ARPU\))?|ARPU)/i, unit: 'USD/user', scale: 1 },
  { id: 'deposits', label: 'Net deposits · quarterly', pattern: /^Net Deposits(?:\s*\(\$B\))?/i, unit: 'USD', scale: 1e9 },
  { id: 'transaction', label: 'Transaction revenue', pattern: /^Transaction-based revenues/i, unit: 'USD', scale: 1e6 },
  { id: 'interest', label: 'Net interest revenue', pattern: /^Net interest revenues/i, unit: 'USD', scale: 1e6 },
  { id: 'other', label: 'Other revenue', pattern: /^Other revenues/i, unit: 'USD', scale: 1e6 },
  { id: 'options', label: 'Options revenue', pattern: /^Options/i, unit: 'USD', scale: 1e6 },
  { id: 'crypto', label: 'Crypto revenue', pattern: /^Cryptocurrencies/i, unit: 'USD', scale: 1e6 },
  { id: 'equities', label: 'Equities revenue', pattern: /^Equities/i, unit: 'USD', scale: 1e6 },
  { id: 'events', label: 'Event contracts revenue', pattern: /^Event contracts/i, unit: 'USD', scale: 1e6 },
]

const numberToken = /\(?\s*\$?\s*[+−–-]?\d[\d,]*(?:\.\d+)?(?:\s*[%x])?\s*\)?|\bNM\b|\bNA\b|[—–-]/gi

function tableMetric(lines: string[], spec: MetricSpec, quarterly: boolean, monthlyColumns = 0): HoodMetric {
  let section = ''
  for (const line of lines) {
    if (/Net income per share|Earnings per share/i.test(line)) section = 'eps'
    if (/Weighted-average shares|^Net income attributable/i.test(line)) section = ''
    if (/^(Total Trading Volumes|Average Daily Trading Volumes|Daily Average Trades|Interest Earning Assets)/i.test(line)) section = line
    if (spec.section && !section.startsWith(spec.section)) continue
    if (spec.id === 'eps' && !/^Diluted EPS/i.test(line) && section !== 'eps') continue
    const match = spec.pattern.exec(line)
    if (!match) continue
    if (/increased|decreased|reached|were|was|included/i.test(line)) continue
    // Footnote digits stay attached to a label. Extraction inserts tabs between PDF cells.
    const rest = line.slice(match[0].length).replace(/^\d+(?:,\d+)*\s*(?=\t)/, '')
    const tokens = (rest.match(numberToken) ?? []).map(token => token.replace(/\s+/g, ''))
    if (tokens.length < 3 || tokens[0].includes('%')) continue
    const values = tokens.map(token => hoodNumber(token, spec.scale))
    const comparison = (token: string | undefined) => token?.replace(/^\((.*)\)$/, '-$1') ?? ''
    if (!quarterly) {
      if (monthlyColumns >= 13) {
        if (tokens.length !== monthlyColumns + 2) continue
        return { id: spec.id, label: spec.label, unit: spec.unit,
          value: values[monthlyColumns - 1], previous: values[monthlyColumns - 2],
          yearAgo: values[monthlyColumns - 13], change: comparison(tokens[monthlyColumns]),
          yearChange: comparison(tokens[monthlyColumns + 1]) }
      }
      if (tokens.length < 5) continue
      return { id: spec.id, label: spec.label, unit: spec.unit, value: values[0], previous: values[1],
        change: comparison(tokens[2]), yearAgo: values[3], yearChange: comparison(tokens[4]) }
    }
    // Quarterly summary columns: year-ago, current, YoY, previous quarter, QoQ.
    // Unadorned statement columns: year-ago quarter, current quarter, previous quarter.
    const summary = /%|NM|NA|x|^[—–-]$/.test(tokens[2])
    return { id: spec.id, label: spec.label, unit: spec.unit, value: values[1], previous: summary ? values[3] ?? null : tokens.length === 3 ? values[2] : null,
      yearAgo: values[0], change: summary ? comparison(tokens[4]) : '', yearChange: summary ? comparison(tokens[2]) : '' }
  }
  return { id: spec.id, label: spec.label, unit: spec.unit, value: null, previous: null, yearAgo: null, change: '', yearChange: '' }
}

/** Text is row-preserving: tab separates PDF cells and newline separates y coordinates. */
export function parseHoodReport(text: string, document: HoodDocument, kind: 'monthly' | 'quarterly'): HoodReport {
  const lines = text.replace(/\u00a0/g, ' ').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, '').split(/\r?\n/).map(line => line.trim().replace(/\t(?=[A-Za-z(])/g, ' ')).filter(Boolean)
  // The metrics PDF lists a rolling history, oldest first, followed by M/M and Y/Y.
  // Press-release summary tables use the separate five-column layout below.
  const monthHeader = lines.find(line => /M\/M\s+Y\/Y\s*$/i.test(line))
  const monthlyColumns = monthHeader?.split(/\s+/).filter(token => MONTHS.some(month => month.slice(0, 3).toLowerCase() === token.toLowerCase())).length ?? 0
  const specs = kind === 'monthly' ? monthlySpecs : quarterlySpecs
  const metrics = specs.map(spec => tableMetric(lines, spec, kind === 'quarterly', monthlyColumns))
  // Releases often introduce additional KPIs only in their prose. This fallback never overwrites table precision.
  const prose = text.replace(/\s+/g, ' ')
  const resultsStart = prose.search(/(?:First|Second|Third|Fourth) Quarter Results/i)
  const results = resultsStart >= 0 ? prose.slice(resultsStart).split(/\bHighlights\b/)[0] : prose
  for (const metric of metrics.filter(entry => entry.value === null)) {
    const spec = specs.find(entry => entry.id === metric.id)!
    const proseLabels: Record<string, string> = {
      eps: 'Diluted (?:earnings per share|EPS)', gold: '(?:Robinhood )?Gold Subscribers', arpu: 'Average Revenue Per User',
      netIncome: 'Net income', ebitda: 'Adjusted EBITDA(?: \\(non-GAAP\\))?', deposits: 'Net Deposits',
      options: 'options revenue', crypto: 'cryptocurrencies revenue', equities: 'equities revenue', events: 'event contracts revenue',
    }
    const label = kind === 'quarterly' ? proseLabels[metric.id] : ''
    if (!label) continue
    const match = new RegExp(`${label}(?:[^.]|\\.(?=\\d)){0,240}?(?:to|of|were|was|reached)\\s+(?:a record\\s+)?(\\(?\\$?[\\d,]+(?:\\.\\d+)?\\)?)(?:\\s+(million|billion))?`, 'i').exec(results)
    if (match) metric.value = hoodNumber(match[1], match[2] === 'billion' ? 1e9 : match[2] === 'million' ? 1e6 : spec.unit === 'count' ? 1e6 : 1)
  }
  if (!metrics.some(metric => metric.value !== null)) throw new Error(`Robinhood ${kind} report metrics could not be read.`)
  const [year, month] = document.period.split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 1 - (kind === 'monthly' ? 1 : 3), 1)).toISOString().slice(0, 7)
  const published = new RegExp(`(${MONTHS.join('|')})\\s+([0-9]{1,2}),?\\s+(20[0-9]{2})`).exec(text.replace(/\s+/g, ' '))
  const notes: string[] = []
  for (let index = 0; index < lines.length; index++) {
    if (!/^(?:\d+\.\s|Note:|The information in this release is unaudited)/i.test(lines[index])) continue
    let note = lines[index]
    while (index + 1 < lines.length && !/^(?:\d+\.?$|\d+\.\s|Note:|For definitions|The information|About Robinhood|Contacts)/i.test(lines[index + 1])) note += ` ${lines[++index]}`
    notes.push(note.replace(/\s+/g, ' '))
  }
  return { period: document.period, sourceUrl: document.url, previousPeriod: previous, yearAgoPeriod: `${year - 1}-${String(month).padStart(2, '0')}`,
    publishedAt: published ? `${published[3]}-${String(MONTHS.indexOf(published[1]) + 1).padStart(2, '0')}-${published[2].padStart(2, '0')}` : '', metrics, notes }
}

export function hoodHistory(financials: FundamentalsPagePayload | null) {
  if (!financials) return []
  const keys = ['revenue', 'netIncome', 'operatingCashFlow', 'sharesOutstanding'] as const
  const dates = [...new Set(keys.flatMap(key => financials.quarterly[key].map(point => point.endDate)))].sort().slice(-8)
  return dates.map(endDate => ({ endDate, ...Object.fromEntries(keys.map(key => [key, financials.quarterly[key].find(point => point.endDate === endDate)?.value ?? null])) })) as Array<{
    endDate: string; revenue: number | null; netIncome: number | null; operatingCashFlow: number | null; sharesOutstanding: number | null
  }>
}

/** Only a complete nonnegative parent breakdown represents a revenue allocation. */
export function hoodRevenueMix(report: HoodReport | null): Array<{ label: string; value: number }> {
  if (!report) return []
  const rows = ['transaction', 'interest', 'other'].map(id => report.metrics.find(metric => metric.id === id))
  return rows.every(row => row?.value != null && row.value >= 0)
    ? rows.map(row => ({ label: row!.label, value: row!.value! })) : []
}
