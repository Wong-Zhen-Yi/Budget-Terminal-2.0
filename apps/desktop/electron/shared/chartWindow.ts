/** Symbols a pop-out chart window accepts: Yahoo-style tickers such as BRK-B, ^GSPC, ES=F or BTC-USD. */
const SYMBOL = /^[A-Z0-9.^=\-]{1,32}$/

export function normalizeChartSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const symbol = value.trim().toUpperCase()
  return SYMBOL.test(symbol) ? symbol : null
}

/** The shell document's hash for a pop-out chart window. */
export const chartWindowHash = (symbol: string): string => `chart=${encodeURIComponent(symbol)}`
