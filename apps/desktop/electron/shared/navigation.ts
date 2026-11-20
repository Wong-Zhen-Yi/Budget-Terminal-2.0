import { SETTINGS_TAB_ID, TABS } from './contract.js'
import type { AppSettings } from './contract.js'

export const DEFAULT_TAB_ID = 'dashboard-2'

export function isVisibleImplementedPage(tab: { id: string; implemented: boolean }, hidden: readonly string[]): boolean {
  return tab.implemented && !hidden.includes(tab.id)
}

export function openingPage(settings?: Pick<AppSettings, 'mainPageId' | 'tabOrder' | 'hiddenTabs'>): string {
  if (!settings) return DEFAULT_TAB_ID
  const visible = new Set(TABS.filter(tab => isVisibleImplementedPage(tab, settings.hiddenTabs)).map(tab => tab.id))
  if (settings.mainPageId && visible.has(settings.mainPageId)) return settings.mainPageId
  return visible.has(DEFAULT_TAB_ID) ? DEFAULT_TAB_ID : settings.tabOrder.find(id => visible.has(id)) ?? SETTINGS_TAB_ID
}

/** Stable workspace membership; user ordering still applies within each workspace. */
export const WORKSPACES = [
  { id: 'overview', label: 'Overview', pages: ['dashboard', 'dashboard-2', 'news', 'calendar', 'youtube', 'dictionary'] },
  { id: 'markets', label: 'Markets', pages: ['pre-market', 'heatmap', 'up-down', 'trading-volumes', 'beta', 'market-cap', 'price', 'etf', 'sp500', 'forex', 'crypto', 'polymarket'] },
  { id: 'research', label: 'Research', pages: ['browser', 'stocks', 'stock-discovery', 'fundamentals', 'scorecard', 'defeatbeta', 'valuation', 'institutions'] },
  { id: 'focus', label: 'Focus', pages: ['macro', 'bmnr', 'bitcoin', 'eth', 'pltr', 'hood', 'hims', 'sofi', 'mu', 'googl', 'anthropic', 'amzn', 'avgo', 'nvda', 'semiconductors', 'homebuilders', 'vst', 'gold', 'oil'] },
  { id: 'trading', label: 'Trading', pages: ['charts', 'options', 'technical-screen', 'quant', 'backtest'] },
  { id: 'macro', label: 'Macro & events', pages: ['global', 'economic', 'bonds', 'money', 'ipo', 'politics'] },
  { id: 'money', label: 'My money', pages: ['portfolio', 'personal-finance', 'cards', 'projections'] },
  { id: 'articles', label: 'Articles', pages: ['articles'] },
  { id: 'agents', label: 'Agents', pages: ['agents'] },
  { id: 'reminders', label: 'Notifications', pages: ['notifications'] },
]

export const DEFAULT_FAVORITE_TABS = ['dashboard', 'portfolio', 'charts']

export function workspaceFor(tabId: string) {
  return WORKSPACES.find((workspace) => workspace.pages.includes(tabId))
}

/** Match sidebar workspace order and the user's visible page order within each header. */
export function pagesInVisualOrder<T extends { id: string; implemented: boolean }>(tabs: readonly T[]): T[] {
  return [
    ...WORKSPACES.flatMap(workspace => tabs.filter(tab => tab.implemented && workspace.pages.includes(tab.id))),
    ...tabs.filter(tab => tab.implemented && tab.id === 'settings'),
  ]
}

export function adjacentPage(tabs: readonly { id: string }[], active: string, direction: -1 | 1): string | undefined {
  if (!tabs.length) return undefined
  const current = tabs.findIndex(tab => tab.id === active)
  return tabs[current < 0 ? 0 : (current + direction + tabs.length) % tabs.length].id
}

export function recentPages(previous: readonly string[], id: string): string[] {
  return [id, ...previous.filter((page) => page !== id)].slice(0, 6)
}

/** Load every implemented page at startup; visit history only changes the order. */
export function startupPages(active: string, favorites: readonly string[], recent: readonly string[]): string[] {
  const implemented = new Set(TABS.filter((tab) => tab.implemented).map((tab) => tab.id))
  return [...new Set([active, ...favorites, ...recent, ...implemented])].filter((id) => implemented.has(id))
}
