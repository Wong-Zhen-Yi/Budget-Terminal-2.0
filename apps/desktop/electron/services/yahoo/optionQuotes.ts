import type { OptionQuote, OptionQuotesPayload, OptionQuotesRequest } from '../../shared/contract.js'
import { isSellerStrategy } from '../../shared/analytics.js'
import { cache, TTL } from '../cache.js'
import { paced, yahoo } from './client.js'
import { observeSource } from '../sourceHealth.js'

/**
 * Live marks for tracked option positions, plus the expiry list each ticker offers.
 *
 * The expiry list is what fills the Expiry dropdown; the chain gives the current price,
 * volume, open interest and implied volatility for the exact contract held.
 */

/**
 * The `optexp:` entry is shared with the Options page (`yahoo/options.ts`), so whichever
 * page loads first pays for the round trip and the other reads it free. That sharing only
 * holds while both sides cache the same shape: the cached value stays Yahoo's `Date[]`
 * and the ISO mapping the Expiry dropdown wants happens on the way out. Caching the
 * mapped strings here instead left the Options page sorting strings with `getTime`.
 */
async function fetchExpiries(ticker: string): Promise<Date[]> {
  const result = await paced(() => yahoo.options(ticker))
  return result.expirationDates ?? []
}

async function fetchContract(
  ticker: string,
  expiry: string,
  strike: number,
  strategy: string,
): Promise<OptionQuote> {
  const result = await paced(() => yahoo.options(ticker, { date: expiry }))
  const chain = result.options?.[0]
  if (!chain) throw new Error(`No chain for ${ticker} ${expiry}.`)

  // A covered call is a short call and a cash-secured put a short put, so the side to
  // price is decided by the strategy, not by whether the user is long or short.
  const puts = strategy === 'Puts' || strategy === 'Cash Secured Put'
  const side = (puts ? chain.puts : chain.calls) ?? []

  // Strikes come back as floats; match on the nearest rather than on equality.
  let best: (typeof side)[number] | null = null
  let bestDistance = Infinity
  for (const contract of side) {
    const distance = Math.abs(Number(contract.strike) - strike)
    if (distance < bestDistance) {
      bestDistance = distance
      best = contract
    }
  }
  if (!best || bestDistance > 0.01) throw new Error(`No ${strike} strike for ${ticker} ${expiry}.`)
  if (typeof best.lastPrice !== 'number' || !Number.isFinite(best.lastPrice) || best.lastPrice < 0) {
    throw new Error(`No valid market mark for ${ticker} ${expiry} ${strike}.`)
  }
  const tradeTime = best.lastTradeDate instanceof Date ? best.lastTradeDate.getTime() : undefined
  const asOf = tradeTime !== undefined && Number.isFinite(tradeTime) ? tradeTime : undefined
  const markStale = asOf !== undefined && Date.now() - asOf > 7 * 24 * 60 * 60_000
  const markReason = markStale ? `${ticker} ${expiry} ${strike}: last option trade is more than seven days old (${new Date(asOf!).toISOString()}); retaining the reported last-trade mark.` : undefined
  observeSource({ fetchedAt: Date.now(), ...(asOf === undefined ? {} : { asOf }),
    stale: markStale, fromCache: false, failures: markReason ? [markReason] : [] })

  return {
    currentPrice: Number(best.lastPrice) || 0,
    volume: Number(best.volume) || 0,
    openInterest: Number(best.openInterest) || 0,
    impliedVolatility: Number(best.impliedVolatility) || 0,
    ...(asOf === undefined ? {} : { asOf }),
    source: 'Yahoo Finance last trade',
    markStale,
    ...(markReason ? { markReason } : {}),
  }
}

export async function getOptionQuotes({
  positions,
  force = false,
}: OptionQuotesRequest): Promise<OptionQuotesPayload> {
  const tickers = [...new Set(positions.map((p) => p.ticker.trim().toUpperCase()).filter(Boolean))]

  const expiryResults = await Promise.allSettled(
    tickers.map((ticker) =>
      cache
        .resolve(`optexp:${ticker}`, TTL.options, () => fetchExpiries(ticker), { force })
        .then((result) => result.value.map((date) => date.toISOString().slice(0, 10))),
    ),
  )
  const expiries: OptionQuotesPayload['expiries'] = {}
  const errors: NonNullable<OptionQuotesPayload['errors']> = []
  const missing: string[] = []
  expiryResults.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') expiries[tickers[index]] = outcome.value
    else errors.push({ source: 'yahoo options', symbol: tickers[index], operation: 'expirations', reason: String(outcome.reason) })
  })

  const priced = positions.filter((p) => p.ticker && p.expiry && p.strike > 0)
  const quoteResults = await Promise.allSettled(
    priced.map((position) =>
      cache
        .resolve(
          `optquote:v2:${position.ticker}:${position.expiry}:${position.strike}:${isSellerStrategy(position.strategy) ? 'x' : 'l'}:${position.strategy}`,
          TTL.options,
          () =>
            fetchContract(
              position.ticker.trim().toUpperCase(),
              position.expiry,
              position.strike,
              position.strategy,
            ),
          { force },
        )
        .then((result) => result.value),
    ),
  )

  const quotes: OptionQuotesPayload['quotes'] = {}
  quoteResults.forEach((outcome, index) => {
    // A contract that cannot be priced simply keeps its stored premium-only row.
    if (outcome.status === 'fulfilled') quotes[priced[index].rowId] = outcome.value
    else {
      missing.push(priced[index].rowId)
      errors.push({ source: 'yahoo options', symbol: priced[index].ticker, operation: 'option mark', reason: String(outcome.reason) })
    }
  })

  return { quotes, expiries, errors, missing }
}
