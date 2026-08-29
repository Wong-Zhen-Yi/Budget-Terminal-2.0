import { contextBridge, ipcRenderer } from 'electron'

import type { DesktopApi } from './shared/contract.js'
import { CHANNELS } from './shared/contract.js'

/**
 * The only surface the renderer gets. `contextIsolation` is on and `nodeIntegration`
 * off, so this bridge is the complete list of what page code can reach.
 */
const api: DesktopApi = {
  quotes: (request) => ipcRenderer.invoke(CHANNELS.quotes, request),
  chart: (request) => ipcRenderer.invoke(CHANNELS.chart, request),
  chartsHistory: (request) => ipcRenderer.invoke(CHANNELS.chartsHistory, request),
  chartsCompare: (request) => ipcRenderer.invoke(CHANNELS.chartsCompare, request),
  chartsRelationship: (request) => ipcRenderer.invoke(CHANNELS.chartsRelationship, request),
  options: (request) => ipcRenderer.invoke(CHANNELS.options, request),
  targets: (request) => ipcRenderer.invoke(CHANNELS.targets, request),
  news: (request) => ipcRenderer.invoke(CHANNELS.news, request),
  newsPage: (request) => ipcRenderer.invoke(CHANNELS.newsPage, request),
  newsTickerSearch: (request) => ipcRenderer.invoke(CHANNELS.newsTickerSearch, request),
  newsArticle: (request) => ipcRenderer.invoke(CHANNELS.newsArticle, request),
  newsThumbnail: (request) => ipcRenderer.invoke(CHANNELS.newsThumbnail, request),
  portfolio: () => ipcRenderer.invoke(CHANNELS.portfolio),
  mutatePortfolio: (mutation) => ipcRenderer.invoke(CHANNELS.portfolioMutate, mutation),
  cards: () => ipcRenderer.invoke(CHANNELS.cards),
  mutateCards: (mutation) => ipcRenderer.invoke(CHANNELS.cardsMutate, mutation),
  cardsPerformance: (request) => ipcRenderer.invoke(CHANNELS.cardsPerformance, request),
  personalFinance: () => ipcRenderer.invoke(CHANNELS.personalFinance),
  mutatePersonalFinance: (mutation) =>
    ipcRenderer.invoke(CHANNELS.personalFinanceMutate, mutation),
  fx: (request) => ipcRenderer.invoke(CHANNELS.fx, request),
  globalMarkets: (request) => ipcRenderer.invoke(CHANNELS.globalMarkets, request),
  preMarket: (request) => ipcRenderer.invoke(CHANNELS.preMarket, request),
  tradingVolumes: (request) => ipcRenderer.invoke(CHANNELS.tradingVolumes, request),
  priceScreen: (request) => ipcRenderer.invoke(CHANNELS.priceScreen, request),
  calendarMonth: (request) => ipcRenderer.invoke(CHANNELS.calendarMonth, request),
  earningsCalendar: (request) => ipcRenderer.invoke(CHANNELS.earningsCalendar, request),
  crypto: (request) => ipcRenderer.invoke(CHANNELS.crypto, request),
  heatmap: (request) => ipcRenderer.invoke(CHANNELS.heatmap, request),
  upDown: (request) => ipcRenderer.invoke(CHANNELS.upDown, request),
  upDownTargets: (request) => ipcRenderer.invoke(CHANNELS.upDownTargets, request),
  stocks: (request) => ipcRenderer.invoke(CHANNELS.stocks, request),
  optionsChain: (request) => ipcRenderer.invoke(CHANNELS.optionsChain, request),
  optionsExpirations: (request) => ipcRenderer.invoke(CHANNELS.optionsExpirations, request),
  projections: (request) => ipcRenderer.invoke(CHANNELS.projections, request),
  valuation: (request) => ipcRenderer.invoke(CHANNELS.valuation, request),
  backtest: (request) => ipcRenderer.invoke(CHANNELS.backtest, request),
  fundamentals: (request) => ipcRenderer.invoke(CHANNELS.fundamentals, request),
  fundamentalsPage: (request) => ipcRenderer.invoke(CHANNELS.fundamentalsPage, request),
  returns: (request) => ipcRenderer.invoke(CHANNELS.returns, request),
  momentum: (request) => ipcRenderer.invoke(CHANNELS.momentum, request),
  analytics: (request) => ipcRenderer.invoke(CHANNELS.analytics, request),
  optionQuotes: (request) => ipcRenderer.invoke(CHANNELS.optionQuotes, request),
  settings: () => ipcRenderer.invoke(CHANNELS.settings),
  mutateSettings: (mutation) => ipcRenderer.invoke(CHANNELS.settingsMutate, mutation),
  maintenance: (action) => ipcRenderer.invoke(CHANNELS.maintenance, action),
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.openExternal, url),
  saveText: (suggestedName, contents) =>
    ipcRenderer.invoke(CHANNELS.saveText, suggestedName, contents),
  writeClipboard: (contents) => ipcRenderer.invoke(CHANNELS.writeClipboard, contents),
  windowControl: (action) => ipcRenderer.invoke(CHANNELS.windowControl, action),
  onPortfolioChanged: (listener) => {
    const handler = () => listener()
    ipcRenderer.on(CHANNELS.portfolioChanged, handler)
    return () => ipcRenderer.removeListener(CHANNELS.portfolioChanged, handler)
  },
}

contextBridge.exposeInMainWorld('api', api)
