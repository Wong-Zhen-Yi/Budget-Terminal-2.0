import { paced, yahoo } from './client.js'

/**
 * Yahoo's equity screener, as `TradingVolumeWorker._query` uses it.
 *
 * yfinance exposes `yf.screen(EquityQuery(...), sortField=..., offset=...)`.
 * `yahoo-finance2`'s public `screener()` does not: it only accepts fifteen predefined
 * saved screens (`most_actives` and friends) with no criteria and no sort field, which
 * would cap the universe at a few hundred names instead of the ~19,000 the reference
 * ranks over. So this posts the same `EquityQuery` body the Python app sends, through
 * the client's own `_fetch` so the cookie jar, crumb and queue are all still Yahoo's.
 *
 * Still behind `paced()`, like every other Yahoo call in the app.
 */

/** The fields the row builder reads. Yahoo returns far more; none of it is needed. */
export interface ScreenerQuote {
  symbol?: string
  quoteType?: string
  longName?: string
  shortName?: string
  displayName?: string
  sector?: string
  sectorDisp?: string
  regularMarketPrice?: number
  regularMarketPreviousClose?: number
  previousClose?: number
  regularMarketVolume?: number
  marketCap?: number
  averageDailyVolume10Day?: number
  averageDailyVolume3Month?: number
  sharesOutstanding?: number
  exchange?: string
  intradayprice?: number
  eodprice?: number
  intradaymarketcap?: number
  'lastclosemarketcap.lasttwelvemonths'?: number
}

interface ScreenerResponse {
  finance?: { result?: Array<{ total?: number; quotes?: ScreenerQuote[] }> }
}

export interface EquityScreenPage {
  total: number
  quotes: ScreenerQuote[]
}

const SCREENER_URL = 'https://query2.finance.yahoo.com/v1/finance/screener'

/** `_SCREEN_PAGE_SIZE` and `_SCREEN_OFFSETS`. */
export const SCREEN_PAGE_SIZE = 250
export const SCREEN_OFFSETS = [0, 250, 500, 750] as const
/** The three orderings the reference unions to build its candidate pool. */
export const SCREEN_SORT_FIELDS = ['dayvolume', 'avgdailyvol3m', 'intradaymarketcap'] as const

/**
 * The screener POST needs a crumb, and the crumb fetch fails outright against a cold
 * cookie jar — "No set-cookie header present in Yahoo's response". A cheap predefined
 * screen goes through the library's own crumb path first and leaves the jar warm, after
 * which the POST succeeds. Memoised: one warm-up per process, not one per call.
 */
let warmed: Promise<void> | null = null

function warmCrumb(): Promise<void> {
  if (!warmed) {
    warmed = paced(() => yahoo.screener({ scrIds: 'most_actives', count: 5 }))
      .then(() => undefined)
      .catch(() => {
        // A failed warm-up is not fatal; the POST may still find a usable crumb. Clear
        // the memo so the next call gets another attempt.
        warmed = null
      })
  }
  return warmed
}

async function postScreen(body: Record<string, unknown>): Promise<EquityScreenPage> {
  await warmCrumb()
  const response = (await paced(() =>
    yahoo._fetch(
      SCREENER_URL,
      { lang: 'en-US', region: 'US', formatted: 'false', corsDomain: 'finance.yahoo.com' },
      {
        fetchOptions: {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        },
      },
      'json',
      true,
    ),
  )) as ScreenerResponse
  const result = response.finance?.result?.[0]
  return {
    total: Number.isFinite(Number(result?.total)) ? Number(result?.total) : 0,
    quotes: result?.quotes ?? [],
  }
}

/** One page of the screen, ordered by `sortField` descending. */
export async function equityScreen(
  sortField: string,
  offset: number,
  size = SCREEN_PAGE_SIZE,
): Promise<ScreenerQuote[]> {
  const body = {
    size,
    offset,
    sortField,
    sortType: 'DESC',
    quoteType: 'EQUITY',
    query: {
      operator: 'and',
      operands: [
        { operator: 'eq', operands: ['region', 'us'] },
        { operator: 'gt', operands: ['dayvolume', 0] },
        { operator: 'gt', operands: ['intradayprice', 0] },
      ],
    },
    userId: '',
    userIdType: 'guid',
  }

  return (await postScreen(body)).quotes
}

/** One market-cap-ranked page for the Price screen's inclusive range query. */
export function equityPriceScreen(
  minimumPrice: number,
  maximumPrice: number,
  exchanges: readonly string[],
  offset: number,
  size = SCREEN_PAGE_SIZE,
): Promise<EquityScreenPage> {
  return postScreen({
    size,
    offset,
    sortField: 'intradaymarketcap',
    sortType: 'DESC',
    quoteType: 'EQUITY',
    query: {
      operator: 'and',
      operands: [
        { operator: 'eq', operands: ['region', 'us'] },
        { operator: 'gte', operands: ['intradayprice', minimumPrice] },
        { operator: 'lte', operands: ['intradayprice', maximumPrice] },
        {
          operator: 'or',
          operands: exchanges.map((exchange) => ({
            operator: 'eq',
            operands: ['exchange', exchange],
          })),
        },
      ],
    },
    userId: '',
    userIdType: 'guid',
  })
}

/**
 * The full candidate pool: three sort orders by four offsets, deduplicated by symbol.
 *
 * A page that fails is skipped rather than failing the load — the reference logs and
 * carries on, and twelve pages give plenty of redundancy for the 100 rows that survive.
 */
export async function screenEquityUniverse(): Promise<ScreenerQuote[]> {
  const pages = SCREEN_SORT_FIELDS.flatMap((sortField) =>
    SCREEN_OFFSETS.map((offset) => ({ sortField, offset })),
  )
  const settled = await Promise.allSettled(
    pages.map((page) => equityScreen(page.sortField, page.offset)),
  )

  const bySymbol = new Map<string, ScreenerQuote>()
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue
    for (const quote of outcome.value) {
      const symbol = quote.symbol?.trim().toUpperCase()
      if (!symbol || bySymbol.has(symbol)) continue
      bySymbol.set(symbol, quote)
    }
  }
  return [...bySymbol.values()]
}
