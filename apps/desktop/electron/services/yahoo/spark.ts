/**
 * Yahoo's `spark` endpoint: many symbols' daily closes in one request.
 *
 * The Heatmap page needs a year of daily closes for every constituent of an index — 503
 * symbols for SPY. The reference gets that in a single `yf.download(symbols, period='2y')`
 * bulk call. `yahoo-finance2` has no bulk download, and 503 individual `chart()` calls
 * behind the rate gate would make the page cost five times what Trading Volumes does, so
 * this posts to `v8/finance/spark`, which Yahoo caps at 20 symbols per request — 26
 * requests for SPY, comparable to the hundred charts Trading Volumes already spends.
 *
 * It is a Yahoo host, so it goes through `paced()` like everything else. It is fetched
 * through the client's own `_fetch` so the cookie jar and queue are Yahoo's too; spark
 * needs no crumb.
 *
 * One year, not the reference's two: every interval the page offers reads at most a year
 * back (`1y` is the longest), so the second year is bytes nobody reads. The closes are
 * unadjusted, which matches the reference's `auto_adjust=False`.
 */

import { paced, yahoo } from './client.js'

const SPARK_URL = 'https://query1.finance.yahoo.com/v8/finance/spark'

/** Yahoo answers a longer list with `Number of symbols needs to be less than or equal to 20`. */
export const SPARK_BATCH_SIZE = 20

export interface SparkSeries {
  /** `YYYY-MM-DD`, ascending. */
  dates: string[]
  closes: number[]
}

interface SparkEntry {
  symbol?: string
  timestamp?: Array<number | null>
  close?: Array<number | null>
}

function toSeries(entry: SparkEntry): SparkSeries | null {
  const stamps = entry.timestamp ?? []
  const closes = entry.close ?? []
  const dates: string[] = []
  const values: number[] = []
  let previousDate = ''

  for (let index = 0; index < stamps.length; index += 1) {
    const stamp = stamps[index]
    const close = closes[index]
    if (typeof stamp !== 'number' || typeof close !== 'number' || !Number.isFinite(close)) continue
    const date = new Date(stamp * 1000).toISOString().slice(0, 10)
    if (date === previousDate) {
      // Yahoo repeats the current session as a live bar; keep the newer value, exactly as
      // `fetchCloses` does for the chart endpoint.
      values[values.length - 1] = close
      continue
    }
    previousDate = date
    dates.push(date)
    values.push(close)
  }
  return dates.length ? { dates, closes: values } : null
}

async function fetchChunk(symbols: string[], range: string): Promise<Record<string, SparkSeries>> {
  const body = (await paced(() =>
    yahoo._fetch(
      SPARK_URL,
      {
        symbols: symbols.join(','),
        range,
        interval: '1d',
        indicators: 'close',
        includeTimestamps: 'true',
        lang: 'en-US',
        region: 'US',
        corsDomain: 'finance.yahoo.com',
      },
      {},
      'json',
      false,
    ),
  )) as Record<string, SparkEntry> & { spark?: { error?: { description?: string } } }

  if (body?.spark?.error) {
    throw new Error(body.spark.error.description ?? 'Yahoo rejected the spark request.')
  }

  const out: Record<string, SparkSeries> = {}
  for (const [key, entry] of Object.entries(body ?? {})) {
    if (!entry || typeof entry !== 'object' || key === 'spark') continue
    const series = toSeries(entry as SparkEntry)
    if (series) out[(entry as SparkEntry).symbol?.toUpperCase() ?? key.toUpperCase()] = series
  }
  return out
}

export interface SparkBatch {
  series: Record<string, SparkSeries>
  missing: string[]
}

/**
 * Daily closes for every symbol, in chunks of twenty.
 *
 * A chunk that fails only costs its own twenty symbols, which then land in `missing` and
 * render as no-data tiles — the same degradation the reference reports as a partial load.
 */
export async function fetchSparkCloses(symbols: string[], range = '1y'): Promise<SparkBatch> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
  const chunks: string[][] = []
  for (let index = 0; index < unique.length; index += SPARK_BATCH_SIZE) {
    chunks.push(unique.slice(index, index + SPARK_BATCH_SIZE))
  }

  const settled = await Promise.allSettled(chunks.map((chunk) => fetchChunk(chunk, range)))
  const series: Record<string, SparkSeries> = {}
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') Object.assign(series, outcome.value)
  }
  return { series, missing: unique.filter((symbol) => !series[symbol]) }
}

/**
 * Yahoo spells a share class with a hyphen where an issuer file uses a dot — `BRK.B` is
 * `BRK-B`. `_yahoo_symbol`.
 */
export function yahooSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, '-')
}
