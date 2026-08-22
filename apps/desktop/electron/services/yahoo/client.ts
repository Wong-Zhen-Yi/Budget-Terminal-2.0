import YahooFinance from 'yahoo-finance2'

import { rateGate } from './rateGate.js'

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

export function paced<T>(task: () => Promise<T>): Promise<T> {
  return rateGate.run(task)
}

/** Days -> the `period1` timestamp Yahoo's chart endpoint expects. */
export function periodStart(lookbackDays: number): Date {
  return new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
}
