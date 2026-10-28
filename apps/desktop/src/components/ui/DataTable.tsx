import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { defaultRangeExtractor, observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import { useNumberPrivacy } from './NumberPrivacy'

export interface Column<T> {
  key: string
  header: ReactNode
  /** Cell contents. Return a string for plain text or a node for styled cells. */
  cell: (row: T, index: number) => ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string
  /** Render in the tabular monospace face; use for anything numeric. */
  numeric?: boolean
  /**
   * Let the cell wrap onto as many lines as the text needs instead of clipping it to
   * one line. Rows in the table grow to fit; every cell aligns to the top.
   */
  wrap?: boolean
  /**
   * Makes the column sortable. Return the value to order by; `null` sorts last in both
   * directions, so rows with no quote never displace real data.
   */
  sortValue?: (row: T) => number | string | null
}

export interface SortState {
  key: string
  direction: 'asc' | 'desc'
}

interface DataTableProps<T> {
  columns: Array<Column<T>>
  rows: T[]
  rowKey: (row: T, index: number) => string
  /** Row index gutter, like the reference app's numbered tables. */
  showIndex?: boolean
  onRowClick?: (row: T, index: number) => void
  onRowDoubleClick?: (row: T, index: number) => void
  rowClassName?: (row: T, index: number) => string
  empty?: ReactNode
  /**
   * `fixed` honours the declared column widths and lets long text ellipsis instead of
   * stretching the table. Needed by any table with a free-text column.
   */
  layout?: 'auto' | 'fixed'
  /**
   * Floor for the table's own width, so a `fixed` layout with more declared columns than
   * the pane can carry scrolls horizontally instead of scaling every column down until
   * its text ellipsis away. The scroller is the wrapper this component already renders.
   */
  minWidth?: string
  /** Initial sort; the header stays clickable from there. */
  defaultSort?: SortState
  /** Automatic above 200 rows; false is reserved for deliberately unbounded layouts. */
  virtualize?: boolean
}

const alignClass = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const

/**
 * The dense, scrollable table the dashboard uses everywhere. A sticky header, a fixed
 * row height, and no cell padding to speak of — the point is to fit as many rows on
 * screen as the reference app does.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  showIndex = false,
  onRowClick,
  onRowDoubleClick,
  rowClassName,
  empty = 'No data',
  layout = 'auto',
  minWidth,
  defaultSort,
  virtualize = true,
}: DataTableProps<T>) {
  const maskNumbers = useNumberPrivacy()
  // One wrapping column makes every row variable-height, so the short cells have to
  // align to the top or they float in the middle of a tall row.
  const hasWrap = columns.some((column) => column.wrap)
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null)

  // Editing a cell changes the value it sorts by, which would move the row out from
  // under the cursor mid-edit. Hold the order still while focus is inside the table and
  // let it settle once focus leaves — the same deferral the reference app applies while
  // one of its editors is open.
  const [frozen, setFrozen] = useState(false)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const orderRef = useRef<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLTableSectionElement>(null)
  const [headerHeight, setHeaderHeight] = useState(25)
  const [autoWidths, setAutoWidths] = useState<number[]>([])
  const lastSort = useRef(sort)
  const columnSignature = columns.map(column => `${column.key}:${column.width ?? ''}`).join('|')

  const sorted = useMemo(() => {
    if (frozen && orderRef.current.length) {
      const rank = new Map(orderRef.current.map((key, index) => [key, index]))
      return [...rows].sort(
        (a, b) =>
          (rank.get(rowKey(a, 0)) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(rowKey(b, 0)) ?? Number.MAX_SAFE_INTEGER),
      )
    }

    const column = sort ? columns.find((entry) => entry.key === sort.key) : null
    const read = column?.sortValue
    const ordered =
      !sort || !read
        ? rows
        : [...rows].sort((a, b) => {
            const factor = sort.direction === 'asc' ? 1 : -1
            const left = read(a)
            const right = read(b)
            // Missing values sink to the bottom whichever way the column points.
            if (left === null && right === null) return 0
            if (left === null) return 1
            if (right === null) return -1
            if (typeof left === 'string' || typeof right === 'string') {
              return String(left).localeCompare(String(right)) * factor
            }
            return (left - right) * factor
          })
    orderRef.current = ordered.map((row, index) => rowKey(row, index))
    return ordered
  }, [rows, columns, sort, frozen, rowKey])

  const virtual = virtualize && rows.length >= 200
  const focusedIndex = focusedKey === null ? -1 : sorted.findIndex((row, index) => rowKey(row, index) === focusedKey)
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: sorted.length,
    enabled: virtual,
    getScrollElement: () => scrollRef.current,
    observeElementRect: (instance, callback) => observeElementRect(instance, rect => {
      if (rect.height > 0 && rect.width > 0) callback(rect)
    }),
    estimateSize: () => hasWrap ? 48 : 25,
    // Activity hides whole page trees. A hidden row's zero-height observation is
    // not a new row size; retaining its measurement prevents range expansion.
    measureElement: (element, _entry, instance) => element.getBoundingClientRect().height
      || instance.measurementsCache[Number(element.dataset.index)]?.size || (hasWrap ? 48 : 25),
    getItemKey: index => rowKey(sorted[index], index),
    overscan: 8,
    paddingStart: headerHeight,
    rangeExtractor: range => {
      const indices = defaultRangeExtractor(range)
      return focusedIndex < 0 ? indices : [...new Set([...indices, focusedIndex])].sort((a, b) => a - b)
    },
  })
  useEffect(() => {
    if (!virtual || !headerRef.current) return
    const observer = new ResizeObserver(() => {
      const height = headerRef.current?.getBoundingClientRect().height
      if (height) setHeaderHeight(height)
    })
    observer.observe(headerRef.current)
    return () => observer.disconnect()
  }, [virtual])
  useLayoutEffect(() => {
    if (lastSort.current === sort) return
    lastSort.current = sort
    if (virtual) virtualizer.scrollToOffset(0)
  }, [sort])
  useEffect(() => {
    setAutoWidths([])
    if (!virtual || layout !== 'auto' || !headerRef.current) return
    // Lock the initial viewport's natural column proportions. Otherwise an auto
    // table changes column widths whenever a wider offscreen cell mounts.
    let locked = false
    const measure = () => {
      if (locked || !headerRef.current?.getBoundingClientRect().width) return
      const widths = [...headerRef.current.rows[0].cells].map(cell => cell.getBoundingClientRect().width)
      if (widths.some(width => width <= 0)) return
      locked = true
      const total = widths.reduce((sum, width) => sum + width, 0)
      setAutoWidths(widths.map(width => width / total * 100))
    }
    const frame = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(headerRef.current)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [virtual, layout, columnSignature, showIndex])
  const items = virtual ? virtualizer.getVirtualItems() : sorted.map((_row, index) => ({ index, start: 0, end: 0 }))
  const columnCount = columns.length + (showIndex ? 1 : 0)
  const spacer = (height: number) => height > 0 ? <tr aria-hidden="true"><td colSpan={columnCount} style={{ height, padding: 0, border: 0 }} /></tr> : null

  const toggleSort = (column: Column<T>) => {
    if (!column.sortValue) return
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setSort((current) =>
      current?.key === column.key
        ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, direction: 'desc' },
    )
  }

  if (!rows.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-2xs text-text-dim">
        {empty}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto"
      style={virtual ? { maxHeight: 'min(70vh, 720px)', overflowAnchor: 'none' } : undefined}
      onFocusCapture={event => {
        setFrozen(true)
        setFocusedKey((event.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-row-key]')?.dataset.rowKey ?? null)
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFrozen(false); setFocusedKey(null) }
      }}
    >
      <table
        aria-rowcount={sorted.length + 1}
        style={minWidth ? { minWidth } : undefined}
        className={`w-full border-collapse ${layout === 'fixed' || (virtual && autoWidths.length) ? 'table-fixed' : ''}`}
      >
        {virtual && layout === 'auto' && autoWidths.length ? <colgroup>
          {showIndex ? <col style={{ width: '40px' }} /> : null}
          {columns.map((column, index) => <col key={column.key} style={{ width: column.width ?? `${autoWidths[index + (showIndex ? 1 : 0)]}%` }} />)}
        </colgroup> : null}
        <thead ref={headerRef} className="sticky top-0 z-10">
          <tr className="bg-surface-raised" aria-rowindex={1}>
            {showIndex ? (
              <th className="w-10 border-b border-border px-1 py-1 text-right text-2xs font-medium text-text-dim" />
            ) : null}
            {columns.map((column) => {
              const active = sort?.key === column.key
              return (
                <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  onClick={() => toggleSort(column)}
                  className={`overflow-hidden border-b border-border px-2 py-1 text-2xs font-medium text-ellipsis whitespace-nowrap ${
                    alignClass[column.align ?? 'left']
                  } ${column.sortValue ? 'cursor-pointer select-none hover:text-text' : ''} ${
                    active ? 'text-accent-hover' : 'text-text-muted'
                  }`}
                >
                  {column.header}
                  {active ? (
                    <span className="pl-1">{sort.direction === 'asc' ? '▲' : '▼'}</span>
                  ) : null}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((item, itemIndex) => {
            const { index } = item
            const row = sorted[index]
            return (
              <Fragment key={rowKey(row, index)}>
                {virtual ? spacer(item.start - (itemIndex ? items[itemIndex - 1].end : headerHeight)) : null}
                <tr
                  ref={virtual ? virtualizer.measureElement : undefined}
                  data-index={index}
                  data-row-key={rowKey(row, index)}
                  aria-rowindex={index + 2}
                  onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                  onDoubleClick={
                    onRowDoubleClick ? () => onRowDoubleClick(row, index) : undefined
                  }
                  className={`border-b border-border/40 ${
                    onRowClick || onRowDoubleClick ? 'cursor-pointer hover:bg-surface-hover' : ''
                  } ${rowClassName?.(row, index) ?? ''}`}
                >
                  {showIndex ? (
                    <td
                      className={`num px-1 py-[3px] text-right text-2xs text-text-dim ${
                        hasWrap ? 'align-top' : ''
                      }`}
                    >
                      {maskNumbers ? '****' : index + 1}
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-2 py-[3px] text-2xs ${
                        column.wrap
                          ? 'break-words whitespace-normal'
                          : 'overflow-hidden text-ellipsis whitespace-nowrap'
                      } ${hasWrap ? 'align-top' : ''} ${alignClass[column.align ?? 'left']} ${
                        column.numeric ? 'num' : ''
                      }`}
                    >
                      {maskNumbers && column.numeric ? '****' : column.cell(row, index)}
                    </td>
                  ))}
                </tr>
              </Fragment>
            )
          })}
          {virtual ? spacer(virtualizer.getTotalSize() - (items.at(-1)?.end ?? headerHeight)) : null}
        </tbody>
      </table>
    </div>
  )
}
