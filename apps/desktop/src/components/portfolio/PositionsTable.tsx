import type { Portfolio } from '@shared/contract'
import type { PositionRow } from '@shared/portfolioMath'
import { sizeBucket } from '@shared/portfolioMath'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { NumberInput } from '@/components/ui/NumberInput'
import { compactNumber, currency, decimals, percent, plainPercent } from '@/lib/format'

interface PositionsTableProps {
  portfolio: Portfolio
  rows: PositionRow[]
  loading: boolean
  onSetShares: (ticker: string, shares: number) => void
  onSetAvgPrice: (ticker: string, avgPrice: number) => void
  onToggleWeight: (ticker: string, include: boolean) => void
  onRemove: (ticker: string) => void
  onResearch?: (ticker: string) => void
}

/** `Mega $3.42T`, or `AUM $88.10B` for a fund — the reference app's wording. */
function formatSize(row: PositionRow): string {
  if (row.size === null) return '--'
  const magnitude = compactNumber(row.size)
  return row.sizeType === 'aum' ? `AUM $${magnitude}` : `${sizeBucket(row.size)} $${magnitude}`
}

function sizeTone(value: number | null): string {
  if (value === null) return 'text-text-dim'
  if (value >= 200_000_000_000) return 'text-yellow-400'
  if (value >= 10_000_000_000) return 'text-sky-400'
  if (value >= 2_000_000_000) return 'text-up'
  if (value >= 300_000_000) return 'text-orange-400'
  return 'text-down'
}

export function PositionsTable({
  portfolio,
  rows,
  loading,
  onSetShares,
  onSetAvgPrice,
  onToggleWeight,
  onRemove,
  onResearch,
}: PositionsTableProps) {
  const readOnly = portfolio.readOnly

  const columns: Array<Column<PositionRow>> = [
    {
      key: 'symbol',
      header: 'Symbol',
      sortValue: (row) => row.ticker,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={row.includeInWeight}
            disabled={readOnly}
            aria-label={`Include ${row.ticker} in weight`}
            onChange={(event) => onToggleWeight(row.ticker, event.target.checked)}
            className="accent-accent"
          />
          {onResearch ? <button type="button" onClick={() => onResearch(row.ticker)} title={`Research ${row.ticker}`}
            className="text-text underline decoration-border-strong underline-offset-4 hover:text-accent-hover">{row.ticker}</button>
            : <span className={row.includeInWeight ? 'text-text' : 'text-text-dim'}>{row.ticker}</span>}
        </div>
      ),
    },
    {
      key: 'shares',
      header: 'Shares',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.shares,
      cell: (row) =>
        readOnly ? (
          decimals(row.shares, row.shares % 1 === 0 ? 0 : 4)
        ) : (
          <NumberInput
            aria-label={`${row.ticker} shares`}
            value={row.shares}
            onCommit={(value) => onSetShares(row.ticker, value)}
          />
        ),
    },
    {
      key: 'avgPrice',
      header: 'Avg Price',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.avgPrice,
      cell: (row) =>
        readOnly ? (
          decimals(row.avgPrice, 2)
        ) : (
          <NumberInput
            aria-label={`${row.ticker} average price`}
            value={row.avgPrice}
            decimals={2}
            onCommit={(value) => onSetAvgPrice(row.ticker, value)}
          />
        ),
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.cost,
      cell: (row) => currency(row.cost),
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      numeric: true,
      sortValue: (row) => (row.hasQuote ? row.price : null),
      cell: (row) => (row.hasQuote ? currency(row.price) : <span title={row.unavailableReason}>N/A</span>),
    },
    {
      key: 'change',
      header: "Day's Change",
      align: 'right',
      numeric: true,
      sortValue: (row) => (row.hasQuote ? row.changePercent : null),
      cell: (row) =>
        row.hasQuote ? (
          <span className={(row.changePercent ?? 0) >= 0 ? 'text-up' : 'text-down'}>
            {percent(row.changePercent)}
          </span>
        ) : (
          '--'
        ),
    },
    {
      key: 'marketValue',
      header: 'Market Value',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.marketValue,
      cell: (row) => currency(row.marketValue),
    },
    {
      key: 'weight',
      header: 'Weight',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.weight,
      // An excluded position shows no weight at all, rather than a misleading 0%.
      cell: (row) => (row.weight === null ? '--' : plainPercent(row.weight)),
    },
    {
      key: 'dollarGain',
      header: 'Dollar Gain',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.dollarGain,
      cell: (row) => (
        <span className={row.dollarGain === null ? 'text-text-muted' : row.dollarGain >= 0 ? 'text-up' : 'text-down'}>
          {row.dollarGain === null ? 'N/A' : `${row.dollarGain >= 0 ? '+' : '-'}${currency(Math.abs(row.dollarGain))}`}
        </span>
      ),
    },
    {
      key: 'growth',
      header: 'Growth',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.growth,
      cell: (row) => (
        <span className={row.growth === null ? 'text-text-muted' : row.growth >= 0 ? 'text-up' : 'text-down'}>
          {percent(row.growth, 1)}
        </span>
      ),
    },
    {
      key: 'size',
      header: 'Market Cap / AUM',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.size,
      cell: (row) => <span className={sizeTone(row.size)}>{formatSize(row)}</span>,
    },
    {
      key: 'pegRatio',
      header: <span title="Provider-reported price/earnings-to-growth ratio. Negative values may reflect shrinking earnings; unavailable data is shown as --.">PEG Ratio</span>,
      align: 'right',
      numeric: true,
      sortValue: (row) => row.pegRatio,
      cell: (row) => row.pegNotApplicable
        ? <span className="text-text-dim" title="PEG is not applicable to funds.">N/A</span>
        : decimals(row.pegRatio, 2),
    },
    {
      key: 'analyst',
      header: 'Analyst PT',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.analystUpside,
      cell: (row) => {
        if (row.analystNotApplicable) return <span className="text-text-dim">N/A</span>
        if (row.analystTarget === null || row.analystUpside === null) return '--'
        return (
          <span className={row.analystUpside >= 0 ? 'text-up' : 'text-down'}>
            {currency(row.analystTarget)} ({percent(row.analystUpside, 1)})
          </span>
        )
      },
    },
  ]

  if (!readOnly) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'center',
      width: '52px',
      cell: (row) => (
        <button
          type="button"
          aria-label={`Remove ${row.ticker}`}
          title={`Remove ${row.ticker}`}
          onClick={() => onRemove(row.ticker)}
          className="px-1 text-2xs text-text-dim hover:text-down"
        >
          ✕
        </button>
      ),
    })
  }

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.ticker}
      showIndex
      defaultSort={{ key: 'marketValue', direction: 'desc' }}
      empty={loading ? 'Loading positions...' : 'No positions. Use + Add Position to start.'}
    />
  )
}
