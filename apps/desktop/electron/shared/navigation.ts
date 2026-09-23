/** Stable workspace membership; user ordering still applies within each workspace. */
export const WORKSPACES = [
  { id: 'overview', label: 'Overview', pages: ['dashboard', 'news', 'calendar', 'youtube', 'dictionary'] },
  { id: 'markets', label: 'Markets', pages: ['pre-market', 'heatmap', 'up-down', 'trading-volumes', 'beta', 'market-cap', 'price', 'etf', 'sp500', 'forex', 'crypto', 'gold', 'oil'] },
  { id: 'research', label: 'Research', pages: ['stocks', 'fundamentals', 'valuation', 'institutions'] },
  { id: 'focus', label: 'Focus', pages: ['bmnr', 'bitcoin'] },
  { id: 'trading', label: 'Trading', pages: ['charts', 'options', 'signals', 'quant', 'backtest', 'roll'] },
  { id: 'macro', label: 'Macro & events', pages: ['global', 'economic', 'bonds', 'money', 'ipo', 'politics'] },
  { id: 'money', label: 'My money', pages: ['portfolio', 'personal-finance', 'cards', 'projections'] },
]

export const DEFAULT_FAVORITE_TABS = ['dashboard', 'portfolio', 'charts']

export function workspaceFor(tabId: string) {
  return WORKSPACES.find((workspace) => workspace.pages.includes(tabId))
}

export function recentPages(previous: readonly string[], id: string): string[] {
  return [id, ...previous.filter((page) => page !== id)].slice(0, 6)
}

/** A bounded startup plan. Expensive screens run only when explicitly favorited. */
export function startupPages(active: string, favorites: readonly string[], recent: readonly string[], hidden: readonly string[]): string[] {
  const expensive = new Set(['trading-volumes', 'heatmap', 'economic', 'bonds', 'etf'])
  return [...new Set([active, ...favorites, ...recent])]
    .filter((id) => !hidden.includes(id) && (id === active || favorites.includes(id) || !expensive.has(id)))
    .slice(0, 5)
}
