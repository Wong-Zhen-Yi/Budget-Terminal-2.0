import { useMemo } from 'react'

import type { CompletedIpoRow } from '@shared/contract'
import { ipoNumericSortValue, ipoPercentSortValue } from '@shared/ipo'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { directionClass } from '@/lib/format'

/**
 * `_P21_COMPLETED_HEADERS` and `_p21_render_completed_rows`.
 *
 * Every cell is the scraped string. `Return` is the one column with a colour, and it is
 * sorted with the percent key rather than the numeric one: the numeric key splits on `-`
 * to find a price range's upper bound, which would read `-12.40%` as `12.40`.
 */
export function CompletedIpoTable({ rows }: { rows: CompletedIpoRow[] }) {
  const columns = useMemo<Array<Column<CompletedIpoRow>>>(
    () => [
      {
        key: 'date',
        header: 'IPO Date',
        align: 'center',
        width: 'w-[104px]',
        cell: (row) => row.dateDisplay,
        sortValue: (row) => row.date,
      },
      {
        key: 'symbol',
        header: 'Symbol',
        align: 'center',
        width: 'w-[76px]',
        cell: (row) => row.symbol,
        sortValue: (row) => row.symbol,
      },
      {
        key: 'company',
        header: 'Company',
        cell: (row) => row.company,
        sortValue: (row) => row.company.toLowerCase(),
      },
      {
        key: 'ipoPrice',
        header: 'IPO Price',
        align: 'right',
        numeric: true,
        width: 'w-[84px]',
        cell: (row) => row.ipoPrice,
        sortValue: (row) => ipoNumericSortValue(row.ipoPrice),
      },
      {
        key: 'current',
        header: 'Current',
        align: 'right',
        numeric: true,
        width: 'w-[84px]',
        cell: (row) => row.currentPrice,
        sortValue: (row) => ipoNumericSortValue(row.currentPrice),
      },
      {
        key: 'return',
        header: 'Return',
        align: 'right',
        numeric: true,
        width: 'w-[80px]',
        cell: (row) => {
          const value = ipoPercentSortValue(row.returnPct)
          return (
            <span className={Number.isFinite(value) ? directionClass(value) : undefined}>
              {row.returnPct}
            </span>
          )
        },
        sortValue: (row) => ipoPercentSortValue(row.returnPct),
      },
    ],
    [],
  )

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row, index) => `${row.date}-${row.symbol}-${index}`}
      layout="fixed"
      // `sortItems(0, DescendingOrder)`: the most recent listing is the top row.
      defaultSort={{ key: 'date', direction: 'desc' }}
      empty="No completed IPO rows"
    />
  )
}
