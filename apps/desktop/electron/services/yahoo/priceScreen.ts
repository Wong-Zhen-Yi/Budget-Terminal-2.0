import type { PriceScreenPayload, PriceScreenRow } from '../../shared/contract.js'
import {
  PRICE_SCREEN_EXCHANGES,
  PRICE_SCREEN_LIMIT,
  priceScreenRowFromQuote,
  rankPriceScreenRows,
  validatePriceRange,
} from '../../shared/priceScreen.js'
import {
  equityPriceScreen,
  SCREEN_PAGE_SIZE,
  type EquityScreenPage,
} from './screener.js'

export const PRICE_SCREEN_SOURCE = 'Yahoo Finance'

function asOfStamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`
  )
}

/** `PriceScreenWorker.fetch`: paginate until the top hundred valid equities are filled. */
type PriceScreenPageFetcher = (
  minimumPrice: number,
  maximumPrice: number,
  exchanges: readonly string[],
  offset: number,
  size: number,
) => Promise<EquityScreenPage>

export interface PriceScreenFetchOptions {
  limit?: number
  pageSize?: number
  fetchPage?: PriceScreenPageFetcher
  now?: Date
}

export async function getPriceScreen(
  minimumPrice: number,
  maximumPrice: number,
  options: PriceScreenFetchOptions = {},
): Promise<PriceScreenPayload> {
  validatePriceRange(minimumPrice, maximumPrice)
  const limit = Math.max(1, Math.trunc(options.limit ?? PRICE_SCREEN_LIMIT))
  const pageSize = Math.max(1, Math.trunc(options.pageSize ?? SCREEN_PAGE_SIZE))
  const fetchPage = options.fetchPage ?? equityPriceScreen

  const rowsByTicker = new Map<string, PriceScreenRow>()
  let candidateCount = 0
  let offset = 0

  while (rowsByTicker.size < limit) {
    const page = await fetchPage(
      minimumPrice,
      maximumPrice,
      PRICE_SCREEN_EXCHANGES,
      offset,
      pageSize,
    )
    candidateCount = Math.max(candidateCount, page.total)

    if (!page.quotes.length) break
    for (const quote of page.quotes) {
      const row = priceScreenRowFromQuote(quote, minimumPrice, maximumPrice)
      if (!row) continue
      const existing = rowsByTicker.get(row.ticker)
      if (!existing || row.marketCap > existing.marketCap) rowsByTicker.set(row.ticker, row)
    }

    offset += pageSize
    if (candidateCount && offset >= candidateCount) break
    if (page.quotes.length < pageSize) break
  }

  return {
    rows: rankPriceScreenRows(rowsByTicker.values(), limit),
    source: PRICE_SCREEN_SOURCE,
    asOf: asOfStamp(options.now),
    candidateCount,
    minimumPrice,
    maximumPrice,
  }
}
