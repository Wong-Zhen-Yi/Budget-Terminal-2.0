import type { EtfArbitragePayload, EtfArbitrageRow } from '@shared/contract'
import {
  arbitrageStatus,
  etfDirection,
  etfMoney,
  etfSignedBps,
  etfSignedPct,
  etfWeight,
} from '@shared/etf'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'

/**
 * The Arbitrage subtab, ported from `_p13_build_arbitrage_tab` and
 * `_p13_render_arbitrage_payload`.
 *
 * The gap is the ETF's own session move minus the weighted move of the holdings that
 * answered a quote — a raw return gap, not a NAV premium. A positive number means the
 * ETF is running rich to the basket underneath it.
 */

const directionClass = (value: unknown) => {
  const direction = etfDirection(value)
  return direction === 'up' ? 'text-up' : direction === 'down' ? 'text-down' : 'text-text-muted'
}

function clockTail(stamp: number): string {
  return stamp ? new Date(stamp).toLocaleTimeString('en-GB', { hour12: false }) : ''
}

export function ArbitrageTab({
  payload,
  loading,
  failureReason,
  hasHoldings,
  onRefresh,
  onOpenSymbol,
}: {
  payload: EtfArbitragePayload | undefined
  loading: boolean
  failureReason: string
  hasHoldings: boolean
  onRefresh: () => void
  onOpenSymbol: (symbol: string) => void
}) {
  const rows = payload?.rows ?? []

  const columns: Array<Column<EtfArbitrageRow>> = [
    { key: 'symbol', header: 'Ticker', cell: (row) => row.symbol, sortValue: (row) => row.symbol },
    {
      key: 'name',
      header: 'Name',
      width: '100%',
      cell: (row) => <span className="text-text-muted">{row.name}</span>,
      sortValue: (row) => row.name,
    },
    {
      key: 'weight',
      header: 'Weight',
      align: 'right',
      numeric: true,
      cell: (row) => <span className="text-up">{etfWeight(row.weight)}</span>,
      sortValue: (row) => row.weight,
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      numeric: true,
      cell: (row) => etfMoney(row.price),
      sortValue: (row) => row.price,
    },
    {
      key: 'move',
      header: 'Move',
      align: 'right',
      numeric: true,
      cell: (row) => <span className={directionClass(row.movePct)}>{etfSignedPct(row.movePct)}</span>,
      sortValue: (row) => row.movePct,
    },
    {
      key: 'contribution',
      header: 'Contribution',
      align: 'right',
      numeric: true,
      cell: (row) => (
        <span className={directionClass(row.contributionPct)}>
          {etfSignedPct(row.contributionPct)}
        </span>
      ),
      sortValue: (row) => row.contributionPct,
    },
  ]

  const coverage = payload?.totalHoldings
    ? `${payload.quoteCoverage}/${payload.totalHoldings}`
    : '--'

  const cells: Array<{ key: string; label: string; value: string; className: string; title: string }> = [
    {
      key: 'etfPrice',
      label: 'ETF Price',
      value: etfMoney(payload?.etfPrice),
      className: 'text-text',
      title: 'Last traded price of the ETF itself.',
    },
    {
      key: 'etfMove',
      label: 'ETF Move',
      value: etfSignedPct(payload?.etfMovePct),
      className: directionClass(payload?.etfMovePct),
      title: 'Percent move of the ETF over the current session.',
    },
    {
      key: 'basketMove',
      label: 'Basket Move',
      value: etfSignedPct(payload?.basketMovePct),
      className: directionClass(payload?.basketMovePct),
      title: 'Weight-adjusted percent move of the loaded holdings.',
    },
    {
      key: 'gap',
      label: 'Gap',
      value: etfSignedBps(payload?.gapBps),
      className: directionClass(payload?.gapBps),
      title: 'ETF move minus basket move, in basis points. Positive means the ETF is rich.',
    },
    {
      key: 'coverage',
      label: 'Quote Coverage',
      value: coverage,
      // `_p13_render_arbitrage_payload` only calls full coverage neutral; anything short
      // of it is amber, because a gap over a partial basket is not a reading.
      className:
        payload?.totalHoldings && payload.quoteCoverage === payload.totalHoldings
          ? 'text-text'
          : 'text-warn',
      title: 'How many holdings returned a usable quote. A low count makes the gap unreliable.',
    },
    {
      key: 'signal',
      label: 'Signal',
      value: payload?.signal || '--',
      className: 'text-text',
      title: 'Plain-language reading of the gap.',
    },
  ]

  /** `_p13_set_arbitrage_status`, across its five states. */
  const status = (() => {
    if (failureReason) return `Arbitrage refresh failed: ${failureReason}`
    if (!hasHoldings) return 'Load ETF holdings before refreshing arbitrage.'
    if (loading) return 'Fetching ETF and basket quotes...'
    if (!payload) return 'Refresh arbitrage to compare the ETF against the loaded basket.'
    return arbitrageStatus(payload).text
  })()

  const statusClass = (() => {
    if (failureReason) return 'text-down'
    if (!payload || loading || !hasHoldings) return 'text-text-muted'
    return arbitrageStatus(payload).status === 'positive' ? 'text-up' : 'text-warn'
  })()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2 border border-border bg-surface px-2 py-1">
        <h2
          className="text-2xs font-semibold tracking-wide text-text uppercase"
          title="Compares the ETF price move against the weighted move of its loaded holdings. A positive gap means the ETF is running rich to its basket."
        >
          ETF vs Basket
        </h2>
        <span className="num ml-auto text-2xs text-text-muted">
          {payload ? `Quotes as of ${clockTail(payload.generatedAt)}` : ''}
        </span>
        <Button
          variant="accent"
          onClick={onRefresh}
          disabled={loading || !hasHoldings}
          title="Re-fetch ETF and component quotes for the loaded basket."
        >
          {loading ? 'Refreshing...' : 'Refresh Arbitrage'}
        </Button>
      </div>

      <div className="grid shrink-0 grid-cols-6 divide-x divide-border border border-border bg-surface">
        {cells.map((cell) => (
          <div key={cell.key} title={cell.title} className="flex flex-col items-center px-2 py-1">
            <span className="text-2xs text-text-muted">{cell.label}</span>
            <span className={`num text-2xs font-semibold ${cell.className}`}>{cell.value}</span>
          </div>
        ))}
      </div>

      <p className={`shrink-0 text-2xs ${statusClass}`}>{status}</p>

      <div className="flex min-h-0 flex-1 flex-col border border-border bg-surface">
        <DataTable
          columns={columns}
          rows={rows}
          layout="fixed"
          rowKey={(row, index) => `${row.symbol}-${index}`}
          onRowClick={(row) => onOpenSymbol(row.symbol)}
          defaultSort={{ key: 'contribution', direction: 'desc' }}
          empty={loading ? 'Fetching basket quotes...' : 'No basket rows yet'}
        />
      </div>
    </div>
  )
}
