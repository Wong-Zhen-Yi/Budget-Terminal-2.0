import type { ChartsHistoryRequest, ChartsInterval, ChartsRange } from './contract.js'

export const CRYPTO_CHART_INTERVALS = [
  { label: '15m', interval: '15 Minutes', range: '5D' },
  { label: '1h', interval: '1 Hour', range: '1M' },
  { label: '4h', interval: '4 Hours', range: '3M' },
  { label: '1D', interval: '1 Day', range: '1Y' },
] as const satisfies ReadonlyArray<{ label: string; interval: ChartsInterval; range: ChartsRange }>

export function cryptoChartRequest(symbol = 'BTC', interval: ChartsInterval = '1 Hour'): ChartsHistoryRequest {
  const choice = CRYPTO_CHART_INTERVALS.find(entry => entry.interval === interval) ?? CRYPTO_CHART_INTERVALS[1]
  return { symbol: `${symbol}-PERP`, interval: choice.interval, range: choice.range }
}

export function cryptoPerpSymbol(symbol: string): string | null {
  return /^[A-Z0-9][A-Z0-9._-]{0,29}-PERP$/i.test(symbol) ? symbol.slice(0, -5) : null
}
