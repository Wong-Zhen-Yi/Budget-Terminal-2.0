import type { DesktopApi } from '@shared/contract'

declare global {
  interface Window {
    api: DesktopApi
  }
}

/**
 * The preload bridge. Everything the renderer can do to the outside world goes
 * through here — there is no `fetch` to Yahoo from page code.
 */
export const api: DesktopApi = window.api

export const queryKeys = {
  portfolio: ['portfolio'] as const,
  settings: ['settings'] as const,
  personalFinance: ['personalFinance'] as const,
  fx: ['fx'] as const,
  globalMarkets: ['globalMarkets'] as const,
  preMarket: ['preMarket'] as const,
  tradingVolumes: ['tradingVolumes'] as const,
  quotes: (holdings: string[]) => ['quotes', [...holdings].sort().join(',')] as const,
  chart: (symbol: string, timeframe: string) => ['chart', symbol, timeframe] as const,
  options: (symbol: string) => ['options', symbol] as const,
  targets: (tickers: string[]) => ['targets', [...tickers].sort().join(',')] as const,
  news: (tickers: string[]) => ['news', [...tickers].sort().join(',')] as const,
  fundamentals: (tickers: string[]) => ['fundamentals', [...tickers].sort().join(',')] as const,
  returns: (tickers: string[], window: string) =>
    ['returns', window, [...tickers].sort().join(',')] as const,
  momentum: (signature: string, timeframe: string) => ['momentum', timeframe, signature] as const,
  analytics: (signature: string, benchmark: string, lookback: string) =>
    ['analytics', benchmark, lookback, signature] as const,
  optionQuotes: (signature: string) => ['optionQuotes', signature] as const,
}
