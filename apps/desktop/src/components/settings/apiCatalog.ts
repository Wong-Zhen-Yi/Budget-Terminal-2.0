export interface ApiUse {
  pages: string[]
  purpose: string
}
export interface ApiDefinition {
  id: string
  label: string
  uses: ApiUse[]
}
const use = (pages: string, purpose: string): ApiUse => ({ pages: pages.split('|'), purpose })

/** Public service inventory. Dependencies include fallback and shared data consumers, not request attribution. */
export const API_CATALOG: ApiDefinition[] = [
  { id: 'yahoo', label: 'Yahoo Finance', uses: [
    use('dashboard|dashboard-2|portfolio|global|pre-market|trading-volumes|heatmap|cards|up-down|stocks|stock-discovery|price|market-cap', 'Quotes, market snapshots, screeners and price/history fallbacks.'),
    use('charts|technical-screen|quant|backtest|beta|projections', 'Historical bars, technical indicators, correlations, simulations and projections.'),
    use('fundamentals|scorecard|valuation|options|etf|sp500', 'Financial statements, valuation inputs, option chains, fund data and index prices.'),
    use('forex|crypto|bitcoin|bmnr|sofi|mu|amzn|avgo|semiconductors|vst|hood|pltr|hims|gold|oil|bonds', 'Currency, commodity, benchmark and company market data.'),
    use('news|calendar|ipo', 'Headlines, earnings events and IPO calendar fallback.'),
  ] },
  { id: 'hyperliquid', label: 'Hyperliquid', uses: [
    use('crypto', 'Shared live perpetual mark prices, funding, open interest and venue volume; labelled price fallback when CoinGecko is unavailable. Yahoo stock metadata is cached separately.'),
    use('portfolio|stocks|stock-discovery|price|market-cap|heatmap|cards|up-down|charts', 'Mapped equity perpetual marks and supported live chart bars; coverage depends on the symbol.'),
  ] },
  { id: 'coingecko', label: 'CoinGecko', uses: [use('crypto', 'Coin rankings, prices, market capitalizations and global market totals.'), use('bmnr', 'Public Ethereum treasury holdings.')] },
  { id: 'alternative', label: 'Alternative.me', uses: [use('crypto', 'Crypto Fear & Greed sentiment index.')] },
  { id: 'defeatbeta', label: 'DefeatBeta / Hugging Face', uses: [use('defeatbeta', 'Downloaded financial datasets and statement/valuation inputs.')] },
  { id: 'fred', label: 'FRED', uses: [use('economic|money|calendar', 'Public economic time series, monetary aggregates, rates and macro context.')] },
  { id: 'treasury', label: 'U.S. Treasury', uses: [use('economic|bonds|valuation', 'Yield curves and shared risk-free rate inputs.')] },
  { id: 'economic-releases', label: 'BLS / BEA / Census / Federal Reserve', uses: [use('calendar', 'Official economic release schedules and FOMC meeting dates.'), use('economic', 'Labor statistics and New York Fed rate data.')] },
  { id: 'umich', label: 'University of Michigan', uses: [use('economic', 'Consumer sentiment time series.')] },
  { id: 'sec', label: 'SEC EDGAR', uses: [use('fundamentals|scorecard|bmnr|sofi|mu|amzn|avgo|vst|hims', 'Company facts, filing submissions and published financial reports.')] },
  { id: 'ir', label: 'Company investor relations', uses: [use('sofi|mu|amzn|avgo|hood|hims', 'Quarterly reports, operating metrics and company disclosures.')] },
  { id: 'bitcoin-network', label: 'Blockchain.info / mempool.space', uses: [use('bitcoin', 'Network statistics, recent blocks, fees and mempool activity.')] },
  { id: 'cnn', label: 'CNN', uses: [use('pre-market', 'Market Fear & Greed sentiment.')] },
  { id: 'nasdaq', label: 'Nasdaq', uses: [use('ipo', 'Public IPO calendar.'), use('calendar', 'Listed-symbol directory for earnings coverage.')] },
  { id: 'funds', label: 'ETF issuers / Stock Analysis', uses: [use('etf', 'Fund directory and holdings from ARK, iShares, State Street, Invesco, Vanguard, First Trust and ProShares, with public holdings fallbacks.'), use('sp500', 'SPY constituent weights from State Street.')] },
  { id: 'wikipedia', label: 'Wikipedia', uses: [use('sp500|etf', 'S&P 500 constituent directory.')] },
  { id: 'gold', label: 'World Gold Council / USGS', uses: [use('gold', 'Gold supply, reserves and industry research.')] },
  { id: 'oil', label: 'EIA / OPEC', uses: [use('oil', 'Petroleum time series and OPEC basket prices.')] },
  { id: 'dataroma', label: 'Dataroma', uses: [use('institutions', 'Institutional portfolios and holdings activity.')] },
  { id: 'capitol', label: 'Capitol Trades', uses: [use('politics', 'Public congressional trading disclosures.')] },
  { id: 'youtube', label: 'YouTube', uses: [use('youtube', 'Public video search, channel feeds and thumbnails.')] },
  { id: 'news-feeds', label: 'Public news feeds', uses: [use('news|forex', 'Publisher feeds and market headlines.')] },
  { id: 'agent', label: 'Codex / connected MCP tools', uses: [use('agents', 'Research and user-requested tool calls; providers depend on local connections. Agent chat can also be opened from any page.')] },
  { id: 'browser', label: 'User-selected websites', uses: [use('browser', 'Navigation and search in the embedded browser; destinations depend on user activity.')] },
]
