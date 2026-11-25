/**
 * `YYYY-MM-DD` session dates in an exchange's own timezone.
 *
 * Yahoo stamps a daily bar at the session start in exchange time. For forex during
 * British Summer Time that is 23:00 UTC the previous day, and New Zealand's open is
 * 21:00–22:00 UTC the previous day, so slicing the UTC ISO string shifts those bars
 * back a day. A shifted bar no longer matches `regularMarketTime`, the quote compares
 * the live session against itself, and the change reads as zero. US sessions open
 * after 13:00 UTC, so their dates are the same either way.
 */

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  const key = zone || 'UTC'
  let formatter = formatters.get(key)
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone: key, year: 'numeric', month: '2-digit', day: '2-digit' })
    } catch {
      // An unknown zone name must not fail the whole series; fall back to UTC dates.
      formatter = formatterFor('UTC')
    }
    formatters.set(key, formatter)
  }
  return formatter
}

/** A reusable stamper for one exchange timezone; an empty or unknown zone uses UTC. */
export function exchangeDateStamper(zone: string | undefined | null): (date: Date) => string {
  const formatter = formatterFor(String(zone ?? '').trim())
  return (date) => formatter.format(date)
}

/** The exchange timezone Yahoo reports in chart metadata, or '' when absent. */
export function exchangeTimezone(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return ''
  const zone = (meta as { exchangeTimezoneName?: unknown }).exchangeTimezoneName
  return typeof zone === 'string' ? zone.trim() : ''
}
