/**
 * A process-wide pacing gate for every Yahoo request.
 *
 * Ported from `services/yahoo_rate_limit.py` in the PySide6 app. Yahoo answers an
 * unpaced burst with HTTP 429, and one dashboard load fans out into quotes, a chart,
 * three option chains, and one target plus one news search per holding. The gate
 * smooths that to a sustained rate with a small burst allowance, caps how many
 * requests are in flight, and on a 429 halves the rate and enters a cooldown,
 * recovering only after a run of clean responses.
 *
 * It also has two lanes. The startup warm-up in `src/api/prefetch.ts` fans a single task
 * out into a hundred requests at once — Trading Volumes and the Heatmap both do — so a
 * plain FIFO gate makes a page the user opens mid-warm wait out the whole batch at 4/s.
 * A `background` waiter therefore only takes a token or a slot when no `foreground`
 * waiter is queued, and one concurrency slot is reserved for the foreground lane so
 * background work can never hold every slot. The priority comes from `paced()` in
 * `client.ts`, which reads it off the request that started the fan-out.
 */

export type Priority = 'foreground' | 'background'

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

/**
 * Slots the background lane may not occupy. Background work already in flight is never
 * cancelled, so this is what bounds a foreground wait to one in-flight call rather than
 * to the whole warm-up batch.
 */
const FOREGROUND_RESERVED_SLOTS = 1

/** True when an error looks like Yahoo pushing back on request volume. */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const status = (error as { response?: { status?: number }; status?: number }).status ??
    (error as { response?: { status?: number } }).response?.status
  if (status === 429) return true
  const message = error instanceof Error ? error.message : String(error)
  return /\b429\b|too many requests|rate limit/i.test(message)
}

interface Waiter {
  priority: Priority
  wake: () => void
}

export class RateGate {
  private readonly options: RateGateOptions
  private readonly baseRate: number
  private rate: number
  private tokens: number
  private lastRefill: number
  private inFlight = 0
  private backgroundInFlight = 0
  private cooldownUntil = 0
  private cleanStreak = 0
  /** One FIFO queue per lane; the foreground queue is always drained first. */
  private readonly queues: Record<Priority, Waiter[]> = { foreground: [], background: [] }
  /** Set while waiters are being admitted, so `pump` cannot re-enter itself. */
  private pumping = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(options: Partial<RateGateOptions> = {}) {
    this.options = { ...DEFAULT_RATE_GATE_OPTIONS, ...options }
    this.baseRate = this.options.requestsPerSecond
    this.rate = this.baseRate
    this.tokens = this.options.burst
    this.lastRefill = Date.now()
  }

  /** Snapshot for diagnostics and the rate probe script. */
  stats(): {
    rate: number
    inFlight: number
    backgroundInFlight: number
    cooldownMs: number
    cleanStreak: number
    waiting: { foreground: number; background: number }
  } {
    return {
      rate: this.rate,
      inFlight: this.inFlight,
      backgroundInFlight: this.backgroundInFlight,
      cooldownMs: Math.max(0, this.cooldownUntil - Date.now()),
      cleanStreak: this.cleanStreak,
      waiting: {
        foreground: this.queues.foreground.length,
        background: this.queues.background.length,
      },
    }
  }

  /** Run `task` once the gate allows it, accounting for the result either way. */
  async run<T>(task: () => Promise<T>, priority: Priority = 'foreground'): Promise<T> {
    await this.acquire(priority)
    try {
      const result = await task()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure(error)
      throw error
    } finally {
      this.release(priority)
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsedSeconds = (now - this.lastRefill) / 1000
    if (elapsedSeconds <= 0) return
    this.lastRefill = now
    this.tokens = Math.min(this.options.burst, this.tokens + elapsedSeconds * this.rate)
  }

  /** Join the lane's queue and wait to be admitted by `pump`. */
  private acquire(priority: Priority): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queues[priority].push({ priority, wake: resolve })
      this.pump()
    })
  }

  /** The next waiter to admit: foreground first, and background only when it may run. */
  private nextWaiter(): Waiter | null {
    const foreground = this.queues.foreground[0]
    if (foreground) return foreground
    // A background waiter yields to any queued foreground work and never takes the last
    // slot, so a foreground request arriving mid-warm waits for one call, not a hundred.
    const background = this.queues.background[0]
    if (!background) return null
    if (this.inFlight >= this.options.maxConcurrency - FOREGROUND_RESERVED_SLOTS) return null
    return background
  }

  /**
   * Admit as many waiters as the cooldown, the concurrency ceiling and the token bucket
   * allow, then re-arm a timer for whatever is blocking the next one.
   */
  private pump(): void {
    if (this.pumping) return
    this.pumping = true
    try {
      for (;;) {
        const waiter = this.nextWaiter()
        if (!waiter) return

        const cooldownMs = this.cooldownUntil - Date.now()
        if (cooldownMs > 0) {
          this.wakeLater(Math.min(cooldownMs, 1000))
          return
        }
        if (this.inFlight >= this.options.maxConcurrency) return

        this.refill()
        if (this.tokens < 1) {
          this.wakeLater(Math.max(Math.ceil(((1 - this.tokens) / this.rate) * 1000), 25))
          return
        }

        this.queues[waiter.priority].shift()
        this.tokens -= 1
        this.inFlight += 1
        if (waiter.priority === 'background') this.backgroundInFlight += 1
        waiter.wake()
      }
    } finally {
      this.pumping = false
    }
  }

  /**
   * Re-check the queues once `ms` has passed; only one timer is ever outstanding.
   *
   * Deliberately not `unref`'d. It stands in for the `await sleep(...)` the old polling
   * `acquire()` did, which held the event loop open while a request waited for a token —
   * the probe scripts have nothing else keeping the process alive, so an unref'd timer
   * lets them exit in the middle of a queued burst.
   */
  private wakeLater(ms: number): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.pump()
    }, ms)
  }

  private release(priority: Priority): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    if (priority === 'background') {
      this.backgroundInFlight = Math.max(0, this.backgroundInFlight - 1)
    }
    this.pump()
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
