import { FRESHNESS } from '@shared/freshness'

/**
 * The refresh cadences the page hooks use.
 *
 * They live apart from the hooks because the startup warm-up in `prefetch.ts` has to
 * prime each query with the same `staleTime` its hook asks for — a warmed entry with a
 * shorter window would be stale the moment the page mounted and would refetch anyway,
 * which is the thing the warm-up exists to avoid.
 */

/** Quotes and the macro bar tick on their own. */
export const QUOTE_REFRESH_MS = 60_000

/** Dashboard headlines share the provider cache's five-minute window. */
export const NEWS_REFRESH_MS = FRESHNESS.news

/** Personal Finance renews its exchange rate hourly. */
export const FX_REFRESH_MS = FRESHNESS.fx

/** `_P14_AUTO_REFRESH_INTERVAL_MS`. */
export const PRE_MARKET_REFRESH_MS = 15 * 60_000

/** These page snapshots deliberately refresh less often than their dependencies. */
export const PAGE_REFRESH_INTERVAL_MS: Readonly<Record<string, number>> = {
  heatmap: FRESHNESS.heatmap,
  amzn: FRESHNESS.amzn,
  mu: FRESHNESS.mu,
  avgo: FRESHNESS.avgo,
  vst: FRESHNESS.vst,
  sofi: FRESHNESS.sofi,
  hims: FRESHNESS.hims,
  hood: FRESHNESS.hood,
  bmnr: FRESHNESS.bmnr,
  semiconductors: FRESHNESS.semiconductors,
}
