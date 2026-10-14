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

/** Per-holding return over the window — the biggest dips sort to the right. */
export function DipFinderPanel({ rows, visible }: DipFinderPanelProps) {
  const [timeframe, setTimeframe] = useState<ReturnTimeframe>('1mo')
  const tickers = useMemo(
    () => rows.filter((row) => row.includeInWeight && row.shares > 0).map((row) => row.ticker),
    [rows],
  )
  const query = useReturns(tickers, timeframe, visible)

  const bars: Bar[] = useMemo(() => {
    const returns = query.data?.data.returns ?? {}
    return Object.entries(returns)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }))
  }, [query.data])

  return (
    <Panel
      title="Dip Finder"
      className="min-h-40 flex-1"
      actions={
        <div className="flex items-center gap-1">
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
      <BarChart
        bars={bars}
        format={(value) => percent(value, 1)}
        empty={query.isFetching ? 'Loading returns...' : 'No return data'}
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
