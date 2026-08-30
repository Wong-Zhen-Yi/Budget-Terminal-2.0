import { useMemo } from 'react'

import type { EtfAumPayload, EtfAumRow } from '@shared/contract'
import { etfAum, filterAumRows } from '@shared/etf'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { SearchInput } from '@/components/ui/SearchInput'

/**
 * `_p13_build_aum_panel`: the left rail ranking every US ETF by net assets.
 *
 * Clicking a row loads that fund on the right, which is `_p13_on_aum_etf_clicked` — and
 * like it, a click while a load is already running only fills the input and says so
 * rather than queueing a second sweep.
 */
export function AumRail({
  payload,
  loading,
  failureReason,
  filter,
  onFilterChange,
  onSelect,
  onRefresh,
  refreshing,
}: {
  payload: EtfAumPayload | undefined
  loading: boolean
  failureReason: string
  filter: string
  onFilterChange: (value: string) => void
  onSelect: (ticker: string) => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const all = payload?.rows ?? []
  const rows = useMemo(() => filterAumRows(all, filter), [all, filter])

  const columns: Array<Column<EtfAumRow>> = [
    {
      key: 'ticker',
      header: 'Ticker',
      cell: (row) => row.ticker,
      sortValue: (row) => row.ticker,
    },
    {
      key: 'aum',
      header: 'AUM',
      align: 'right',
      numeric: true,
      cell: (row) => <span className="text-up">{etfAum(row.netAssets)}</span>,
      sortValue: (row) => row.netAssets,
    },
  ]

  /** `_p13_render_aum_table`'s four status lines, in the same order of precedence. */
  const status = (() => {
    if (loading && !all.length) return 'Fetching ETF AUM...'
    if (failureReason) return `ETF AUM unavailable: ${failureReason}`
    if (!all.length) return 'No US ETF AUM data returned by Yahoo Finance.'
    if (filter.trim()) return `${rows.length} of ${all.length} US ETFs match "${filter.trim().toUpperCase()}".`
    if (payload?.missingCount) {
      return `Loaded AUM for ${all.length}/${payload.totalCount} US ETFs; ${payload.missingCount} unavailable.`
    }
    return `Loaded AUM for ${all.length} US ETFs.`
  })()

  return (
    <div className="flex min-h-0 w-full flex-col gap-2 border-r border-border bg-surface p-2">
      <h2 className="shrink-0 text-2xs font-semibold tracking-wide text-text uppercase">
        ETF by AUM
      </h2>
      <Button
        className="shrink-0"
        onClick={onRefresh}
        disabled={refreshing || loading}
        title="Re-fetch the US ETF universe ranked by net assets."
      >
        {refreshing || loading ? 'Refreshing...' : 'Refresh AUM'}
      </Button>
      <SearchInput
        className="shrink-0"
        aria-label="Search the ETF universe by ticker"
        value={filter}
        onChange={onFilterChange}
        placeholder="Search ticker..."
      />
      <p className="shrink-0 text-2xs text-text-muted">{status}</p>
      {/* `_p13_aum_note_lbl`: the caveat is on the panel because the number is wrong for
          a whole issuer, not because a particular row failed. */}
      <p className="shrink-0 text-2xs text-warn italic">
        Note: Vanguard ETFs may show total fund AUM across all share classes, not ETF-only.
      </p>
      <div className="flex min-h-0 flex-1 flex-col">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.ticker}
          onRowClick={(row) => onSelect(row.ticker)}
          defaultSort={{ key: 'aum', direction: 'desc' }}
          empty={loading ? 'Fetching ETF AUM...' : 'No ETFs to show'}
        />
      </div>
    </div>
  )
}
