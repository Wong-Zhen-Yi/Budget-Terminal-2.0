import { useState } from 'react'
import { OPTION_BUCKETS, type OptionBucket, type OptionBucketKey, type OptionRow } from '@shared/contract'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel } from '@/components/ui/Panel'
import { decimals, integer } from '@/lib/format'
import './OptionsPanel.css'

const contractColumns: Array<Column<OptionRow>> = [
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
const columns: Array<Column<OptionRow>> = [
  { key: 'ticker', header: 'Ticker', cell: (row) => row.ticker },
  ...contractColumns,
]
const emptyBuckets: OptionBucket[] = OPTION_BUCKETS.map(({ key, label }) => ({ key, label, expiration: '', rows: [] }))

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
  const shown = buckets.length ? buckets : emptyBuckets

  return (
    <div className="dashboard-options flex min-h-0 min-w-0 flex-1 flex-col gap-1">
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

export function DashboardLiteOptions({ symbol, buckets, loading, onExport }: {
  symbol: string
  buckets: OptionBucket[]
  loading: boolean
  onExport: () => void
}) {
  const [expiry, setExpiry] = useState<OptionBucketKey>(OPTION_BUCKETS[0].key)
  const selected = buckets.find(bucket => bucket.key === expiry)
  return (
    <Panel title="Options volume" className="dashboard-lite-options" actions={
      <Button disabled={!buckets.some(bucket => bucket.rows.length)} onClick={onExport}>Export CSV</Button>
    }>
      <div className="dashboard-lite-expiries" role="group" aria-label="Option expiry">
        {OPTION_BUCKETS.map(({ key, label }) => (
          <Button key={key} variant="toggle" active={expiry === key} onClick={() => setExpiry(key)}>{label}</Button>
        ))}
      </div>
      <div className="dashboard-lite-option-context">
        <strong>{symbol}</strong>
        <span className="text-text-muted">{selected?.expiration ? `Expires ${selected.expiration}` : '—'}</span>
      </div>
      <DataTable
        key={expiry}
        columns={contractColumns}
        rows={selected?.rows ?? []}
        rowKey={(row, index) => `${row.type}-${row.strike}-${index}`}
        empty={loading ? `Loading ${symbol} options…` : 'No contracts'}
      />
    </Panel>
  )
}
