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
  cards: ['cards'] as const,
  cardsPerformance: (signature: string) => ['cardsPerformance', signature] as const,
  settings: ['settings'] as const,
  personalFinance: ['personalFinance'] as const,
  fx: ['fx'] as const,
  globalMarkets: ['globalMarkets'] as const,
  preMarket: ['preMarket'] as const,
  tradingVolumes: ['tradingVolumes'] as const,
  signals: ['signals'] as const,
  calendarMonth: (tickers: string[], year: number, month: number) =>
    ['calendarMonth', year, month, [...tickers].sort().join(',')] as const,
  earningsCalendar: (rangeKey: string) => ['earningsCalendar', rangeKey] as const,
  crypto: ['crypto'] as const,
  heatmap: (etf: string) => ['heatmap', etf] as const,
  upDown: (source: string, interval: string, symbols: string[]) =>
    ['upDown', source, interval, [...symbols].sort().join(',')] as const,
  stocks: (symbol: string) => ['stocks', symbol] as const,
  quotes: (holdings: string[]) => ['quotes', [...holdings].sort().join(',')] as const,
  chart: (symbol: string, timeframe: string) => ['chart', symbol, timeframe] as const,
  chartsHistory: (symbol: string, interval: string, range: string) =>
    ['chartsHistory', symbol, interval, range] as const,
  chartsCompare: (symbols: string[], interval: string, range: string) =>
    ['chartsCompare', interval, range, [...symbols].sort().join(',')] as const,
  chartsRelationship: (symbols: [string, string], range: string, window: number) =>
    ['chartsRelationship', symbols.join(','), range, window] as const,
  options: (symbol: string) => ['options', symbol] as const,
  optionsChain: (symbol: string, expiry: string) => ['optionsChain', symbol, expiry] as const,
  optionsExpirations: (symbol: string) => ['optionsExpirations', symbol] as const,
  projections: (symbol: string, timeframe: string) => ['projections', symbol, timeframe] as const,
  // The peer list is part of the key: adding a peer changes the exit multiple, and with it
  // every assumption the derivation hangs off that multiple.
  valuation: (symbol: string, customPeers: string[]) =>
    ['valuation', symbol, customPeers.join(',')] as const,
  // The whole catalog resolves from one load, so the page has a single key.
  economic: ['economic'] as const,
  targets: (tickers: string[]) => ['targets', [...tickers].sort().join(',')] as const,
  news: (tickers: string[]) => ['news', [...tickers].sort().join(',')] as const,
  newsPage: (tickers: string[]) => ['newsPage', [...tickers].sort().join(',')] as const,
  newsTickerSearch: (tickers: string[]) => ['newsTickerSearch', tickers.join(',')] as const,
  newsPreview: (url: string) => ['newsPreview', url] as const,
  newsThumbnail: (url: string) => ['newsThumbnail', url] as const,
  fundamentals: (tickers: string[]) => ['fundamentals', [...tickers].sort().join(',')] as const,
  fundamentalsPage: (symbol: string) => ['fundamentalsPage', symbol] as const,
  returns: (tickers: string[], window: string) =>
    ['returns', window, [...tickers].sort().join(',')] as const,
  momentum: (signature: string, timeframe: string) => ['momentum', timeframe, signature] as const,
  analytics: (signature: string, benchmark: string, lookback: string) =>
    ['analytics', benchmark, lookback, signature] as const,
  optionQuotes: (signature: string) => ['optionQuotes', signature] as const,
}
