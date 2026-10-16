import type { AsyncBuffer } from 'hyparquet'
import { cache, type TtlCache } from '../cache.js'
import { trackApiRequest } from '../apiUsage.js'
import { readDefeatBetaParquet } from './decoder.js'

const BASE = 'https://huggingface.co/datasets/defeatbeta/yahoo-finance-data/resolve'
const SPEC_TTL = 5 * 60_000
const MAX_RANGE = 8 * 1024 * 1024

export type DefeatBetaTable = 'stock_prices' | 'stock_profile' | 'stock_statement' | 'stock_shares_outstanding'
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

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly store: TtlCache = cache) {}

  private async request(url: string, init?: RequestInit): Promise<Response> {
    return trackApiRequest('defeatbeta', async () => {
      const response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(20_000) })
      if (!response.ok) {
        await response.body?.cancel()
        throw Object.assign(new Error(`DefeatBeta HTTP ${response.status}`), { status: response.status })
      }
      return response
    })
  }

  private async dataset(): Promise<DatasetSpec> {
    if (this.spec && this.spec.expiresAt > Date.now()) return this.spec.value
    if (this.specFlight) return this.specFlight
    this.specFlight = (async () => {
      const response = await this.request(`${BASE}/main/spec.json`)
      // Pin every range to the same immutable revision as the size/footer metadata.
      const revision = response.headers.get('x-repo-commit')
      const data = record(await response.json())
      const updatedAt = Date.parse(String(data.update_time))
      if (!revision || !/^[a-f0-9]{40}$/.test(revision) || !Number.isFinite(updatedAt)) {
        throw new Error('DefeatBeta returned invalid dataset version metadata.')
      }
      const files = record(data.footer_index)
      const value = { revision, updatedAt, files: files as DatasetSpec['files'] }
      this.spec = { value, expiresAt: Date.now() + SPEC_TTL }
      return value
    })().finally(() => { this.specFlight = undefined })
    return this.specFlight
  }

  async rows(table: DefeatBetaTable, input: string): Promise<{ rows: DataRow[]; updatedAt: number }> {
    const symbol = defeatBetaSymbol(input)
    const spec = await this.dataset()
    const path = `US/${table}.parquet`
    const size = spec.files[path]?.file_size
    if (!Number.isSafeInteger(size) || size < 8) throw new Error(`DefeatBeta metadata is missing ${table}.`)
    const key = `defeatbeta:${spec.revision}:${table}:${symbol}`
    const result = await this.store.resolve(key, SPEC_TTL, async () => {
      const file: AsyncBuffer = {
        byteLength: size,
        slice: async (offset, end = size) => {
          const start = offset < 0 ? size + offset : offset
          if (start < 0 || end > size || end <= start || end - start > MAX_RANGE) {
            throw new Error('DefeatBeta requested an invalid or oversized byte range.')
          }
          const response = await this.request(`${BASE}/${spec.revision}/data/${path}`, {
            headers: { Range: `bytes=${start}-${end - 1}` },
          })
          // Refuse whole-file responses: the prices dataset is hundreds of MB.
          if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end - 1}/${size}`) {
            await response.body?.cancel()
            throw new Error('DefeatBeta server did not honor the requested byte range.')
          }
          const buffer = await response.arrayBuffer()
          if (buffer.byteLength !== end - start) throw new Error('DefeatBeta returned a truncated byte range.')
          return buffer
        },
      }
      const rows = await readDefeatBetaParquet(file, `${spec.revision}:${table}`, symbol)
      if (!rows.length) throw new Error(`DefeatBeta has no ${table} data for ${symbol}.`)
      return rows
    })
    return { rows: result.value, updatedAt: spec.updatedAt }
  }

  async company(input: string): Promise<DataRow> {
    const symbol = defeatBetaSymbol(input)
    const spec = await this.dataset()
    const result = await this.store.resolve(`defeatbeta:companies:${spec.revision}`, SPEC_TTL, async () => {
      const response = await this.request(`${BASE}/${spec.revision}/data/US/company_tickers.json`)
      return record(await response.json())
    })
    return Object.values(result.value).map(record).find(row => row.ticker === symbol) ?? {}
  }
}

export const defeatBeta = new DefeatBetaClient()
