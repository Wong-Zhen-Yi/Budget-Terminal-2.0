import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import type {
  EnvelopeError,
  GoldBlock,
  GoldEtf,
  GoldMarket,
  GoldMining,
  GoldPayload,
  GoldQuarterly,
  GoldAboveGround,
} from '../shared/contract.js'
import {
  GOLD_MARKET_SOURCE,
  GOLD_USGS_SOURCE,
  GOLD_WGC_SOURCE,
  buildGoldPayload,
  emptyGoldMarket,
  goldValue,
  parseAboveGroundHtml,
  parseGoldDemandHtml,
  parseGoldEtfHtml,
  parseUsgsGoldText,
} from '../shared/gold.js'
import { localIsoSeconds } from '../shared/crypto.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL } from './cache.js'
import { getQuote } from './yahoo/quotes.js'

export const GOLD_SOURCE = 'Gold physical fundamentals'

const WGC_ROOT = 'https://www.gold.org'
const DEMAND_LANDING_URL = `${WGC_ROOT}/goldhub/research/gold-demand-trends`
const ABOVE_GROUND_URL = `${WGC_ROOT}/goldhub/data/how-much-gold`
const SITEMAP_URL = `${WGC_ROOT}/sitemap.xml`
const USGS_ROOT = 'https://pubs.usgs.gov/periodicals'
const TIMEOUT_MS = 20_000

const HEADERS = {
  'User-Agent': 'BudgetTerminal/1.0 gold-page',
  Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
}

export const GOLD_BLOCK_LABELS: Record<GoldBlock, string> = {
  market: 'Gold Market Proxies',
  demand: 'Quarterly Supply & Demand',
  aboveGround: 'Above-ground Stock',
  etf: 'Gold ETF Holdings & Flows',
  mining: 'Mine Production & Reserves',
}

async function fetchResponse(url: string): Promise<Response> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)
  return response
}

async function fetchText(url: string): Promise<string> {
  return (await fetchResponse(url)).text()
}

interface Lane<T> {
  value: T | null
  warning: unknown | null
}

/** Fresh cache -> network -> stale cache, keeping a refresh failure visible in the envelope. */
async function lane<T>(key: string, ttlMs: number, force: boolean, load: () => Promise<T>): Promise<Lane<T>> {
  try {
    const result = await cache.resolve(key, ttlMs, load, { force })
    return { value: result.value, warning: null }
  } catch (error) {
    const stale = cache.get<T>(key, { allowStale: true, observe: true })
    return { value: stale?.value ?? null, warning: error }
  }
}

function absoluteWgcUrl(path: string): string {
  return path.startsWith('http') ? path : new URL(path, WGC_ROOT).toString()
}

export function discoverDemandUrl(html: string): string | null {
  const candidates = [...html.matchAll(/href="([^"]*gold-demand-trends-(?:q[1-4]-\d{4}|full-year-\d{4}))"/gi)]
    .map((match) => match[1])
    .filter((path) => !/^\/(?:ja|cn|zh)\//i.test(path))
    .map((path) => absoluteWgcUrl(path))
  const score = (url: string): number => {
    const quarter = url.match(/q([1-4])-(\d{4})/i)
    if (quarter) return Number(quarter[2]) * 10 + Number(quarter[1])
    const annual = url.match(/full-year-(\d{4})/i)
    return annual ? Number(annual[1]) * 10 + 4 : 0
  }
  return [...new Set(candidates)].sort((left, right) => score(right) - score(left))[0] ?? null
}

async function fetchQuarterly(): Promise<GoldQuarterly> {
  const url = discoverDemandUrl(await fetchText(DEMAND_LANDING_URL))
  if (!url) throw new Error('The latest public Gold Demand Trends report was not discoverable.')
  const parsed = parseGoldDemandHtml(await fetchText(url), url)
  if (!parsed?.periods.length) throw new Error('The public quarterly supply-and-demand table was unavailable.')
  return parsed
}

async function fetchAboveGround(): Promise<GoldAboveGround> {
  const parsed = parseAboveGroundHtml(await fetchText(ABOVE_GROUND_URL))
  if (!parsed) throw new Error('The public above-ground stock totals were unavailable.')
  return parsed
}

function sitemapChildren(xml: string): string[] {
  return [...xml.matchAll(/<loc>(https:\/\/www\.gold\.org\/sitemap\.xml\?page=\d+)<\/loc>/gi)].map(
    (match) => match[1].replace(/&amp;/g, '&'),
  )
}

export function discoverEtfUrl(xmlDocuments: string[]): string | null {
  const urls = xmlDocuments.flatMap((xml) =>
    [...xml.matchAll(/https:\/\/www\.gold\.org\/goldhub\/research\/gold-etfs-holdings-and-flows\/(\d{4})\/(\d{2})/gi)]
      .map((match) => match[0]),
  )
  return [...new Set(urls)].sort().at(-1) ?? null
}

async function fetchEtf(): Promise<GoldEtf> {
  const index = await fetchText(SITEMAP_URL)
  const children = sitemapChildren(index)
  if (!children.length) throw new Error('World Gold Council sitemap pages were unavailable.')
  const maps = await Promise.all(children.map(fetchText))
  const url = discoverEtfUrl(maps)
  if (!url) throw new Error('The latest public gold ETF commentary was not discoverable.')
  const parsed = parseGoldEtfHtml(await fetchText(url), url)
  if (!parsed) throw new Error('No public ETF headline aggregates were present.')
  return parsed
}

async function latestUsgsUrl(): Promise<string> {
  const current = new Date().getUTCFullYear()
  for (let year = current; year >= current - 2; year -= 1) {
    const url = `${USGS_ROOT}/mcs${year}/mcs${year}-gold.pdf`
    try {
      const response = await fetch(url, { method: 'HEAD', headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (response.ok) return url
    } catch {
      // Try the preceding annual edition.
    }
  }
  throw new Error('No recent USGS gold commodity summary was available.')
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const document = await getDocument({ data: bytes }).promise
  const pages: string[] = []
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number)
    const content = await page.getTextContent()
    pages.push(
      content.items
        .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
        .join(''),
    )
  }
  return pages.join('\n')
}

async function fetchMining(): Promise<GoldMining> {
  const url = await latestUsgsUrl()
  const bytes = new Uint8Array(await (await fetchResponse(url)).arrayBuffer())
  const parsed = parseUsgsGoldText(await pdfText(bytes), url)
  if (!parsed) throw new Error('The USGS world mine-production table could not be read.')
  return parsed
}

async function fetchMarket(force: boolean, fetchedAt: string): Promise<GoldMarket> {
  const [future, gld] = await Promise.allSettled([getQuote('GC=F', force), getQuote('GLD', force)])
  const market = emptyGoldMarket()
  if (future.status === 'fulfilled') {
    market.futuresPrice = goldValue(future.value.price, 'usdPerOz', fetchedAt, GOLD_MARKET_SOURCE, 'live', 'COMEX futures proxy; not the LBMA benchmark.')
    market.futuresChangePct = goldValue(future.value.change, 'percent', fetchedAt, GOLD_MARKET_SOURCE, 'live')
  }
  if (gld.status === 'fulfilled') {
    market.gldPrice = goldValue(gld.value.price, 'usd', fetchedAt, GOLD_MARKET_SOURCE, 'live', 'GLD ETF share-price proxy.')
    market.gldChangePct = goldValue(gld.value.change, 'percent', fetchedAt, GOLD_MARKET_SOURCE, 'live')
  }
  if (future.status === 'rejected' && gld.status === 'rejected') {
    throw new Error(`GC=F: ${describeError(future.reason)}; GLD: ${describeError(gld.reason)}`)
  }
  return market
}

export interface GoldFetchResult {
  payload: GoldPayload
  errors: EnvelopeError[]
}

export async function getGold(force = false): Promise<GoldFetchResult> {
  const fetchedAt = localIsoSeconds()
  const [market, quarterly, aboveGround, etf, mining] = await Promise.all([
    lane('gold:market', TTL.goldMarket, force, () => fetchMarket(force, fetchedAt)),
    lane('gold:demand', TTL.goldWgc, force, fetchQuarterly),
    lane('gold:above-ground', TTL.goldWgc, force, fetchAboveGround),
    lane('gold:etf', TTL.goldWgc, force, fetchEtf),
    lane('gold:mining', TTL.goldMining, force, fetchMining),
  ])

  const errors: EnvelopeError[] = []
  const record = (block: GoldBlock, source: string, warning: unknown): void => {
    if (warning === null) return
    errors.push(err(source, describeError(warning), `gold-${block}`, GOLD_BLOCK_LABELS[block]))
  }
  record('market', GOLD_MARKET_SOURCE, market.warning)
  record('demand', GOLD_WGC_SOURCE, quarterly.warning)
  record('aboveGround', GOLD_WGC_SOURCE, aboveGround.warning)
  record('etf', 'World Gold Council', etf.warning)
  record('mining', GOLD_USGS_SOURCE, mining.warning)

  return {
    payload: buildGoldPayload({
      fetchedAt,
      market: market.value ?? emptyGoldMarket(),
      quarterly: quarterly.value,
      aboveGround: aboveGround.value,
      etf: etf.value,
      mining: mining.value,
    }),
    errors,
  }
}

export const goldTesting = {
  ABOVE_GROUND_URL,
  DEMAND_LANDING_URL,
  HEADERS,
  SITEMAP_URL,
  TIMEOUT_MS,
  discoverDemandUrl,
  discoverEtfUrl,
}
