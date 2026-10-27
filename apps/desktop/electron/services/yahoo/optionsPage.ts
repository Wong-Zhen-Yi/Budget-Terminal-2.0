import type {
  OptionsChainPayload,
  OptionsExpirationsPayload,
  OptionsPageFailure,
} from '../../shared/contract.js'
import type { OptionsExpirationBucket, OptionsRawRow } from '../../shared/optionsPage.js'
import {
  buildExpirationOrder,
  buildOptionsVolumeRanking,
  collectStrikes,
  DEFAULT_RISK_FREE_RATE,
  enrichChain,
  expiryOptionLabel,
  extractDividendYield,
  filterLiveExpiries,
  isOptionsExpiryClosed,
  normalizeRiskFreeRate,
  optionsMarketDate,
} from '../../shared/optionsPage.js'
import { describeError } from '../../shared/envelope.js'
import { cache, TTL } from '../cache.js'
import { paced, yahoo } from './client.js'

/**
 * The Options page's data, ported from `OptionsChainMixin` and
 * `services/options_data.py`.
 *
 * Two loads, matching the two things the page's subtabs ask for:
 *
 * - `getOptionsChain` fetches one expiration and enriches it with Greeks — the Chain
 *   tab, `_p5_load_expiries` followed by `_p5_load_chain`.
 * - `getOptionsExpirations` fetches *every* live expiration's raw chain — what
 *   `_p5_load_top_volume`, `_p5_load_strike_values` and `_p5_load_options_by_strike`
 *   each loop over. The reference makes that same sweep three times over its own chain
 *   cache; here one sweep serves all three, and the type filter, the strike list and
 *   the strike selection are all derived in the renderer from the one payload.
 *
 * Everything Yahoo goes through `paced()`, including the per-expiration sweep — it is
 * the single most request-heavy load in the app after Trading Volumes.
 */

export const OPTIONS_PAGE_SOURCE = 'Yahoo Finance options'

/** `^IRX`, the 13-week bill the reference uses as its risk-free proxy. */
const RISK_FREE_SYMBOL = '^IRX'

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function marketDate(value: unknown): string {
  const date = dateValue(value)
  return date ? optionsMarketDate(date) : ''
}

interface ChainFetch {
  rows: OptionsRawRow[]
  /** The underlying's regular-market price, which the same response carries. */
  spot: number
}

function toRows(symbol: string, expiration: string, chain: {
  calls?: Array<Record<string, unknown>>
  puts?: Array<Record<string, unknown>>
}): OptionsRawRow[] {
  const rows: OptionsRawRow[] = []
  const push = (contract: Record<string, unknown>, type: 'Call' | 'Put') => {
    const strike = Number(contract.strike)
    if (!Number.isFinite(strike)) return
    rows.push({
      ticker: symbol,
      type,
      strike,
      expiration,
      lastPrice: Number(contract.lastPrice) || 0,
      bid: Number(contract.bid) || 0,
      ask: Number(contract.ask) || 0,
      change: Number(contract.change) || 0,
      volume: Number(contract.volume) || 0,
      openInterest: Number(contract.openInterest) || 0,
      impliedVolatility: Number(contract.impliedVolatility) || 0,
      inTheMoney: Boolean(contract.inTheMoney),
      lastTradeDate: marketDate(contract.lastTradeDate),
    })
  }
  ;(chain.calls ?? []).forEach((contract) => push(contract, 'Call'))
  ;(chain.puts ?? []).forEach((contract) => push(contract, 'Put'))
  return rows
}

/**
 * One `options` call answers with the expiration list, the chain for one date *and* the
 * underlying quote, so the Chain tab's spot price costs no extra request.
 */
async function fetchChain(symbol: string, expiration: string): Promise<ChainFetch> {
  const result = await paced(() => yahoo.options(symbol, { date: expiration }))
  const chain = result.options?.[0]
  const spot = Number(result.quote?.regularMarketPrice) || 0
  if (!chain) throw new Error(`No options chain returned for ${symbol} ${expiration}.`)
  return {
    rows: toRows(symbol, expiration, {
      calls: (chain.calls ?? []) as Array<Record<string, unknown>>,
      puts: (chain.puts ?? []) as Array<Record<string, unknown>>,
    }),
    spot,
  }
}

async function fetchExpirations(
  symbol: string,
): Promise<{ expiries: string[]; spot: number; marketDate: string }> {
  const result = await paced(() => yahoo.options(symbol))
  return {
    expiries: (result.expirationDates ?? []).map(isoDate),
    spot: Number(result.quote?.regularMarketPrice) || 0,
    marketDate: marketDate(result.quote?.regularMarketTime),
  }
}

/** `_p5_fetch_market_rate`. A failure leaves the config default in place, not an error. */
async function fetchRiskFreeRate(force: boolean): Promise<number | null> {
  try {
    const cached = await cache.resolve(
      'options:riskfree',
      TTL.targets,
      async () => {
        const quote = await paced(() => yahoo.quote(RISK_FREE_SYMBOL))
        return (
          Number(quote?.regularMarketPrice) ||
          Number(quote?.regularMarketPreviousClose) ||
          0
        )
      },
      { force },
    )
    return normalizeRiskFreeRate(cached.value)
  } catch {
    return null
  }
}

/** `_p5_extract_dividend_yield`, off the same summary block the Stocks page reads. */
async function fetchDividendYield(symbol: string, force: boolean): Promise<number | null> {
  try {
    const cached = await cache.resolve(
      `options:dividend:${symbol}`,
      TTL.profile,
      async () => {
        const summary = await paced(() =>
          yahoo.quoteSummary(symbol, { modules: ['summaryDetail'] }),
        )
        return (summary?.summaryDetail ?? {}) as Record<string, unknown>
      },
      { force },
    )
    return extractDividendYield(cached.value)
  } catch {
    return null
  }
}

/**
 * The Chain tab. The expiry list, the spot price, the resolved Greek inputs and one
 * enriched chain, in a single round trip from the renderer's point of view.
 *
 * A requested expiry that has closed is not fetched: the reference refuses it with
 * "Option expiry ... has closed" rather than asking Yahoo for a dead date, which
 * answers with a bare "expiration cannot be found" error.
 */
export async function getOptionsChain(
  symbol: string,
  requestedExpiry: string,
  force: boolean,
): Promise<{ payload: OptionsChainPayload; failures: OptionsPageFailure[] }> {
  const failures: OptionsPageFailure[] = []

  const listing = (
    await cache.resolve(`optpage:exp:${symbol}`, TTL.options, () => fetchExpirations(symbol), {
      force,
    })
  ).value
  const expiries = filterLiveExpiries(listing.expiries)

  const wanted = String(requestedExpiry ?? '').trim()
  const expiry =
    wanted && expiries.includes(wanted) && !isOptionsExpiryClosed(wanted) ? wanted : expiries[0] ?? ''

  const empty: OptionsChainPayload = {
    symbol,
    expiries: expiries.map((entry) => ({ expiry: entry, label: expiryOptionLabel(entry) })),
    expiry,
    spotPrice: listing.spot,
    riskFreeRate: DEFAULT_RISK_FREE_RATE,
    rateSource: 'config',
    dividendYield: 0,
    dividendSource: 'default',
    rows: [],
    generatedAt: Date.now(),
  }

  if (!expiry) {
    failures.push({
      block: 'Chain',
      reason: `No current listed options expirations were available for ${symbol}.`,
    })
    return { payload: empty, failures }
  }

  // The rate, the dividend yield and the chain are independent; the gate paces them.
  const [rate, dividend, chain] = await Promise.all([
    fetchRiskFreeRate(force),
    fetchDividendYield(symbol, force),
    cache
      .resolve(`optpage:chain:${symbol}:${expiry}`, TTL.options, () => fetchChain(symbol, expiry), {
        force,
      })
      .then((result) => result.value)
      .catch((error): ChainFetch => {
        failures.push({ block: 'Chain', reason: describeError(error) })
        return { rows: [], spot: 0 }
      }),
  ])

  const spotPrice = chain.spot || listing.spot
  const riskFreeRate = rate ?? DEFAULT_RISK_FREE_RATE
  const dividendYield = dividend ?? 0

  return {
    payload: {
      ...empty,
      spotPrice,
      riskFreeRate,
      rateSource: rate === null ? 'config' : 'market',
      dividendYield,
      dividendSource: dividend === null ? 'default' : 'ticker',
      rows: enrichChain(chain.rows, expiry, spotPrice, riskFreeRate, dividendYield),
      generatedAt: Date.now(),
    },
    failures,
  }
}

/**
 * The Options by Top Volume and Options by Strike tabs: the raw chain for every live
 * expiration, plus the union of every strike they quote.
 *
 * One expiration failing costs its own panel and nothing else — it comes back as a
 * bucket with no rows and a failure carrying the expiry as its block label, so the
 * grid keeps its shape exactly as `_p5_load_top_volume`'s per-expiry `except` does.
 */
export async function getOptionsExpirations(
  symbol: string,
  force: boolean,
): Promise<{ payload: OptionsExpirationsPayload; failures: OptionsPageFailure[] }> {
  const failures: OptionsPageFailure[] = []

  const listing = (
    await cache.resolve(`optpage:exp:${symbol}`, TTL.options, () => fetchExpirations(symbol), {
      force,
    })
  ).value
  const order = buildExpirationOrder(listing.expiries)

  if (!order.length) {
    failures.push({
      block: 'Expirations',
      reason: `No current listed options expirations were available for ${symbol}.`,
    })
    return {
      payload: {
        symbol,
        spotPrice: listing.spot,
        marketDate: listing.marketDate,
        buckets: [],
        strikes: [],
        topVolume: buildOptionsVolumeRanking([]),
        generatedAt: Date.now(),
      },
      failures,
    }
  }

  const buckets = await Promise.all(
    order.map(async ({ expiry, daysOut }): Promise<OptionsExpirationBucket> => {
      try {
        const chain = (
          await cache.resolve(
            `optpage:chain:${symbol}:${expiry}`,
            TTL.options,
            () => fetchChain(symbol, expiry),
            { force },
          )
        ).value
        return { expiry, daysOut, rows: chain.rows }
      } catch (error) {
        failures.push({ block: expiry, reason: describeError(error) })
        return { expiry, daysOut, rows: [] }
      }
    }),
  )

  return {
    payload: {
      symbol,
      spotPrice: listing.spot,
      marketDate: listing.marketDate,
      buckets,
      strikes: collectStrikes(buckets),
      topVolume: buildOptionsVolumeRanking(buckets, failures.map(failure => failure.block)),
      generatedAt: Date.now(),
    },
    failures,
  }
}
