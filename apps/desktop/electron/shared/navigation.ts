import { TABS } from './contract.js'

export const DEFAULT_TAB_ID = 'dashboard-2'

/** Stable workspace membership; user ordering still applies within each workspace. */
export const WORKSPACES = [
  { id: 'overview', label: 'Overview', pages: ['dashboard', 'dashboard-2', 'news', 'calendar', 'youtube', 'dictionary'] },
  { id: 'markets', label: 'Markets', pages: ['pre-market', 'heatmap', 'up-down', 'trading-volumes', 'beta', 'market-cap', 'price', 'etf', 'sp500', 'forex', 'crypto', 'gold', 'oil'] },
  { id: 'research', label: 'Research', pages: ['browser', 'stocks', 'stock-discovery', 'fundamentals', 'defeatbeta', 'valuation', 'institutions'] },
  { id: 'focus', label: 'Focus', pages: ['bmnr', 'bitcoin', 'pltr', 'hood', 'hims', 'sofi', 'mu', 'amzn', 'avgo', 'semiconductors', 'vst'] },
  { id: 'trading', label: 'Trading', pages: ['charts', 'options', 'technical-screen', 'quant', 'backtest'] },
  { id: 'macro', label: 'Macro & events', pages: ['global', 'economic', 'bonds', 'money', 'ipo', 'politics'] },
  { id: 'money', label: 'My money', pages: ['portfolio', 'personal-finance', 'cards', 'projections'] },
  { id: 'articles', label: 'Articles', pages: ['articles'] },
  { id: 'agents', label: 'Agents', pages: ['agents'] },
  { id: 'reminders', label: 'Reminders', pages: ['movement', 'notifications'] },
]

export const DEFAULT_FAVORITE_TABS = ['dashboard', 'portfolio', 'charts']

export function workspaceFor(tabId: string) {
  return WORKSPACES.find((workspace) => workspace.pages.includes(tabId))
}

export function recentPages(previous: readonly string[], id: string): string[] {
  return [id, ...previous.filter((page) => page !== id)].slice(0, 6)
}

/** Load every implemented page at startup; visit history only changes the order. */
export function startupPages(active: string, favorites: readonly string[], recent: readonly string[]): string[] {
  const implemented = new Set(TABS.filter((tab) => tab.implemented).map((tab) => tab.id))
  return [...new Set([active, ...favorites, ...recent, ...implemented])].filter((id) => implemented.has(id))
}
