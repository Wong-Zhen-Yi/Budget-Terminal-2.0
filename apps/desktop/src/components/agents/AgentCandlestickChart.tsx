import { useId, useState } from 'react'
import { agentChartSymbolSchema } from '@shared/agentCharts'
import type { AgentCandlestick } from '@shared/agentCharts'
import { AgentMarketChart } from './AgentMarketChart'

const number = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 })

export function AgentCandlestickChart({ chart }: { chart: AgentCandlestick }) {
  const [manualSymbol, setManualSymbol] = useState('')
  const symbol = chart.symbol || manualSymbol
  if (symbol) return <AgentMarketChart key={symbol} chart={chart} symbol={symbol} />
  return chart.candles ? <ProvidedCandlestickChart chart={chart} candles={chart.candles} onLoadHistory={setManualSymbol} /> : null
}

function ProvidedCandlestickChart({ chart, candles, onLoadHistory }: {
  chart: AgentCandlestick; candles: NonNullable<AgentCandlestick['candles']>; onLoadHistory: (symbol: string) => void
}) {
  const titleId = useId()
  const [symbol, setSymbol] = useState('')
  const [error, setError] = useState('')
  const low = Math.min(...candles.map(candle => candle.low))
  const high = Math.max(...candles.map(candle => candle.high))
  // Normalize before subtracting so even extreme finite prices cannot overflow.
  const scale = Math.max(Math.abs(low), Math.abs(high)) || 1
  const bottom = low / scale
  const top = high / scale
  const span = top > bottom ? top - bottom : 0.02
  const center = bottom + (top - bottom) / 2
  const y = (price: number) => 24 + (center + span * 0.55 - price / scale) / (span * 1.1) * 220
  const width = Math.max(400, candles.length * 9 + 100)
  const plotWidth = width - 100
  const step = plotWidth / candles.length
  const bodyWidth = Math.min(16, step * 0.65)
  const x = (index: number) => 16 + step * (index + 0.5)
  const ticks = [...new Set([0, ...(width > 600 ? [Math.floor((candles.length - 1) / 2)] : []), candles.length - 1])]

  return <figure className="agents-candlestick" aria-labelledby={titleId}>
    <figcaption id={titleId}>{chart.title}{chart.unit && <span> · {chart.unit}</span>}</figcaption>
    <p className="agents-history-warning">Provided data only ({candles.length} bars), not full market history. Enter the actual ticker to load an interactive full-history chart.</p>
    <form className="agents-history-controls" onSubmit={event => {
      event.preventDefault()
      const parsed = agentChartSymbolSchema.safeParse(symbol)
      if (parsed.success) onLoadHistory(parsed.data)
      else setError('Enter a valid market ticker, not a URL or path.')
    }}>
      <input aria-label={`${chart.title} history symbol`} placeholder="Ticker, e.g. AAPL" maxLength={32} value={symbol} onChange={event => { setSymbol(event.target.value); setError('') }} />
      <button type="submit">Load full history</button>
      {error && <span role="alert">{error}</span>}
    </form>
    <div className="agents-candlestick-plot" tabIndex={0} role="region" aria-label={`${chart.title} chart, scroll horizontally for more candles`}>
      <svg viewBox={`0 0 ${width} 300`} style={{ minWidth: width }} role="img" aria-label={`${chart.title}: candlestick chart. Rising candles are green; falling candles are red. Exact OHLC values in the table below.`}>
        {[0, 1, 2, 3, 4].map(index => {
          // Convex interpolation stays finite even when low/high have opposite signs.
          const fraction = index / 4
          const price = low * (1 - fraction) + high * fraction
          if (low === high && index !== 2) return null
          return <g key={index} className="agents-candlestick-axis">
            <line x1={16} x2={width - 84} y1={y(price)} y2={y(price)} />
            <text x={width - 78} y={y(price) + 4}>{number.format(price)}</text>
          </g>
        })}
        {candles.map((candle, index) => <g key={candle.time} className={`agents-candle ${candle.close >= candle.open ? 'up' : 'down'}`}>
          <title>{`${candle.time} · Open ${candle.open} · High ${candle.high} · Low ${candle.low} · Close ${candle.close}${chart.unit ? ` ${chart.unit}` : ''}`}</title>
          <line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} />
          <rect x={x(index) - bodyWidth / 2} y={Math.min(y(candle.open), y(candle.close))} width={bodyWidth} height={Math.max(1, Math.abs(y(candle.open) - y(candle.close)))} />
        </g>)}
        {ticks.map(index => {
          const time = candles[index].time
          const labelX = index === 0 ? 16 : index === candles.length - 1 ? width - 84 : x(index)
          return <text key={index} className="agents-candlestick-time" x={labelX} y={270} textAnchor={index === 0 ? 'start' : index === candles.length - 1 ? 'end' : 'middle'}>
            {time.slice(0, 10)}
            {time.includes('T') && <tspan x={labelX} dy={14}>{time.slice(11, 19)} UTC</tspan>}
          </text>
        })}
      </svg>
    </div>
    <p className="agents-candlestick-legend">Green: close ≥ open · Red: close &lt; open · Bars spaced by trading period{candles.some(candle => candle.time.includes('T')) ? ' · Times in UTC' : ''}</p>
    {chart.caption && <p className="agents-candlestick-caption">{chart.caption}</p>}
    <details className="agents-candlestick-data">
      <summary>Show OHLC data ({candles.length} candles)</summary>
      <div tabIndex={0} role="region" aria-label={`${chart.title} exact OHLC values`}>
        <table>
          <thead><tr>{['Time', 'Open', 'High', 'Low', 'Close'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{candles.map(candle => <tr key={candle.time}>
            <th scope="row">{candle.time}</th>
            {[candle.open, candle.high, candle.low, candle.close].map((price, index) => <td key={index}>{String(price)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </figure>
}
