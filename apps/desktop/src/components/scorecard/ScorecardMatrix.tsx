import { useEffect, useRef, useState } from 'react'
import { SCORECARD_METRICS, type ScorecardMetricKey, type ScorecardRow } from '@shared/scorecard'
import { Checkbox } from '@/components/ui/Checkbox'
import { useScorecard } from '@/stores/scorecard'
import { scorecardMetricValue } from './format'

const metricGroups: ReadonlyArray<{ label: string; keys: readonly ScorecardMetricKey[] }> = [
  { label: 'Scale & growth', keys: ['marketCap', 'revenue', 'revenueGrowth'] },
  { label: 'Profitability & cash', keys: ['netMargin', 'fcfMargin', 'freeCashFlow', 'fcfYield', 'netCash'] },
  { label: 'Valuation & risk', keys: ['trailingPe', 'forwardPe', 'priceToSales', 'evEbitda', 'beta'] },
]

export function ScorecardMatrix({ rows, columns, chartMetric, onSelectMetric, onNavigate }: {
  rows: ScorecardRow[]
  columns: ScorecardMetricKey[]
  chartMetric: ScorecardMetricKey
  onSelectMetric: (metric: ScorecardMetricKey) => void
  onNavigate?: (page: string, symbol?: string) => void
}) {
  const toggleColumn = useScorecard(state => state.toggleColumn)
  const picker = useRef<HTMLDetailsElement>(null)
  const [sort, setSort] = useState<{ key: ScorecardMetricKey; direction: 'asc' | 'desc' } | null>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (picker.current && !picker.current.contains(event.target as Node)) picker.current.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  // Nulls always follow comparable values, in either direction. Source order breaks ties.
  const ordered = sort ? [...rows].sort((left, right) => {
    const a = left.values[sort.key]
    const b = right.values[sort.key]
    if (a === null) return b === null ? 0 : 1
    if (b === null) return -1
    return (a - b) * (sort.direction === 'asc' ? 1 : -1)
  }) : rows

  return <section className="scorecard-matrix-panel" aria-label="Company comparison">
    <div className="scorecard-section-heading">
      <div><h2>Comparison matrix</h2><span>{rows.length} companies · {columns.length} metrics · USD</span></div>
      <details ref={picker} className="scorecard-columns" onKeyDown={event => {
        if (event.key === 'Escape' && picker.current) {
          picker.current.open = false
          picker.current.querySelector('summary')?.focus()
          event.stopPropagation()
        }
      }}>
        <summary>Metrics <span>{columns.length}</span></summary>
        <div className="scorecard-column-options">
          {metricGroups.map(group => <fieldset key={group.label}><legend>{group.label}</legend>
            {SCORECARD_METRICS.filter(metric => group.keys.includes(metric.key)).map(metric => <Checkbox key={metric.key} label={metric.label}
              checked={columns.includes(metric.key)} title={metric.basis} disabled={columns.length === 1 && columns.includes(metric.key)} onChange={() => toggleColumn(metric.key)} />)}
          </fieldset>)}
        </div>
      </details>
    </div>
    <div className="scorecard-table" tabIndex={0} role="region" aria-label="Company comparison table">
      <table>
        <caption className="sr-only">Company financial comparison in USD. Select a metric to chart it; sort buttons reorder companies by numeric value.</caption>
        <colgroup><col className="scorecard-metric-column" />{ordered.map(row => <col key={row.symbol} />)}</colgroup>
        <thead><tr><th scope="col" className="scorecard-corner"><span>FINANCIAL METRICS</span><p>Latest fiscal year</p></th>
          {ordered.map(row => <th key={row.symbol} scope="col" data-company={row.symbol}>
            <div className="scorecard-company">
              {onNavigate ? <button className="scorecard-symbol" onClick={() => onNavigate('stocks', row.symbol)} title={`Open ${row.symbol} in Stocks`}>{row.symbol}<span aria-hidden="true"> ↗</span></button> : <span className="scorecard-symbol">{row.symbol}</span>}
              <span className="scorecard-company-name" title={row.name}>{row.name}</span>
              <span className="scorecard-company-sector" title={row.sector}>{row.sector || 'Sector unavailable'}</span>
              <span className="scorecard-fiscal">FY {row.fiscalEnd ?? 'unavailable'}</span>
              {onNavigate && <div className="scorecard-links"><button onClick={() => onNavigate('fundamentals', row.symbol)}>Fundamentals</button><button onClick={() => onNavigate('valuation', row.symbol)}>Valuation</button></div>}
            </div>
          </th>)}
        </tr></thead>
        {metricGroups.map(group => {
          const metrics = SCORECARD_METRICS.filter(metric => group.keys.includes(metric.key) && columns.includes(metric.key))
          if (!metrics.length) return null
          return <tbody key={group.label}>
            <tr className="scorecard-group"><th colSpan={ordered.length + 1} scope="rowgroup">{group.label}</th></tr>
            {metrics.map(metric => <tr key={metric.key} data-metric={metric.key} className={chartMetric === metric.key ? 'is-selected' : ''}>
              <th scope="row" aria-sort={sort?.key === metric.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : undefined}><div className="scorecard-metric-label">
                <button title={`${metric.basis} Select to chart.`} aria-pressed={chartMetric === metric.key} onClick={() => onSelectMetric(metric.key)}>{metric.label}</button>
                <button className="scorecard-sort" aria-label={`Sort by ${metric.label}`} title={`Sort companies by ${metric.label}${sort?.key === metric.key ? ` (${sort.direction})` : ''}`}
                  onClick={() => setSort(current => ({ key: metric.key, direction: current?.key === metric.key && current.direction === 'desc' ? 'asc' : 'desc' }))}>
                  {sort?.key === metric.key ? sort.direction === 'desc' ? '↓' : '↑' : '↕'}
                </button>
              </div></th>
              {ordered.map(row => <td key={row.symbol} className={`num ${row.values[metric.key] === null ? 'is-missing' : row.values[metric.key]! < 0 ? 'is-negative' : ''}`}
                title={`${row.symbol}: ${metric.basis}${row.values[metric.key] === null ? ' Unavailable or not meaningful.' : ''}`}>{scorecardMetricValue(metric.key, row.values[metric.key])}</td>)}
            </tr>)}
          </tbody>
        })}
      </table>
    </div>
    <div className="scorecard-matrix-footer"><span>Select a metric to chart it.</span>
      {sort ? <button onClick={() => setSort(null)}>Reset company order</button> : <span>↕ Sort companies by value</span>}
    </div>
  </section>
}
