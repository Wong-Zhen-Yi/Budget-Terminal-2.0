import { TABS } from '../electron/shared/contract.js'
import { DEFAULT_TAB_ID, WORKSPACES } from '../electron/shared/navigation.js'
import type { Operation } from '../mcp/operations.js'

export interface PageDefinition {
  id: string
  name: string
  workspace: string
  operation?: Operation
  request?: Record<string, unknown>
  sourceId?: string
  lines: string[]
}

/** Use desktop labels and membership so new desktop pages cannot silently disappear. */
export function desktopPages(now = new Date()): PageDefinition[] {
  const presets: Record<string, [Operation, Record<string, unknown>?]> = {
    portfolio: ['portfolio'], news: ['newsPage', { tickers: [] }],
    calendar: ['calendarMonth', { tickers: [], year: now.getFullYear(), month: now.getMonth() + 1 }],
    youtube: ['youtube', { tickers: [] }],
    'pre-market': ['preMarket'], heatmap: ['heatmap', { etf: 'SPY' }],
    'up-down': ['upDown', { source: 'spy', interval: '1d' }],
    'trading-volumes': ['tradingVolumes'], 'market-cap': ['marketCap'],
    price: ['priceScreen', { minimumPrice: 100, maximumPrice: 200 }],
    etf: ['etfHoldings', { ticker: 'SPY' }], sp500: ['sp500', { part: 'constituents' }], forex: ['forexQuotes'],
    crypto: ['crypto'], gold: ['gold'], oil: ['oil'],
    stocks: ['stocks', { symbol: 'AAPL' }], 'stock-discovery': ['discovery', { symbol: 'AAPL' }],
    fundamentals: ['fundamentalsPage', { symbol: 'AAPL' }],
    valuation: ['valuation', { symbol: 'AAPL' }], institutions: ['institutionActivity'],
    bmnr: ['bmnr'], bitcoin: ['bitcoin'], pltr: ['stocks', { symbol: 'PLTR' }],
    hood: ['hood'], hims: ['hims'], sofi: ['sofi'], mu: ['mu'], amzn: ['amzn'],
    avgo: ['avgo'], semiconductors: ['semiconductors'], vst: ['vst'],
    charts: ['chartsHistory', { symbol: 'SPY', interval: '1 Day', range: '1Y' }],
    options: ['options', { symbol: 'SPY' }], 'technical-screen': ['technicalScan'],
    quant: ['quantScan', { latestOnly: true }], global: ['globalMarkets'],
    economic: ['economic'], bonds: ['economic'], money: ['money'], ipo: ['ipoUpcoming'],
    politics: ['politicsPage'], 'personal-finance': ['personalFinance'], cards: ['cards'],
    projections: ['projections', { symbol: 'SPY', timeframe: '1 Day' }], articles: ['articles'],
  }
  const desktopHelp: Record<string, string> = {
    browser: 'Use Browser in the desktop app for the shared Chromium session, tabs and website reading.',
    agents: 'Use Agents in the desktop app for chat, tools and saved conversations.',
    notifications: 'Use Notifications in the desktop app to manage reminders and background trackers.',
    scorecard: 'Use Scorecard in the desktop app for its interactive company scoring model.',
    beta: 'Use Beta in the desktop app for the interactive market replay.',
    polymarket: 'Use Polymarket in the desktop app for market search, probability charts and order books.',
    defeatbeta: 'Use DefeatBeta Terminal in the desktop app to select a dataset section. Space > Browse research services also supports section requests.',
    backtest: 'Use Backtest in the desktop app to configure strategy rows, benchmark and range. Space > Browse research services accepts custom read-only backtests.',
  }
  const ordered = [...new Set([...WORKSPACES.flatMap(group => group.pages), ...TABS.map(tab => tab.id)])]
  return ordered.flatMap(id => {
    const tab = TABS.find(item => item.id === id && item.implemented)
    if (!tab) return []
    const preset = presets[id]
    return [{ id, name: tab.label, workspace: WORKSPACES.find(group => group.pages.includes(id))?.label ?? 'Settings',
      operation: preset?.[0], request: preset?.[1] ?? {},
      sourceId: id === 'dashboard' || id === 'dashboard-2' ? 'portfolio' : id === 'bonds' ? 'economic' : undefined,
      lines: desktopHelp[id] ? [tab.label, '', desktopHelp[id], '', 'Open the desktop app with BTD. Launch Budget Terminal.cmd installs/checks both interfaces.', 'Press p to find a page, w for workspaces, or Space for research actions.'] : [],
    }]
  })
}

export const initialPageId = DEFAULT_TAB_ID
