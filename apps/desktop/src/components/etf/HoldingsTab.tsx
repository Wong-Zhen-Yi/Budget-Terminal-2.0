import { useMemo } from 'react'

import type { EtfHoldingRow } from '@shared/contract'
import { buildDonut, etfWeight, filterHoldings } from '@shared/etf'
import { Donut } from '@/components/charts/Donut'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { SearchInput } from '@/components/ui/SearchInput'

/**
 * The Holdings subtab: the filter row, the table and the breakdown donut beside it.
 *
 * The reference splits the row 3:2 between the table and the chart; the same ratio here.
 * Double-clicking a row opens the holding in Charts, as `_p13_open_holding_in_charts`
 * does — the Heatmap page's tiles use the same hand-off.
 */
export function HoldingsTab({
  holdings,
  filter,
  onFilterChange,
  onOpenSymbol,
  loading,
}: {
  holdings: EtfHoldingRow[]
  filter: string
  onFilterChange: (value: string) => void
  onOpenSymbol: (symbol: string) => void
  loading: boolean
}) {
  const rows = useMemo(() => filterHoldings(holdings, filter), [holdings, filter])
  // The donut is built from every loaded row, not the filtered ones: it describes the
  // fund, and narrowing it to a search would make the coverage centre meaningless.
  const donut = useMemo(() => buildDonut(holdings), [holdings])

  const columns: Array<Column<EtfHoldingRow>> = [
    { key: 'symbol', header: 'Ticker', cell: (row) => row.symbol, sortValue: (row) => row.symbol },
    {
      key: 'name',
      header: 'Name',
      width: '100%',
      cell: (row) => <span className="text-text-muted">{row.name}</span>,
      sortValue: (row) => row.name,
    },
    {
      key: 'weight',
      header: 'Weight',
      align: 'right',
      numeric: true,
      cell: (row) => <span className="text-up">{etfWeight(row.weight)}</span>,
      // A null weight sorts last in both directions, so the Yahoo fallback's unweighted
      // rows never displace a real one at the top of the table.
      sortValue: (row) => row.weight,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <SearchInput
          className="flex-1"
          aria-label="Filter holdings by ticker or name"
          value={filter}
          onChange={onFilterChange}
          placeholder="Filter holdings by ticker or name..."
        />
        <span className="num shrink-0 text-2xs text-text-muted">
          {rows.length === holdings.length ? '' : `${rows.length} of ${holdings.length} shown`}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex min-h-0 min-w-0 flex-[3] flex-col border border-border bg-surface">
          <DataTable
            columns={columns}
            rows={rows}
            layout="fixed"
            rowKey={(row, index) => `${row.symbol}-${index}`}
            onRowClick={(row) => onOpenSymbol(row.symbol)}
            defaultSort={{ key: 'weight', direction: 'desc' }}
            empty={loading ? 'Loading holdings...' : 'No holdings to show'}
          />
        </div>

        <div className="flex min-h-0 min-w-[360px] flex-[2] flex-col border border-border bg-surface">
          <header className="flex h-9 shrink-0 items-center border-b border-border bg-surface-raised px-2">
            <h2 className="text-2xs font-semibold tracking-wide text-text uppercase">
              Holdings Breakdown
            </h2>
          </header>
          <Donut
            slices={donut.slices}
            startAngle={donut.startAngle}
            // `set_center_text(f'{coverage_pct:.1f}%', 'Coverage')`. The empty state is
            // the placeholder text below, which `Donut` renders instead of the ring.
            centerText={`${donut.coveragePct.toFixed(1)}%`}
            centerSubtext="Coverage"
            empty={loading ? 'Loading breakdown...' : 'Load an ETF to see its breakdown'}
          />
        </div>
      </div>
    </div>
  )
}
