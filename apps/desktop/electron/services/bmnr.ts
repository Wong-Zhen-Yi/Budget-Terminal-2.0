import type { BmnrBlock, BmnrPayload, EnvelopeError } from '../shared/contract.js'
import { BMNR_CIK, BMNR_ETH_SYMBOL, BMNR_SYMBOL } from '../shared/contract.js'
import type { BmnrMarketInput, BmnrSecInput } from '../shared/bmnr.js'
import { buildBmnrPayload, finiteOrNull, markBmnrPayload } from '../shared/bmnr.js'
import { localIsoSeconds } from '../shared/crypto.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL } from './cache.js'
import { fetchSecFactsDocument } from './secEdgar.js'
import { getFundamentals } from './yahoo/fundamentals.js'
import { getQuote } from './yahoo/quotes.js'
import { trackApiRequest } from './apiUsage.js'

/**
 * The BMNR page's data — three independent lanes over three different hosts.
 *
 * No arithmetic lives in this file. It fetches, hands the raw documents to
 * `buildBmnrPayload` in `shared/bmnr.ts`, and reports which lanes answered.
 *
 * **CoinGecko deliberately stays outside `paced()`**, on the `services/fearGreed.ts` and
 * `services/crypto.ts` precedent: the rate gate models Yahoo's 429 behaviour and halves its
 * own budget on one, so letting a CoinGecko hiccup throttle the Dashboard would be strictly
 * worse than letting this page's live panel fail alone. SEC has its own 200ms limiter and
 * disk cache inside `secEdgar.ts`. Only the three Yahoo quotes go through the Yahoo gate,
 * and their helpers already call it.
 */

export const BMNR_SOURCE = 'BMNR treasury'
export const BMNR_TREASURY_SOURCE = 'CoinGecko'
export const BMNR_SEC_SOURCE = 'SEC EDGAR'
export const BMNR_MARKET_SOURCE = 'Yahoo Finance'

const TREASURY_URL = 'https://api.coingecko.com/api/v3/companies/public_treasury/ethereum'

/** Per-host agent string, the same pattern `services/crypto.ts` uses for its own calls. */
const HEADERS = {
  'User-Agent': 'BudgetTerminal/1.0 bmnr-page',
  Accept: 'application/json, text/plain, */*',
}

const TIMEOUT_MS = 12_000

/**
 * Block labels ride on `EnvelopeError.symbol`, which is what lets the page's `warningOf`
 * route one lane's failure to one panel instead of taking the whole page down.
 */
export const BMNR_BLOCK_LABELS: Record<BmnrBlock, string> = {
  treasury: 'ETH Treasury (CoinGecko)',
  filings: 'SEC Filed Balance Sheet',
  market: 'BMNR / ETH Market Data',
}

async function getJson(url: string): Promise<unknown> {
  return trackApiRequest('coingecko', async () => {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
}

export interface BmnrFetchResult {
  payload: BmnrPayload
  errors: EnvelopeError[]
}

async function fetchBmnr(force: boolean): Promise<BmnrFetchResult> {
  const errors: EnvelopeError[] = []
  const fetchedAt = localIsoSeconds()

  const record = (block: BmnrBlock, source: string, error: unknown, operation: string): void => {
    errors.push(err(source, describeError(error), operation, BMNR_BLOCK_LABELS[block]))
  }

  const treasuryTask = getJson(TREASURY_URL).catch((error) => {
    record('treasury', BMNR_TREASURY_SOURCE, error, 'bmnr-treasury')
    return null
  })

  // The CIK is passed directly so the `company_tickers.json` round trip is skipped —
  // two SEC requests rather than three, and the disk cache entry is shared with the
  // Fundamentals page, so opening either warms the other.
  const secTask = fetchSecFactsDocument({ cik: BMNR_CIK }, { force })
    .then<BmnrSecInput | null>((document) => ({
      cik: document.cik,
      facts: document.facts,
      filings: document.filings,
      freshness: document.freshness,
      cacheAgeSeconds: document.cacheAgeSeconds,
      warnings: document.warnings,
    }))
    .catch((error) => {
      record('filings', BMNR_SEC_SOURCE, error, 'bmnr-sec-facts')
      return null
    })

  const marketTask = fetchMarket(force).catch((error) => {
    record('market', BMNR_MARKET_SOURCE, error, 'bmnr-market')
    return emptyMarket()
  })

  const [treasuryBody, sec, market] = await Promise.all([treasuryTask, secTask, marketTask])

  if (treasuryBody !== null && !hasTreasuryRow(treasuryBody)) {
    errors.push(
      err(
        BMNR_TREASURY_SOURCE,
        `No ${BMNR_SYMBOL} row was present in the ETH treasury list.`,
        'bmnr-treasury',
        BMNR_BLOCK_LABELS.treasury,
      ),
    )
  }

  const payload = buildBmnrPayload({ fetchedAt, treasuryBody, sec, market })
  return { payload, errors }
}

function hasTreasuryRow(body: unknown): boolean {
  const rows = (body as { companies?: unknown })?.companies
  if (!Array.isArray(rows)) return false
  return rows.some((row) => {
    const ticker = String((row as { symbol?: unknown })?.symbol ?? '').split('.')[0]?.trim().toUpperCase()
    if (ticker === BMNR_SYMBOL) return true
    return String((row as { name?: unknown })?.name ?? '').trim().toUpperCase().startsWith('BITMINE')
  })
}

function emptyMarket(): BmnrMarketInput {
  return { sharePrice: null, shareChangePct: null, marketCap: null, ethPrice: null, ethChangePct: null }
}

/**
 * BMNR's own quote, ETH's, and the market cap.
 *
 * `getQuote` rather than `getFundamentalsPage`: the latter costs four Yahoo calls plus a
 * full `fetchSecCompanyBundle` this service is already fetching itself. Each of the three
 * calls settles independently, so a single dead one costs its own figure and nothing else.
 */
async function fetchMarket(force: boolean): Promise<BmnrMarketInput> {
  const [share, eth, fundamentals] = await Promise.allSettled([
    getQuote(BMNR_SYMBOL, force),
    getQuote(BMNR_ETH_SYMBOL, force),
    getFundamentals([BMNR_SYMBOL], force),
  ])

  const shareQuote = share.status === 'fulfilled' ? share.value : null
  const ethQuote = eth.status === 'fulfilled' ? eth.value : null

  // Guard on `sizeType`: `size` carries assets under management for funds, and a Yahoo
  // quote-type misclassification would otherwise feed fund AUM straight into mNAV.
  let marketCap: number | null = null
  if (fundamentals.status === 'fulfilled') {
    const entry = fundamentals.value[BMNR_SYMBOL]
    if (entry && entry.sizeType === 'marketCap') marketCap = finiteOrNull(entry.size)
  }

  return {
    sharePrice: finiteOrNull(shareQuote?.price),
    shareChangePct: finiteOrNull(shareQuote?.change),
    marketCap,
    ethPrice: finiteOrNull(ethQuote?.price),
    ethChangePct: finiteOrNull(ethQuote?.change),
  }
}

/**
 * The page has no refresh timer — Refresh and F5 are the only ways it refetches. The TTL
 * matches `TTL.crypto` because it is the same CoinGecko free tier and the same rate budget;
 * it only stops a tab revisit from spending that budget again.
 */
export async function getBmnr(force = false): Promise<BmnrFetchResult> {
  const result = (await cache.resolve('bmnr:page', TTL.bmnr, () => fetchBmnr(force), { force })).value
  try {
    return { ...result, payload: markBmnrPayload(result.payload, await getQuote(BMNR_SYMBOL, force)) }
  } catch (error) {
    return { ...result, errors: [...result.errors, err('market prices', describeError(error), 'quote', BMNR_BLOCK_LABELS.market)] }
  }
}

export const bmnrTesting = { TREASURY_URL, HEADERS, TIMEOUT_MS, fetchMarket, hasTreasuryRow }
