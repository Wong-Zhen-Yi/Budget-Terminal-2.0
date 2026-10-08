import type { TargetRow } from '../../shared/contract.js'
import { getFundamentals } from './fundamentals.js'
import { getQuote } from './quotes.js'

/**
 * The Dashboard's analyst-target rows. The facts come from the shared fundamentals
 * fetch, so opening both pages costs one `quoteSummary` per ticker rather than two.
 */
export async function getTargets(tickers: string[], force = false): Promise<TargetRow[]> {
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))]
  const facts = await getFundamentals(unique, force)

  return Promise.all(
    unique.map(async (ticker): Promise<TargetRow> => {
      const current = await getQuote(ticker, force)
        .then((quote) => quote.price)
        .catch(() => null)
      const entry = facts[ticker]
      const target = entry?.targetMeanPrice ?? null

      // ETFs never carry a target; anything else missing one means the provider refused.
      const unavailableReason: TargetRow['unavailableReason'] =
        target !== null ? '' : entry && ['ETF', 'MUTUALFUND'].includes(entry.quoteType) ? 'etf' : 'unavailable'

      return {
        ticker,
        current,
        target,
        upside: target !== null && current ? ((target - current) / current) * 100 : null,
        unavailableReason,
      }
    }),
  )
}
