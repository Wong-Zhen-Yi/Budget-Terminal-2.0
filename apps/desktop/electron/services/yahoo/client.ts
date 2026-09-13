import { AsyncLocalStorage } from 'node:async_hooks'
import YahooFinance from 'yahoo-finance2'

import { rateGate, type Priority } from './rateGate.js'
import { trackApiRequest } from '../apiUsage.js'

/**
 * The single Yahoo client for the process.
 *
 * `validation.logErrors` is off because Yahoo adds and removes response fields
 * constantly and the schema warnings are noise, not signal — we read the handful of
 * fields we need defensively instead. Every call goes through `paced()` so the rate
 * gate sees it; nothing should call `yahoo.*` directly.
 */
export const yahoo = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false },
  queue: { concurrency: 4 },
})

/**
 * The lane the current request belongs in. An `AsyncLocalStorage` rather than a `paced()`
 * argument because the flag arrives on the IPC request and the fan-out that reads it is
 * dozens of call sites deep — the store propagates through every `await` and
 * `Promise.allSettled` between the handler and the request, so no service changes.
 */
const priorityStore = new AsyncLocalStorage<Priority>()

/** Run `fn` — and everything it awaits — in the given rate-gate lane. */
export function runWithPriority<T>(priority: Priority, fn: () => Promise<T>): Promise<T> {
  return priorityStore.run(priority, fn)
}

export function paced<T>(task: () => Promise<T>): Promise<T> {
  return rateGate.run(
    () => trackApiRequest('yahoo', task),
    priorityStore.getStore() ?? 'foreground',
  )
}

/** Days -> the `period1` timestamp Yahoo's chart endpoint expects. */
export function periodStart(lookbackDays: number): Date {
  return new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
}
