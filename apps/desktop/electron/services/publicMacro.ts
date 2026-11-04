import type { EconomicPoint } from '../shared/contract.js'
import { cache, type TtlCache } from './cache.js'
import { diversifiedHttp, type DiversifiedHttp } from './diversifiedHttp.js'
import { parseCsvRecords } from './etf/csv.js'
import { observeSource } from './sourceHealth.js'

/** Annual context is deliberately separate from monthly CPI and quarterly GDP. */
export function parseWorldBankInflation(body: unknown, year: number): EconomicPoint[] {
  if (!Array.isArray(body) || !Array.isArray(body[1]) || Number(body[0]?.pages) !== 1) throw new Error('Invalid World Bank response')
  const points: EconomicPoint[] = []
  for (const row of body[1]) {
    if (row?.indicator?.id !== 'FP.CPI.TOTL.ZG' || row.countryiso3code !== 'USA') throw new Error('Wrong World Bank indicator')
    if (!/^\d{4}$/.test(row.date) || Number(row.date) >= year || Number(row.date) < year - 11) continue
    if (typeof row.value === 'number' && Number.isFinite(row.value)) points.push([`${row.date}-01-01`, row.value])
  }
  return validated(points)
}

export function parseImfGrowth(text: string, year: number): EconomicPoint[] {
  const points: EconomicPoint[] = []
  for (const row of parseCsvRecords(text)) {
    if (row.country !== 'USA' || row.indicator !== 'NGDP_RPCH' || row.frequency !== 'A') throw new Error('Wrong IMF series')
    // WEO includes forecasts even for completed years. Respect each series' explicit actual-data cutoff.
    if (!/^\d{4}$/.test(row.time_period) || !/^\d{4}$/.test(row.latest_actual_annual_data)) continue
    const period = Number(row.time_period)
    if (period >= year || period < year - 11 || period > Number(row.latest_actual_annual_data)) continue
    if (row.scale !== '0' || !row.obs_value?.trim()) continue
    const value = Number(row.obs_value)
    if (Number.isFinite(value)) points.push([`${period}-01-01`, value])
  }
  return validated(points)
}

function validated(points: EconomicPoint[]): EconomicPoint[] {
  const sorted = [...new Map(points.map(point => [point[0], point])).values()].sort((a, b) => a[0].localeCompare(b[0]))
  if (sorted.length < 2) throw new Error('Annual series has insufficient observations')
  return sorted
}

export class PublicMacroClient {
  constructor(private http: DiversifiedHttp = diversifiedHttp, private storage: TtlCache = cache, private now = Date.now) {}

  async series(provider: 'world-bank' | 'imf'): Promise<EconomicPoint[]> {
    const year = new Date(this.now()).getUTCFullYear()
    const result = await this.storage.resolve(`public-macro:v1:${provider}:${year}`, 24 * 60 * 60_000, () => {
      if (provider === 'world-bank') {
        const url = new URL('https://api.worldbank.org/v2/country/USA/indicator/FP.CPI.TOTL.ZG')
        url.search = new URLSearchParams({ format: 'json', date: `${year - 11}:${year - 1}`, per_page: '100' }).toString()
        return this.http.get(provider, url, text => parseWorldBankInflation(JSON.parse(text), year))
      }
      // Pin the verified WEO structure version; do not guess the dimension order from an unversioned dataset.
      const url = new URL('https://api.imf.org/external/sdmx/2.1/data/IMF.RES,WEO,6.0.0/USA.NGDP_RPCH.A')
      url.search = new URLSearchParams({ startPeriod: String(year - 11), endPeriod: String(year - 1) }).toString()
      return this.http.get(provider, url, text => parseImfGrowth(text, year), { Accept: 'text/csv' })
    })
    const fetchedAt = this.now() - result.ageSeconds * 1_000
    observeSource({ fetchedAt, expiresAt: fetchedAt + 24 * 60 * 60_000, fromCache: result.fromCache, stale: false, failures: [], sources: [provider === 'imf' ? 'IMF WEO annual actuals' : 'World Bank annual CPI inflation'] })
    return result.value
  }
}

export const publicMacro = new PublicMacroClient()
