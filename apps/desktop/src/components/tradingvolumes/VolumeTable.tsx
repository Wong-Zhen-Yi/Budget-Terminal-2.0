import { useMemo } from 'react'

import { TRADING_VOLUME_INTERVALS, type TradingVolumeInterval } from '@shared/contract'
import {
  TRADING_VOLUME_METRICS,
  metricValue,
  type RankedTradingVolumeRow,
} from '@shared/tradingVolumes'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { compactCurrency, integer } from '@/lib/format'

/**
 * The left half of the Trading Volumes page: `_P20_HEADERS` as a `DataTable`.
 *
 * The columns are the reference's, in its order. Two things are worth knowing:
 * the `#` column prints the rank the row held *before* the filter sliced the list, and
 * the ADV columns print millions with no unit, which is what `($m)` in the header means.
 */

interface VolumeTableProps {
  rows: RankedTradingVolumeRow[]
  interval: TradingVolumeInterval
  loading: boolean
}

/** `_p20_format_dollar_volume_m`: the value over a million, no decimals, no unit. */
function millions(value: number | null): string {
  return value === null ? '' : integer(value / 1e6)
}

export function VolumeTable({ rows, interval, loading }: VolumeTableProps) {
  const columns = useMemo<Array<Column<RankedTradingVolumeRow>>>(() => {
    const advColumns = TRADING_VOLUME_INTERVALS.map((key) => {
      const metric = TRADING_VOLUME_METRICS[key]
      return {
        key,
        header: metric.columnHeader,
        align: 'right' as const,
        numeric: true,
        width: '84px',
        cell: (row: RankedTradingVolumeRow) => millions(metricValue(row, metric.volumeField)),
        sortValue: (row: RankedTradingVolumeRow) => metricValue(row, metric.volumeField),
      }
    })

    return [
      {
        key: 'rank',
        header: '#',
        align: 'right',
        numeric: true,
        width: '44px',
        // The rank before filtering, not the display position — which is exactly why
        // this is a real column instead of the table's own `showIndex` gutter.
        cell: (row) => row.rank,
        sortValue: (row) => row.rank,
      },
      {
        key: 'ticker',
        header: 'Ticker',
        width: '76px',
        cell: (row) => <span className="text-text">{row.ticker}</span>,
        sortValue: (row) => row.ticker,
      },
      {
        key: 'name',
        header: 'Name',
        // Wide enough for most company names outright, where the reference clips at
        // roughly half this. It cannot be a `100%` stretch column: under `table-fixed`
        // that collapses to nothing, and under `auto` it swallows the pane and pushes
        // the ADV columns out of sight. Ten dense columns do not fit either way, so the
        // pane scrolls horizontally exactly as the reference's does.
        width: '184px',
        cell: (row) => <span className="text-text-muted">{row.name}</span>,
        sortValue: (row) => row.name,
      },
      {
        key: 'marketCap',
        header: 'Market Cap',
        align: 'right',
        numeric: true,
        width: '96px',
        cell: (row) => compactCurrency(row.marketCap),
        sortValue: (row) => row.marketCap,
      },
      ...advColumns,
    ]
  }, [])

  return (
    <DataTable
      // The reference re-sorts the table onto the active metric's column after every
      // render; remounting on interval is how that lands here, while header clicks
      // still work normally within one interval.
      key={interval}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.ticker}
      layout="fixed"
      // `_finish` force-sorts onto the active metric's column, descending, after every
      // render — so picking an interval re-sorts the table as well as the plot.
      defaultSort={{ key: interval, direction: 'desc' }}
      empty={loading ? 'Loading trading volume...' : 'Load Trading Volumes to see rows.'}
    />
  )
}
