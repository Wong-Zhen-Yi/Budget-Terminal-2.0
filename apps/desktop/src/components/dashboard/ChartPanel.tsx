import { useEffect, useMemo, useState } from 'react'

import { TIMEFRAMES, type ChartPayload, type TimeframeLabel } from '@shared/contract'
import { PriceChart, DASHBOARD_INDICATOR_COLORS } from '@/charts/PriceChart'
import { Button } from '@/components/ui/Button'
import { PanelMessage } from '@/components/ui/Panel'
import { compactNumber, decimals, percent, quotePrice, signedQuotePrice } from '@/lib/format'
import type { IndicatorKey } from '@/stores/dashboard'

const INDICATORS: ReadonlyArray<{ key: IndicatorKey; label: string }> = [
  { key: 'volume', label: 'Volume' },
  { key: 'rsi', label: 'RSI' },
  { key: 'ma200', label: '200 MA' },
]

interface ChartPanelProps {
  className?: string
  symbol: string
  timeframe: TimeframeLabel
  indicators: Record<IndicatorKey, boolean>
  payload: ChartPayload | null
  loading: boolean
  failed: boolean
  onLoadSymbol: (symbol: string) => void
  onSetTimeframe: (timeframe: TimeframeLabel) => void
  onToggleIndicator: (key: IndicatorKey) => void
  dashboardActions?: {
    autoFollow: boolean
    canExport: boolean
    onToggleAutoFollow: () => void
    onExportOptions: () => void
  }
}

export function ChartPanel({
  className, symbol, timeframe, indicators, payload, loading, failed,
  onLoadSymbol, onSetTimeframe, onToggleIndicator, dashboardActions,
}: ChartPanelProps) {
  const [draft, setDraft] = useState(symbol)
  const [inspectedTime, setInspectedTime] = useState<number | null>(null)
  useEffect(() => setDraft(symbol), [symbol])
  useEffect(() => setInspectedTime(null), [symbol, timeframe])

  const candlesByTime = useMemo(() => new Map(payload?.candles.map(bar => [bar.time, bar])), [payload?.candles])
  const stats = payload?.stats
  const candle = (inspectedTime === null ? undefined : candlesByTime.get(inspectedTime)) ?? payload?.candles.at(-1)
  const bar = candle ?? stats
  const candleTime = candle && Number.isFinite(candle.time)
    ? new Date(candle.time * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : undefined
  const candleSource = [candleTime, stats?.source].filter(Boolean).join(' · ')

  return (
    <section className={`dashboard-price-chart${className ? ` ${className}` : ''}`} aria-label="Price chart">
      <div className="dashboard-price-chart-head">
        <div>
          <div className="dashboard-price-chart-instrument">
            <h2>{symbol}</h2>
            {stats?.longName && stats.longName !== symbol && <span title={stats.longName}>{stats.longName}</span>}
          </div>
          <div className="dashboard-price-chart-quote">
            <strong className="num" title={stats?.priceSource ?? stats?.source}>{quotePrice(stats?.price, stats?.currency)}</strong>
            {stats && <>
              <span className={`num ${stats.change >= 0 ? 'text-up' : 'text-down'}`}>
                {signedQuotePrice(stats.absChange, stats.currency)} ({percent(stats.change)})
              </span>
              <span className="text-text-muted">{stats.changeBasis === '24h' ? 'vs 24h ago' : 'vs prior bar'}</span>
              {stats.priceBasis === 'equity-perp-mark' && <span className="text-text-muted">Perp mark</span>}
            </>}
          </div>
        </div>
        <form className="dashboard-price-chart-ticker" onSubmit={event => {
          event.preventDefault()
          const next = draft.trim().toUpperCase()
          if (next) onLoadSymbol(next)
        }}>
          <input aria-label="Chart ticker" value={draft} spellCheck={false} onChange={event => setDraft(event.target.value)} />
          <Button variant="accent" type="submit">Load</Button>
        </form>
      </div>
      <div className="dashboard-price-chart-toolbar">
        <div className="dashboard-price-chart-controls" role="group" aria-label="Candle interval">
          {TIMEFRAMES.map(({ label, short }) => (
            <Button key={label} variant="toggle" active={label === timeframe} title={label} aria-label={label}
              onClick={() => onSetTimeframe(label)}>{short}</Button>
          ))}
        </div>
        <div className="dashboard-price-chart-controls" role="group" aria-label="Chart indicators">
          {INDICATORS.map(({ key, label }) => (
            <Button key={key} variant="toggle" active={indicators[key]} onClick={() => onToggleIndicator(key)}>{label}</Button>
          ))}
        </div>
        {dashboardActions && <div className="dashboard-price-chart-actions">
          <Button variant="toggle" active={dashboardActions.autoFollow} onClick={dashboardActions.onToggleAutoFollow}
            title="Follow the holding selected in the portfolio table">Auto</Button>
          <Button onClick={dashboardActions.onExportOptions} disabled={!dashboardActions.canExport}>Export Top Options</Button>
        </div>}
      </div>
      <div className="dashboard-price-chart-readouts num" aria-label="Candle prices" title={candleSource || undefined}>
        <span>O <b>{decimals(bar?.open, 2)}</b></span>
        <span>H <b>{decimals(bar?.high, 2)}</b></span>
        <span>L <b>{decimals(bar?.low, 2)}</b></span>
        <span>C <b>{decimals(bar?.close, 2)}</b></span>
        <span>Vol <b>{compactNumber(bar?.volume)}</b></span>
      </div>
      {dashboardActions && (indicators.ma200 || indicators.rsi) && (
        <div className="dashboard-price-chart-readouts num" role="group" aria-label="Indicator values">
          {indicators.ma200 && <span style={{ color: DASHBOARD_INDICATOR_COLORS.ma200 }}>
            MA200 {quotePrice(payload?.indicators.ma200.at(-1)?.value, stats?.currency)}
          </span>}
          {indicators.rsi && <>
            <span style={{ color: DASHBOARD_INDICATOR_COLORS.rsi }}>RSI(14) {decimals(payload?.indicators.rsi.at(-1)?.value, 2)}</span>
            <span>RSI MA(14) {decimals(payload?.indicators.rsiMa.at(-1)?.value, 2)}</span>
          </>}
        </div>
      )}
      {!failed && payload?.candles.length ? (
        <PriceChart key={payload.symbol} payload={payload} indicators={indicators} onInspect={setInspectedTime} />
      ) : (
        <PanelMessage>{failed ? 'History unavailable. See Settings for details.' :
          loading ? 'Loading chart…' : 'Price history unavailable.'}</PanelMessage>
      )}
    </section>
  )
}
