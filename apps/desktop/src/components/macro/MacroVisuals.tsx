import type { EconomicRow, EconomicYieldCurve } from '@shared/contract'
import { formatEconomicValue } from '@shared/economic'

export const MACRO_TREND_OBSERVATIONS = 12

export function MacroSparkline({ row }: { row?: EconomicRow }) {
  const points = row?.history.slice(-MACRO_TREND_OBSERVATIONS) ?? []
  const first = points[0]
  const last = points.at(-1)
  if (!row || points.length < 2 || !last) return <span className="macro-trend-empty" role="img" aria-label="Trend unavailable">—</span>

  const start = Date.parse(first[0])
  const span = Date.parse(last[0]) - start
  const values = points.map(([, value]) => value)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const format = (value: number) => formatEconomicValue(value, row.units, row.decimals)
  const summary = `${points.length} observations, ${first[0]} to ${last[0]}. Start ${format(first[1])}; latest ${format(last[1])}; range ${format(low)} to ${format(high)}.`
  const coordinates = points.map(([date, value]) => {
    const x = 3 + 94 * (Date.parse(date) - start) / span
    const y = high === low ? 12 : 21 - 18 * (value - low) / (high - low)
    return `${x},${y}`
  }).join(' ')

  return <svg className="macro-sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={summary}>
    <title>{summary}</title>
    <polyline points={coordinates} />
  </svg>
}

const benchmarks = [
  { id: 'DGS3MO', label: '3M' },
  { id: 'DGS2', label: '2Y' },
  { id: 'DGS5', label: '5Y' },
  { id: 'DGS10', label: '10Y' },
  { id: 'DGS30', label: '30Y' },
]

export function MacroTreasuryCurve({ curve }: { curve?: EconomicYieldCurve }) {
  const tenors = benchmarks.map(({ id }) => curve?.tenors.find(tenor => tenor.seriesId === id))
  const date = tenors.flatMap(tenor => tenor?.date ? [tenor.date] : []).sort().at(-1)
  const yields = tenors.map(tenor => date && tenor?.date === date ? tenor.yieldPct : null)
  const available = yields.filter(value => value !== null)
  const low = available.length ? Math.min(...available) : 0
  const high = available.length ? Math.max(...available) : 0
  const mid = (low + high) / 2
  // Give a nearly flat curve room around its midpoint to avoid exaggerating small changes.
  const span = Math.max(high - low, 0.25)
  const points = yields.map((value, index) => value === null ? null : {
    x: (index + 0.5) * 100 / benchmarks.length,
    y: 50 - 78 * (value - mid) / span,
  })
  const path = points.map((point, index) =>
    point ? `${points[index - 1] ? 'L' : 'M'}${point.x} ${point.y}` : '',
  ).join(' ')

  return <figure className="macro-curve">
    <figcaption><strong>Treasury yield curve</strong>{date && <time dateTime={date}>{date}</time>}</figcaption>
    {available.length ? <>
      <div className="macro-curve-plot" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path className="macro-curve-grid" d="M0 11H100 M0 50H100 M0 89H100" />
          <path className="macro-curve-line" d={path} />
        </svg>
        {points.map(point => point && <span key={point.x} style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}
      </div>
      <dl className="macro-curve-values">
        {benchmarks.map(({ id, label }, index) => <div key={id}>
          <dt>{label}</dt><dd>{formatEconomicValue(yields[index], 'percent', 2)}</dd>
        </div>)}
      </dl>
    </> : <p>Treasury yields unavailable.</p>}
  </figure>
}
