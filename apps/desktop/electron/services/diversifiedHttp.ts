import { apiUsageTracker, trackApiRequest } from './apiUsage.js'

export const DIVERSIFIED_BUDGETS = {
  coinbase: { label: 'Coinbase', minute: 90, day: 50_000 },
  binance: { label: 'Binance', minute: 60, day: 30_000 },
  'world-bank': { label: 'World Bank', minute: 20, day: 1_000 },
  imf: { label: 'IMF', minute: 20, day: 1_000 },
} as const
export type DiversifiedProvider = keyof typeof DIVERSIFIED_BUDGETS

/** Fail over immediately under pressure, without queueing the whole startup behind one provider. */
export class DiversifiedHttp {
  private states = new Map<DiversifiedProvider, { times: number[]; day: number; count: number; until: number; active: number }>()

  constructor(private request: typeof fetch = (...args) => fetch(...args), private now = Date.now) {}

  async get<T>(provider: DiversifiedProvider, url: URL, parse: (body: string) => T, headers: Record<string, string> = {}): Promise<T> {
    const hosts = { coinbase: 'api.exchange.coinbase.com', binance: 'data-api.binance.vision', 'world-bank': 'api.worldbank.org', imf: 'api.imf.org' }
    if (url.protocol !== 'https:' || url.host !== hosts[provider] || url.username || url.password
      || Object.keys(headers).some(name => name.toLowerCase() !== 'accept')
      || [...url.searchParams.keys()].some(name => /key|token|secret/i.test(name))) throw new Error('Only public provider endpoints are allowed.')
    const policy = DIVERSIFIED_BUDGETS[provider]
    const now = this.now()
    const day = Math.floor(now / 86_400_000)
    const state = this.states.get(provider) ?? { times: [], day, count: 0, until: 0, active: 0 }
    this.states.set(provider, state)
    if (state.day !== day) { state.day = day; state.count = 0 }
    state.times = state.times.filter(time => time > now - 60_000)
    if (state.until > now || state.active >= 6 || state.times.filter(time => time > now - 1_000).length >= 6
      || state.times.length >= policy.minute || state.count >= policy.day) {
      throw new Error(`${policy.label}: request budget or cooldown active.`)
    }
    state.times.push(now)
    state.count += 1
    state.active += 1
    try {
      return await trackApiRequest(provider, async () => {
        try {
          const response = await this.request(url, { headers: { Accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(6_000) })
          if (!response.ok) {
            const retry = response.headers.get('Retry-After')
            const retryAt = retry && Number.isFinite(Number(retry)) ? this.now() + Math.max(0, Number(retry)) * 1_000 : Date.parse(retry ?? '')
            const delay = response.status === 401 || response.status === 403 ? 10 * 60_000 : response.status === 429 || response.status === 418 ? 60_000 : 10_000
            state.until = Math.max(state.until, this.now() + delay, Number.isFinite(retryAt) ? retryAt : 0)
            apiUsageTracker.setCooldown(provider, state.until)
            // Never propagate the URL, response body, headers or an upstream exception (keys may be embedded).
            throw new Error('Upstream request failed')
          }
          const content = await response.text()
          if (content.length > 4_000_000) throw new Error('Response too large')
          return parse(content)
        } catch {
          state.until = Math.max(state.until, this.now() + 10_000)
          apiUsageTracker.setCooldown(provider, state.until)
          throw new Error(`${policy.label}: request failed or response was invalid.`)
        }
      })
    } finally { state.active -= 1 }
  }
}

export const diversifiedHttp = new DiversifiedHttp()
