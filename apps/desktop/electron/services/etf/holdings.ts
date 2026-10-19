/**
 * ETF holdings, from the issuers' own published files.
 *
 * Seven full issuer providers support basket consumers. The Explorer routes known
 * tickers directly, then uses a labelled public snapshot and one cached Yahoo summary
 * as fallbacks. Yahoo enrichment is optional, not part of a normal Explorer load.
 *
 * The Heatmap page (`services/heatmap.ts`) and the ETF page share this loader, so the
 * three index buttons and a hand-typed ticker resolve through one cache.
 *
 * **These hosts deliberately stay outside `paced()`**, on the `services/fearGreed.ts`
 * precedent: the rate gate models Yahoo's 429 behaviour and halves its own budget on
 * one, so letting an SSGA, Invesco or ARK hiccup throttle the dashboard would be
 * strictly worse than letting this page fail alone. The Yahoo fallback and the
 * enrichment underneath *are* Yahoo, and they do go through the gate.
 */

import { normalizeSector } from '../../shared/heatmap.js'
import { FRESHNESS } from '../../shared/freshness.js'
import { fetchEtfHtml, getEtfDirectory } from './directory.js'
import { resolveEtfSnapshot } from './snapshot.js'
import { cache } from '../cache.js'
import { paced, yahoo } from '../yahoo/client.js'
import { decodeCsv, parseCsv, parseCsvRecords } from './csv.js'
import { firstHeadingOrTitle, headingText, parseTables, textOf, type HtmlTable } from './html.js'
import { parseXlsxRows } from './xlsx.js'

export interface EtfHolding {
  symbol: string
  name: string
  /**
   * A fraction, not a percentage: `0.0873` is 8.73% of the fund. Nullable because the
   * dataclass is — a row the Yahoo fallback returns without one sorts to the bottom
   * rather than being dropped.
   */
  weight: number | null
  sector: string
}

export interface EtfSectorWeight {
  sector: string
  /** A percentage, not a fraction: `sector_breakdown` is rounded to two places there. */
  percent: number
}

export interface EtfHoldingsResult {
  fetchedAt?: number
  ticker: string
  fundName: string
  issuer: string
  asOfDate: string
  /** Pre-formatted, `'--'` when no source carried one, as the dataclass default is. */
  expenseRatio: string
  netAssets: string
  sourceUrl: string
  holdings: EtfHolding[]
  sectorBreakdown: EtfSectorWeight[]
  /** True for the Yahoo fallback, which is a top-holdings list rather than the book. */
  isPartial: boolean
  coverageNote: string
}

/** Bound each issuer attempt before falling back to a public snapshot. */
const TIMEOUT_MS = 12_000

/** The reference's own session header. */
const HEADERS = {
  'User-Agent': 'BudgetTerminal/1.0 (+https://github.com/)',
  'Accept-Language': 'en-US,en;q=0.9',
}

/**
 * An issuer's holdings file changes once a day, and it is the same file for every user
 * of the page. Cached far longer than a quote so switching tickers back and forth costs
 * one download, not one per visit.
 */
const HOLDINGS_TTL_MS = FRESHNESS.etfHoldings

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `_normalize_weight`. `'auto'` reads anything above 1 as a percentage. */
function normalizeWeight(
  value: unknown,
  scale: 'percent' | 'fraction' | 'auto' = 'auto',
): number | null {
  const text = clean(value).replace(/%/g, '').replace(/,/g, '')
  if (!text) return null
  const number = Number(text)
  if (!Number.isFinite(number)) return null
  if (scale === 'percent') return number / 100
  if (scale === 'fraction') return number
  return Math.abs(number) > 1 ? number / 100 : number
}

/** `_format_percent_string`: two decimals, or the raw text with a `%` glued on. */
function formatPercentString(value: unknown): string {
  const text = clean(value).replace(/ /g, '').replace(/%$/, '')
  if (!text) return '--'
  const number = Number(text)
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : `${text}%`
}

/** `_format_large_number`: T/B/M/K at two decimals, unprefixed — the label supplies `$`. */
function formatLargeNumber(value: unknown): string {
  const text = clean(value).replace(/\$/g, '').replace(/,/g, '')
  if (!text) return '--'
  const number = Number(text)
  if (!Number.isFinite(number)) return clean(value)
  const magnitude = Math.abs(number)
  if (magnitude >= 1e12) return `${(number / 1e12).toFixed(2)}T`
  if (magnitude >= 1e9) return `${(number / 1e9).toFixed(2)}B`
  if (magnitude >= 1e6) return `${(number / 1e6).toFixed(2)}M`
  if (magnitude >= 1e3) return `${(number / 1e3).toFixed(2)}K`
  return number.toFixed(2)
}

function blankResult(ticker: string, issuer: string): EtfHoldingsResult {
  return {
    ticker,
    fundName: '',
    issuer,
    asOfDate: '',
    expenseRatio: '--',
    netAssets: '--',
    sourceUrl: '',
    holdings: [],
    sectorBreakdown: [],
    isPartial: false,
    coverageNote: '',
  }
}

async function getText(url: string, init: RequestInit = {}): Promise<{ text: string; url: string } | null> {
  const response = await fetch(url, {
    ...init,
    headers: { ...HEADERS, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`)
  return { text: await response.text(), url: response.url || url }
}

async function getBuffer(url: string): Promise<{ buffer: Buffer; url: string } | null> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`)
  return { buffer: Buffer.from(await response.arrayBuffer()), url: response.url || url }
}

/**
 * The column layout every tabular provider looks for: a ticker column and a weight
 * column, with name and sector optional. Returns null when the header row does not carry
 * both required columns, which is how a provider decides a table is not the holdings one.
 */
interface ColumnMap {
  symbol: number
  weight: number
  name: number | null
  sector: number | null
}

function locateColumns(
  headers: string[],
  options: {
    symbolTokens?: string[]
    nameTokens?: string[]
    weightTokens?: string[]
    exactSymbol?: boolean
  } = {},
): ColumnMap | null {
  const {
    symbolTokens = ['ticker'],
    nameTokens = ['name'],
    weightTokens = ['weight'],
    exactSymbol = false,
  } = options
  const find = (tokens: string[], exact: boolean) =>
    headers.findIndex((header) =>
      tokens.some((token) => (exact ? header === token : header.includes(token))),
    )
  const symbol = find(symbolTokens, exactSymbol)
  const weight = find(weightTokens, false)
  if (symbol < 0 || weight < 0) return null
  const name = find(nameTokens, false)
  const sector = headers.findIndex((header) => header.includes('sector'))
  return { symbol, weight, name: name < 0 ? null : name, sector: sector < 0 ? null : sector }
}

/** One row of any tabular provider into a holding, or nothing. */
function rowToHolding(row: string[], columns: ColumnMap, keepSector: boolean): EtfHolding | null {
  const widest = Math.max(columns.symbol, columns.weight, columns.name ?? 0, columns.sector ?? 0)
  if (row.length <= widest) return null
  const symbol = clean(row[columns.symbol]).toUpperCase()
  const weight = normalizeWeight(row[columns.weight], 'percent')
  if (!symbol || weight === null) return null
  return {
    symbol,
    name: columns.name === null ? '' : clean(row[columns.name]),
    weight,
    sector: keepSector && columns.sector !== null ? normalizeSector(row[columns.sector]) : '',
  }
}

/* ------------------------------------------------------------------- ARK */

const ARK_ISSUER = 'ARK Invest'
const ARK_BASE = 'https://assets.ark-funds.com/fund-documents/funds-etf-csv'

/** `ArkIssuerProvider.file_names` and `.fund_names`. */
const ARK_FUNDS: Record<string, { file: string; name: string }> = {
  ARKK: { file: 'ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv', name: 'ARK Innovation ETF' },
  ARKQ: {
    file: 'ARK_AUTONOMOUS_TECH._&_ROBOTICS_ETF_ARKQ_HOLDINGS.csv',
    name: 'ARK Autonomous Technology & Robotics ETF',
  },
  ARKW: {
    file: 'ARK_NEXT_GENERATION_INTERNET_ETF_ARKW_HOLDINGS.csv',
    name: 'ARK Next Generation Internet ETF',
  },
  ARKG: { file: 'ARK_GENOMIC_REVOLUTION_ETF_ARKG_HOLDINGS.csv', name: 'ARK Genomic Revolution ETF' },
  ARKF: { file: 'ARK_FINTECH_INNOVATION_ETF_ARKF_HOLDINGS.csv', name: 'ARK Fintech Innovation ETF' },
  ARKX: {
    file: 'ARK_SPACE_EXPLORATION_&_INNOVATION_ETF_ARKX_HOLDINGS.csv',
    name: 'ARK Space Exploration & Innovation ETF',
  },
  PRNT: { file: 'THE_3D_PRINTING_ETF_PRNT_HOLDINGS.csv', name: 'The 3D Printing ETF' },
  IZRL: {
    file: 'ARK_ISRAEL_INNOVATIVE_TECHNOLOGY_ETF_IZRL_HOLDINGS.csv',
    name: 'ARK Israel Innovative Technology ETF',
  },
}

/** `_parse_currency`. */
function parseCurrency(value: unknown): number | null {
  const text = clean(value).replace(/\$/g, '').replace(/,/g, '')
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

async function fetchArk(ticker: string): Promise<EtfHoldingsResult | null> {
  const fund = ARK_FUNDS[ticker]
  if (!fund) return null
  const url = `${ARK_BASE}/${fund.file}`
  const downloaded = await getBuffer(url)
  if (!downloaded) return null

  const records = parseCsvRecords(decodeCsv(downloaded.buffer))
  const holdings: EtfHolding[] = []
  let asOfDate = ''
  let totalMarketValue = 0
  let hasMarketValue = false
  for (const record of records) {
    if (!asOfDate) asOfDate = clean(record.date)
    const symbol = clean(record.ticker).toUpperCase()
    const weight = normalizeWeight(record['weight (%)'], 'percent')
    if (symbol && weight !== null) {
      holdings.push({ symbol, name: clean(record.company), weight, sector: '' })
    }
    const marketValue = parseCurrency(record['market value ($)'])
    if (marketValue !== null) {
      totalMarketValue += marketValue
      hasMarketValue = true
    }
  }
  if (!holdings.length) return null

  return {
    ...blankResult(ticker, ARK_ISSUER),
    fundName: fund.name,
    asOfDate,
    netAssets: hasMarketValue ? formatLargeNumber(totalMarketValue) : '--',
    sourceUrl: url,
    holdings,
  }
}

/* --------------------------------------------------------------- iShares */

const ISHARES_ISSUER = 'iShares / BlackRock'
const ISHARES_BASE = 'https://www.ishares.com'
const ISHARES_LISTING = `${ISHARES_BASE}/us/products/etf-investments`

/**
 * The listing page is a megabyte of product JSON and it is the *first* thing the chain
 * touches for every non-ARK ticker, including SPY and QQQ, which iShares does not
 * publish. Caching it for the holdings TTL turns that into one download per six hours
 * instead of one per load; the reference pays it every time because its own session has
 * no cache to put it in.
 */
function isharesListing(): Promise<string> {
  return cache
    .resolveWithStaleFallback('etf-ishares-listing', HOLDINGS_TTL_MS, async () => {
      const page = await getText(ISHARES_LISTING)
      return page?.text ?? ''
    })
    .then((entry) => entry.value)
}

/** `_find_product_path`: three shapes, because the listing markup is not stable. */
function isharesProductPath(html: string, ticker: string): string {
  const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(
      `"localExchangeTicker"\\s*:\\s*"${escaped}"[\\s\\S]{0,600}?"productUrl"\\s*:\\s*"(/us/products/[^"]+)"`,
      'i',
    ),
    new RegExp(
      `"productUrl"\\s*:\\s*"(/us/products/[^"]+)"[\\s\\S]{0,600}?"localExchangeTicker"\\s*:\\s*"${escaped}"`,
      'i',
    ),
    new RegExp(`href="(/us/products/[^"]+)"[\\s\\S]{0,200}?>\\s*${escaped}\\s*<`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match) return match[1].replace(/\\\//g, '/')
  }
  return ''
}

/** `IsharesIssuerProvider._parse_holdings_csv`: the header row is somewhere in a preamble. */
function isharesHoldings(text: string): EtfHolding[] {
  const rows = parseCsv(text)
  for (let index = 0; index < rows.length; index += 1) {
    const headers = rows[index].map((cell) => clean(cell).toLowerCase())
    if (!headers.includes('ticker') || !headers.some((header) => header.includes('weight'))) continue
    const columns = locateColumns(headers, { exactSymbol: true, nameTokens: ['name'] })
    if (!columns) return []
    return rows
      .slice(index + 1)
      .map((row) => rowToHolding(row, columns, true))
      .filter((holding): holding is EtfHolding => holding !== null)
  }
  return []
}

/** `_parse_fund_page`: the title, and two figures scraped out of the rendered text. */
function isharesFundFacts(html: string, ticker: string): {
  fundName: string
  asOfDate: string
  expenseRatio: string
  netAssets: string
} {
  const title = firstHeadingOrTitle(html, ticker).split('|')[0].trim()
  const text = textOf(html)
  const assets = /Net Assets of Fund\s+as of\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+\$?([\d,.]+)/i.exec(text)
  const expense = /Expense Ratio\s+([0-9.]+%)/i.exec(text)
  return {
    fundName: title,
    asOfDate: assets ? assets[1] : '',
    expenseRatio: expense ? expense[1] : '--',
    netAssets: assets ? formatLargeNumber(assets[2]) : '--',
  }
}

async function fetchIshares(ticker: string): Promise<EtfHoldingsResult | null> {
  const productPath = isharesProductPath(await isharesListing(), ticker)
  if (!productPath) return null
  const pageUrl = `${ISHARES_BASE}${productPath}`
  const page = await getText(pageUrl)
  if (!page) return null
  const query = new URLSearchParams({
    fileType: 'csv',
    fileName: `${ticker}_holdings`,
    dataType: 'fund',
  })
  const csv = await getText(`${pageUrl}?${query.toString()}`)
  const holdings = csv ? isharesHoldings(csv.text) : []
  if (!holdings.length) return null
  const facts = isharesFundFacts(page.text, ticker)
  return {
    ...blankResult(ticker, ISHARES_ISSUER),
    fundName: facts.fundName || ticker,
    asOfDate: facts.asOfDate,
    expenseRatio: facts.expenseRatio,
    netAssets: facts.netAssets,
    sourceUrl: pageUrl,
    holdings,
  }
}

/* ---------------------------------------------------------- SPDR / SSGA */

const SPDR_ISSUER = 'SPDR / State Street'
const SPDR_URL = (ticker: string) =>
  `https://www.ssga.com/us/en/intermediary/etfs/library-content/products/fund-data/etfs/us/holdings-daily-us-en-${ticker.toLowerCase()}.xlsx`

/** `_lookup_value`: the cell after a labelled one, anywhere in the preamble. */
function lookupValue(rows: string[][], labels: string[]): string {
  const wanted = new Set(labels.map((label) => label.toLowerCase()))
  for (const row of rows) {
    const cells = row.map(clean).filter(Boolean)
    for (let index = 0; index < cells.length - 1; index += 1) {
      if (wanted.has(cells[index].toLowerCase().replace(/:$/, ''))) return cells[index + 1]
    }
  }
  return ''
}

/** `_lookup_date`: SSGA writes "As of 27-Aug-2026" in its own cell. */
function lookupAsOf(rows: string[][]): string {
  for (const row of rows) {
    const text = row.map(clean).filter(Boolean).join(' ')
    const long = /\b(?:as of|date)\b[: ]+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(text)
    if (long) return long[1]
    const short = /\b(?:as of|date)\b[: ]+(\d{1,2}-[A-Za-z]{3}-\d{4})/i.exec(text)
    if (short) return short[1]
  }
  return ''
}

/** `SpdrIssuerProvider._extract_holdings`: find the header row, then read below it. */
function spdrHoldings(rows: string[][]): EtfHolding[] {
  for (let index = 0; index < rows.length; index += 1) {
    const headers = rows[index].map((cell) => clean(cell).toLowerCase())
    if (!headers.includes('ticker') || !headers.some((header) => header.includes('weight'))) continue
    const columns = locateColumns(headers, { exactSymbol: true })
    if (!columns) return []
    return rows
      .slice(index + 1)
      .map((row) => rowToHolding(row, columns, true))
      .filter((holding): holding is EtfHolding => holding !== null)
  }
  return []
}

async function fetchSpdr(ticker: string): Promise<EtfHoldingsResult | null> {
  const downloaded = await getBuffer(SPDR_URL(ticker))
  if (!downloaded) return null
  const rows = parseXlsxRows(downloaded.buffer)
  if (!rows.length) return null
  const holdings = spdrHoldings(rows)
  if (!holdings.length) return null
  return {
    ...blankResult(ticker, SPDR_ISSUER),
    fundName: lookupValue(rows, ['fund name', 'name']) || ticker,
    asOfDate: lookupAsOf(rows),
    expenseRatio: formatPercentString(
      lookupValue(rows, ['gross expense ratio', 'net expense ratio', 'expense ratio']),
    ),
    netAssets: formatLargeNumber(lookupValue(rows, ['net assets', 'total net assets'])),
    sourceUrl: downloaded.url,
    holdings,
  }
}

/* -------------------------------------------------------------- Invesco */

const INVESCO_ISSUER = 'Invesco'
const INVESCO_HOLDINGS_PAGE = 'https://www.invesco.com/us/financial-products/etfs/holdings'
const INVESCO_QQQ_API =
  'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/holdings/fund'
const INVESCO_ABOUT = 'https://www.invesco.com/qqq-etf/en/about.html'
const INVESCO_RESOURCE_PATH =
  '/content/invesco/qqq-etf/en/about/jcr:content/root/container/container_742249799/' +
  'sectioncomponent_1252524195/container/view_all_holdings'

/** `_DYNAMIC_NON_EQUITY_CODES` / `_DYNAMIC_NON_EQUITY_TEXT`. */
const NON_EQUITY_CODES = new Set(['CURR', 'CURRCOL', 'IFUT', 'SYN'])
const NON_EQUITY_TEXT = ['cash', 'currency', 'future', 'synthetic', 'collateral']

interface InvescoRow {
  ticker?: unknown
  issuerName?: unknown
  sectorName?: unknown
  percentageOfTotalNetAssets?: unknown
  securityTypeCode?: unknown
  securityTypeName?: unknown
}

/** `_is_dynamic_equity_row`: the file lists the fund's cash and futures legs too. */
function isEquityRow(row: InvescoRow): boolean {
  if (!clean(row.ticker)) return false
  if (NON_EQUITY_CODES.has(clean(row.securityTypeCode).toUpperCase())) return false
  const type = clean(row.securityTypeName).toLowerCase()
  return !NON_EQUITY_TEXT.some((token) => type.includes(token))
}

/** `_fetch_qqq_dynamic_holdings`: QQQ has its own JSON API, and it is tried first. */
async function fetchInvescoQqq(ticker: string): Promise<EtfHoldingsResult | null> {
  const query = new URLSearchParams({ idType: 'ticker', interval: 'monthly', productType: 'ETF' })
  const response = await fetch(`${INVESCO_QQQ_API}?${query.toString()}`, {
    headers: {
      ...HEADERS,
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://www.invesco.com',
      Referer: INVESCO_ABOUT,
      ResourcePath: INVESCO_RESOURCE_PATH,
      AppId: 'invesco',
      ComponentType: 'view-all-holdings',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Invesco returned HTTP ${response.status}.`)

  const body = (await response.json()) as { holdings?: InvescoRow[]; effectiveDate?: unknown }
  const rows = Array.isArray(body.holdings) ? body.holdings : []
  const holdings: EtfHolding[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !isEquityRow(row)) continue
    const symbol = clean(row.ticker).toUpperCase()
    const weight = normalizeWeight(row.percentageOfTotalNetAssets, 'percent')
    if (!symbol || weight === null) continue
    holdings.push({ symbol, name: clean(row.issuerName), weight, sector: normalizeSector(row.sectorName) })
  }
  if (!holdings.length) return null
  return {
    ...blankResult(ticker, INVESCO_ISSUER),
    fundName: `Invesco ${ticker}`,
    asOfDate: clean(body.effectiveDate),
    sourceUrl: response.url || INVESCO_QQQ_API,
    holdings,
  }
}

/**
 * `_extract_holdings_table`: the shared holdings page, whose sector column is a running
 * one — a blank cell means the row belongs to the sector last named above it.
 */
function invescoPageHoldings(tables: HtmlTable[]): EtfHolding[] {
  for (const table of tables) {
    const symbolIndex = table.headers.indexOf('ticker')
    const weightIndex = table.headers.indexOf('% of fund')
    if (symbolIndex < 0 || weightIndex < 0) continue
    const nameIndex = table.headers.indexOf('company')
    const sectorIndex = table.headers.indexOf('sector total')
    const widest = Math.max(symbolIndex, weightIndex, Math.max(nameIndex, 0), Math.max(sectorIndex, 0))
    const holdings: EtfHolding[] = []
    let currentSector = ''
    for (const row of table.rows) {
      if (row.length <= widest) continue
      if (sectorIndex >= 0 && row[sectorIndex]) currentSector = row[sectorIndex]
      const symbol = clean(row[symbolIndex]).toUpperCase()
      const weight = normalizeWeight(row[weightIndex], 'percent')
      if (!symbol || weight === null) continue
      holdings.push({
        symbol,
        name: nameIndex >= 0 ? clean(row[nameIndex]) : '',
        weight,
        sector: normalizeSector(currentSector),
      })
    }
    if (holdings.length) return holdings
  }
  return []
}

async function fetchInvesco(ticker: string): Promise<EtfHoldingsResult | null> {
  if (ticker === 'QQQ') {
    const dynamic = await fetchInvescoQqq(ticker)
    if (dynamic) return dynamic
  }
  const query = new URLSearchParams({ audienceType: 'Investor', ticker })
  const page = await getText(`${INVESCO_HOLDINGS_PAGE}?${query.toString()}`)
  if (!page) return null
  if (!page.text.includes('Fund Holdings') && !page.text.toLowerCase().includes('holdings')) {
    return null
  }
  const holdings = invescoPageHoldings(parseTables(page.text))
  if (!holdings.length) return null
  // `_extract_title` keeps the right-hand side of "TICKER - Fund Name".
  const heading = firstHeadingOrTitle(page.text, ticker)
  const asOf = /\bas of\b\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(page.text)
  return {
    ...blankResult(ticker, INVESCO_ISSUER),
    fundName: heading.includes(' - ') ? heading.split(' - ').slice(1).join(' - ').trim() : heading,
    asOfDate: asOf ? asOf[1] : '',
    sourceUrl: page.url,
    holdings,
  }
}

/* ------------------------------------------------------------- Vanguard */

const VANGUARD_ISSUER = 'Vanguard'
const VANGUARD_API = 'https://investor.vanguard.com/investment-products/etfs/profile/api'
/** `_fetch_all_holdings` pages 500 at a time and follows `next.href`. */
const VANGUARD_PAGE_SIZE = 500

interface VanguardProfile {
  longName?: unknown
  shortName?: unknown
  expenseRatio?: unknown
}

interface VanguardHoldingsPage {
  holding?: unknown
  fund?: { entity?: unknown }
  next?: { href?: unknown }
}

async function fetchVanguardProfile(ticker: string): Promise<VanguardProfile | null> {
  try {
    const page = await getText(`${VANGUARD_API}/${ticker}/profile`)
    return page ? (JSON.parse(page.text) as VanguardProfile) : null
  } catch {
    // `_fetch_profile` swallows both a transport error and a bad body: no profile means
    // this issuer does not publish the ticker, which is a fall-through and not a failure.
    return null
  }
}

async function fetchVanguardHoldings(ticker: string): Promise<EtfHolding[]> {
  const holdings: EtfHolding[] = []
  let start = 0
  for (;;) {
    let page: VanguardHoldingsPage
    try {
      const query = new URLSearchParams({ start: String(start), count: String(VANGUARD_PAGE_SIZE) })
      const response = await getText(
        `${VANGUARD_API}/${ticker}/portfolio-holding/stock?${query.toString()}`,
      )
      if (!response) break
      page = JSON.parse(response.text) as VanguardHoldingsPage
    } catch {
      break
    }
    const raw = page.holding ?? page.fund?.entity
    const items = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
    if (!items.length) break
    for (const item of items) {
      const symbol = clean(item.ticker).toUpperCase()
      const weight = normalizeWeight(item.percentWeight, 'percent')
      if (!symbol || weight === null) continue
      holdings.push({
        symbol,
        name: clean(item.longName ?? item.shortName),
        weight,
        sector: '',
      })
    }
    if (!clean(page.next?.href)) break
    start += VANGUARD_PAGE_SIZE
  }
  return holdings
}

async function fetchVanguard(ticker: string): Promise<EtfHoldingsResult | null> {
  const profile = await fetchVanguardProfile(ticker)
  if (!profile) return null
  const holdings = await fetchVanguardHoldings(ticker)
  if (!holdings.length) return null
  const expense = Number(profile.expenseRatio)
  return {
    ...blankResult(ticker, VANGUARD_ISSUER),
    fundName: clean(profile.longName ?? profile.shortName) || ticker,
    // `_extract_expense`: Vanguard publishes the ratio already in percent.
    expenseRatio: Number.isFinite(expense) ? `${expense.toFixed(2)}%` : '--',
    sourceUrl: `https://investor.vanguard.com/investment-products/etfs/profile/${ticker}`,
    holdings,
  }
}

/* ---------------------------------------------------- First Trust / ProShares */

/** Both scrape one table out of a fund page; only the URL and the header tokens differ. */
async function fetchScrapedTable(
  ticker: string,
  options: {
    issuer: string
    url: string
    tableClass: string
    symbolTokens: string[]
    nameTokens: string[]
    weightTokens: string[]
    /** `_extract_title` splits on these, in order, and keeps the left-hand side. */
    titleSeparators: string[]
  },
): Promise<EtfHoldingsResult | null> {
  let page: { text: string; url: string } | null
  try {
    page = await getText(options.url)
  } catch {
    // Both providers swallow a transport error and fall through to the next issuer.
    return null
  }
  if (!page) return null

  const tables = parseTables(page.text)
  const classed = tables.find((table) => table.openTag.includes(options.tableClass))
  const candidates = classed ? [classed] : tables
  let holdings: EtfHolding[] = []
  for (const table of candidates) {
    const columns = locateColumns(table.headers, {
      symbolTokens: options.symbolTokens,
      nameTokens: options.nameTokens,
      weightTokens: options.weightTokens,
    })
    if (!columns) continue
    holdings = table.rows
      .map((row) => rowToHolding(row, columns, false))
      .filter((holding): holding is EtfHolding => holding !== null)
    if (holdings.length) break
  }
  if (!holdings.length) return null

  let fundName = headingText(page.text, ticker)
  for (const separator of options.titleSeparators) {
    if (fundName.includes(separator)) {
      fundName = fundName.split(separator)[0].trim()
      break
    }
  }
  return {
    ...blankResult(ticker, options.issuer),
    fundName: fundName || ticker,
    sourceUrl: page.url,
    holdings,
  }
}

function fetchFirstTrust(ticker: string): Promise<EtfHoldingsResult | null> {
  return fetchScrapedTable(ticker, {
    issuer: 'First Trust',
    url: `https://www.ftportfolios.com/Retail/Etf/EtfHoldings.aspx?Ticker=${encodeURIComponent(ticker)}`,
    tableClass: 'fundSilverGrid',
    symbolTokens: ['ticker', 'symbol'],
    nameTokens: ['name', 'security'],
    weightTokens: ['weight'],
    titleSeparators: [' - ', ' | ', '('],
  })
}

function fetchProShares(ticker: string): Promise<EtfHoldingsResult | null> {
  return fetchScrapedTable(ticker, {
    issuer: 'ProShares',
    url: `https://www.proshares.com/funds/${ticker.toLowerCase()}.html`,
    tableClass: 'holdings-table',
    symbolTokens: ['ticker', 'symbol'],
    nameTokens: ['description', 'name'],
    weightTokens: ['exposure weight', 'weight'],
    titleSeparators: [' - ', ' | '],
  })
}

/* ------------------------------------------------------- Yahoo enrichment */

/** `SECTOR_DISPLAY_NAMES`. */
const SECTOR_DISPLAY_NAMES: Record<string, string> = {
  realestate: 'Real Estate',
  real_estate: 'Real Estate',
  consumer_cyclical: 'Consumer Cyclical',
  basic_materials: 'Basic Materials',
  consumer_defensive: 'Consumer Defensive',
  technology: 'Technology',
  communication_services: 'Communication Services',
  financial_services: 'Financial Services',
  utilities: 'Utilities',
  industrials: 'Industrials',
  energy: 'Energy',
  healthcare: 'Healthcare',
}

function titleCase(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b[a-z]/g, (character) => character.toUpperCase())
}

/** `funds_data.sector_weightings` into the display map, largest first. */
function sectorWeights(entries: Array<Record<string, unknown>> | undefined): EtfSectorWeight[] {
  const sectors = new Map<string, number>()
  for (const entry of entries ?? []) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, value] of Object.entries(entry)) {
      const number = Number(value)
      if (!Number.isFinite(number)) continue
      sectors.set(SECTOR_DISPLAY_NAMES[key] ?? titleCase(key), Math.round(number * 100 * 100) / 100)
    }
  }
  return [...sectors]
    .map(([sector, percent]) => ({ sector, percent }))
    .sort((a, b) => b.percent - a.percent)
}

/**
 * The one Yahoo call the loader makes, shared by the enrichment pass and the fallback.
 *
 * The modules list stays inline: `quoteSummary` is overloaded on the literal array, so
 * hoisting it behind a named type erases every field back to `{}`.
 */
function fundSummary(ticker: string) {
  return resolveEtfSnapshot(`etf-yahoo-summary:v1:${ticker}`, HOLDINGS_TTL_MS, () =>
    paced(() => yahoo.quoteSummary(ticker, {
      modules: ['topHoldings', 'fundProfile', 'price', 'summaryDetail', 'defaultKeyStatistics'],
    })),
  ).catch(() => null)
}

/**
 * `_enrich_with_yfinance`: fill in only what the issuer left blank.
 *
 * Every branch is conditional on the issuer's own value being absent. An issuer file is
 * the authority on its own fund, and overwriting a published expense ratio with Yahoo's
 * rounded one would make the page disagree with the document it links to as its source.
 */
async function enrichWithYahoo(result: EtfHoldingsResult): Promise<EtfHoldingsResult> {
  const summary = await fundSummary(result.ticker)
  if (!summary) return result

  if (!result.fundName || result.fundName === result.ticker) {
    const name = clean(summary.price?.longName ?? summary.price?.shortName)
    if (name) result.fundName = name
  }
  if (result.expenseRatio === '--' || result.expenseRatio === '') {
    const ratio = Number(summary.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio)
    if (Number.isFinite(ratio)) result.expenseRatio = formatPercentString(ratio * 100)
  }
  if (result.netAssets === '--' || result.netAssets === '') {
    const assets = summary.summaryDetail?.totalAssets ?? summary.defaultKeyStatistics?.totalAssets
    if (Number.isFinite(Number(assets))) result.netAssets = formatLargeNumber(assets)
  }
  if (!result.sectorBreakdown.length) {
    result.sectorBreakdown = sectorWeights(
      summary.topHoldings?.sectorWeightings as Array<Record<string, unknown>> | undefined,
    )
  }
  return result
}

/**
 * `_load_yfinance_fallback`: a top-holdings list, not the book.
 *
 * Ten or so names instead of five hundred, which is why the result is flagged
 * `isPartial` and carries `coverageNote` — the page's status line says so rather than
 * presenting a ten-row list as the fund.
 */
async function fetchYahooFallback(ticker: string): Promise<EtfHoldingsResult | null> {
  const summary = await fundSummary(ticker)
  if (!summary) return null

  const holdings: EtfHolding[] = []
  for (const row of summary.topHoldings?.holdings ?? []) {
    const symbol = clean(row.symbol).toUpperCase()
    const weight = normalizeWeight(row.holdingPercent, 'fraction')
    if (!symbol || weight === null) continue
    holdings.push({ symbol, name: clean(row.holdingName), weight, sector: '' })
  }
  if (!holdings.length) return null

  const fees = summary.fundProfile?.feesExpensesInvestment
  const ratio = Number(fees?.annualReportExpenseRatio)
  const family = clean(summary.fundProfile?.family)
  return {
    ticker,
    fundName: clean(summary.price?.longName ?? summary.price?.shortName) || ticker,
    issuer: family
      ? `Yahoo Finance Top Holdings Fallback (${family})`
      : 'Yahoo Finance Top Holdings Fallback',
    asOfDate: '',
    expenseRatio: Number.isFinite(ratio) ? formatPercentString(ratio * 100) : '--',
    netAssets: Number.isFinite(Number(fees?.totalNetAssets))
      ? formatLargeNumber(fees?.totalNetAssets)
      : '--',
    sourceUrl: `https://finance.yahoo.com/quote/${ticker}/holdings`,
    holdings,
    sectorBreakdown: sectorWeights(
      summary.topHoldings?.sectorWeightings as Array<Record<string, unknown>> | undefined,
    ),
    isPartial: true,
    coverageNote:
      'Yahoo Finance fallback provides a top-holdings list, not the full ETF holdings list.',
  }
}

/* ------------------------------------------------------------- the loader */

/**
 * `EtfHoldingsService.providers`, in order.
 *
 * ARK first because its lookup is a dictionary miss for anything else; the rest are
 * ordered by how much of the US book they cover. A provider that does not publish the
 * ticker answers `null` and the chain moves on; one that *throws* records the reason and
 * the chain moves on too, so a single issuer outage cannot take the page down.
 */
const PROVIDERS: ReadonlyArray<{ issuer: string; fetch: (ticker: string) => Promise<EtfHoldingsResult | null> }> = [
  { issuer: ARK_ISSUER, fetch: fetchArk },
  { issuer: ISHARES_ISSUER, fetch: fetchIshares },
  { issuer: SPDR_ISSUER, fetch: fetchSpdr },
  { issuer: INVESCO_ISSUER, fetch: fetchInvesco },
  { issuer: VANGUARD_ISSUER, fetch: fetchVanguard },
  { issuer: 'First Trust', fetch: fetchFirstTrust },
  { issuer: 'ProShares', fetch: fetchProShares },
]

/** `load()` sorts every provider's rows by weight, so a null weight sorts last. */
function sortByWeight(holdings: EtfHolding[]): void {
  holdings.sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1))
}

async function loadHoldings(symbol: string, enrich: boolean, allowYahooFallback = true): Promise<EtfHoldingsResult> {
  const errors: string[] = []
  const issuer = preferredEtfIssuer(symbol)
  const providers = issuer ? PROVIDERS.filter(provider => provider.issuer === issuer) : PROVIDERS
  for (const provider of providers) {
    let result: EtfHoldingsResult | null = null
    try {
      result = await provider.fetch(symbol)
    } catch (error) {
      errors.push(`${provider.issuer}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!result) continue
    if (enrich) result = await enrichWithYahoo(result)
    sortByWeight(result.holdings)
    return result
  }

  const fallback = allowYahooFallback ? await fetchYahooFallback(symbol).catch(() => null) : null
  if (fallback) {
    sortByWeight(fallback.holdings)
    return fallback
  }
  throw new Error(
    errors.length
      ? `Issuer not yet supported for full holdings import. Tried official sources: ${errors.join(', ')}`
      : 'Issuer not yet supported for full holdings import.',
  )
}

/** Heatmap requires the issuer's full basket and never calls Yahoo for enrichment. */
export function getIssuerEtfHoldings(ticker: string, force = false): Promise<EtfHoldingsResult> {
  const symbol = ticker.trim().toUpperCase()
  if (!symbol) return Promise.reject(new Error('Ticker is required.'))
  return resolveEtfSnapshot(`etf-holdings:issuer-only:${symbol}`, HOLDINGS_TTL_MS,
    async () => ({ ...await loadHoldings(symbol, false, false), fetchedAt: Date.now() }), { force })
}

/** Route common funds directly instead of probing seven unrelated issuer websites. */
export function preferredEtfIssuer(ticker: string): string | undefined {
  if (ARK_FUNDS[ticker]) return ARK_ISSUER
  if (['SPY', 'DIA', 'GLD', 'GLDM', 'SPLG', 'SPYM', 'MDY', 'SDY', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'].includes(ticker)) return SPDR_ISSUER
  if (['QQQ', 'QQQM', 'RSP', 'SQQQ'].includes(ticker)) return ticker === 'SQQQ' ? 'ProShares' : INVESCO_ISSUER
  if (['VOO', 'VTI', 'VT', 'VTV', 'VUG', 'VEA', 'VWO', 'VXUS', 'BND', 'BNDX', 'VNQ', 'VIG', 'VYM', 'VB', 'VO', 'VGT'].includes(ticker)) return VANGUARD_ISSUER
  return undefined
}

/** Public top holdings are useful even when an issuer's full download is unavailable. */
export function parsePublicEtfHoldings(html: string, ticker: string): EtfHoldingsResult {
  const table = parseTables(html).find(table => table.headers.includes('symbol') && table.headers.some(header => header.includes('weight')))
  if (!table) throw new Error(`No published holdings table for ${ticker}.`)
  const symbolIndex = table.headers.indexOf('symbol')
  const nameIndex = table.headers.indexOf('name')
  const weightIndex = table.headers.findIndex(header => header.includes('weight'))
  const holdings: EtfHolding[] = []
  for (const cells of table.rows) {
    const symbol = clean(cells[symbolIndex]).toUpperCase()
    const weight = normalizeWeight(cells[weightIndex], 'percent')
    if (!/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(symbol) || weight === null || weight < 0) continue
    holdings.push({ symbol, name: clean(cells[nameIndex]), weight, sector: '' })
  }
  if (!holdings.length) throw new Error(`No usable published holdings for ${ticker}.`)
  sortByWeight(holdings)
  return {
    ...blankResult(ticker, 'Stock Analysis'),
    fundName: headingText(html, ticker).replace(/\s+Holdings(?:\s+(?:List|Information))?\s*$/i, ''),
    sourceUrl: `https://stockanalysis.com/etf/${ticker.toLowerCase()}/holdings/`,
    holdings,
    // The public table can be truncated. Never claim that this is the complete book.
    isPartial: true,
    coverageNote: `Public holdings snapshot (${holdings.length} rows); may not include the full fund.`,
  }
}

async function loadFundSnapshot(symbol: string, enrich: boolean, force: boolean): Promise<EtfHoldingsResult> {
  const issuer = preferredEtfIssuer(symbol)
  const provider = PROVIDERS.find(provider => provider.issuer === issuer)
  let result: EtfHoldingsResult | null = null
  if (provider) {
    // Reuse a full basket already downloaded by Heatmap or the S&P 500 page.
    // Share the in-flight issuer download as well as its disk cache with other pages.
    try { result = await getIssuerEtfHoldings(symbol, force) } catch { /* Try the public snapshot next. */ }
  }
  if (!result && provider) {
    const previous = cache.get<EtfHoldingsResult>(`etf-fund:v2:${symbol}:${enrich ? 'enriched' : 'basic'}`, { allowStale: true, observe: false })
    if (previous && !previous.value.isPartial) throw new Error(`${issuer} is unavailable. Retaining the last complete holdings snapshot.`)
  }
  if (!result) {
    try {
      result = parsePublicEtfHoldings(await fetchEtfHtml(`https://stockanalysis.com/etf/${symbol.toLowerCase()}/holdings/`), symbol)
    } catch { /* One cached Yahoo summary is the final fallback, not a universe sweep. */ }
  }
  if (!result) result = await fetchYahooFallback(symbol)
  if (!result) throw new Error(`No holdings available for ${symbol}. The issuer and public snapshot are unavailable; try again later.`)
  // Directory metadata is optional. It is shared, persisted and costs no Yahoo calls.
  const directory = await getEtfDirectory().catch(() => null)
  const entry = directory?.rows.find(row => row.ticker === symbol)
  if (entry?.name && (!result.fundName || result.fundName === symbol || result.issuer === 'Stock Analysis')) result.fundName = entry.name
  if (entry?.netAssets && result.netAssets === '--') result.netAssets = formatLargeNumber(entry.netAssets)
  if (!result.sectorBreakdown.length) {
    const sectors = new Map<string, number>()
    for (const holding of result.holdings) {
      if (holding.sector && holding.weight !== null) sectors.set(holding.sector, (sectors.get(holding.sector) ?? 0) + holding.weight * 100)
    }
    result.sectorBreakdown = [...sectors].map(([sector, percent]) => ({ sector, percent })).sort((a, b) => b.percent - a.percent)
  }
  if (enrich && !result.isPartial) result = await enrichWithYahoo(result)
  sortByWeight(result.holdings)
  return { ...result, fetchedAt: result.fetchedAt ?? Date.now() }
}

export function getEtfHoldings(ticker: string, force = false, enrich = false): Promise<EtfHoldingsResult> {
  const symbol = ticker.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) return Promise.reject(new Error('Enter a valid ETF ticker.'))
  return resolveEtfSnapshot(`etf-fund:v2:${symbol}:${enrich ? 'enriched' : 'basic'}`, HOLDINGS_TTL_MS,
    () => loadFundSnapshot(symbol, enrich, force), { force })
}
