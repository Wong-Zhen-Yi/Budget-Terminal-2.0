// Compact, monochrome symbols drawn on the same grid for the workspace rail.
export const pageIconPaths: Record<string, string> = {
  agents: 'M5 7h14v13H5z M12 3v4 M9 12h.01 M15 12h.01 M9 16h6 M2 10v7 M22 10v7',
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  portfolio: 'M3 7h18v14H3z M8 7V3h8v4 M3 12h18 M10 12v3h4v-3',
  'personal-finance': 'M3 6h16v14H3z M3 6V4h14 M15 11h6v5h-6z M18 13.5h.01',
  global: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c-5 5-5 13 0 18 5-5 5-13 0-18',
  news: 'M4 3h13v18H4z M17 8h4v11a2 2 0 0 1-4 0 M7 6h7 M7 10h3v4H7z M13 10h1 M13 14h1 M7 18h7',
  calendar: 'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18 M7 14h2 M15 14h2 M7 18h2',
  'pre-market': 'M3 17h18 M6 14a6 6 0 0 1 12 0 M12 3v3 M3 7l2 2 M21 7l-2 2 M3 21h18',
  'trading-volumes': 'M4 20V12h4v8 M10 20V4h4v16 M16 20V8h4v12 M2 20h20',
  beta: 'M8 21V7c0-6 10-6 10 0 0 3-3 4-6 4 8-1 9 8 3 8H8',
  heatmap: 'M3 3h11v8H3z M17 3h4v8h-4z M3 14h5v7H3z M11 14h10v7H11z',
  cards: 'M3 5h18v14H3z M3 9h18 M6 15h4 M15 15h3',
  'up-down': 'M7 21V3 M3 7l4-4 4 4 M17 3v18 M13 17l4 4 4-4',
  stocks: 'M3 20h18 M6 15V8 M4 10h4v3H4z M12 17V4 M10 7h4v7h-4z M18 16V6 M16 9h4v4h-4z',
  'stock-discovery': 'M15 9a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M14 14l7 7 M6 10l2-3 2 2 2-3',
  fundamentals: 'M4 21V3h16v18z M8 7h8 M8 11h8 M8 15h3 M8 18h8',
  defeatbeta: 'M3 4h18v16H3z M6 8l4 4-4 4 M12 16h6 M3 6h18',
  charts: 'M3 3v18h18 M6 16l4-6 4 3 7-8',
  valuation: 'M5 3h14v18H5z M8 6h8v4H8z M8 14h1 M12 14h1 M16 14h.01 M8 18h1 M12 18h1 M16 18h.01',
  options: 'M4 12h6 M10 12l7-7 M10 12l7 7 M14 5h3v3 M14 19h3v-3',
  'technical-screen': 'M3 5h18v14H3z M8 22h8 M12 19v3 M6 13h3l2-5 3 8 2-5h2',
  quant: 'M18 4H6l7 8-7 8h12',
  projections: 'M3 3v18h18 M5 17l5-5 4 2 M14 14l2-3 M18 9l3-5 M17 4h4v4',
  etf: 'M3 4h12v12H3z M7 8h12v12H7 M11 12h10v10H11z',
  sp500: 'M3 20h18 M5 17v-5h3v5 M10 17V8h3v9 M15 17V4h4v13 M4 7l5-4',
  forex: 'M3 7h18 M17 3l4 4-4 4 M21 17H3 M7 13l-4 4 4 4',
  crypto: 'M8 3 3 8v8l5 5h8l5-5V8l-5-5z M16 8a6 6 0 1 0 0 8',
  bitcoin: 'M9 5v14 M7 7h7a3 3 0 0 1 0 6H9 M9 13h6a3 3 0 0 1 0 6H7 M11 3v4 M14 3v4 M11 19v2 M14 19v2',
  bmnr: 'M4 20l3-7h10l3 7z M9 13V9h6v4 M5 4l14 5 M16 3l3 6-6 2',
  sofi: 'M4 6h.01 M12 4h.01 M20 6h.01 M4 12h.01 M12 12h.01 M20 12h.01 M4 18h.01 M12 20h.01 M20 18h.01 M8 8l8 8 M16 8l-8 8',
  mu: 'M5 8c2-5 12-5 14 0 M5 16c2 5 12 5 14 0 M6 15V9l6 5 6-5v6',
  amzn: 'M5 4h14l-1 10H6z M9 4V3h6v1 M4 18c5 4 11 4 16-1 M16 17h4v4',
  avgo: 'M3 15c3-8 5-8 9 0s6 8 9 0 M3 9c3-8 5-8 9 0s6 8 9 0',
  semiconductors: 'M6 6h12v12H6z M9 9h6v6H9z M9 3v3 M15 3v3 M9 18v3 M15 18v3 M3 9h3 M3 15h3 M18 9h3 M18 15h3',
  vst: 'M13 2 5 14h6l-1 8 9-13h-7z',
  hood: 'M5 20c0-10 4-15 15-17 0 10-6 16-13 16 M5 20 17 7 M10 14h6',
  pltr: 'M12 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M5 21l7-5 7 5 M5 16h14',
  hims: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  gold: 'M3 19 7 6h10l4 13z M7 6l3 13 M3 19h18 M10 19l7-13',
  oil: 'M12 3c-2 5-7 8-7 12a7 7 0 0 0 14 0c0-4-5-7-7-12 M9 15c0 2 1 3 3 3',
  backtest: 'M4 9a8 8 0 1 1 0 7 M4 3v6h6 M12 7v5l4 2',
  ipo: 'M8 15h8 M12 15V3 M8 7l4-4 4 4 M5 13v8h14v-8',
  institutions: 'M3 8l9-5 9 5z M5 11v7 M10 11v7 M14 11v7 M19 11v7 M3 21h18',
  politics: 'M6 3v18 M6 4h14l-3 4 3 4H6 M3 21h6',
  youtube: 'M3 5h18v14H3z M10 8l6 4-6 4z',
  dictionary: 'M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1v15 M6 8h3 M15 8h3',
  bonds: 'M5 3h14v14l-3 4-4-2-4 2-3-4z M8 7h8 M8 11h8 M10 15h4',
  money: 'M3 6h18v12H3z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M6 9h.01 M18 15h.01',
  economic: 'M3 20h18 M5 17v-5 M10 17V9 M15 17V6 M20 17V3 M4 7l6-3 5 1 5-3',
  price: 'M3 3h8l10 10-8 8L3 11z M7 7h.01',
  'market-cap': 'M4 18h16v3H4z M7 12h10v6H7z M10 6h4v6h-4z M12 3v3',
  articles: 'M4 3h11l5 5v13H4z M15 3v5h5 M8 12h8 M8 16h8',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
}

const workspaceIconPaths: Record<string, string> = {
  agents: pageIconPaths.agents,
  overview: pageIconPaths.dashboard,
  markets: pageIconPaths.economic,
  research: pageIconPaths['stock-discovery'],
  focus: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0 M12 9v6 M9 12h6',
  trading: pageIconPaths.stocks,
  macro: pageIconPaths.global,
  money: pageIconPaths['personal-finance'],
  articles: pageIconPaths.articles,
}

export function NavigationIcon({ id, workspace = false }: { id: string; workspace?: boolean }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20"
      className="mx-auto shrink-0" fill="none" stroke="currentColor" strokeWidth="1.65"
      strokeLinecap="round" strokeLinejoin="round" data-navigation-icon={id}>
      <path d={(workspace ? workspaceIconPaths : pageIconPaths)[id] ?? 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h4'} />
    </svg>
  )
}
