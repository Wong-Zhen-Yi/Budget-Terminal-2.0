type Priority = 'foreground' | 'background'

interface WaitingJob {
  weight: number
  priority: Priority
  start: () => void
}

/** Hyperliquid limits aggregate weighted work per minute, not seconds per call.
 * Small interactive bursts are admitted immediately. Crypto and equities share
 * this budget, and startup work leaves a connection slot for ticker switches.
 */
export class HyperliquidRateGate {
  private readonly waiting: WaitingJob[] = []
  private readonly starts: Array<{ at: number; weight: number }> = []
  private active = 0
  private activeBackground = 0
  private foregroundStreak = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: {
    weightLimit?: number
    windowMs?: number
    concurrency?: number
    now?: () => number
  } = {}) {}

  run<T>(weight: number, task: () => Promise<T>, priority: Priority = 'foreground'): Promise<T> {
    const limit = this.options.weightLimit ?? 1_000
    if (!Number.isFinite(weight) || weight <= 0 || weight > limit) return Promise.reject(new Error('Invalid Hyperliquid request weight.'))
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ weight, priority, start: () => {
        this.active += 1
        if (priority === 'background') this.activeBackground += 1
        this.starts.push({ at: this.now(), weight })
        void Promise.resolve().then(task).then(resolve, reject).finally(() => {
          this.active -= 1
          if (priority === 'background') this.activeBackground -= 1
          this.pump()
        })
      } })
      this.pump()
    })
  }

  private now(): number { return (this.options.now ?? Date.now)() }

  private pump(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    const now = this.now()
    const windowMs = this.options.windowMs ?? 60_000
    while (this.starts.length && this.starts[0].at <= now - windowMs) this.starts.shift()
    let used = this.starts.reduce((sum, entry) => sum + entry.weight, 0)
    const concurrency = this.options.concurrency ?? 4
    while (this.waiting.length && this.active < concurrency) {
      const foreground = this.waiting.findIndex(job => job.priority === 'foreground')
      const background = this.waiting.findIndex(job => job.priority === 'background')
      const backgroundAllowed = this.activeBackground < Math.max(1, concurrency - 1)
      const limit = this.options.weightLimit ?? 1_000
      const backgroundWeight = this.waiting[background]?.weight ?? 0
      const backgroundAffordable = used + backgroundWeight <= Math.max(backgroundWeight, Math.floor(limit * 0.8))
      const index = foreground >= 0 && !(this.foregroundStreak >= 4 && background >= 0 && backgroundAllowed && backgroundAffordable)
        ? foreground : backgroundAllowed ? background : -1
      if (index < 0) return
      const job = this.waiting[index]
      // Leave rate budget for ticker switches as well as a connection slot.
      const budget = job.priority === 'background' ? Math.max(job.weight, Math.floor(limit * 0.8)) : limit
      if (used + job.weight > budget) {
        this.timer = setTimeout(() => this.pump(), Math.max(1, this.starts[0].at + windowMs - now))
        return
      }
      this.waiting.splice(index, 1)
      used += job.weight
      this.foregroundStreak = job.priority === 'foreground' ? this.foregroundStreak + 1 : 0
      job.start()
    }
  }
}

// Keep headroom below the documented 1,200-weight/IP/minute allowance.
export const hyperliquidRateGate = new HyperliquidRateGate()
