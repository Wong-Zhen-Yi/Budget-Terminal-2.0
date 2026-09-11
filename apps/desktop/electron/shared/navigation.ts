/** Stable workspace membership; user ordering still applies within each workspace. */
export const WORKSPACES = [
  { id: 'overview', label: 'Overview', pages: ['dashboard', 'news', 'calendar', 'youtube', 'dictionary'] },
  { id: 'markets', label: 'Markets', pages: ['pre-market', 'heatmap', 'up-down', 'trading-volumes', 'beta', 'market-cap', 'price', 'etf', 'sp500', 'forex', 'crypto', 'gold', 'oil'] },
  { id: 'research', label: 'Research', pages: ['stocks', 'fundamentals', 'valuation', 'bmnr', 'institutions'] },
  { id: 'trading', label: 'Trading', pages: ['charts', 'options', 'signals', 'quant', 'backtest', 'roll'] },
  { id: 'macro', label: 'Macro & events', pages: ['global', 'economic', 'bonds', 'money', 'ipo', 'politics'] },
  { id: 'money', label: 'My money', pages: ['portfolio', 'personal-finance', 'cards', 'projections'] },
]

export const DEFAULT_FAVORITE_TABS = ['dashboard', 'portfolio', 'charts']

export function workspaceFor(tabId: string) {
  return WORKSPACES.find((workspace) => workspace.pages.includes(tabId))
}
