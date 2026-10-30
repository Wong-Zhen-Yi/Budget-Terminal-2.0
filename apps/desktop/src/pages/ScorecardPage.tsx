import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  buildScorecardRow, parseScorecardSymbols, scorecardBarDomain, SCORECARD_METRICS,
  type ScorecardMetricKey, type ScorecardRow,
} from '@shared/scorecard'
import { queryKeys } from '@/api/client'
import { queryFreshness } from '@/api/queryPersistence'
import { loadScorecardCompany, useScorecardCompanies } from '@/api/scorecardQueries'
import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { DataFreshness } from '@/components/ui/DataFreshness'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Select } from '@/components/ui/Select'
import { compactCurrency, decimals } from '@/lib/format'
import { useScorecard } from '@/stores/scorecard'
import '@/styles/scorecard.css'

function metricValue(key: ScorecardMetricKey, value: number | null): string {
  if (value === null) return 'N/A'
  const metric = SCORECARD_METRICS.find(entry => entry.key === key)!
  return metric.format === 'money' ? compactCurrency(value)
    : metric.format === 'percent' ? `${decimals(value, 1)}%` : `${decimals(value, 2)}x`
}

export function ScorecardPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate?: (page: string, symbol?: string) => void
}) {
  const state = useScorecard()
  const { symbols, columns: selectedColumns, chartMetric, comparisons, selectedId } = state
  const queries = useScorecardCompanies(symbols)
  const client = useQueryClient()
  const now = useSnapshotClock()
  const [draft, setDraft] = useState(symbols.join(', '))
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const selected = comparisons.find(entry => entry.id === selectedId)
  const symbolSignature = symbols.join(',')
  useEffect(() => setDraft(symbols.join(', ')), [symbolSignature])
  useEffect(() => setName(selected?.name ?? ''), [selected?.id, selected?.name])

  // Query result arrays have a new identity each render. Report only actual status changes.
  const statusSignature = JSON.stringify(queries.map(query => [query.dataUpdatedAt, query.errorUpdatedAt, query.fetchStatus, query.status]))
  useEffect(() => {
    onStatusChange(queries.map((query, index) => ({ label: `Scorecard ${symbols[index]}`,
      envelope: query.data, error: query.error, loading: query.isFetching, enabled: true })), '')
  }, [onStatusChange, symbolSignature, statusSignature])

  const rows = symbols.map((symbol, index) => buildScorecardRow(symbol, queries[index]?.data?.data, now))
  const loading = queries.some(query => query.isFetching)
  const draftSymbols = parseScorecardSymbols(draft)
  const unapplied = Boolean(draftSymbols.error) || draftSymbols.symbols.join(',') !== symbolSignature
  const modified = selected && (selected.symbols.join(',') !== symbolSignature
    || selected.columns.join(',') !== selectedColumns.join(',') || selected.chartMetric !== chartMetric)
  const availableCount = rows.filter(row => Object.values(row.values).some(value => value !== null)).length
  const problemCount = queries.filter((query, index) => query.error || !query.data || rows[index].issues.length
    || ['partial', 'stale', 'failed'].includes(effectiveFreshness(query.data, now, queryFreshness(queryKeys.fundamentalsPage(symbols[index]))))).length

  const compare = () => {
    setMessage(''); setError('')
    if (draftSymbols.error) { setError(draftSymbols.error); return }
    state.setSymbols(draftSymbols.symbols)
  }
  const refresh = async () => {
    setRefreshing(true); setMessage(''); setError('')
    try {
      const results = await Promise.allSettled(symbols.map(symbol => client.fetchQuery({
        queryKey: queryKeys.fundamentalsPage(symbol), queryFn: () => loadScorecardCompany(symbol, { force: true }), staleTime: 0,
      })))
      const failures = results.filter(result => result.status === 'rejected').length
      const degraded = results.filter((result, index) => result.status === 'fulfilled' && (
        ['partial', 'stale', 'failed'].includes(effectiveFreshness(result.value, Date.now(), queryFreshness(queryKeys.fundamentalsPage(symbols[index]))))
        || result.value.errors.length > 0 || result.value.data.warnings.length > 0)).length
      if (failures) setError(`${failures} compan${failures === 1 ? 'y' : 'ies'} could not refresh. Retained values and source issues are shown below.`)
      else if (degraded) setMessage(`Refreshed with source issues for ${degraded} compan${degraded === 1 ? 'y' : 'ies'}. Review Source details.`)
      else setMessage('All company financials refreshed.')
    } finally { setRefreshing(false) }
  }
  const save = () => {
    setError(''); setMessage('')
    if (unapplied) { setError('Compare the entered tickers before saving.'); return }
    const failure = state.saveComparison(name)
    if (failure) setError(failure)
    else setMessage(`Saved “${name.trim()}” locally. Saving the same name updates that comparison.`)
  }

  const tableColumns: Array<Column<ScorecardRow>> = [{
    key: 'company', header: <button type="button" aria-label="Sort by company">Company</button>, wrap: true, width: '250px', sortValue: row => row.symbol,
    cell: row => <div className="scorecard-company">
      <div className="scorecard-symbol">{onNavigate ? <button onClick={() => onNavigate('stocks', row.symbol)} title={`Open ${row.symbol} in Stocks`}>{row.symbol}</button> : row.symbol}</div>
      <span>{row.name}</span>
      {row.sector && <span className="text-text-muted">{row.sector}</span>}
      {onNavigate && <div className="scorecard-links"><button onClick={() => onNavigate('fundamentals', row.symbol)}>Fundamentals</button><button onClick={() => onNavigate('valuation', row.symbol)}>Valuation</button></div>}
    </div>,
  }, {
    key: 'fiscalEnd', header: <button type="button" aria-label="Sort by fiscal year ended">Fiscal year ended</button>, width: '150px', sortValue: row => row.fiscalEnd,
    cell: row => <span title="The fiscal period used for annual revenue, growth, margins, and cash flow.">{row.fiscalEnd ?? 'Unavailable'}</span>,
  }, ...SCORECARD_METRICS.filter(metric => selectedColumns.includes(metric.key)).map(metric => ({
    key: metric.key, header: <button type="button" title={metric.basis} aria-label={`Sort by ${metric.label}`}>{metric.label}</button>, numeric: true, align: 'right' as const,
    width: '155px', sortValue: (row: ScorecardRow) => row.values[metric.key],
    cell: (row: ScorecardRow) => <span className={row.values[metric.key] === null ? 'text-text-dim' : ''} title={row.values[metric.key] === null ? `Unavailable or not meaningful. ${metric.basis}` : metric.basis}>{metricValue(metric.key, row.values[metric.key])}</span>,
  }))]

  return <div className="scorecard-page">
    <header className="scorecard-heading">
      <div><p className="scorecard-eyebrow">RESEARCH / COMPANY COMPARISON</p><h1>Scorecard</h1><p>Compare business performance and valuation across 3–6 companies.</p></div>
      <div className="scorecard-saved"><Select value={selectedId} options={[{ value: '', label: 'Saved comparisons' }, ...comparisons.map(entry => ({ value: entry.id, label: entry.name }))]}
        aria-label="Saved scorecards" onChange={id => { if (id) state.loadComparison(id); setError(''); setMessage('') }} />
        <span>{selected ? modified ? 'Unsaved changes' : 'Saved locally' : 'Current comparison'}</span></div>
    </header>

    <section className="scorecard-toolbar" aria-label="Comparison controls">
      <form className="scorecard-tickers" onSubmit={event => { event.preventDefault(); compare() }}>
        <label htmlFor="scorecard-tickers">Company tickers</label>
        <div><input id="scorecard-tickers" value={draft} onChange={event => setDraft(event.target.value.toUpperCase())} maxLength={90} spellCheck={false} autoComplete="off" placeholder="AMZN, MSFT, GOOGL" />
          <Button type="submit" variant="accent">Compare</Button><Button onClick={() => void refresh()} disabled={loading || refreshing}>{loading || refreshing ? 'Loading…' : 'Refresh'}</Button></div>
      </form>
      <form className="scorecard-save" onSubmit={event => { event.preventDefault(); save() }}>
        <label htmlFor="scorecard-name">Save or update by name</label>
        <div><input id="scorecard-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="Name this comparison" />
          <Button type="submit" disabled={unapplied}>Save</Button><Button disabled={!selectedId} onClick={() => { state.deleteComparison(selectedId); setMessage('Saved comparison deleted. Current tickers remain displayed.'); setError('') }}>Delete</Button></div>
      </form>
    </section>
    <div className="scorecard-feedback" aria-live="polite">
      {error ? <p role="alert" className="text-down">{error}</p> : message ? <p>{message}</p>
        : <p>{loading ? 'Loading company financials…' : `${availableCount} of ${symbols.length} companies have financial data`}{problemCount ? ` · ${problemCount} with unavailable data or source issues; review Source details.` : ' · USD financials'}{unapplied ? ' · Compare to apply the entered tickers.' : ''}</p>}
    </div>

    <details className="scorecard-columns"><summary>Choose metrics <span>({selectedColumns.length} selected)</span></summary>
      <div className="scorecard-column-options">{SCORECARD_METRICS.map(metric => <Checkbox key={metric.key} label={metric.label} checked={selectedColumns.includes(metric.key)} title={metric.basis}
        disabled={selectedColumns.length === 1 && selectedColumns.includes(metric.key)} onChange={() => state.toggleColumn(metric.key)} />)}</div>
    </details>

    <section className="scorecard-table" aria-label="Company comparison table">
      <DataTable columns={tableColumns} rows={rows} rowKey={row => row.symbol} minWidth={`${400 + selectedColumns.length * 155}px`} layout="fixed" />
    </section>

    <section className="scorecard-bottom">
      <div className="scorecard-chart">
        <div className="scorecard-section-heading"><h2>Metric comparison</h2><Select value={chartMetric} aria-label="Chart metric" onChange={state.setChartMetric}
          options={SCORECARD_METRICS.map(metric => ({ value: metric.key, label: metric.label }))} /></div>
        <ScorecardBars rows={rows} metric={chartMetric} />
        <p className="scorecard-caption">{SCORECARD_METRICS.find(metric => metric.key === chartMetric)?.basis}</p>
      </div>
      <div className="scorecard-method">
        <h2>Read the comparison</h2>
        <p><strong>FY</strong> uses each company’s latest reported fiscal year. Year ends can differ; check the date beside each company.</p>
        <p><strong>TTM</strong> uses provider-reported trailing figures. Forward P/E uses forecast earnings.</p>
        <p><strong>N/A</strong> means a value is missing or not meaningful. Margins require revenue and cash flow or income from the same fiscal period.</p>
        <p>Financial amounts are normalized to USD by Fundamentals. Use Source details to review observation times, statement sources, and currency conversions.</p>
      </div>
    </section>

    <details className="scorecard-sources"><summary>Source details <span>· freshness, currency conversions, and coverage</span></summary>
      {queries.map((query, index) => <section key={symbols[index]} className="scorecard-source">
        <h3>{symbols[index]} <span>{rows[index].statementSources.length ? `Annual statements: ${rows[index].statementSources.join(', ')}` : 'Annual statement sources unavailable'}</span></h3>
        <DataFreshness envelope={query.data} error={query.error} loading={query.isFetching} freshnessMs={queryFreshness(queryKeys.fundamentalsPage(symbols[index]))}
          coverage={`${Object.values(rows[index].values).filter(value => value !== null).length}/${SCORECARD_METRICS.length} metrics`} />
        {rows[index].currencyNote && <p>{rows[index].currencyNote}</p>}
        {rows[index].issues.length > 0 && <ul>{rows[index].issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
      </section>)}
    </details>
  </div>
}

function ScorecardBars({ rows, metric }: { rows: ScorecardRow[]; metric: ScorecardMetricKey }) {
  if (rows.every(row => row.values[metric] === null)) {
    return <p className="scorecard-caption" role="status">No comparable values are available for this metric. Choose another metric or review Source details.</p>
  }
  const domain = scorecardBarDomain(rows.map(row => row.values[metric]))
  const span = domain.max - domain.min
  const label = SCORECARD_METRICS.find(entry => entry.key === metric)!.label
  return <div className="scorecard-bars" role="img" aria-label={`${label}: ${rows.map(row => `${row.symbol} ${metricValue(metric, row.values[metric])}`).join('; ')}`}>
    {rows.map(row => {
      const value = row.values[metric]
      const position = ((value ?? 0) - domain.min) / span * 100
      return <div key={row.symbol} className="scorecard-bar-row">
        <span>{row.symbol}</span><div className="scorecard-bar-track"><span className="scorecard-bar-zero" style={{ left: `${domain.zero}%` }} />
          {value !== null && <span className={`scorecard-bar ${value < 0 ? 'is-negative' : ''}`} style={{ left: `${Math.min(position, domain.zero)}%`, width: `${Math.abs(position - domain.zero)}%` }} />}
        </div><span className="num">{metricValue(metric, value)}</span>
      </div>
    })}
    <div className="scorecard-axis"><span>{metricValue(metric, domain.min)}</span><span>{metricValue(metric, domain.max)}</span></div>
  </div>
}
