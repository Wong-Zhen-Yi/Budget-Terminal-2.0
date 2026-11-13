import { useEffect, useState } from 'react'
import { buildScorecardRow } from '@shared/scorecard'
import { useScorecardCompanies, useRefreshScorecard } from '@/api/scorecardQueries'
import { useSnapshotClock } from '@/api/snapshotHealth'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { ScorecardControls } from '@/components/scorecard/ScorecardControls'
import { ScorecardMatrix } from '@/components/scorecard/ScorecardMatrix'
import { ScorecardAnalysis, type ScorecardView } from '@/components/scorecard/ScorecardAnalysis'
import { Button } from '@/components/ui/Button'
import { useScorecard } from '@/stores/scorecard'
import '@/styles/scorecard.css'

export function ScorecardPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate?: (page: string, symbol?: string) => void
}) {
  const { symbols, columns, chartMetric, setChartMetric } = useScorecard()
  const queries = useScorecardCompanies(symbols)
  const refresh = useRefreshScorecard()
  const now = useSnapshotClock()
  const [view, setView] = useState<ScorecardView>('chart')
  const symbolSignature = symbols.join(',')
  // Query arrays change identity each render; publish only actual health changes.
  const statusSignature = JSON.stringify(queries.map(query => [query.dataUpdatedAt, query.errorUpdatedAt, query.fetchStatus, query.status]))
  useEffect(() => {
    onStatusChange(queries.map((query, index) => ({ label: `Scorecard ${symbols[index]}`,
      envelope: query.data, error: query.error, loading: query.isFetching, enabled: true })), '')
  }, [onStatusChange, symbolSignature, statusSignature])

  const rows = symbols.map((symbol, index) => buildScorecardRow(symbol, queries[index]?.data?.data, now))
  const loading = queries.some(query => query.isFetching)

  return <div className="scorecard-page">
    <header className="scorecard-heading">
      <div><p className="scorecard-eyebrow">RESEARCH / COMPANY COMPARISON</p><h1>Scorecard</h1></div>
      <p>Business performance, side by side.</p>
      <Button disabled={loading} onClick={() => { void refresh(symbols) }}>{loading ? 'Loading…' : 'Refresh'}</Button>
    </header>
    <ScorecardControls />
    <div className="scorecard-workspace">
      <ScorecardMatrix rows={rows} columns={columns} chartMetric={chartMetric} onNavigate={onNavigate}
        onSelectMetric={metric => { setChartMetric(metric); setView('chart') }} />
      <ScorecardAnalysis rows={rows} queries={queries} metric={chartMetric} onMetricChange={setChartMetric} view={view} onViewChange={setView} />
    </div>
  </div>
}
