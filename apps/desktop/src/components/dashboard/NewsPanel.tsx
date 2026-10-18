import type { NewsItem } from '@shared/contract'
import { api } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { NEWS_REFRESH_MS } from '@/api/refreshRates'
import { Panel } from '@/components/ui/Panel'
import { newsTime } from '@/lib/format'

/**
 * Headlines Yahoo associates with the holdings on screen, newest first, capped at two
 * per ticker so one busy name cannot fill the panel. Clicking a row opens the article
 * in the system browser — nothing navigates inside the app.
 */
export function NewsPanel({
  items,
  loading,
  warning,
  className,
  live = false,
  refreshing = false,
  updatedAt,
  onRefresh,
}: {
  items: NewsItem[]
  loading: boolean
  warning?: string
  className?: string
  live?: boolean
  refreshing?: boolean
  updatedAt?: number
  onRefresh?: () => void
}) {
  const columns: Array<Column<NewsItem>> = [
    {
      key: 'title',
      header: 'Headline',
      // The table is fixed-layout, so this cell absorbs the slack; it wraps onto as many
      // lines as the headline needs rather than clipping it.
      cell: (item) => <span title={item.title}>{item.title}</span>,
      width: 'auto',
      wrap: true,
    },
    ...(live ? [{ key: 'source', header: 'Source', cell: (item: NewsItem) => item.source, width: '100px', wrap: true }] : []),
    { key: 'ticker', header: 'Ticker', cell: (item) => item.ticker, width: '76px' },
    {
      key: 'time',
      header: 'Time',
      align: 'right',
      numeric: true,
      width: '68px',
      cell: (item) => <span title={item.source}>{newsTime(item.publishedAt)}</span>,
    },
  ]

  return (
    <Panel title="Live News Feed" warning={warning} className={className} actions={live ? (
      <>
        <span className="text-2xs text-text-dim" title={updatedAt ? `Updated ${new Date(updatedAt).toLocaleString()}` : 'Waiting for headlines'}>
          {refreshing ? 'Updating...' : `Auto · ${NEWS_REFRESH_MS / 60_000}m`}
        </span>
        <Button onClick={onRefresh} disabled={refreshing} aria-label="Refresh live news">Refresh</Button>
      </>
    ) : undefined}>
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(item) => item.id}
        showIndex
        layout="fixed"
        onRowClick={(item) => void api.openExternal(item.url)}
        empty={loading ? 'Loading news...' : warning ? 'News unavailable. Refresh to retry.' : 'No recent headlines for these holdings'}
      />
    </Panel>
  )
}
