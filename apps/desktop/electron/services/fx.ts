import type { FxPayload } from '../shared/contract.js'
import { cache, TTL } from './cache.js'
import { getQuote } from './yahoo/quotes.js'

/**
 * The USD/SGD rate the Personal Finance page converts with.
 *
 * The PySide6 `NetWorthFxWorker` hand-rolls a three-tier fallback (fast_info, then a
 * 1m history bar, then the raw chart REST endpoint). `getQuote` already walks an
 * equivalent chart-then-quote chain behind `paced()`, so this reuses it rather than
 * opening a second, unpaced route to Yahoo.
 */
export const FX_SYMBOL = 'SGD=X'
export const FX_SOURCE = 'Yahoo Finance SGD=X'

/** A rate only counts when it is finite and positive, exactly as the reference checks. */
function usable(rate: number | undefined): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
}

export async function getFxRate(force = false): Promise<FxPayload> {
  const result = await cache.resolve(
    `fx:${FX_SYMBOL}`,
    TTL.fx,
    async () => {
      const quote = await getQuote(FX_SYMBOL, force)
      if (!usable(quote.price)) throw new Error('Yahoo returned no usable USD/SGD rate.')
      return { usdSgd: quote.price, collectedAt: Date.now() }
    },
    { force },
  )
  return { usdSgd: result.value.usdSgd, source: FX_SOURCE, collectedAt: result.value.collectedAt }
}
