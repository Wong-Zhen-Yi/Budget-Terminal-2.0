import type {
  CardInterval,
  CardsPerformancePayload,
  CardsPerformanceRequest,
  EnvelopeError,
} from '../../shared/contract.js'
import { computeCardPerformance, normalizeCardSymbols, type CardPriceSeries } from '../../shared/cards.js'
import { describeError, err } from '../../shared/envelope.js'
import { cache } from '../cache.js'
import { getYahooSeries } from './series.js'

export const CARDS_SOURCE = 'Yahoo Finance'

const TTL_BY_INTERVAL: Record<CardInterval, number> = {
  '1d': 5 * 60_000,
  '30d': 30 * 60_000,
  '1y': 60 * 60_000,
}

function intervalConfig(interval: CardInterval): { period1: Date; interval: '5m' | '1d' } {
  const now = new Date()
  if (interval === '1d') {
    // `period='1d'` in yfinance means the latest trading session, even on a weekend.
    // Pull five calendar days here, then retain the latest ET session below.
    return { period1: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), interval: '5m' }
  }
  if (interval === '30d') {
    return {
      period1: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, now.getUTCDate())),
      interval: '1d',
    }
  }
  return {
    period1: new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate())),
    interval: '1d',
  }
}

export async function fetchCardSeries(
  symbol: string,
  interval: CardInterval,
  force = false,
): Promise<CardPriceSeries> {
  const config = intervalConfig(interval)
  const result = await getYahooSeries({ symbol, start: config.period1, interval: config.interval, force })
  const points = new Map<number, number>()
  for (const row of result.rows) {
    const close = row.close
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue
    const timestamp = config.interval === '1d'
      ? Date.parse(new Date(row.time * 1000).toISOString().slice(0, 10))
      : row.time * 1000
    points.set(timestamp, close)
  }
  let timestamps = [...points.keys()].sort((a, b) => a - b)
  if (interval === '1d' && timestamps.length) {
    const sessionStamp = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const latestSession = sessionStamp.format(new Date(timestamps[timestamps.length - 1]))
    timestamps = timestamps.filter(
      (timestamp) => sessionStamp.format(new Date(timestamp)) === latestSession,
    )
  }
  if (timestamps.length < 2) throw new Error(`No history returned for ${symbol}.`)
  return { timestamps, values: timestamps.map((timestamp) => points.get(timestamp) as number) }
}

async function getCardSeries(
  symbol: string,
  interval: CardInterval,
  force: boolean,
): Promise<CardPriceSeries> {
  const result = await cache.resolve(
    `cards:${symbol}:${interval}`,
    TTL_BY_INTERVAL[interval],
    () => fetchCardSeries(symbol, interval, force),
    { force },
  )
  return result.value
}

export interface CardsPerformanceResult {
  payload: CardsPerformancePayload
  errors: EnvelopeError[]
}

/** Resolve every visible basket with one shared union of paced symbol requests. */
export async function getCardsPerformance(
  request: CardsPerformanceRequest,
): Promise<CardsPerformanceResult> {
  const symbols = [...new Set(request.cards.flatMap((card) => normalizeCardSymbols(card.symbols)))]
  const settled = await Promise.allSettled(
    symbols.map((symbol) => getCardSeries(symbol, request.interval, Boolean(request.force))),
  )
  const series: Record<string, CardPriceSeries> = {}
  const failureBySymbol: Record<string, string> = {}
  settled.forEach((outcome, index) => {
    const symbol = symbols[index]
    if (outcome.status === 'fulfilled') series[symbol] = outcome.value
    else failureBySymbol[symbol] = describeError(outcome.reason)
  })

  const results: CardsPerformancePayload['results'] = {}
  const errors: EnvelopeError[] = []
  for (const card of request.cards) {
    try {
      const performance = computeCardPerformance(card, series, request.interval)
      results[card.id] = performance
      if (performance.missingSymbols.length) {
        const detail = performance.missingSymbols
          .map((symbol) => `${symbol}: ${failureBySymbol[symbol] ?? 'unavailable'}`)
          .join(' | ')
        errors.push(err(CARDS_SOURCE, detail, 'performance', card.id))
      }
    } catch (error) {
      errors.push(err(CARDS_SOURCE, describeError(error), 'performance', card.id))
    }
  }
  return { payload: { interval: request.interval, results }, errors }
}
