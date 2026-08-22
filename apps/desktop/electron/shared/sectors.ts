/**
 * The sector universe, ported from `SECTOR_DATA` in the PySide6 `constants.py`.
 *
 * The Portfolio Heatmap groups tiles by these buckets. It is a fixed list rather than a
 * per-ticker Yahoo lookup, which is what the reference app does — anything not listed
 * lands in `Unclassified` instead of costing a request.
 */
export const SECTOR_DATA: Record<string, string[]> = {
  'Technology': ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'ASML', 'ADBE', 'AMD', 'CRM', 'CSCO'],
  'Financials': ['JPM', 'BAC', 'WFC', 'MS', 'GS', 'HSBC', 'RY', 'TD', 'C', 'UBS'],
  'Healthcare': ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'NVO', 'AZN', 'PFE', 'ABT'],
  'Consumer Cyclical': ['AMZN', 'TSLA', 'HD', 'MCD', 'TM', 'NKE', 'LOW', 'SBUX', 'TJX', 'BKNG'],
  'Energy': ['XOM', 'CVX', 'SHEL', 'TTE', 'COP', 'BP', 'PBR', 'EOG', 'SLB', 'MPC'],
  'Communication Services': ['GOOGL', 'META', 'NFLX', 'DIS', 'TMUS', 'VZ', 'T', 'CMCSA', 'AMX', 'BTI'],
  'Industrials': ['GE', 'UNP', 'HON', 'RTX', 'LMT', 'CAT', 'BA', 'UPS', 'DE', 'MMM'],
  'Consumer Defensive': ['WMT', 'PG', 'KO', 'PEP', 'COST', 'PM', 'UL', 'EL', 'DEO', 'MO'],
  'Utilities': ['NEE', 'DUK', 'SO', 'D', 'EXC', 'AEP', 'SRE', 'PEG', 'ED', 'XEL'],
  'Real Estate': ['PLD', 'AMT', 'EQIX', 'CCI', 'WY', 'PSA', 'SBAC', 'VICI', 'O', 'WELL'],
  'Basic Materials': ['LIN', 'BHP', 'RIO', 'FCX', 'VALE', 'APD', 'NEM', 'SHW', 'CTVA', 'SCCO'],
  'Crypto': ['IBIT', 'ETHA', 'BMNR', 'MSTR', 'BITW', 'BSOL', 'CRCL', 'COIN', 'BITQ'],
  'Metals': ['GLD', 'SLV', 'GDX', 'GDXJ', 'GLDM', 'SIVR', 'PAAS', 'WPM', 'FNV', 'SBSW'],}

export const UNCLASSIFIED_SECTOR = 'Unclassified'

const bySymbol = new Map<string, string>()
for (const [sector, tickers] of Object.entries(SECTOR_DATA)) {
  for (const ticker of tickers) if (!bySymbol.has(ticker)) bySymbol.set(ticker, sector)
}

/** Yahoo spells the same name with a dot or a hyphen, so try both. */
export function sectorFor(symbol: string): string {
  const text = symbol.trim().toUpperCase()
  if (!text) return UNCLASSIFIED_SECTOR
  return (
    bySymbol.get(text) ??
    bySymbol.get(text.replace(/\./g, '-')) ??
    bySymbol.get(text.replace(/-/g, '.')) ??
    UNCLASSIFIED_SECTOR
  )
}
