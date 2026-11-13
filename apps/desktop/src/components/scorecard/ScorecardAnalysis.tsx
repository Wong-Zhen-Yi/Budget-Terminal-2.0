import type { UseQueryResult } from '@tanstack/react-query'
import type { Envelope, FundamentalsPagePayload } from '@shared/contract'
import { scorecardBarDomain, SCORECARD_METRICS, type ScorecardMetricKey, type ScorecardRow } from '@shared/scorecard'
import { queryKeys } from '@/api/client'
import { queryFreshness } from '@/api/queryPersistence'
import { effectiveFreshness, errorMessage, useSnapshotClock } from '@/api/snapshotHealth'
import { DataFreshness } from '@/components/ui/DataFreshness'
import { Select } from '@/components/ui/Select'
import { scorecardMetricValue } from './format'

export type ScorecardView = 'chart' | 'method' | 'sources'
const views: ReadonlyArray<{ key: ScorecardView; label: string }> = [
  { key: 'chart', label: 'Chart' }, { key: 'method', label: 'Method' }, { key: 'sources', label: 'Sources' },
]

export function ScorecardAnalysis({ rows, queries, metric, onMetricChange, view, onViewChange }: {
  rows: ScorecardRow[]
  queries: UseQueryResult<Envelope<FundamentalsPagePayload>>[]
  metric: ScorecardMetricKey
  onMetricChange: (metric: ScorecardMetricKey) => void
  view: ScorecardView
  onViewChange: (view: ScorecardView) => void
}) {
  const now = useSnapshotClock()
  const definition = SCORECARD_METRICS.find(entry => entry.key === metric)!
  const available = rows.filter(row => row.values[metric] !== null).length
  const issues = queries.filter((query, index) => !query.isFetching && (query.error || !query.data || rows[index].issues.length
    || ['partial', 'stale', 'failed'].includes(effectiveFreshness(query.data, now, queryFreshness(queryKeys.fundamentalsPage(rows[index].symbol)))))).length

  return <aside className="scorecard-analysis" aria-label="Comparison analysis">
    <nav className="scorecard-analysis-tabs" aria-label="Analysis views">
      {views.map(tab => <button key={tab.key} aria-label={tab.label} aria-pressed={view === tab.key} onClick={() => onViewChange(tab.key)}>{tab.label}{tab.key === 'sources' && issues > 0 && <span className="scorecard-source-count">{issues}</span>}</button>)}
    </nav>
    <div className="scorecard-analysis-content">
      {view === 'chart' && <section className="scorecard-chart" aria-label="Metric comparison">
        <div className="scorecard-chart-header"><p className="scorecard-eyebrow">METRIC COMPARISON</p><h2>{definition.label}</h2>
          <Select value={metric} aria-label="Chart metric" onChange={onMetricChange} options={SCORECARD_METRICS.map(entry => ({ value: entry.key, label: entry.label }))} /></div>
        <ScorecardBars rows={rows} metric={metric} />
        <div className="scorecard-chart-notes"><p className="scorecard-caption">{definition.basis}</p><p>{available} of {rows.length} companies have comparable values.</p>
          {issues > 0 && <button className="scorecard-evidence-link" onClick={() => onViewChange('sources')}>Review source details ({issues}) →</button>}</div>
      </section>}
      {view === 'method' && <section className="scorecard-method"><p className="scorecard-eyebrow">COMPARISON GUIDE</p><h2>Read the numbers</h2>
        <dl><div><dt>FY · Annual performance</dt><dd>Each company’s latest reported fiscal year. Year ends can differ; check the date below each company name.</dd></div>
          <div><dt>TTM · Trailing valuation</dt><dd>Provider-reported trailing figures. Forward P/E uses forecast earnings. These periods can differ from annual financials.</dd></div>
          <div><dt>USD · Comparable currency</dt><dd>Financial amounts are normalized to USD by Fundamentals. Sources contains statement origins and currency conversions.</dd></div>
          <div><dt>N/A · Unavailable or not meaningful</dt><dd>Missing values remain empty of assumptions. Margins require matching fiscal periods. Nonpositive earnings multiples are hidden.</dd></div>
          <div><dt>Compare values, not scores</dt><dd>Sort arrows order companies numerically. Larger values are not always better; sector, growth, risk, and fiscal periods matter.</dd></div></dl>
      </section>}
      {view === 'sources' && <section className="scorecard-sources" aria-label="Source details"><p className="scorecard-eyebrow">EVIDENCE & COVERAGE</p><h2>Source details</h2>
        {queries.map((query, index) => {
          const row = rows[index]
          const failure = errorMessage(query.error)
          return <section key={row.symbol} className="scorecard-source"><h3>{row.symbol}<span>{Object.values(row.values).filter(value => value !== null).length}/{SCORECARD_METRICS.length} metrics</span></h3>
            <DataFreshness envelope={query.data} error={query.error} loading={query.isFetching} freshnessMs={queryFreshness(queryKeys.fundamentalsPage(row.symbol))} />
            {failure && query.data && <p role="status">Latest request could not refresh: {failure}. Previous financials remain displayed.</p>}
            <p className="scorecard-source-origin">{row.statementSources.length ? `Annual statements: ${row.statementSources.join(', ')}` : 'Annual statement sources unavailable'}</p>
            {row.currencyNote && <p>{row.currencyNote}</p>}
            {row.issues.length > 0 && <ul>{row.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
          </section>
        })}
      </section>}
    </div>
  </aside>
}

function ScorecardBars({ rows, metric }: { rows: ScorecardRow[]; metric: ScorecardMetricKey }) {
  if (rows.every(row => row.values[metric] === null)) return <p className="scorecard-empty" role="status">No comparable values are available for this metric. Choose another metric or review Sources.</p>
  const domain = scorecardBarDomain(rows.map(row => row.values[metric]))
  const span = domain.max - domain.min
  const label = SCORECARD_METRICS.find(entry => entry.key === metric)!.label
  return <div className={`scorecard-bars ${rows.length > 3 ? 'is-dense' : ''}`} role="img" aria-label={`${label}: ${rows.map(row => `${row.symbol} ${scorecardMetricValue(metric, row.values[metric])}`).join('; ')}`}>
    {rows.map(row => {
      const value = row.values[metric]
      const position = ((value ?? 0) - domain.min) / span * 100
      return <div key={row.symbol} className="scorecard-bar-row"><div><span>{row.symbol}</span><span className={`num ${value === null ? 'text-text-dim' : ''}`}>{scorecardMetricValue(metric, value)}</span></div>
        <div className="scorecard-bar-track"><span className="scorecard-bar-zero" style={{ left: `${domain.zero}%` }} />
          {value !== null && <span className={`scorecard-bar ${value < 0 ? 'is-negative' : ''}`} style={{ left: `${Math.min(position, domain.zero)}%`, width: `${Math.abs(position - domain.zero)}%` }} />}
        </div>
      </div>
    })}
    <div className="scorecard-axis"><span>{scorecardMetricValue(metric, domain.min)}</span><span>{scorecardMetricValue(metric, domain.max)}</span></div>
  </div>
}
