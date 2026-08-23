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
  options: (request) => ipcRenderer.invoke(CHANNELS.options, request),
  targets: (request) => ipcRenderer.invoke(CHANNELS.targets, request),
  news: (request) => ipcRenderer.invoke(CHANNELS.news, request),
  portfolio: () => ipcRenderer.invoke(CHANNELS.portfolio),
  mutatePortfolio: (mutation) => ipcRenderer.invoke(CHANNELS.portfolioMutate, mutation),
  personalFinance: () => ipcRenderer.invoke(CHANNELS.personalFinance),
  mutatePersonalFinance: (mutation) =>
    ipcRenderer.invoke(CHANNELS.personalFinanceMutate, mutation),
  fx: (request) => ipcRenderer.invoke(CHANNELS.fx, request),
  globalMarkets: (request) => ipcRenderer.invoke(CHANNELS.globalMarkets, request),
  preMarket: (request) => ipcRenderer.invoke(CHANNELS.preMarket, request),
  tradingVolumes: (request) => ipcRenderer.invoke(CHANNELS.tradingVolumes, request),
  fundamentals: (request) => ipcRenderer.invoke(CHANNELS.fundamentals, request),
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
  windowControl: (action) => ipcRenderer.invoke(CHANNELS.windowControl, action),
  onPortfolioChanged: (listener) => {
    const handler = () => listener()
    ipcRenderer.on(CHANNELS.portfolioChanged, handler)
    return () => ipcRenderer.removeListener(CHANNELS.portfolioChanged, handler)
  },
}

contextBridge.exposeInMainWorld('api', api)
