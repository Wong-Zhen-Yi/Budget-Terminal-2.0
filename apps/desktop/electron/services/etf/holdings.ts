/**
 * ETF holdings, from the issuers' own published files.
 *
 * A narrowed port of `EtfHoldingsService` in the PySide6 `etf_holdings.py`. That service
 * carries seven issuer providers because its ETF Analyser page accepts any ticker; the
 * Heatmap page offers exactly three buttons, so only the two providers behind them are
 * ported — SPDR/State Street for SPY and DIA, Invesco for QQQ — plus the same Yahoo
 * top-holdings fallback the reference falls back to when no issuer matches. The other
 * five providers would be unreachable code until the ETF page is migrated.
 *
 * **These hosts deliberately stay outside `paced()`**, on the `services/fearGreed.ts`
 * precedent: the rate gate models Yahoo's 429 behaviour and halves its own budget on
 * one, so letting an SSGA or Invesco hiccup throttle the dashboard would be strictly
 * worse than letting this page fail alone. The Yahoo fallback underneath *is* Yahoo, and
 * it does go through the gate.
 */

import { normalizeSector } from '../../shared/heatmap.js'
import { cache } from '../cache.js'
import { paced, yahoo } from '../yahoo/client.js'
import { parseXlsxRows } from './xlsx.js'

export interface EtfHolding {
  symbol: string
  name: string
  /** A fraction, not a percentage: `0.0873` is 8.73% of the fund. */
  weight: number
  sector: string
}

export interface EtfHoldingsResult {
  ticker: string
  fundName: string
  issuer: string
  asOfDate: string
  sourceUrl: string
  holdings: EtfHolding[]
  /** True for the Yahoo fallback, which is a top-holdings list rather than the book. */
  isPartial: boolean
}

/** `DEFAULT_TIMEOUT = 20`. */
const TIMEOUT_MS = 20_000

/** The reference's own session header. */
const HEADERS = {
  'User-Agent': 'BudgetTerminal/1.0 (+https://github.com/)',
  'Accept-Language': 'en-US,en;q=0.9',
}

/**
 * An issuer's holdings file changes once a day, and it is the same file for every user
 * of the page. Cached far longer than a quote so switching index buttons back and forth
 * costs one download, not one per visit.
 */
const HOLDINGS_TTL_MS = 6 * 60 * 60 * 1000

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * `_normalize_weight`. The two issuer feeds both publish percent, so both callers pass
 * `'percent'`; the `'auto'` branch exists because the reference's other providers use it.
 */
function normalizeWeight(value: unknown, scale: 'percent' | 'fraction' | 'auto' = 'auto'): number | null {
  const text = clean(value).replace(/%/g, '').replace(/,/g, '')
  if (!text) return null
  const number = Number(text)
  if (!Number.isFinite(number)) return null
  if (scale === 'percent') return number / 100
  if (scale === 'fraction') return number
  return Math.abs(number) > 1 ? number / 100 : number
}

async function getBuffer(url: string): Promise<{ buffer: Buffer; url: string }> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (response.status === 404) throw new Error(`${url} returned HTTP 404.`)
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`)
  return { buffer: Buffer.from(await response.arrayBuffer()), url: response.url || url }
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
  let headerIndex = -1
  let symbolIndex = -1
  let weightIndex = -1
  let nameIndex = -1
  let sectorIndex = -1

  for (let index = 0; index < rows.length; index += 1) {
    const lowered = rows[index].map((cell) => clean(cell).toLowerCase())
    if (!lowered.includes('ticker') || !lowered.some((cell) => cell.includes('weight'))) continue
    headerIndex = index
    symbolIndex = lowered.indexOf('ticker')
    nameIndex = lowered.indexOf('name')
    sectorIndex = lowered.findIndex((cell) => cell.includes('sector'))
    weightIndex = lowered.findIndex((cell) => cell.includes('weight'))
    break
  }
  if (headerIndex < 0 || symbolIndex < 0 || weightIndex < 0) return []

  const holdings: EtfHolding[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.length <= Math.max(symbolIndex, weightIndex, nameIndex, sectorIndex)) continue
    const symbol = clean(row[symbolIndex]).toUpperCase()
    const weight = normalizeWeight(row[weightIndex], 'percent')
    if (!symbol || weight === null) continue
    holdings.push({
      symbol,
      name: nameIndex >= 0 ? clean(row[nameIndex]) : '',
      weight,
      sector: sectorIndex >= 0 ? normalizeSector(row[sectorIndex]) : '',
    })
  }
  return holdings
}

async function fetchSpdr(ticker: string): Promise<EtfHoldingsResult | null> {
  const { buffer, url } = await getBuffer(SPDR_URL(ticker))
  const rows = parseXlsxRows(buffer)
  const holdings = spdrHoldings(rows)
  if (!holdings.length) return null
  return {
    ticker,
    fundName: lookupValue(rows, ['fund name', 'name']) || ticker,
    issuer: SPDR_ISSUER,
    asOfDate: lookupAsOf(rows),
    sourceUrl: url,
    holdings,
    isPartial: false,
  }
}

/* -------------------------------------------------------------- Invesco */

const INVESCO_ISSUER = 'Invesco'
const INVESCO_URL =
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

async function fetchInvesco(ticker: string): Promise<EtfHoldingsResult | null> {
  const query = new URLSearchParams({ idType: 'ticker', interval: 'monthly', productType: 'ETF' })
  const response = await fetch(`${INVESCO_URL}?${query.toString()}`, {
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
    holdings.push({
      symbol,
      name: clean(row.issuerName),
      weight,
      sector: normalizeSector(row.sectorName),
    })
  }
  if (!holdings.length) return null
  return {
    ticker,
    fundName: `Invesco ${ticker}`,
    issuer: INVESCO_ISSUER,
    asOfDate: clean(body.effectiveDate),
    sourceUrl: response.url || INVESCO_URL,
    holdings,
    isPartial: false,
  }
}

/* ------------------------------------------------------- Yahoo fallback */

/**
 * `_load_yfinance_fallback`: a top-holdings list, not the book.
 *
 * Ten or so names instead of five hundred, which is why the result is flagged `isPartial`
 * — the page's status line says so rather than presenting a ten-tile map as the index.
 */
async function fetchYahooFallback(ticker: string): Promise<EtfHoldingsResult | null> {
  const summary = await paced(() =>
    yahoo.quoteSummary(ticker, { modules: ['topHoldings', 'fundProfile', 'price'] }),
  )
  const rows = summary.topHoldings?.holdings ?? []
  const holdings: EtfHolding[] = []
  for (const row of rows) {
    const symbol = clean(row.symbol).toUpperCase()
    const weight = normalizeWeight(row.holdingPercent, 'fraction')
    if (!symbol || weight === null) continue
    holdings.push({ symbol, name: clean(row.holdingName), weight, sector: '' })
  }
  if (!holdings.length) return null

  const family = clean(summary.fundProfile?.family)
  return {
    ticker,
    fundName: clean(summary.price?.longName ?? summary.price?.shortName) || ticker,
    issuer: family
      ? `Yahoo Finance Top Holdings Fallback (${family})`
      : 'Yahoo Finance Top Holdings Fallback',
    asOfDate: '',
    sourceUrl: `https://finance.yahoo.com/quote/${ticker}/holdings`,
    holdings,
    isPartial: true,
  }
}

/* ------------------------------------------------------------ the loader */

/** Which issuer publishes which of the three ETFs the Heatmap page can select. */
const PROVIDERS: Record<string, (ticker: string) => Promise<EtfHoldingsResult | null>> = {
  SPY: fetchSpdr,
  DIA: fetchSpdr,
  QQQ: fetchInvesco,
}

async function loadHoldings(ticker: string): Promise<EtfHoldingsResult> {
  const symbol = ticker.trim().toUpperCase()
  if (!symbol) throw new Error('Ticker is required.')

  const errors: string[] = []
  const provider = PROVIDERS[symbol]
  if (provider) {
    try {
      const result = await provider(symbol)
      if (result) {
        // `load()` sorts every provider's rows by weight before returning them, so the
        // treemap's group ordering does not depend on how an issuer ordered its file.
        result.holdings.sort((a, b) => b.weight - a.weight)
        return result
      }
      errors.push(`${symbol}: the issuer file carried no usable holdings.`)
    } catch (error) {
      errors.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const fallback = await fetchYahooFallback(symbol).catch(() => null)
  if (fallback) {
    fallback.holdings.sort((a, b) => b.weight - a.weight)
    return fallback
  }
  throw new Error(
    errors.length
      ? `No holdings source answered for ${symbol}. Tried: ${errors.join('; ')}`
      : `No holdings source answered for ${symbol}.`,
  )
}

export function getEtfHoldings(ticker: string, force = false): Promise<EtfHoldingsResult> {
  const symbol = ticker.trim().toUpperCase()
  return cache
    .resolveWithStaleFallback(
      `etf-holdings:${symbol}`,
      HOLDINGS_TTL_MS,
      () => loadHoldings(symbol),
      { force },
    )
    .then((result) => result.value)
}
