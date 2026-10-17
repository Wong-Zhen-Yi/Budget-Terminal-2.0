import type { AsyncBuffer } from 'hyparquet'
import { cache, type TtlCache } from '../cache.js'
import { trackApiRequest } from '../apiUsage.js'
import { readDefeatBetaParquet } from './decoder.js'
import { DefeatBetaRequestGate } from './requestGate.js'

const BASE = 'https://huggingface.co/datasets/defeatbeta/yahoo-finance-data/resolve'
const SPEC_TTL = 60 * 60_000
const MAX_RANGE = 8 * 1024 * 1024

export type DefeatBetaTable = 'stock_prices' | 'stock_profile' | 'stock_statement' | 'stock_shares_outstanding'
  | 'stock_dividend_events' | 'stock_earning_calendar' | 'stock_news' | 'stock_split_events'
  | 'stock_officers' | 'stock_earning_call_transcripts' | 'stock_sec_filing' | 'stock_revenue_breakdown'
export type DataRow = Record<string, unknown>

interface DatasetSpec {
  revision: string
  updatedAt: number
  files: Record<string, { file_size: number }>
}

/** Only the US equity dataset is used; never map a currency, future or index to an equity. */
export function defeatBetaSymbol(input: string): string {
  const symbol = input.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9-]{0,14}$/.test(symbol)) {
    throw new Error(`DefeatBeta has no supported US equity symbol for ${input}.`)
  }
  return symbol
}

function record(value: unknown): DataRow {
  return value && typeof value === 'object' ? value as DataRow : {}
}

export class DefeatBetaClient {
  private spec?: { value: DatasetSpec; expiresAt: number }
  private specFlight?: Promise<DatasetSpec>
  private readonly gate = new DefeatBetaRequestGate()
  private readonly byteRanges = new Map<string, Promise<ArrayBuffer>>()
  private rangeBytes = 0

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly store: TtlCache = cache) {}

  private async request<T>(url: string, init: RequestInit | undefined, consume: (response: Response) => Promise<T>): Promise<T> {
    return this.gate.run(() => trackApiRequest('defeatbeta', async () => {
      const response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(20_000) })
      if (!response.ok) {
        await response.body?.cancel()
        const retryAfter = response.headers.get('retry-after')
        const seconds = retryAfter === null ? NaN : Number(retryAfter)
        const retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
          : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : 0
        throw Object.assign(new Error(`DefeatBeta HTTP ${response.status}`), { status: response.status,
          retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 0 })
      }
      return consume(response)
    }))
  }

  private async dataset(force = false): Promise<DatasetSpec> {
    if (!force && this.spec && this.spec.expiresAt > Date.now()) return this.spec.value
    if (this.specFlight) return this.specFlight
    this.specFlight = this.store.resolveWithStaleFallback('defeatbeta:manifest:v1', SPEC_TTL, async () => {
      const { data, revision } = await this.request(`${BASE}/main/spec.json`, undefined, async response => ({
        data: record(await response.json()), revision: response.headers.get('x-repo-commit'),
      }))
      // Pin every range to the same immutable revision as the size/footer metadata.
      const updatedAt = Date.parse(String(data.update_time))
      if (!revision || !/^[a-f0-9]{40}$/.test(revision) || !Number.isFinite(updatedAt)) {
        throw new Error('DefeatBeta returned invalid dataset version metadata.')
      }
      const files = record(data.footer_index)
      const value = { revision, updatedAt, files: files as DatasetSpec['files'] }
      return value
    }, { force }).then(result => {
      this.spec = { value: result.value, expiresAt: Date.now() + (result.stale ? 60_000 : SPEC_TTL) }
      return result.value
    }).finally(() => { this.specFlight = undefined })
    return this.specFlight
  }

  private file(spec: DatasetSpec, table: DefeatBetaTable): AsyncBuffer {
    const path = `US/${table}.parquet`
    const size = spec.files[path]?.file_size
    if (!Number.isSafeInteger(size) || size < 8) throw new Error(`DefeatBeta metadata is missing ${table}.`)
    return {
      byteLength: size,
      slice: async (offset, end = size) => {
        const start = offset < 0 ? size + offset : offset
        if (start < 0 || end > size || end <= start || end - start > MAX_RANGE) {
          throw new Error('DefeatBeta requested an invalid or oversized byte range.')
        }
        const key = `${spec.revision}:${table}:${start}:${end}`
        let pending = this.byteRanges.get(key)
        if (!pending) {
          pending = this.request(`${BASE}/${spec.revision}/data/${path}`, { headers: { Range: `bytes=${start}-${end - 1}` } }, async response => {
            if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end - 1}/${size}`) {
              await response.body?.cancel()
              throw new Error('DefeatBeta server did not honor the requested byte range.')
            }
            const buffer = await response.arrayBuffer()
            if (buffer.byteLength !== end - start) throw new Error('DefeatBeta returned a truncated byte range.')
            return buffer
          })
          const bytes = end - start
          while (this.rangeBytes + bytes > 64 * 1024 * 1024 && this.byteRanges.size) {
            const oldest = this.byteRanges.keys().next().value!
            const old = this.byteRanges.get(oldest)!
            this.byteRanges.delete(oldest)
            // Sizes are encoded in the range key, so pending ranges count too.
            const parts = oldest.split(':')
            this.rangeBytes -= Number(parts.at(-1)) - Number(parts.at(-2))
            void old.catch(() => {})
          }
          this.byteRanges.set(key, pending)
          this.rangeBytes += bytes
          void pending.catch(() => {
            if (this.byteRanges.get(key) === pending) { this.byteRanges.delete(key); this.rangeBytes -= bytes }
          })
        }
        // The decoder transfers ownership; keep the cached bytes intact for siblings.
        return (await pending).slice(0)
      },
    }
  }

  async rows(table: DefeatBetaTable, input: string, force = false): Promise<{ rows: DataRow[]; updatedAt: number }> {
    const symbol = defeatBetaSymbol(input)
    const spec = await this.dataset(force)
    const key = `defeatbeta:${spec.revision}:${table}:${symbol}`
    // Revision-pinned rows cannot change. Reuse them across page refreshes; only the
    // small spec needs frequent revalidation to discover a new publication.
    const result = await this.store.resolve(key, 7 * 24 * 60 * 60_000, async () => {
      const columns = table === 'stock_news' ? ['symbol', 'uuid', 'title', 'publisher', 'report_date', 'link'] : undefined
      const rows = await readDefeatBetaParquet(this.file(spec, table), `${spec.revision}:${table}`, symbol, { columns })
      if (!rows.length && ['stock_prices', 'stock_profile', 'stock_statement', 'stock_shares_outstanding'].includes(table)) {
        throw new Error(`DefeatBeta has no ${table} data for ${symbol}.`)
      }
      return rows
    })
    return { rows: result.value, updatedAt: spec.updatedAt }
  }

  /** Read the heatmap basket once, filtering recent daily rows in the worker. */
  async priceRows(inputs: string[], startDate: string, force = false): Promise<{ rows: DataRow[]; updatedAt: number }> {
    const symbols = [...new Set(inputs.map(defeatBetaSymbol))].sort()
    if (!symbols.length) return { rows: [], updatedAt: Date.now() }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Invalid price history start date.')
    const spec = await this.dataset(force)
    const key = `defeatbeta:${spec.revision}:heatmap-closes:v1:${startDate}:${symbols.join(',')}`
    const result = await this.store.resolve(key, 7 * 24 * 60 * 60_000, () =>
      readDefeatBetaParquet(this.file(spec, 'stock_prices'), `${spec.revision}:stock_prices`, '', {
        // Include the intervening open column so Parquet can coalesce this contiguous
        // prefix into one HTTP range per group. Only close is consumed by Heatmap.
        symbols, startDate, columns: ['symbol', 'report_date', 'open', 'close'],
      }))
    return { rows: result.value, updatedAt: spec.updatedAt }
  }

  async companies(): Promise<DataRow[]> {
    const spec = await this.dataset()
    const result = await this.store.resolve(`defeatbeta:companies:${spec.revision}`, 24 * 60 * 60_000, () =>
      this.request(`${BASE}/${spec.revision}/data/US/company_tickers.json`, undefined, async response => record(await response.json())))
    return Object.values(result.value).map(record)
  }

  async company(input: string): Promise<DataRow> {
    const symbol = defeatBetaSymbol(input)
    return (await this.companies()).find(row => row.ticker === symbol) ?? {}
  }
}

export const defeatBeta = new DefeatBetaClient()
