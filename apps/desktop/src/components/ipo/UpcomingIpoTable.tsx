import { useMemo } from 'react'

import type { UpcomingIpoRow } from '@shared/contract'
import { ipoNumericSortValue, upcomingIpoSortKey } from '@shared/ipo'
import { DataTable, type Column } from '@/components/ui/DataTable'

/**
 * `_P21_HEADERS` and `_p21_render_ipo_rows`.
 *
 * The six money columns all sort with `ipoNumericSortValue`, which is what makes a price
 * range sort on its upper bound and a `$1.2B` deal size sort above a `$900.0M` one.
 *
 * `layout="fixed"` with a flexible Company column and everything else at a declared width
 * is the same trade Trading Volumes makes: under `auto` the free-text column swallows the
 * pane and pushes the figures the page exists to show off the right edge.
 */
export function UpcomingIpoTable({ rows }: { rows: UpcomingIpoRow[] }) {
  const columns = useMemo<Array<Column<UpcomingIpoRow>>>(() => {
    const money = (
      key: string,
      header: string,
      width: string,
      read: (row: UpcomingIpoRow) => string,
    ): Column<UpcomingIpoRow> => ({
      key,
      header,
      align: 'right',
      numeric: true,
      width,
      cell: read,
      sortValue: (row) => ipoNumericSortValue(read(row)),
    })

    return [
      {
        key: 'date',
        header: 'IPO Date',
        align: 'center',
        width: '104px',
        cell: (row) => <span title={row.filingDate ? `Filed ${row.filingDate}; IPO date not scheduled` : 'Estimated IPO date'}>{row.dateDisplay}</span>,
        sortValue: upcomingIpoSortKey,
      },
      {
        key: 'filingDate',
        header: 'Filed',
        align: 'center',
        width: '104px',
        cell: (row) => row.filingDate || '--',
        sortValue: (row) => row.filingDate || '',
      },
      {
        key: 'symbol',
        header: 'Symbol',
        align: 'center',
        width: '76px',
        cell: (row) => row.symbol,
        sortValue: (row) => row.symbol,
      },
      {
        key: 'company',
        header: 'Company',
        width: '240px',
        cell: (row) => row.company,
        sortValue: (row) => row.company.toLowerCase(),
      },
      {
        key: 'exchange',
        header: 'Exchange',
        align: 'center',
        width: '92px',
        cell: (row) => row.exchange,
        sortValue: (row) => row.exchange.toLowerCase(),
      },
      money('priceRange', 'Price Range', '112px', (row) => row.priceRange),
      money('shares', 'Shares', '96px', (row) => row.sharesOffered),
      money('dealSize', 'Deal Size', '96px', (row) => row.dealSize),
      money('marketCap', 'Market Cap', '96px', (row) => row.marketCap),
      money('revenue', 'Revenue', '96px', (row) => row.revenue),
    ]
  }, [])

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row, index) => `${row.date}-${row.symbol}-${index}`}
      layout="fixed"
      minWidth="1220px"
      // `sortItems(0, AscendingOrder)`: the next listing to price is the top row.
      defaultSort={{ key: 'date', direction: 'asc' }}
      empty="No upcoming IPO rows"
    />
  )
}
