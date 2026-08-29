/**
 * Peer selection for the Valuation page, ported from `workers/valuation.py`.
 *
 * The scoring is pure — it reads a Yahoo metadata record per candidate and nothing else —
 * so it lives beside the valuation maths rather than in the service, and
 * `npm run probe:valuation -- --offline` can assert the ranking without a network call.
 *
 * The shape of the answer matters more than any single score: the loaded ticker is always
 * row one, custom peers follow in the order they were added, and auto peers fill whatever
 * is left of the row budget.
 */

import { SECTOR_DATA } from './sectors.js'
import { finiteOrNull, type ValuationPeerRow } from './valuation.js'

export const PEER_ROW_LIMIT = 5
export const PEER_CANDIDATE_LIMIT = 16
export const PEER_CUSTOM_ROW_LIMIT = 12
export const DEFAULT_PEERS = ['MSFT', 'AAPL', 'GOOGL', 'AMZN'] as const

/** Industry keyword buckets, in the reference's order. First match wins the 120-point tier. */
export const INDUSTRY_PEER_GROUPS: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  [
    ['semiconductor', 'semiconductors', 'chip', 'integrated circuit'],
    ['NVDA', 'AMD', 'AVGO', 'QCOM', 'INTC', 'MU', 'TSM', 'ASML', 'MRVL'],
  ],
  [
    ['software', 'cloud', 'infrastructure software', 'application software'],
    ['MSFT', 'ORCL', 'CRM', 'ADBE', 'NOW', 'INTU', 'SNOW', 'PANW', 'ADSK'],
  ],
  [
    ['consumer electronics', 'computer hardware', 'communication equipment'],
    ['AAPL', 'SONY', 'DELL', 'HPQ', 'LOGI', 'CSCO', 'ANET'],
  ],
  [
    ['internet content', 'internet information', 'interactive media', 'entertainment'],
    ['GOOGL', 'META', 'NFLX', 'SPOT', 'PINS', 'SNAP', 'DIS'],
  ],
  [
    ['internet retail', 'specialty retail', 'e-commerce', 'auto manufacturers', 'automobiles'],
    ['AMZN', 'MELI', 'SHOP', 'EBAY', 'TSLA', 'TM', 'F', 'GM'],
  ],
  [
    ['banks', 'bank', 'credit services'],
    ['JPM', 'BAC', 'WFC', 'C', 'USB', 'PNC', 'TFC', 'COF', 'AXP'],
  ],
  [
    ['capital markets', 'asset management', 'financial data'],
    ['GS', 'MS', 'BLK', 'SCHW', 'CME', 'ICE', 'SPGI', 'MCO'],
  ],
  [
    ['oil', 'gas', 'energy', 'exploration', 'integrated oil'],
    ['XOM', 'CVX', 'COP', 'EOG', 'OXY', 'SHEL', 'BP', 'TTE', 'SLB'],
  ],
  [
    ['drug manufacturer', 'pharmaceutical', 'biotechnology', 'biotech'],
    ['LLY', 'NVO', 'JNJ', 'MRK', 'ABBV', 'PFE', 'BMY', 'AMGN', 'GILD', 'REGN'],
  ],
  [
    ['medical', 'diagnostics', 'healthcare plans', 'medical devices'],
    ['UNH', 'ELV', 'CI', 'HUM', 'TMO', 'DHR', 'ABT', 'SYK', 'ISRG', 'MDT'],
  ],
  [
    ['discount stores', 'grocery stores', 'household', 'beverages', 'packaged foods'],
    ['WMT', 'COST', 'TGT', 'DG', 'DLTR', 'KR', 'PG', 'KO', 'PEP', 'MDLZ'],
  ],
  [
    ['home improvement', 'restaurants', 'apparel'],
    ['HD', 'LOW', 'MCD', 'SBUX', 'CMG', 'YUM', 'NKE', 'LULU', 'TJX'],
  ],
  [
    ['reit', 'real estate'],
    ['PLD', 'AMT', 'EQIX', 'CCI', 'PSA', 'O', 'WELL', 'SPG', 'VICI'],
  ],
  [
    ['utilities', 'utility', 'regulated electric'],
    ['NEE', 'DUK', 'SO', 'AEP', 'EXC', 'SRE', 'PEG', 'ED', 'XEL'],
  ],
  [
    ['aerospace', 'defense'],
    ['RTX', 'LMT', 'NOC', 'GD', 'BA', 'GE', 'HON', 'TXT'],
  ],
  [
    ['farm', 'machinery', 'industrial', 'specialty industrial'],
    ['CAT', 'DE', 'ETN', 'EMR', 'ITW', 'MMM', 'PH', 'ROK'],
  ],
]

const SECTOR_ALIASES: Record<string, string> = {
  technology: 'Technology',
  financialservices: 'Financials',
  financials: 'Financials',
  healthcare: 'Healthcare',
  consumercyclical: 'Consumer Cyclical',
  consumerdefensive: 'Consumer Defensive',
  communicationservices: 'Communication Services',
  energy: 'Energy',
  industrials: 'Industrials',
  utilities: 'Utilities',
  realestate: 'Real Estate',
  basicmaterials: 'Basic Materials',
}

/** The Yahoo metadata this module reads. Everything is optional; nothing is required. */
export interface PeerInfo {
  shortName?: string | null
  longName?: string | null
  sector?: string | null
  industry?: string | null
  quoteType?: string | null
  marketCap?: number | null
  currentPrice?: number | null
  regularMarketPrice?: number | null
  revenueGrowth?: number | null
  profitMargins?: number | null
  trailingPE?: number | null
  forwardPE?: number | null
  enterpriseToEbitda?: number | null
  freeCashflow?: number | null
}

function peerText(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', ' and ')
    .replaceAll('/', ' ')
    .replaceAll('-', ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

function peerKey(value: unknown): string {
  return [...peerText(value)].filter((char) => /[a-z0-9]/.test(char)).join('')
}

function peerMatches(text: string, keywords: readonly string[]): boolean {
  const textKey = peerKey(text)
  for (const keyword of keywords) {
    const keywordText = peerText(keyword)
    const keywordKey = peerKey(keywordText)
    if (keywordText && text.includes(keywordText)) return true
    if (keywordKey && textKey.includes(keywordKey)) return true
  }
  return false
}

function addCandidates(
  scores: Map<string, number>,
  symbols: readonly string[],
  sourceScore: number,
  currentSymbol: string,
): void {
  for (const raw of symbols) {
    const peer = String(raw ?? '').toUpperCase().trim()
    if (!peer || peer === currentSymbol) continue
    scores.set(peer, Math.max(scores.get(peer) ?? 0, sourceScore))
  }
}

/** Upper-case, de-duplicate and drop the anchor from a user-supplied peer list. */
export function normalizePeerSymbols(values: unknown, currentSymbol = ''): string[] {
  if (!Array.isArray(values)) return []
  const anchor = String(currentSymbol ?? '').toUpperCase().trim()
  const symbols: string[] = []
  for (const raw of values) {
    const peer = String(raw ?? '').toUpperCase().trim()
    if (!peer || peer === anchor || symbols.includes(peer)) continue
    symbols.push(peer)
  }
  return symbols
}

function peerSectorName(sector: unknown): string {
  const key = peerKey(sector)
  if (key in SECTOR_ALIASES) return SECTOR_ALIASES[key]
  for (const name of Object.keys(SECTOR_DATA)) {
    const nameKey = peerKey(name)
    if (key && (key === nameKey || key.includes(nameKey) || nameKey.includes(key))) return name
  }
  return ''
}

/** The source tiers: 120 for an industry bucket, 90/70 for the sector, 10 for the defaults. */
export function peerCandidateScores(symbol: string, info: PeerInfo): Map<string, number> {
  const currentSymbol = String(symbol ?? '').toUpperCase().trim()
  const industry = peerText(info.industry)
  const sectorName = peerSectorName(info.sector)
  const scores = new Map<string, number>()
  let matchedIndustry = false
  for (const [keywords, symbols] of INDUSTRY_PEER_GROUPS) {
    if (symbols.includes(currentSymbol) || peerMatches(industry, keywords)) {
      matchedIndustry = true
      addCandidates(scores, symbols, 120, currentSymbol)
    }
  }
  if (sectorName) {
    addCandidates(scores, SECTOR_DATA[sectorName] ?? [], matchedIndustry ? 70 : 90, currentSymbol)
  }
  addCandidates(scores, DEFAULT_PEERS, 10, currentSymbol)
  return scores
}

/** The candidates whose metadata is worth fetching, highest source tier first. */
export function peerCandidateSymbols(symbol: string, info: PeerInfo): string[] {
  const scores = peerCandidateScores(symbol, info)
  return [...scores.keys()]
    .sort((left, right) => (scores.get(right) ?? 0) - (scores.get(left) ?? 0))
    .slice(0, PEER_CANDIDATE_LIMIT)
}

function marketCapScore(anchorCap: number | null, peerCap: number | null): number {
  if (anchorCap === null || peerCap === null || anchorCap <= 0 || peerCap <= 0) return 0
  const distance = Math.abs(Math.log(peerCap / anchorCap))
  if (!Number.isFinite(distance)) return 0
  return Math.max(0, 30 - distance * 15)
}

/** Score one candidate against the anchor: industry, sector, quote type, then size. */
export function peerScore(
  symbol: string,
  info: PeerInfo,
  peerSymbol: string,
  peerInfo: PeerInfo,
  sourceScore: number,
): number {
  let score = sourceScore
  const anchorIndustry = peerKey(info.industry)
  const candidateIndustry = peerKey(peerInfo.industry)
  if (anchorIndustry && candidateIndustry) {
    if (anchorIndustry === candidateIndustry) score += 60
    else if (anchorIndustry.includes(candidateIndustry) || candidateIndustry.includes(anchorIndustry)) {
      score += 25
    }
  }
  const anchorSector = peerSectorName(info.sector)
  if (anchorSector && anchorSector === peerSectorName(peerInfo.sector)) score += 35
  const quoteType = String(peerInfo.quoteType ?? '').toUpperCase().trim()
  if (quoteType && quoteType !== 'EQUITY') score -= 40
  else if (quoteType === 'EQUITY') score += 5
  score += marketCapScore(finiteOrNull(info.marketCap), finiteOrNull(peerInfo.marketCap))
  if (peerSymbol === symbol) score -= 1000
  return score
}

/**
 * The final row order: the anchor, then every custom peer, then auto peers by score.
 *
 * The row budget grows with the custom list so adding a peer never silently pushes an
 * auto row out of a five-row table, and is capped at `PEER_CUSTOM_ROW_LIMIT`.
 */
export function peerSymbols(
  symbol: string,
  info: PeerInfo,
  peerInfos: Record<string, PeerInfo> = {},
  customPeers: unknown = null,
  rowLimitInput: number | null = null,
): string[] {
  const currentSymbol = String(symbol ?? '').toUpperCase().trim()
  const customSymbols = normalizePeerSymbols(customPeers, currentSymbol)
  const budget =
    rowLimitInput ??
    (customSymbols.length
      ? Math.max(PEER_ROW_LIMIT, 1 + customSymbols.length + Math.max(0, PEER_ROW_LIMIT - 1))
      : PEER_ROW_LIMIT)
  const rowLimit = Math.min(Math.max(Math.trunc(budget), PEER_ROW_LIMIT), PEER_CUSTOM_ROW_LIMIT)
  const sourceScores = peerCandidateScores(currentSymbol, info)
  const ordered = [...sourceScores.keys()].sort(
    (left, right) =>
      peerScore(currentSymbol, info, right, peerInfos[right] ?? {}, sourceScores.get(right) ?? 0) -
      peerScore(currentSymbol, info, left, peerInfos[left] ?? {}, sourceScores.get(left) ?? 0),
  )
  const symbols = currentSymbol ? [currentSymbol] : []
  for (const peer of customSymbols) {
    if (peer && !symbols.includes(peer)) symbols.push(peer)
    if (symbols.length >= rowLimit) return symbols
  }
  for (const peer of ordered) {
    if (peer && !symbols.includes(peer)) symbols.push(peer)
    if (symbols.length >= rowLimit) break
  }
  return symbols
}

/** A candidate whose metadata came back empty is dropped rather than shown as a blank row. */
export function peerInfoHasUsableData(info: PeerInfo | null | undefined): boolean {
  if (!info || typeof info !== 'object') return false
  return [info.shortName, info.longName, info.currentPrice, info.regularMarketPrice, info.marketCap]
    .some((value) => value !== null && value !== undefined)
}

/** Build one displayed peer row from a candidate's Yahoo metadata. */
export function buildPeerRow(
  peer: string,
  info: PeerInfo,
  source: ValuationPeerRow['source'],
): ValuationPeerRow {
  const marketCap = finiteOrNull(info.marketCap)
  const freeCashFlow = finiteOrNull(info.freeCashflow)
  const revenueGrowth = finiteOrNull(info.revenueGrowth)
  const profitMargins = finiteOrNull(info.profitMargins)
  return {
    ticker: peer,
    company: String(info.shortName ?? info.longName ?? '').trim() || peer,
    source,
    marketCap,
    revenueGrowth: revenueGrowth === null ? null : revenueGrowth * 100,
    netMargin: profitMargins === null ? null : profitMargins * 100,
    pe: finiteOrNull(info.trailingPE),
    forwardPe: finiteOrNull(info.forwardPE),
    evEbitda: finiteOrNull(info.enterpriseToEbitda),
    fcfYield: freeCashFlow !== null && marketCap ? (freeCashFlow / marketCap) * 100 : null,
  }
}
