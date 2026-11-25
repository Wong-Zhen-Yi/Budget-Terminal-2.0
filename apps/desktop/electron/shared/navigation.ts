import { FOCUS_DASHBOARD_TAB_ID, SETTINGS_TAB_ID, TABS } from './contract.js'
import type { LabFeatureId } from './contract.js'

export const DEFAULT_TAB_ID = 'dashboard-2'

export function isLabPageEnabled(id: string, enabledLabs: readonly LabFeatureId[] = []): boolean {
  const lab = TABS.find(tab => tab.id === id)?.lab
  return !lab || enabledLabs.includes(lab)
}

export function isMainPageAvailable(id: string, hidden: readonly string[], enabledLabs?: readonly LabFeatureId[]): boolean {
  return TABS.some(tab => tab.id === id && tab.implemented) && !hidden.includes(id) && isLabPageEnabled(id, enabledLabs)
}

export function resolveMainPage(mainPage: string | undefined, order: readonly string[], hidden: readonly string[], enabledLabs?: readonly LabFeatureId[]): string {
  if (mainPage && isMainPageAvailable(mainPage, hidden, enabledLabs)) return mainPage
  if (isMainPageAvailable(DEFAULT_TAB_ID, hidden, enabledLabs)) return DEFAULT_TAB_ID
  return order.find(id => isMainPageAvailable(id, hidden, enabledLabs)) ?? SETTINGS_TAB_ID
}

export const FOCUS_WORKSPACE = {
  id: 'focus',
  label: 'Focus',
  pages: [FOCUS_DASHBOARD_TAB_ID, 'macro', 'bmnr', 'bitcoin', 'eth', 'pltr', 'hood', 'hims', 'sofi', 'mu', 'googl', 'anthropic', 'amzn', 'avgo', 'nvda', 'semiconductors', 'homebuilders', 'vst', 'gold', 'oil'],
}

/** Stable workspace membership for navigation. */
export const WORKSPACES = [
  { id: 'overview', label: 'Overview', pages: ['dashboard', 'dashboard-2', 'dashboard-lite', 'pre-market', 'news', 'news-lite', 'calendar', 'youtube', 'dictionary'] },
  { id: 'markets', label: 'Markets', pages: ['heatmap', 'up-down', 'trading-volumes', 'beta', 'market-cap', 'price', 'etf', 'sp500', 'forex', 'crypto', 'polymarket'] },
  { id: 'research', label: 'Research', pages: ['browser', 'stocks', 'stock-discovery', 'fundamentals', 'scorecard', 'defeatbeta', 'valuation', 'institutions'] },
  FOCUS_WORKSPACE,
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

export function focusTopicPages<T extends (typeof TABS)[number]>(tabs: readonly T[]): T[] {
  return tabs
    .filter(tab => tab.implemented && tab.id !== FOCUS_DASHBOARD_TAB_ID && FOCUS_WORKSPACE.pages.includes(tab.id))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
}

/** Match sidebar workspace order and the visible shortcuts within each workspace. */
export function pagesInVisualOrder<T extends (typeof TABS)[number]>(tabs: readonly T[]): T[] {
  return [
    ...WORKSPACES.flatMap(workspace => {
      const pages = tabs.filter(tab => tab.implemented && workspace.pages.includes(tab.id))
      const dashboard = pages.find(tab => tab.id === FOCUS_DASHBOARD_TAB_ID)
      return dashboard ? [dashboard, ...focusTopicPages(pages)] : pages
    }),
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

/** In-session page history behind the back/forward controls. The last entry of each stack is the next step. */
export interface PageHistory {
  back: string[]
  forward: string[]
}

export const PAGE_HISTORY_LIMIT = 50

export const EMPTY_PAGE_HISTORY: PageHistory = { back: [], forward: [] }

/** Leaving `from` for a new page: remember it and drop the forward branch. */
export function pushPageHistory(history: PageHistory, from: string): PageHistory {
  if (history.back.at(-1) === from) return { back: history.back, forward: [] }
  return { back: [...history.back, from].slice(-PAGE_HISTORY_LIMIT), forward: [] }
}

/**
 * Step back (-1) or forward (1) from `current`, skipping pages that are no longer
 * available (hidden, disabled Labs) and repeats of the current page.
 */
export function stepPageHistory(history: PageHistory, current: string, direction: -1 | 1,
  available: (id: string) => boolean): { page: string; history: PageHistory } | undefined {
  const source = [...(direction < 0 ? history.back : history.forward)]
  while (source.length) {
    const page = source.pop()!
    if (page === current || !available(page)) continue
    const other = [...(direction < 0 ? history.forward : history.back), current].slice(-PAGE_HISTORY_LIMIT)
    return { page, history: direction < 0 ? { back: source, forward: other } : { back: other, forward: source } }
  }
  return undefined
}

/** Favorites in sidebar order that Ctrl/⌘+1…9 open. */
export function favoriteShortcutPages(favorites: readonly string[], tabs: readonly { id: string; implemented: boolean }[]): string[] {
  return favorites.filter(id => tabs.some(tab => tab.id === id && tab.implemented)).slice(0, 9)
}
