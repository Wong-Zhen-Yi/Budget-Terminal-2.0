import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { BmnrPayload, Candle, ChartPayload, ChartsComparePayload, ChartsHistoryPayload, EquityMarketUpdate, Envelope, FundamentalsPagePayload, Quote, QuotesPayload, StocksPayload, ValuationPayload } from '@shared/contract'
import { rsi, sma, toPoints } from '../../electron/services/indicators'
import { targetUpside } from '@shared/stocks'
import { sofiBookRatios, type SofiPayload } from '@shared/sofi'
import { markBmnrPayload } from '@shared/bmnr'
import type { SemiconductorsPayload } from '@shared/semiconductors'
import { equityPriceSource } from '@shared/equityMarkets'

/** Update the live mark without pretending the underlying history is a perp series. */
function stockMark(stock: StocksPayload, quote: Quote): StocksPayload {
  const upside = targetUpside(quote.price, stock.targets.meanPrice)
  return { ...stock, currentQuote: quote, chart: { ...stock.chart, stats: { ...stock.chart.stats,
    price: quote.price, change: quote.change, absChange: quote.absChange, priceSource: quote.source,
    priceBasis: quote.priceBasis, changeBasis: quote.changeBasis } },
    targets: { ...stock.targets, upsideToMean: upside.text, upsidePct: upside.value } }
}

/** Merge actual venue candles only; a mark price never becomes an OHLCV trade bar. */
export function mergeStreamCandle(candles: Candle[], candle: Candle): Candle[] {
  const last = candles.at(-1)
  if (!last || candle.time < last.time) return candles
  return (candle.time === last.time ? [...candles.slice(0, -1), candle] : [...candles, candle]).slice(-5_000)
}

export function applyEquityMarketUpdate(client: QueryClient, update: EquityMarketUpdate): void {
  const quotes = new Map(update.quotes.map(quote => [quote.symbol, quote]))
  for (const query of client.getQueryCache().getAll()) {
    const envelope = query.state.data as Envelope<unknown> | undefined
    if (!envelope?.data || typeof envelope.data !== 'object') continue
    const root = String(query.queryKey[0])
    let data: unknown = envelope.data
    if (root === 'quotes') {
      const payload = data as QuotesPayload
      const holdings = { ...payload.holdings }
      let changed = false
      for (const [symbol, quote] of quotes) if (holdings[symbol]) {
        holdings[symbol] = { ...quote, sector: holdings[symbol].sector }
        changed = true
      }
      if (changed) data = { ...payload, holdings }
    } else if (root === 'bmnr') {
      const quote = quotes.get('BMNR')
      if (quote) data = markBmnrPayload(data as BmnrPayload, quote)
    } else if (root === 'fundamentalsPage') {
      const payload = data as FundamentalsPagePayload
      const quote = quotes.get(payload.symbol)
      if (quote) data = { ...payload, facts: { ...payload.facts, currentPrice: quote.price },
        currencyNote: `${(payload.currencyNote ?? 'Reported in USD').split(' · Price:')[0]} · Price: ${quote.source}` }
    } else if (root === 'valuation') {
      const payload = data as ValuationPayload
      const quote = quotes.get(payload.ticker)
      if (quote) data = { ...payload, metrics: { ...payload.metrics, price: quote.price },
        sources: { ...payload.sources, quote: `${quote.source}; Yahoo stock monthly history` } }
    } else if (root === 'semiconductors') {
      const payload = data as SemiconductorsPayload
      let changed = false
      const rows = payload.rows.map(row => {
        const quote = quotes.get(row.company.symbol)
        if (!quote || !row.market) return row
        changed = true
        return { ...row, market: { ...row.market, price: quote.price, dailyChange: quote.change,
          priceSource: quote.source, quoteTime: quote.asOf, changeBasis: quote.changeBasis } }
      })
      if (changed) data = { ...payload, rows }
    } else if (root === 'chartsCompare') {
      const payload = data as ChartsComparePayload
      let changed = false
      const series = { ...payload.series }
      const interval = payload.interval === '1 Week' ? '1wk' : '1d'
      for (const event of update.candles) {
        if (event.interval !== interval || payload.sources?.[event.symbol] !== equityPriceSource(event.market)) continue
        const rows = series[event.symbol]
        const last = rows?.at(-1)
        if (!last || event.candle.time < last.time) continue
        const point = { time: event.candle.time, close: event.candle.close }
        series[event.symbol] = event.candle.time === last.time ? [...rows.slice(0, -1), point] : [...rows, point]
        changed = true
      }
      if (changed) data = { ...payload, series }
    } else if (root === 'stocks') {
      const stock = data as StocksPayload
      const quote = quotes.get(stock.symbol)
      if (quote) data = stockMark(stock, quote)
    } else if (['amzn', 'avgo', 'mu', 'sofi', 'vst', 'hood', 'hims', 'pltr'].includes(root)) {
      const payload = data as { market?: StocksPayload | null }
      const quote = payload.market && quotes.get(payload.market.symbol)
      if (payload.market && quote) {
        data = { ...payload, market: stockMark(payload.market, quote) }
        if (root === 'sofi') {
          const sofi = data as SofiPayload
          data = { ...sofi, price: quote.price, changePct: quote.change, priceAsOf: quote.asOf,
            valuation: sofiBookRatios(quote.price, sofi.reports?.quarters.at(-1)) }
        }
      }
    } else if (root === 'chart' || root === 'chartsHistory') {
      const payload = data as ChartPayload | ChartsHistoryPayload
      if (!payload.stats) continue
      const quote = quotes.get(payload.symbol)
      let next = payload
      if (quote) next = { ...next, stats: { ...payload.stats, price: quote.price, change: quote.change, absChange: quote.absChange,
        priceSource: quote.source, priceBasis: quote.priceBasis, changeBasis: quote.changeBasis } }
      for (const event of update.candles) {
        if (event.symbol !== payload.symbol || event.market !== payload.stats.market || event.interval !== payload.interval) continue
        const candles = mergeStreamCandle(next.candles, event.candle)
        if (candles === next.candles) continue
        const closes = candles.map(row => row.close)
        const rsiValues = rsi(closes, 14)
        // Intraday MA lines remain daily-derived. Daily MAs can be recomputed from the
        // same venue's complete visible daily series once enough bars are present.
        const indicators = { ...next.indicators, rsi: toPoints(candles, rsiValues), rsiMa: toPoints(candles, sma(rsiValues, 14)) }
        if (payload.interval === '1d' && candles.length >= 200) indicators.ma200 = toPoints(candles, sma(closes, 200))
        if (payload.interval === '1d' && candles.length >= 50 && 'ma50' in indicators) indicators.ma50 = toPoints(candles, sma(closes, 50))
        const last = candles.at(-1)!
        next = { ...next, candles, indicators, stats: { ...next.stats!, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume } } as typeof next
      }
      data = next
    }
    // Keep the envelope's oldest source time/failures: a new mark must not make
    // old Yahoo fundamentals, macro quotes or historical dependencies look fresh.
    if (data !== envelope.data) client.setQueryData(query.queryKey, { ...envelope, data }, { updatedAt: query.state.dataUpdatedAt })
  }
}

export function useEquityMarketStream(): void {
  const client = useQueryClient()
  useEffect(() => window.api.onEquityMarketChanged?.(update => applyEquityMarketUpdate(client, update)), [client])
}
