/** Explicit stock/ADR mappings. Never infer a stock from an arbitrary perp ticker.
 * USD contract specifications and names must be reviewed before adding a market.
 * ETFs, indices, FX, commodities and pre-IPO markets are intentionally excluded.
 */
const XYZ_STOCKS = [
  'AAPL', 'AAOI', 'AMAT', 'AMD', 'AMZN', 'ARM', 'ASML', 'AVGO', 'BABA', 'BB',
  'BE', 'BMNR', 'BX', 'COIN', 'COST', 'CRCL', 'CRWD', 'CRWV', 'CVX',
  'DELL', 'DKNG', 'EBAY', 'GEV', 'GLW', 'GME', 'GOOGL', 'HIMS', 'HOOD', 'IBM',
  'INTC', 'IREN', 'LITE', 'LLY', 'LRCX', 'META', 'MRNA', 'MRVL', 'MSFT',
  'MSTR', 'MU', 'NBIS', 'NET', 'NFLX', 'NOK', 'NOW', 'NVDA', 'ORCL', 'PLTR',
  'QCOM', 'RDDT', 'RIVN', 'RKLB', 'SNDK', 'TSLA', 'TSM', 'TWST', 'UMC', 'USAR',
  'WDC', 'ZM',
] as const

export const EQUITY_MARKETS: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(XYZ_STOCKS.map(symbol => [symbol, `xyz:${symbol}`])),
  SOFI: 'para:SOFI',
  VST: 'para:VST',
})

export const EQUITY_PRICE_POLICY = 'Stock prices: Hyperliquid equity-perp marks where mapped; Yahoo elsewhere. Perp changes are 24h.'

export function equityMarket(symbol: string): string | undefined {
  return EQUITY_MARKETS[symbol.trim().toUpperCase()]
}

export function equityPriceSource(market: string): string {
  return `Hyperliquid equity perp (${market})`
}
