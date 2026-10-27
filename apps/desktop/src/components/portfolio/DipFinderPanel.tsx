import { useMemo, useState } from 'react'

import type { Portfolio, ReturnTimeframe } from '@shared/contract'
import { RETURN_TIMEFRAMES } from '@shared/contract'
import type { PositionRow } from '@shared/portfolioMath'
import { useReturns } from '@/api/portfolioQueries'
import { BarChart, type Bar } from '@/components/charts/BarChart'
import { colorForIndex } from '@/components/charts/Donut'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { percent, plainPercent } from '@/lib/format'

interface DipFinderPanelProps {
  rows: PositionRow[]
  visible: boolean
}

/** Per-holding return over a window or since entry — biggest dips sort to the right. */
export function DipFinderPanel({ rows, visible }: DipFinderPanelProps) {
  const [timeframe, setTimeframe] = useState<ReturnTimeframe | 'entry'>('1mo')
  const entryRows = useMemo(
    () => rows.filter((row) => row.includeInWeight && row.shares > 0),
    [rows],
  )
  const tickers = useMemo(() => entryRows.map((row) => row.ticker), [entryRows])
  const query = useReturns(tickers, timeframe === 'entry' ? '1mo' : timeframe, visible && timeframe !== 'entry')
  const unavailableEntryRows = entryRows.filter(
    (row) => !Number.isFinite(row.avgPrice) || row.avgPrice <= 0 || row.growth === null || !Number.isFinite(row.growth),
  )

  const bars: Bar[] = useMemo(() => {
    if (timeframe === 'entry') {
      return entryRows
        .filter((row) => Number.isFinite(row.avgPrice) && row.avgPrice > 0 && row.growth !== null && Number.isFinite(row.growth))
        .map((row) => ({ label: row.ticker, value: row.growth! }))
        .sort((a, b) => b.value - a.value)
    }
    const returns = query.data?.data.returns ?? {}
    return Object.entries(returns)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }))
  }, [entryRows, query.data, timeframe])

  return (
    <Panel
      title="Dip Finder"
      className="min-h-40 flex-1"
      actions={
        <div className="flex items-center gap-1">
          <Button
            variant="toggle"
            active={timeframe === 'entry'}
            onClick={() => setTimeframe('entry')}
            title="Gain or loss versus your average purchase price"
            className="h-6"
          >
            Entry
          </Button>
          {RETURN_TIMEFRAMES.map((entry) => (
            <Button
              key={entry.key}
              variant="toggle"
              active={entry.key === timeframe}
              onClick={() => setTimeframe(entry.key)}
              className="h-6"
            >
              {entry.label}
            </Button>
          ))}
        </div>
      }
    >
      {timeframe === 'entry' ? (
        <div className="shrink-0 px-2 py-1 text-2xs text-text-muted">
          Gain/loss vs. average purchase price: (current price / average price − 1) × 100%.
          {unavailableEntryRows.length > 0 ? (
            <span className="text-down"> Unavailable (quote missing or average price invalid): {unavailableEntryRows.map((row) => row.ticker).join(', ')}.</span>
          ) : null}
        </div>
      ) : null}
      <BarChart
        bars={bars}
        format={(value) => percent(value, 1)}
        empty={timeframe === 'entry' ? 'No positions with a quote and positive average price' : query.isFetching ? 'Loading returns...' : 'No return data'}
        minBarWidth={48}
      />
    </Panel>
  )
}

/** Share of the portfolio per position, cash included when it counts toward weight. */
export function WeightPanel({ portfolio, rows }: { portfolio: Portfolio; rows: PositionRow[] }) {
  const bars: Bar[] = useMemo(() => {
    if (rows.some(row => row.includeInWeight && row.marketValue === null)) return []
    const included = rows.filter((row) => row.includeInWeight && row.marketValue !== null && row.marketValue > 0)
    const cash = portfolio.includeCashInWeight ? Math.max(portfolio.cashBalance, 0) : 0
    const total = included.reduce((sum, row) => sum + (row.marketValue ?? 0), 0) + cash
    if (total <= 0) return []

    const entries = included.map((row) => ({
      label: row.ticker,
      value: ((row.marketValue ?? 0) / total) * 100,
    }))
    if (cash > 0) entries.push({ label: 'CASH', value: (cash / total) * 100 })

    return entries
      .sort((a, b) => b.value - a.value)
      .map((entry, index) => ({ ...entry, color: colorForIndex(index) }))
  }, [portfolio, rows])

  return (
    <Panel title="Portfolio Weight" className="min-h-40 flex-1">
      <BarChart
        bars={bars}
        signed={false}
        format={(value) => plainPercent(value)}
        empty={rows.some(row => row.includeInWeight && row.marketValue === null) ? 'Market marks missing; allocation unavailable' : 'No weighted positions'}
        minBarWidth={48}
      />
    </Panel>
  )
}
