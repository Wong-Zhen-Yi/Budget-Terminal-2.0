import type { ApiProviderUsage, ApiUsageSnapshot } from '../shared/contract.js'
import { rateGate } from './yahoo/rateGate.js'

interface ProviderDefinition {
  label: string
  /** A conservative app-side budget, not a provider-reported account quota. */
  softLimit: number
  windowMs: number
  fallbackCooldownMs: number
}

const PROVIDERS: Record<string, ProviderDefinition> = {
  yahoo: {
    label: 'Yahoo',
    softLimit: 240,
    windowMs: 60_000,
    fallbackCooldownMs: 20_000,
  },
  coingecko: {
    label: 'CoinGecko',
    softLimit: 30,
    windowMs: 60_000,
    fallbackCooldownMs: 60_000,
  },
  alternative: {
    label: 'Alt.me',
    softLimit: 60,
    windowMs: 60_000,
    fallbackCooldownMs: 60_000,
  },
  defeatbeta: {
    label: 'DefeatBeta',
    softLimit: 60,
    windowMs: 60_000,
    fallbackCooldownMs: 5 * 60_000,
  },
}

interface ProviderState {
  requestTimes: number[]
  inFlight: number
  throttledUntil: number
  updatedAt: number
}

function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const status = (error as { status?: number; response?: { status?: number } }).status ??
    (error as { response?: { status?: number } }).response?.status
  if (status === 429) return true
  const message = error instanceof Error ? error.message : String(error)
  return /\b429\b|too many requests|rate limit/i.test(message)
}

/**
 * Process-local rolling request counters for upstream providers.
 *
 * Providers generally do not expose remaining quota to an unauthenticated desktop app,
 * so the footer reports pressure against conservative app-side soft limits. A real 429
 * overrides the estimate and pins the provider at 100% for its cooldown period.
 */
export class ApiUsageTracker {
  private readonly states = new Map<string, ProviderState>()

  constructor(
    private readonly providers: Record<string, ProviderDefinition> = PROVIDERS,
    private readonly now: () => number = Date.now,
  ) {}

  async track<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const definition = this.providers[providerId]
    if (!definition) return task()

    const startedAt = this.now()
    const state = this.stateFor(providerId)
    this.prune(state, definition, startedAt)
    state.requestTimes.push(startedAt)
    state.inFlight += 1
    state.updatedAt = startedAt

    try {
      return await task()
    } catch (error) {
      if (isRateLimitError(error)) {
        state.throttledUntil = Math.max(
          state.throttledUntil,
          this.now() + definition.fallbackCooldownMs,
        )
      }
      throw error
    } finally {
      state.inFlight = Math.max(0, state.inFlight - 1)
      state.updatedAt = this.now()
    }
  }

  snapshot(): ApiUsageSnapshot {
    const sampledAt = this.now()
    const providers: ApiProviderUsage[] = []

    for (const providerId of Object.keys(this.providers)) {
      const state = this.stateFor(providerId)
      const definition = this.providers[providerId]
      this.prune(state, definition, sampledAt)
      const throttled = state.throttledUntil > sampledAt
      const requestCount = state.requestTimes.length
      providers.push({
        id: providerId,
        label: definition.label,
        percent: throttled
          ? 100
          : Math.min(100, Math.ceil((requestCount / definition.softLimit) * 100)),
        requestCount,
        softLimit: definition.softLimit,
        windowSeconds: Math.round(definition.windowMs / 1000),
        inFlight: state.inFlight,
        throttled,
        cooldownMs: Math.max(0, state.throttledUntil - sampledAt),
        updatedAt: state.updatedAt,
      })
    }

    return { providers, sampledAt }
  }

  private stateFor(providerId: string): ProviderState {
    const current = this.states.get(providerId)
    if (current) return current
    const created: ProviderState = {
      requestTimes: [],
      inFlight: 0,
      throttledUntil: 0,
      updatedAt: this.now(),
    }
    this.states.set(providerId, created)
    return created
  }

  private prune(state: ProviderState, definition: ProviderDefinition, now: number): void {
    const cutoff = now - definition.windowMs
    let firstLive = 0
    while (firstLive < state.requestTimes.length && state.requestTimes[firstLive] <= cutoff) {
      firstLive += 1
    }
    if (firstLive) state.requestTimes.splice(0, firstLive)
  }
}

export const apiUsageTracker = new ApiUsageTracker()

export function trackApiRequest<T>(providerId: string, task: () => Promise<T>): Promise<T> {
  return apiUsageTracker.track(providerId, task)
}

export function getApiUsageSnapshot(): ApiUsageSnapshot {
  const snapshot = apiUsageTracker.snapshot()
  const yahoo = snapshot.providers.find(provider => provider.id === 'yahoo')
  if (yahoo) {
    const gate = rateGate.stats()
    yahoo.queued = gate.waiting.foreground + gate.waiting.background
    yahoo.backgroundRequestsPerSecond = gate.backgroundRate
  }
  return snapshot
}
