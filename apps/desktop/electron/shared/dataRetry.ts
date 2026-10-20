/** Retry transport/provider outages, not bad symbols, validation or sign-in errors. */
export function isTransientDataError(error: unknown, depth = 0): boolean {
  if (depth > 3 || error == null) return false
  const value = error as { status?: number; response?: { status?: number }; code?: string; name?: string; cause?: unknown }
  const status = value.status ?? value.response?.status
  if (typeof status === 'number') return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
  if (value.name === 'AbortError') return false
  if (/^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_SOCKET)$/.test(value.code ?? '')) return true
  const message = error instanceof Error ? error.message : String(error)
  // A renderer deadline does not cancel its IPC request. Retrying it could duplicate
  // a fan-out still queued in main; actual transport timeouts are safe to retry.
  if (/Background page load timed out/i.test(message)) return false
  if (/\b(?:HTTP\s*|status(?:\s+code)?[\s:=]*)(?:408|429|500|502|503|504)\b|\b429\b|too many requests|rate limit|fetch failed|failed to fetch|network error|network request failed|socket hang up|connection (?:reset|refused)|timed?\s*out|timeout|temporarily unavailable|service unavailable|bad gateway|gateway timeout|Yahoo worker exited/i.test(message)) return true
  return isTransientDataError(value.cause, depth + 1)
}

export interface DataRetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  isCancelled?: () => boolean
  onRetry?: (error: unknown, nextAttempt: number, delayMs: number) => void
  /** Injected by deterministic probes; production uses jittered exponential backoff. */
  random?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Delays never hold a provider slot; callers must admit each attempt through its gate. */
export async function retryTransientData<T>(run: () => Promise<T>, options: DataRetryOptions = {}): Promise<T> {
  const attempts = options.maxAttempts ?? 3
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const cancelled = () => {
    if (options.isCancelled?.()) throw Object.assign(new Error('Data load cancelled'), { name: 'AbortError' })
  }
  for (let attempt = 1; ; attempt++) {
    cancelled()
    try {
      return await run()
    } catch (error) {
      cancelled()
      if (attempt >= attempts || !isTransientDataError(error)) throw error
      const delayMs = Math.min(options.maxDelayMs ?? 30_000,
        Math.ceil((options.baseDelayMs ?? 1_000) * 2 ** (attempt - 1) * (1 + (options.random ?? Math.random)() * 0.25)))
      options.onRetry?.(error, attempt + 1, delayMs)
      await sleep(delayMs)
    }
  }
}
