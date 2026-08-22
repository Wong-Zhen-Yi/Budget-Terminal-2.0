import type { Fundamentals } from '../../shared/contract.js'
import { cache, TTL } from '../cache.js'
import { paced, yahoo } from './client.js'

/**
 * Per-ticker facts the positions table needs: what kind of instrument it is, how big it
 * is, and the analyst mean target.
 *
 * All three come from one `quoteSummary` call — the Portfolio page needs size and the
 * Dashboard needs the target, and fetching them separately would double the slowest
 * request on either page.
 */
const FUND_QUOTE_TYPES = new Set(['ETF', 'MUTUALFUND'])

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return null
}

async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  const summary = await paced(() =>
    yahoo.quoteSummary(ticker, {
      modules: ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics'],
    }),
  )

  const quoteType = String(summary?.price?.quoteType ?? '').toUpperCase()
  const isFund = FUND_QUOTE_TYPES.has(quoteType)

  // Funds report assets under management, not market cap; equities the other way round.
  const aum = firstFinite(
    summary?.summaryDetail?.totalAssets,
    summary?.defaultKeyStatistics?.totalAssets,
  )
  const marketCap = firstFinite(summary?.price?.marketCap, summary?.summaryDetail?.marketCap)
  const size = isFund ? (aum ?? marketCap) : (marketCap ?? aum)
  const sizeType = size === null ? null : isFund && aum !== null ? 'aum' : 'marketCap'

  // A fund has no analyst target; asking for one is what makes the row read N/A.
  const targetMeanPrice = isFund ? null : firstFinite(summary?.financialData?.targetMeanPrice)

  return { ticker, quoteType, size, sizeType, targetMeanPrice }
}

export async function getFundamentals(
  tickers: string[],
  force = false,
): Promise<Record<string, Fundamentals>> {
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))]
  const settled = await Promise.allSettled(
    unique.map((ticker) =>
      cache
        .resolve(`fundamentals:${ticker}`, TTL.targets, () => fetchFundamentals(ticker), { force })
        .then((result) => result.value),
    ),
  )

  const facts: Record<string, Fundamentals> = {}
  settled.forEach((outcome, index) => {
    const ticker = unique[index]
    facts[ticker] =
      outcome.status === 'fulfilled'
        ? outcome.value
        : // A refused lookup still gets a row, so the table shows `--` rather than a gap.
          { ticker, quoteType: '', size: null, sizeType: null, targetMeanPrice: null }
  })
  return facts
}
