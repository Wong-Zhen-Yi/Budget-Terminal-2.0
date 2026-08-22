import type { OptionBucket, OptionRow } from '@shared/contract'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel } from '@/components/ui/Panel'
import { decimals, integer } from '@/lib/format'

const columns: Array<Column<OptionRow>> = [
  { key: 'ticker', header: 'Ticker', cell: (row) => row.ticker },
  {
    key: 'type',
    header: 'Type',
    cell: (row) => (
      <span className={row.type === 'Call' ? 'text-up' : 'text-down'}>{row.type}</span>
    ),
  },
  {
    key: 'strike',
    header: 'Strike',
    align: 'right',
    numeric: true,
    cell: (row) => decimals(row.strike, 1),
  },
  { key: 'exp', header: 'Exp', align: 'right', numeric: true, cell: (row) => row.expiration },
  {
    key: 'price',
    header: 'Price',
    align: 'right',
    numeric: true,
    cell: (row) => decimals(row.lastPrice, 2),
  },
  {
    key: 'volume',
    header: 'Vol',
    align: 'right',
    numeric: true,
    cell: (row) => integer(row.volume),
  },
]

/**
 * The three top-volume option tables: this week, two weeks out, four weeks out. Calls
 * and puts share one ranking per bucket, top ten by volume.
 */
export function OptionsPanel({
  symbol,
  buckets,
  loading,
  warning,
}: {
  symbol: string
  buckets: OptionBucket[]
  loading: boolean
  warning?: string
}) {
  const shown = buckets.length
    ? buckets
    : ([
        { key: '0_week', label: '0 Week', expiration: '', rows: [] },
        { key: '2_weeks', label: '2 Weeks', expiration: '', rows: [] },
        { key: '4_weeks', label: '4 Weeks', expiration: '', rows: [] },
      ] satisfies OptionBucket[])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {shown.map((bucket) => (
        <Panel
          key={bucket.key}
          title={`Top Options by Volume - ${bucket.label}`}
          warning={!loading && !bucket.rows.length ? `No contracts for ${bucket.label}` : warning}
          actions={
            bucket.expiration ? (
              <span className="num text-2xs text-text-dim">exp {bucket.expiration}</span>
            ) : null
          }
          className="min-h-0 flex-1"
        >
          <DataTable
            columns={columns}
            rows={bucket.rows}
            rowKey={(row, index) => `${row.type}-${row.strike}-${index}`}
            showIndex
            empty={loading ? `Loading ${symbol} options...` : 'No contracts'}
          />
        </Panel>
      ))}
    </div>
  )
}
