import { cache, TTL, type CachedResult, type TtlCache } from '../cache.js'
import { paced, yahoo } from './client.js'

export type YahooSeriesInterval = '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '90m' | '1h' | '1d' | '5d' | '1wk' | '1mo' | '3mo'

export interface YahooSeriesRow {
  /** Epoch seconds. */
  time: number
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  adjclose: number | null
  volume: number | null
}

interface SeriesDocument {
  rows: YahooSeriesRow[]
  coveredFrom: number
  refreshedAt: number
  fullSyncAt: number
  currency: string
  longName: string
  meta?: unknown
}

export interface IncrementalSeriesResult {
  rows: YahooSeriesRow[]
  currency: string
  longName: string
  stale: boolean
  fromCache: boolean
  cacheAgeSeconds: number
  meta?: unknown
}

interface IncrementalOptions {
  symbol: string
  start: Date
  interval: YahooSeriesInterval
  force?: boolean
  /** Distinguishes provider representations that cannot safely share rows. */
  variant?: string
}

interface RangeResult {
  rows: YahooSeriesRow[]
  currency: string
  longName: string
  meta?: unknown
}

const DAY = 24 * 60 * 60_000
const WEEKLY_RECONCILE_MS = 7 * DAY

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function overlapStart(lastSeconds: number, interval: YahooSeriesInterval): Date {
  const last = new Date(lastSeconds * 1000)
  if (['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'].includes(interval)) {
    return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()))
  }
  if (interval === '1wk') return new Date(last.getTime() - 14 * DAY)
  if (interval === '1mo' || interval === '3mo') return new Date(last.getTime() - 62 * DAY)
  return new Date(last.getTime() - 10 * DAY)
}

function mergeRows(existing: YahooSeriesRow[], incoming: YahooSeriesRow[]): YahooSeriesRow[] {
  return [...new Map(
    [...existing, ...incoming]
      .filter((row) => Number.isFinite(row.time))
      .sort((left, right) => left.time - right.time)
      .map((row) => [row.time, row]),
  ).values()]
}

async function fetchRange(
  symbol: string,
  interval: YahooSeriesInterval,
  start: Date,
  end?: Date,
): Promise<RangeResult> {
  const result = await paced(() => yahoo.chart(symbol, {
    period1: start,
    ...(end ? { period2: end } : {}),
    interval,
  }))
  const rows = result.quotes.flatMap((quote) => {
    const time = Math.floor(quote.date.getTime() / 1000)
    if (!Number.isFinite(time)) return []
    return [{
      time,
      open: finite(quote.open),
      high: finite(quote.high),
      low: finite(quote.low),
      close: finite(quote.close),
      adjclose: finite(quote.adjclose),
      volume: finite(quote.volume),
    }]
  })
  if (!rows.length) throw new Error(`No history returned for ${symbol}.`)
  return {
    rows,
    currency: result.meta?.currency ?? 'USD',
    longName: result.meta?.longName ?? result.meta?.shortName ?? symbol,
    meta: result.meta,
  }
}

/**
 * Maintain one canonical series per symbol/interval. Requested windows become slices of
 * that series, while uncovered head and stale tail ranges are the only network reads.
 */
export async function getYahooSeries(
  options: IncrementalOptions,
  store: TtlCache = cache,
  rangeLoader: typeof fetchRange = fetchRange,
): Promise<IncrementalSeriesResult> {
  const symbol = options.symbol.trim().toUpperCase()
  if (!symbol) throw new Error('No symbol was provided.')
  const startSeconds = Math.floor(options.start.getTime() / 1000)
  const key = `series:yahoo:${options.variant ?? 'ohlcv'}:${symbol}:${options.interval}`
  const ttl = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'].includes(options.interval)
    ? TTL.chartIntraday
    : TTL.chartDaily
  const previous = store.get<SeriesDocument>(key, { allowStale: true })
  const needsEarlierCoverage = Boolean(previous && startSeconds < previous.value.coveredFrom)
  const now = Date.now()
  const needsReconcile = Boolean(
    previous && options.interval === '1d' && now - previous.value.fullSyncAt >= WEEKLY_RECONCILE_MS,
  )

  const resolved = await store.resolveWithStaleFallback(
    key,
    ttl,
    async (): Promise<SeriesDocument> => {
      const old = previous?.value
      const full = !old || Boolean(options.force) || needsReconcile
      // A forced refresh replaces the requested range but preserves any older canonical
      // coverage populated by a previous Max/backtest request.
      const fullStart = needsReconcile && old
        ? new Date(old.coveredFrom * 1000)
        : options.start
      let rows = full
        ? (old && options.force && !needsReconcile
            ? old.rows.filter((row) => row.time < startSeconds)
            : [])
        : old.rows
      let currency = old?.currency ?? 'USD'
      let longName = old?.longName ?? symbol
      let meta = old?.meta
      let coveredFrom = old ? Math.min(old.coveredFrom, startSeconds) : startSeconds

      if (full) {
        const fetched = await rangeLoader(symbol, options.interval, fullStart)
        rows = mergeRows(rows, fetched.rows)
        currency = fetched.currency
        longName = fetched.longName
        meta = fetched.meta
      } else {
        if (needsEarlierCoverage) {
          const first = old!.rows[0]
          const fetched = await rangeLoader(
            symbol,
            options.interval,
            options.start,
            first ? new Date(first.time * 1000) : undefined,
          )
          rows = mergeRows(rows, fetched.rows)
          currency = fetched.currency
          longName = fetched.longName
          meta = fetched.meta
          coveredFrom = startSeconds
        }
        const last = rows.at(-1)
        const tailStart = last ? overlapStart(last.time, options.interval) : options.start
        const fetched = await rangeLoader(symbol, options.interval, tailStart)
        rows = mergeRows(rows, fetched.rows)
        currency = fetched.currency
        longName = fetched.longName
        meta = fetched.meta
      }

      return {
        rows,
        coveredFrom,
        refreshedAt: now,
        fullSyncAt: full ? now : old!.fullSyncAt,
        currency,
        longName,
        meta,
      }
    },
    { force: Boolean(options.force) || needsEarlierCoverage || needsReconcile },
  )

  const document = resolved.value
  const rows = document.rows.filter((row) => row.time >= startSeconds)
  if (!rows.length) throw new Error(`No history returned for ${symbol}.`)
  return {
    rows,
    currency: document.currency,
    longName: document.longName,
    stale: resolved.stale,
    fromCache: resolved.fromCache,
    cacheAgeSeconds: resolved.ageSeconds,
    meta: document.meta,
  }
}

export type { CachedResult }
