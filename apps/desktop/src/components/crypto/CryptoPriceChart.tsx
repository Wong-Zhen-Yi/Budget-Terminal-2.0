import { useEffect, useRef } from 'react'
import { CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, createChart } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { Candle } from '@shared/contract'

/** Marks are displayed separately: only provider OHLCV observations enter this plot. */
export function CryptoPriceChart({ candles, context }: { candles: Candle[]; context: string }) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<{ price: ISeriesApi<'Candlestick'>; volume: ISeriesApi<'Histogram'> } | null>(null)
  const fitted = useRef('')

  useEffect(() => {
    if (!host.current) return
    const view = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0d1420' }, textColor: '#7d8ea6', fontSize: 12 },
      grid: { vertLines: { color: '#162131' }, horzLines: { color: '#162131' } },
      rightPriceScale: { borderColor: '#1e2b3f', scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: '#1e2b3f', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
    })
    const price = view.addSeries(CandlestickSeries, {
      upColor: '#26c281', downColor: '#f0554e', wickUpColor: '#26c281', wickDownColor: '#f0554e', borderVisible: false,
    })
    const volume = view.addSeries(HistogramSeries, {
      priceScaleId: 'volume', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false,
    })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    chart.current = view
    series.current = { price, volume }
    return () => { view.remove(); chart.current = null; series.current = null; fitted.current = '' }
  }, [])

  useEffect(() => {
    series.current?.price.setData(candles.map(row => ({ ...row, time: row.time as UTCTimestamp })))
    series.current?.volume.setData(candles.map(row => ({ time: row.time as UTCTimestamp, value: row.volume,
      color: row.close >= row.open ? '#26c28160' : '#f0554e60' })))
    // Provider polling and shared mark updates must preserve the user's zoom/pan.
    if (candles.length && fitted.current !== context) {
      chart.current?.timeScale().fitContent()
      fitted.current = context
    }
  }, [candles, context])

  return <div className="crypto-chart-canvas" ref={host} role="img"
    aria-label={`${context} candlestick chart with base-asset volume; times in UTC`}
    data-candle-count={candles.length} />
}
