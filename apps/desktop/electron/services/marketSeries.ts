import { equityMarket } from '../shared/equityMarkets.js'
import { hyperliquidEquities } from './hyperliquidEquities.js'
import { getYahooSeries, type IncrementalOptions, type IncrementalSeriesResult } from './yahoo/series.js'
import { captureSources, observeSource } from './sourceHealth.js'

/** Only chart consumers opt in. Adjusted returns, backtests and financial history
 * retain the stock's corporate-action-adjusted series. Never stitch the two assets.
 */
export async function getMarketSeries(options: IncrementalOptions & { sourceMarket?: string; stockOnly?: boolean; allowPartialHistory?: boolean }): Promise<IncrementalSeriesResult> {
  if (!options.stockOnly && equityMarket(options.symbol) && !options.adjusted && options.variant !== 'adjusted') {
    try {
      const captured = await captureSources(() => hyperliquidEquities.getCandles(options.symbol, options.start, options.interval, Boolean(options.force || options.refresh), !options.allowPartialHistory))
      const result = captured.value
      if (captured.snapshot) observeSource(captured.snapshot)
      if (options.sourceMarket && result.market !== options.sourceMarket) throw new Error('Indicator market differs from chart market.')
      return {
        rows: result.candles.map(row => ({ ...row, adjclose: row.close })),
        currency: 'USD', longName: `${options.symbol} equity perpetual`, stale: result.stale,
        fromCache: result.fromCache, cacheAgeSeconds: result.cacheAgeSeconds,
        meta: { instrumentType: 'EQUITY_PERP', source: result.source, market: result.market },
      }
    } catch (error) {
      // A perpetual indicator cannot fall back to stock history on a perp chart.
      if (options.sourceMarket) throw error
      const result = await getYahooSeries(options)
      const reason = error instanceof Error ? error.message : String(error)
      const source = `Yahoo stock history (${reason})`
      observeSource({ fetchedAt: Date.now(), stale: result.stale, fromCache: result.fromCache,
        failures: [], sources: [source] })
      return { ...result, meta: { ...(result.meta as object ?? {}), source, market: undefined } }
    }
  }
  return getYahooSeries(options)
}
