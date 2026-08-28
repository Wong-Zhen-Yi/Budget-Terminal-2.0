/**
 * The refresh cadences the page hooks use.
 *
 * They live apart from the hooks because the startup warm-up in `prefetch.ts` has to
 * prime each query with the same `staleTime` its hook asks for — a warmed entry with a
 * shorter window would be stale the moment the page mounted and would refetch anyway,
 * which is the thing the warm-up exists to avoid.
 */

/** Quotes and the macro bar tick on their own; everything else refetches on demand. */
export const QUOTE_REFRESH_MS = 60_000

/** The reference refreshes USD/SGD every 300 seconds; match it. */
export const FX_REFRESH_MS = 300_000

/** `_P14_AUTO_REFRESH_INTERVAL_MS`. */
export const PRE_MARKET_REFRESH_MS = 15 * 60_000
