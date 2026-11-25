import type { TargetRow } from '@shared/contract'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel } from '@/components/ui/Panel'
import { currency, percent } from '@/lib/format'

const NA = 'N/A'

/**
 * Analyst mean targets for the holdings on screen. ETFs have none — they show `N/A`
 * rather than an error, matching the reference app.
 */
export function TargetsPanel({
  targets,
  loading,
  warning,
  className,
  activeTicker,
  onSelectTicker,
}: {
  targets: TargetRow[]
  loading: boolean
  warning?: string
  className?: string
  activeTicker?: string
  onSelectTicker?: (ticker: string) => void
}) {
  const columns: Array<Column<TargetRow>> = [
    {
      key: 'ticker', header: 'Ticker', cell: row => activeTicker && onSelectTicker
        ? <button type="button" className="dashboard-lite-ticker" aria-current={row.ticker === activeTicker || undefined}>{row.ticker}</button>
        : row.ticker,
    },
    {
      key: 'current',
      header: 'Current',
      align: 'right',
      numeric: true,
      cell: (row) => currency(row.current),
    },
    {
      key: 'target',
      header: 'Target',
      align: 'right',
      numeric: true,
      cell: (row) => (row.target === null ? NA : currency(row.target)),
      // Why a target is missing matters: an ETF never has one.
    },
    {
      key: 'upside',
      header: 'Upside (%)',
      align: 'right',
      numeric: true,
      cell: (row) =>
        row.upside === null ? (
          <span
            className="text-text-dim"
            title={row.unavailableReason === 'etf' ? 'ETFs have no analyst target' : undefined}
          >
            {NA}
          </span>
        ) : (
          <span className={row.upside >= 0 ? 'text-up' : 'text-down'}>
            {percent(row.upside, 1)}
          </span>
        ),
    },
  ]

  return (
    <Panel title="Analyst Price Targets" warning={warning} className={className}>
      <DataTable
        columns={columns}
        rows={targets}
        rowKey={(row) => row.ticker} rowSymbol={(row) => row.ticker}
        showIndex={!activeTicker}
        onRowClick={onSelectTicker ? row => onSelectTicker(row.ticker) : undefined}
        rowClassName={activeTicker ? row => row.ticker === activeTicker ? 'dashboard-lite-active-row' : '' : undefined}
        empty={loading ? 'Loading targets...' : 'No targets for these holdings'}
      />
    </Panel>
  )
}
