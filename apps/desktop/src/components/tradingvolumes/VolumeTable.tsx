import { useMemo } from 'react'

import type { TradingVolumeInterval } from '@shared/contract'
import {
  TRADING_VOLUME_METRICS,
  metricValue,
  type RankedTradingVolumeRow,
} from '@shared/tradingVolumes'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { compactCurrency, integer } from '@/lib/format'

/**
 * The compact table keeps the active interval's ADV beside each stock's identity.
 * Rank is retained before filtering; ADV prints millions, as the ($m) header indicates.
 */

interface VolumeTableProps {
  rows: RankedTradingVolumeRow[]
  interval: TradingVolumeInterval
  loading: boolean
  onTickerHover: (ticker: string | null) => void
}

/** `_p20_format_dollar_volume_m`: the value over a million, no decimals, no unit. */
function millions(value: number | null): string {
  return value === null ? '' : integer(value / 1e6)
}

export function VolumeTable({ rows, interval, loading, onTickerHover }: VolumeTableProps) {
  const columns = useMemo<Array<Column<RankedTradingVolumeRow>>>(() => {
    const metric = TRADING_VOLUME_METRICS[interval]

    return [
      {
        key: 'rank',
        header: '#',
        align: 'right',
        numeric: true,
        width: '40px',
        // The rank before filtering, not the display position — which is exactly why
        // this is a real column instead of the table's own `showIndex` gutter.
        cell: (row) => row.rank,
        sortValue: (row) => row.rank,
      },
      {
        key: 'ticker',
        header: 'Ticker',
        width: '68px',
        cell: (row) => (
          <span
            className="block text-text"
            onMouseEnter={() => onTickerHover(row.ticker)}
            onMouseLeave={() => onTickerHover(null)}
          >
            {row.ticker}
          </span>
        ),
        sortValue: (row) => row.ticker,
      },
      {
        key: 'name',
        header: 'Name',
        // Fill the space left by the numeric columns and reveal clipped names on hover.
        cell: (row) => <span className="text-text-muted" title={row.name}>{row.name}</span>,
        sortValue: (row) => row.name,
      },
      {
        key: 'marketCap',
        header: 'Market Cap',
        align: 'right',
        numeric: true,
        width: '104px',
        cell: (row) => compactCurrency(row.marketCap),
        sortValue: (row) => row.marketCap,
      },
      {
        key: interval,
        header: metric.columnHeader,
        align: 'right',
        numeric: true,
        width: '128px',
        cell: (row) => millions(metricValue(row, metric.volumeField)),
        sortValue: (row) => metricValue(row, metric.volumeField),
      },
    ]
  }, [interval, onTickerHover])

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
