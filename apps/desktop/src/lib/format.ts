/**
 * One home for every number the dashboard prints.
 *
 * Five panels format the same handful of values — price, percent change, dollar gain,
 * volume — and left to themselves they drift apart. The formats here reproduce the
 * PySide6 dashboard: `$309.35`, `+1.12%`, `+$49`, `2.2%`, `231.06M`.
 */

export const EM_DASH = '--'

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function currency(value: number | null | undefined, decimals = 2): string {
  if (!finite(value)) return EM_DASH
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

/** Native quote units, including provider subunits such as GBp, are never converted. */
export function quotePrice(value: number | null | undefined, unit = 'USD', places = 2): string {
  if (!finite(value)) return EM_DASH
  if (unit === 'USD') return currency(value, places)
  return `${thousands(value, places)} ${unit.trim() || '(unit unknown)'}`
}

export function signedQuotePrice(value: number | null | undefined, unit = 'USD', places = 2): string {
  if (!finite(value)) return EM_DASH
  return `${value >= 0 ? '+' : '-'}${quotePrice(Math.abs(value), unit, places)}`
}

/**
 * Currency prefixes for the Personal Finance page. The reference prints SGD as `S$`
 * and USD as a bare `$`, except where the two sit in one sentence and USD needs
 * disambiguating — the Debt panel's margin line, which spells it `US$`.
 */
export const CURRENCY_PREFIX: Record<'SGD' | 'USD', string> = { SGD: 'S$', USD: '$' }

/**
 * Where both currencies appear in one list — the bills table, the margin clause in the
 * Debt footer — a bare `$` is ambiguous, so USD is spelled out.
 */
export const EXPLICIT_CURRENCY_PREFIX: Record<'SGD' | 'USD', string> = {
  SGD: 'S$',
  USD: 'US$',
}

export function moneyExplicit(
  value: number | null | undefined,
  currency: 'SGD' | 'USD',
  decimals = 2,
): string {
  if (!finite(value)) return EM_DASH
  return `${EXPLICIT_CURRENCY_PREFIX[currency]}${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

export function money(
  value: number | null | undefined,
  currency: 'SGD' | 'USD',
  decimals = 2,
): string {
  if (!finite(value)) return EM_DASH
  return `${CURRENCY_PREFIX[currency]}${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

/** Whole units, for chart labels and the goal counters: `S$71,498`. */
export function moneyRounded(value: number | null | undefined, currency: 'SGD' | 'USD'): string {
  if (!finite(value)) return EM_DASH
  return `${CURRENCY_PREFIX[currency]}${Math.round(value).toLocaleString('en-US')}`
}

export function percent(value: number | null | undefined, decimals = 2): string {
  if (!finite(value)) return EM_DASH
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`
}

/**
 * A performance percent as the Global page prints it: signed only when the move is
 * positive, so a flat market reads `0.00%` rather than `+0.00%`. That is `_p26_pct`,
 * and it differs from `percent` above at exactly zero.
 */
export function performancePercent(value: number | null | undefined, decimals = 2): string {
  if (!finite(value)) return EM_DASH
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}%`
}

/** A bare number with thousands separators and no currency mark: `7,674.37`. */
export function thousands(value: number | null | undefined, places = 2): string {
  if (!finite(value)) return EM_DASH
  return value.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

/** Weight column: no sign, one decimal. */
export function plainPercent(value: number | null | undefined, decimals = 1): string {
  if (!finite(value)) return EM_DASH
  return `${value.toFixed(decimals)}%`
}

/** Dollar gain: signed, whole dollars, thousands separated. */
export function signedCurrency(value: number | null | undefined): string {
  if (!finite(value)) return EM_DASH
  const sign = value >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`
}

export function signedCurrencyPrecise(value: number | null | undefined, decimals = 2): string {
  if (!finite(value)) return EM_DASH
  const sign = value >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(value).toFixed(decimals)}`
}

export function compactNumber(value: number | null | undefined): string {
  if (!finite(value)) return EM_DASH
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  return value.toFixed(0)
}

/**
 * `_p20_format_compact_currency`: one decimal place and a dollar sign, unlike
 * `compactNumber` above, which is two places and unprefixed. The Trading Volumes table
 * and both of its log axes print this, so it cannot live in either of them.
 */
export function compactCurrency(value: number | null | undefined): string {
  if (!finite(value)) return EM_DASH
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}

export function integer(value: number | null | undefined): string {
  if (!finite(value)) return EM_DASH
  return Math.round(value).toLocaleString('en-US')
}

export function decimals(value: number | null | undefined, places: number): string {
  if (!finite(value)) return EM_DASH
  return value.toFixed(places)
}

/** Sign class for a value, used for both text and background tinting. */
export function directionClass(
  value: number | null | undefined,
  { up = 'text-up', down = 'text-down', neutral = 'text-text' } = {},
): string {
  if (!finite(value)) return neutral
  return value >= 0 ? up : down
}

/**
 * The top-bar clock, in the market country and format Settings picked.
 *
 * `update_time` in the reference prints `%I:%M:%S %p` or `%H:%M:%S`. `hourCycle: 'h23'`
 * rather than `hour12: false` because en-US renders midnight as 24:00:00 with the
 * latter, which is not what the reference shows.
 */
export function clockTime(date: Date, zone: string, hour12: boolean): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: zone,
    ...(hour12 ? { hour12: true } : { hourCycle: 'h23' as const }),
  })
}

export function newsTime(timestamp: number): string {
  if (!timestamp) return EM_DASH
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function timestampLabel(timestamp: number | null | undefined): string {
  if (!finite(timestamp) || !timestamp) return EM_DASH
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}
