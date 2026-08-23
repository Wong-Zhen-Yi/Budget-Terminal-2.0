import type { FuturesRow } from '@shared/contract'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { decimals, directionClass, percent } from '@/lib/format'

/**
 * The five index and commodity contracts, as `_p14_apply_result` renders them.
 *
 * Deliberately unsorted: the reference lists them in contract order and clicking a
 * header there does nothing, so no column declares a `sortValue`.
 */
const columns: Array<Column<FuturesRow>> = [
  { key: 'symbol', header: 'Ticker', cell: (row) => row.symbol },
  { key: 'name', header: 'Name', cell: (row) => row.name },
  { key: 'price', header: 'Price', align: 'right', numeric: true, cell: (row) => decimals(row.price, 2) },
  {
    key: 'changePct',
    header: 'Chg %',
    align: 'right',
    numeric: true,
    // The reference hardcodes #00c853/#ff1744 here; the terminal's own up/down keeps the
    // page consistent with every other table in the app.
    cell: (row) => <span className={directionClass(row.changePct)}>{percent(row.changePct)}</span>,
  },
  { key: 'direction', header: 'Direction', cell: (row) => row.direction },
]

export function FuturesPanel({
  rows,
  loading,
  warning,
  className = '',
}: {
  rows: FuturesRow[]
  loading: boolean
  warning?: string
  className?: string
}) {
  return (
    <Panel title="Futures" warning={warning} className={className}>
      {rows.length ? (
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.symbol} />
      ) : (
        <PanelMessage>{loading ? 'Loading futures...' : 'No futures data available'}</PanelMessage>
      )}
    </Panel>
  )
}
