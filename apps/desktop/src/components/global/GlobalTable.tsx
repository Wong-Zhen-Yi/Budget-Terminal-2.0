import type { GlobalInterval } from '@shared/contract'
import type { MarketStatus } from '@shared/globalMarkets'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { performancePercent, thousands } from '@/lib/format'
import type { MappedRow } from './WorldMap'

/** `_p26_style_market_status_item`: open is green, closed is red, unknown is dim. */
function statusClass(status: MarketStatus): string {
  if (status.state === 'open') return 'text-up'
  if (status.state === 'closed') return 'text-down'
  return 'text-text-dim'
}

/** The three-line hover from `_p26_market_status_tooltip`. */
function statusTooltip(status: MarketStatus): string {
  return [
    status.session,
    `Clock timezone: ${status.clockTimezone}`,
    `Exchange timezone: ${status.exchangeTimezone}`,
  ].join('\n')
}

/** Index values and performance for the selected interval. */
export function GlobalTable({
  rows,
  interval,
  loading,
}: {
  rows: MappedRow[]
  interval: GlobalInterval
  loading: boolean
}) {
  const columns: Array<Column<MappedRow>> = [
    {
      key: 'region',
      header: 'Region',
      cell: (row) => row.region,
      sortValue: (row) => row.region,
    },
    {
      key: 'country',
      header: 'Country',
      cell: (row) => row.country,
      sortValue: (row) => row.country,
    },
    {
      // The reference stretches this one column and sizes the rest to their contents;
      // a percentage width under auto layout is the same bargain.
      key: 'index',
      header: 'Index',
      width: '100%',
      cell: (row) => row.name,
      sortValue: (row) => row.name,
    },
    {
      key: 'symbol',
      header: 'Symbol',
      align: 'center',
      cell: (row) => row.symbol,
      sortValue: (row) => row.symbol,
    },
    {
      key: 'market',
      header: 'Market',
      align: 'center',
      cell: (row) => (
        <span className={statusClass(row.status)} title={statusTooltip(row.status)}>
          {row.status.market}
        </span>
      ),
      sortValue: (row) => row.status.market,
    },
    {
      key: 'session',
      header: 'Session (Clock TZ)',
      cell: (row) => (
        <span className={statusClass(row.status)} title={statusTooltip(row.status)}>
          {row.status.session}
        </span>
      ),
      sortValue: (row) => row.status.session,
    },
  ]

  columns.push(
    {
      key: 'lastClose',
      header: 'Last Close',
      align: 'right',
      numeric: true,
      cell: (row) => thousands(row.lastClose),
      sortValue: (row) => row.lastClose,
    },
    {
      key: 'intradayRange',
      header: 'Intraday Range',
      align: 'right',
      numeric: true,
      cell: (row) => (
        <span title={`Latest session (${row.lastDate || '--'}), low – high`}>
          {thousands(row.dayLow)} – {thousands(row.dayHigh)}
        </span>
      ),
      sortValue: (row) => row.dayLow,
    },
    {
      key: 'startClose',
      header: 'Start Close',
      align: 'right',
      numeric: true,
      cell: (row) => {
        const payload = row.intervals?.[interval]
        return payload?.available ? thousands(payload.startClose) : '--'
      },
      sortValue: (row) => row.intervals?.[interval]?.startClose ?? null,
    },
    {
      key: 'endClose',
      header: 'End Close',
      align: 'right',
      numeric: true,
      cell: (row) => {
        const payload = row.intervals?.[interval]
        return payload?.available ? thousands(payload.endClose) : '--'
      },
      sortValue: (row) => row.intervals?.[interval]?.endClose ?? null,
    },
    {
      key: 'performance',
      header: 'Performance %',
      align: 'right',
      numeric: true,
      cell: (row) => {
        const payload = row.intervals?.[interval]
        if (!payload?.available) return '--'
        const value = payload.changePct ?? 0
        return (
          <span className={value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-text'}>
            {performancePercent(payload.changePct)}
          </span>
        )
      },
      sortValue: (row) =>
        row.intervals?.[interval]?.available ? (row.intervals[interval].changePct ?? null) : null,
    },
    {
      key: 'lastDate',
      header: 'Last Date',
      align: 'center',
      numeric: true,
      cell: (row) => row.lastDate || row.intervals?.[interval]?.endDate || '--',
      sortValue: (row) => row.lastDate,
    },
  )

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.symbol}
      empty={loading ? 'Loading global market indexes...' : 'No global index data'}
    />
  )
}
