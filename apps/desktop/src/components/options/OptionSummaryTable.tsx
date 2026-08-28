import { useMemo } from 'react'

import type { OptionsRawRow } from '@shared/contract'
import {
  formatExpiration,
  formatOptionPrice,
  formatOptionVolume,
  formatStrike,
  SUMMARY_COLUMNS,
  summaryHighlights,
} from '@shared/optionsPage'
import type { SortState } from '@/components/ui/DataTable'
import { highlightColor } from './highlights'

/**
 * The six-column table both summary grids use (`_make_top_volume_table`).
 *
 * It is not `DataTable`: the four highlights are per *cell* backgrounds rather than per
 * row, and the sort is controlled from outside so every panel in one grid reorders
 * together — `_p5_attach_top_volume_sort_sync` connects each table's header to the same
 * coordinator so clicking Vol on one expiration sorts all of them.
 *
 * The highlights are ranked on the records as loaded, before the display sort, exactly
 * as `_summary_cell_backgrounds` does — reordering a table must not repaint which row
 * is the highest-volume one.
 */

const SORT_VALUES: Record<string, (row: OptionsRawRow) => number | string> = {
  Ticker: (row) => row.ticker,
  Type: (row) => row.type,
  Strike: (row) => row.strike,
  Exp: (row) => row.expiration,
  Price: (row) => row.lastPrice,
  Vol: (row) => row.volume,
}

export function OptionSummaryTable({
  rows,
  sort,
  onSortChange,
  empty = 'No rows',
}: {
  rows: OptionsRawRow[]
  sort: SortState | null
  onSortChange: (sort: SortState | null) => void
  empty?: string
}) {
  const highlights = useMemo(() => summaryHighlights(rows), [rows])

  const ordered = useMemo(() => {
    const indexed = rows.map((row, index) => ({ row, index }))
    if (!sort) return indexed
    const read = SORT_VALUES[sort.key]
    if (!read) return indexed
    const direction = sort.direction === 'asc' ? 1 : -1
    return [...indexed].sort((a, b) => {
      const left = read(a.row)
      const right = read(b.row)
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * direction
      }
      return (left - right) * direction
    })
  }, [rows, sort])

  const toggle = (key: string) => {
    if (sort?.key !== key) return onSortChange({ key, direction: 'desc' })
    if (sort.direction === 'desc') return onSortChange({ key, direction: 'asc' })
    return onSortChange(null)
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-2xs">
        <thead className="sticky top-0 z-10 bg-surface-raised">
          <tr>
            {SUMMARY_COLUMNS.map((column) => (
              <th
                key={column}
                onClick={() => toggle(column)}
                className={`cursor-pointer border-b border-border px-1 py-0.5 font-semibold text-text-muted select-none hover:text-text ${
                  column === 'Strike' || column === 'Price' || column === 'Vol'
                    ? 'text-right'
                    : 'text-left'
                }`}
              >
                {column}
                {sort?.key === column ? (sort.direction === 'asc' ? ' ^' : ' v') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.length ? (
            ordered.map(({ row, index }) => {
              const highlight = highlights[index] ?? {}
              return (
                <tr key={`${row.type}-${row.strike}-${row.expiration}-${index}`} className="hover:bg-surface-hover">
                  <td className="truncate px-1 py-0.5">{row.ticker}</td>
                  <td className={`px-1 py-0.5 ${row.type === 'Call' ? 'text-up' : 'text-down'}`}>
                    {row.type}
                  </td>
                  <td className="num px-1 py-0.5 text-right">{formatStrike(row.strike)}</td>
                  <td className="px-1 py-0.5 whitespace-nowrap">
                    {formatExpiration(row.expiration)}
                  </td>
                  <td
                    className="num px-1 py-0.5 text-right"
                    style={{ background: highlightColor(highlight.price, 'price') }}
                  >
                    {formatOptionPrice(row.lastPrice)}
                  </td>
                  <td
                    className="num px-1 py-0.5 text-right"
                    style={{ background: highlightColor(highlight.volume, 'volume') }}
                  >
                    {formatOptionVolume(row.volume)}
                  </td>
                </tr>
              )
            })
          ) : (
            <tr>
              <td colSpan={SUMMARY_COLUMNS.length} className="p-3 text-center text-text-dim">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
