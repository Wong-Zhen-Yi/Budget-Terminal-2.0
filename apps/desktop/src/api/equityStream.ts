import { useEffect } from 'react'
import { notifyManager, useQueryClient, type Query, type QueryClient } from '@tanstack/react-query'
import type { BmnrPayload, Candle, ChartPayload, ChartsComparePayload, ChartsHistoryPayload, CryptoPayload, EquityMarketUpdate, Envelope, FundamentalsPagePayload, HeatmapPayload, MarketCapPayload, PriceScreenPayload, Quote, QuotesPayload, StocksPayload, ValuationPayload } from '@shared/contract'
import { pageQueryKeys } from './pageQueryScope'
import { liveIndicators, retainLiveIndicatorState } from './liveIndicators'
import { createEquityQueryIndex } from './equityQueryIndex'
import { markLiveQuerySnapshot } from './queryPersistence'
import { targetUpside } from '@shared/stocks'
import { sofiBookRatios, type SofiPayload } from '@shared/sofi'
import { markBmnrPayload } from '@shared/bmnr'
import type { HomebuildersPayload } from '@shared/homebuilders'
import type { SemiconductorsPayload } from '@shared/semiconductors'
import { equityPriceSource } from '@shared/equityMarkets'
import { cryptoPerpSymbol } from '@shared/cryptoWorkspace'
import { markCryptoPerpetuals } from '@shared/hyperliquid'

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
  if (last.time === candle.time && last.open === candle.open && last.high === candle.high && last.low === candle.low && last.close === candle.close && last.volume === candle.volume) return candles
  return (candle.time === last.time ? [...candles.slice(0, -1), candle] : [...candles, candle]).slice(-5_000)
}

export function applyEquityMarketUpdate(client: QueryClient, update: EquityMarketUpdate, queries: Iterable<Query> = client.getQueryCache().getAll()): void {
  const quotes = new Map(update.quotes.map(quote => [quote.symbol, quote]))
  for (const query of queries) {
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
    } else if (root === 'crypto') {
      const payload = data as CryptoPayload
      const next = { ...payload.quotes }
      let changed = false
      // Crypto proxies stay on their own providers even when other pages use Finnhub.
      for (const [symbol, quote] of quotes) if (next[symbol] && quote.source?.startsWith('Hyperliquid equity perp')) {
        next[symbol] = { ...next[symbol], price: quote.price, changePct: quote.change, source: quote.source ?? next[symbol].source }
        changed = true
      }
      if (changed) data = { ...payload, quotes: next }
      if (update.hyperliquid) data = markCryptoPerpetuals(data as CryptoPayload, update.hyperliquid)
    } else if (root === 'marketCap' || root === 'priceScreen') {
      const payload = data as MarketCapPayload | PriceScreenPayload
      let changed = false
      let rows = payload.rows.map(row => {
        const quote = quotes.get(row.ticker)
        if (!quote) return row
        changed = true
        return { ...row, price: quote.price, priceSource: quote.source, priceBasis: quote.priceBasis }
      })
      if (changed) {
        if ('minimumPrice' in payload) rows = rows.filter(row => row.price !== null && row.price >= payload.minimumPrice && row.price <= payload.maximumPrice)
        data = { ...payload, rows,
          source: [...new Set([...payload.source.split('; '), ...update.quotes.map(quote => quote.source).filter(Boolean)])].join('; ') }
      }
    } else if (root === 'heatmap') {
      const payload = data as HeatmapPayload
      let changed = false
      const holdings = payload.holdings.map(row => {
        const quote = quotes.get(row.symbol)
        if (!quote) return row
        changed = true
        return { ...row, price: quote.price, priceSource: quote.source, priceBasis: quote.priceBasis }
      })
      if (changed) data = { ...payload, holdings, priceSource: `${[...new Set(holdings.map(row => row.priceSource).filter(Boolean))].join(' + ')}; returns use Yahoo stock history` }
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
    } else if (root === 'semiconductors' || root === 'homebuilders') {
      const payload = data as SemiconductorsPayload | HomebuildersPayload
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
        if (event.symbol !== payload.symbol || event.market !== payload.stats.market || event.interval !== (payload.interval === '1w' ? '1wk' : payload.interval === '1M' ? '1mo' : payload.interval)) continue
        const candles = mergeStreamCandle(next.candles, event.candle)
        if (candles === next.candles) continue
        const indicators = liveIndicators(next, candles)
        const last = candles.at(-1)!
        const previous = candles.at(-2) ?? last
        const cryptoStats = cryptoPerpSymbol(payload.symbol) ? { price: last.close, absChange: last.close - previous.close, change: (last.close / previous.close - 1) * 100 } : {}
        next = { ...next, candles, indicators, stats: { ...next.stats!, ...cryptoStats, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume } } as typeof next
      }
      data = next
    }
    // Keep the envelope's oldest source time/failures: a new mark must not make
    // old Yahoo fundamentals, macro quotes or historical dependencies look fresh.
    if (data !== envelope.data) {
      const stored = client.setQueryData<Envelope<unknown>>(query.queryKey, { ...envelope, data }, { updatedAt: query.state.dataUpdatedAt })
      if (stored) markLiveQuerySnapshot(stored)
      if (root === 'chart' || root === 'chartsHistory') {
        retainLiveIndicatorState((data as ChartPayload).candles, (stored!.data as ChartPayload).candles)
      }
    }
  }
}

export function useEquityMarketStream(activePage: string): void {
  const client = useQueryClient()
  useEffect(() => {
    const index = createEquityQueryIndex(client)
    let last = ''
    const publish = () => {
      const symbols = index.symbolsFor(pageQueryKeys(activePage)).sort().slice(0, 2000)
      const signature = JSON.stringify(symbols)
      if (signature === last) return
      last = signature
      void window.api.setEquityQuoteVisibility?.(symbols).catch(() => undefined)
    }
    publish()
    const timer = setInterval(publish, 1_000)
    const stream = createBatchedEquityUpdates(client)
    const stop = window.api.onEquityMarketChanged?.(stream.enqueue)
    return () => { clearInterval(timer); index.stop(); stop?.(); stream.stop() }
  }, [client, activePage])
}

/** Retain every distinct candle timestamp while coalescing repeated marks/live bars. */
export function createBatchedEquityUpdates(client: QueryClient, delayMs = 50) {
  const index = createEquityQueryIndex(client)
  const quotes = new Map<string, Quote>()
  const candles = new Map<string, EquityMarketUpdate['candles'][number]>()
  let hyperliquid: EquityMarketUpdate['hyperliquid']
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!quotes.size && !candles.size && !hyperliquid) return
    const update = { quotes: [...quotes.values()], candles: [...candles.values()].sort((a, b) => a.candle.time - b.candle.time), hyperliquid }
    quotes.clear(); candles.clear(); hyperliquid = undefined
    notifyManager.batch(() => applyEquityMarketUpdate(client, update, index.matching(update)))
  }
  return {
    enqueue(update: EquityMarketUpdate) {
      for (const quote of update.quotes) quotes.set(quote.symbol, quote)
      for (const event of update.candles) candles.set(JSON.stringify([event.symbol, event.market, event.interval, event.candle.time]), event)
      if (update.hyperliquid) hyperliquid = update.hyperliquid
      timer ??= setTimeout(flush, delayMs)
    },
    flush,
    stop() { flush(); index.stop() },
  }
}
