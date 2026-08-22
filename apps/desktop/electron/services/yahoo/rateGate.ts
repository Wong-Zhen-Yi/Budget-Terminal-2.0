/**
 * A process-wide pacing gate for every Yahoo request.
 *
 * Ported from `services/yahoo_rate_limit.py` in the PySide6 app. Yahoo answers an
 * unpaced burst with HTTP 429, and one dashboard load fans out into quotes, a chart,
 * three option chains, and one target plus one news search per holding. The gate
 * smooths that to a sustained rate with a small burst allowance, caps how many
 * requests are in flight, and on a 429 halves the rate and enters a cooldown,
 * recovering only after a run of clean responses.
 */

export interface RateGateOptions {
  /** Sustained requests per second once the burst allowance is spent. */
  requestsPerSecond: number
  /** How many requests may be spent back-to-back before pacing kicks in. */
  burst: number
  /** Hard ceiling on concurrent in-flight requests. */
  maxConcurrency: number
  /** How long to pause everything after a 429. */
  cooldownSeconds: number
  /** Clean responses needed before the rate recovers a step. */
  recoveryStreak: number
}

export const DEFAULT_RATE_GATE_OPTIONS: RateGateOptions = {
  requestsPerSecond: 4,
  burst: 6,
  maxConcurrency: 4,
  cooldownSeconds: 20,
  recoveryStreak: 12,
}

const MIN_RATE = 0.25

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** True when an error looks like Yahoo pushing back on request volume. */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const status = (error as { response?: { status?: number }; status?: number }).status ??
    (error as { response?: { status?: number } }).response?.status
  if (status === 429) return true
  const message = error instanceof Error ? error.message : String(error)
  return /\b429\b|too many requests|rate limit/i.test(message)
}

export class RateGate {
  private readonly options: RateGateOptions
  private readonly baseRate: number
  private rate: number
  private tokens: number
  private lastRefill: number
  private inFlight = 0
  private cooldownUntil = 0
  private cleanStreak = 0
  private waiters: Array<() => void> = []

  constructor(options: Partial<RateGateOptions> = {}) {
    this.options = { ...DEFAULT_RATE_GATE_OPTIONS, ...options }
    this.baseRate = this.options.requestsPerSecond
    this.rate = this.baseRate
    this.tokens = this.options.burst
    this.lastRefill = Date.now()
  }

  /** Snapshot for diagnostics and the rate probe script. */
  stats(): { rate: number; inFlight: number; cooldownMs: number; cleanStreak: number } {
    return {
      rate: this.rate,
      inFlight: this.inFlight,
      cooldownMs: Math.max(0, this.cooldownUntil - Date.now()),
      cleanStreak: this.cleanStreak,
    }
  }

  /** Run `task` once the gate allows it, accounting for the result either way. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      const result = await task()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure(error)
      throw error
    } finally {
      this.release()
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsedSeconds = (now - this.lastRefill) / 1000
    if (elapsedSeconds <= 0) return
    this.lastRefill = now
    this.tokens = Math.min(this.options.burst, this.tokens + elapsedSeconds * this.rate)
  }

  private async acquire(): Promise<void> {
    for (;;) {
      const cooldownMs = this.cooldownUntil - Date.now()
      if (cooldownMs > 0) {
        await sleep(Math.min(cooldownMs, 1000))
        continue
      }
      if (this.inFlight >= this.options.maxConcurrency) {
        await new Promise<void>((resolve) => this.waiters.push(resolve))
        continue
      }
      this.refill()
      if (this.tokens < 1) {
        const waitMs = Math.ceil(((1 - this.tokens) / this.rate) * 1000)
        await sleep(Math.max(waitMs, 25))
        continue
      }
      this.tokens -= 1
      this.inFlight += 1
      return
    }
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    const next = this.waiters.shift()
    if (next) next()
  }

  private onSuccess(): void {
    this.cleanStreak += 1
    if (this.cleanStreak >= this.options.recoveryStreak && this.rate < this.baseRate) {
      this.cleanStreak = 0
      this.rate = Math.min(this.baseRate, this.rate * 2)
    }
  }

  private onFailure(error: unknown): void {
    if (!isRateLimitError(error)) return
    this.cleanStreak = 0
    this.rate = Math.max(MIN_RATE, this.rate / 2)
    this.tokens = 0
    this.cooldownUntil = Date.now() + this.options.cooldownSeconds * 1000
  }
}

export const rateGate = new RateGate()
