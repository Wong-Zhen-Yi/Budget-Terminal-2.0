interface RequestGateOptions {
  intervalMs: number
  maxConcurrency: number
  cooldownMs: number
}

interface Waiter { run: () => Promise<void>; reject: (error: Error) => void }

/** Independent budget for Hugging Face byte-range requests, including body reads. */
export class DefeatBetaRequestGate {
  private active = 0
  private nextStart = 0
  private cooldownUntil = 0
  private timer?: ReturnType<typeof setTimeout>
  private readonly queue: Waiter[] = []
  private readonly options: RequestGateOptions

  constructor(options: Partial<RequestGateOptions> = {}) {
    this.options = { intervalMs: 1000, maxConcurrency: 2, cooldownMs: 5 * 60_000, ...options }
  }

  private cooldownError(): Error {
    return new Error(`DefeatBeta is cooling down after throttling; retry after ${new Date(this.cooldownUntil).toISOString()}.`)
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (Date.now() < this.cooldownUntil) return Promise.reject(this.cooldownError())
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ reject, run: async () => {
        try { resolve(await task()) } catch (error) {
          const response = error as { status?: number; retryAfterMs?: number }
          if (response?.status === 429 || (response?.retryAfterMs ?? 0) > 0) {
            this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + Math.max(this.options.cooldownMs, response.retryAfterMs ?? 0))
            for (const queued of this.queue.splice(0)) queued.reject(this.cooldownError())
          }
          reject(error)
        } finally { this.active -= 1; this.pump() }
      } })
      this.pump()
    })
  }

  private pump(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    if (!this.queue.length || this.active >= this.options.maxConcurrency) return
    if (Date.now() < this.cooldownUntil) {
      for (const queued of this.queue.splice(0)) queued.reject(this.cooldownError())
      return
    }
    const delay = this.nextStart - Date.now()
    if (delay > 0) { this.timer = setTimeout(() => { this.timer = undefined; this.pump() }, delay); return }
    const next = this.queue.shift()!
    this.active += 1
    this.nextStart = Date.now() + this.options.intervalMs
    void next.run()
    this.pump()
  }
}
