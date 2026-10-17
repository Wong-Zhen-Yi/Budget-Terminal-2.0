import type { DesktopApi, MarketCapTier } from '@shared/contract'

declare global {
  interface Window {
    api: DesktopApi
  }
}

/** Bootstrap installs either the Electron preload or the authenticated browser bridge. */
if (!window.api) throw new Error('Budget Terminal service API is unavailable.')
export const api: DesktopApi = window.api

export const queryKeys = {
  agents: ['agents'] as const,
  defeatbetaTerminal: (symbol: string, section: string) => ['defeatbetaTerminal', symbol, section, 1] as const,
  marketCap: (tier: MarketCapTier) => ['marketCap', tier] as const,
  portfolio: ['portfolio'] as const,
  articles: ['articles'] as const,
  cards: ['cards'] as const,
  cardsPerformance: (signature: string) => ['cardsPerformance', signature] as const,
  settings: ['settings'] as const,
  personalFinance: ['personalFinance'] as const,
  fx: ['fx'] as const,
  globalMarkets: ['globalMarkets'] as const,
  preMarket: ['preMarket'] as const,
  tradingVolumes: ['tradingVolumes'] as const,
  signals: ['signals'] as const,
  technicalScreen: ['technicalScreen'] as const,
  quant: ['quant'] as const,
  calendarMonth: (tickers: string[], year: number, month: number) =>
    ['calendarMonth', year, month, [...tickers].sort().join(',')] as const,
  earningsCalendar: (rangeKey: string) => ['earningsCalendar', rangeKey] as const,
  forexQuotes: ['forexQuotes'] as const,
  forexHistory: (pair: string, range: string) => ['forexHistory', pair, range] as const,
  forexNews: (pair: string) => ['forexNews', pair] as const,
  crypto: ['crypto'] as const,
  bitcoin: ['bitcoin'] as const,
  bmnr: ['bmnr'] as const,
  sofi: ['sofi'] as const,
  mu: ['mu'] as const,
  amzn: ['amzn'] as const,
  avgo: ['avgo'] as const,
  semiconductors: ['semiconductors', 1] as const,
  vst: ['vst', 2] as const,
  hood: ['hood'] as const,
  hims: ['hims'] as const,
  gold: ['gold'] as const,
  oil: ['oil'] as const,
  heatmap: (etf: string) => ['heatmap', etf, 'yahoo-v1'] as const,
  // One key per ticker, so switching back to a fund already loaded repaints instantly
  // the way `_p13_last_result` does. Arbitrage is keyed the same way and separately: it
  // is a second, opt-in load over the same basket, not part of the holdings payload.
  etfHoldings: (ticker: string) => ['etfHoldings', ticker] as const,
  etfArbitrage: (ticker: string) => ['etfArbitrage', ticker] as const,
  etfAum: ['etfAum'] as const,
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
  money: ['money'] as const,
  economic: ['economic'] as const,
  // Two feeds, two keys: a failed upcoming refresh must not evict the completed rows,
  // and the completed year is part of its key so an older year is its own entry.
  ipoUpcoming: ['ipoUpcoming'] as const,
  ipoCompleted: (year: number) => ['ipoCompleted', year] as const,
  politicsPage: (page: number) => ['politicsPage', page] as const,
  institutionActivity: (quarter: string) => ['institutions', 'activity', quarter || 'latest'] as const,
  institutionTickerActivity: (symbol: string) => ['institutions', 'ticker', symbol] as const,
  targets: (tickers: string[]) => ['targets', [...tickers].sort().join(',')] as const,
  news: (tickers: string[]) => ['news', [...tickers].sort().join(',')] as const,
  newsPage: (tickers: string[]) => ['newsPage', [...tickers].sort().join(',')] as const,
  newsTickerSearch: (tickers: string[]) => ['newsTickerSearch', tickers.join(',')] as const,
  newsPreview: (url: string) => ['newsPreview', url] as const,
  newsThumbnail: (url: string) => ['newsThumbnail', url] as const,
  youtube: (tickers: string[]) => ['youtube', [...tickers].sort().join(',')] as const,
  youtubeThumbnail: (videoId: string, thumbnailUrl: string) =>
    ['youtubeThumbnail', videoId, thumbnailUrl] as const,
  fundamentals: (tickers: string[]) => ['fundamentals', [...tickers].sort().join(',')] as const,
  fundamentalsPage: (symbol: string) => ['fundamentalsPage', symbol, 'usd-v2'] as const,
  returns: (tickers: string[], window: string) =>
    ['returns', window, [...tickers].sort().join(',')] as const,
  momentum: (signature: string, timeframe: string) => ['momentum', timeframe, signature] as const,
  analytics: (signature: string, benchmark: string, lookback: string) =>
    ['analytics', benchmark, lookback, signature] as const,
  optionQuotes: (signature: string) => ['optionQuotes', signature] as const,
}
