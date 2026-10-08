import type { OptionPosition, OptionQuote, Portfolio } from '@shared/contract'
import { computeOptionMetrics, OPTION_STATUSES, OPTION_STRATEGIES } from '@shared/analytics'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { NumberInput } from '@/components/ui/NumberInput'
import { decimals, integer, percent } from '@/lib/format'

export interface OptionRowView extends OptionPosition {
  pnl: number | null
  returnPct: number | null
  annualPct: number | null
  hasMark: boolean
}

/** Attach the derived columns to each stored row. */
export function buildOptionRows(
  options: OptionPosition[],
  quotes: Record<string, OptionQuote>,
): OptionRowView[] {
  return options.map((option) => {
    const live = quotes[option.rowId]
    const merged: OptionPosition = live ? { ...option, ...live, hasMarketMark: true } : { ...option, hasMarketMark: false }
    const { pnl, returnPct, annualPct } = computeOptionMetrics({
      strategy: merged.strategy,
      contracts: merged.contracts,
      premium: merged.premium,
      currentPrice: merged.currentPrice,
      strike: merged.strike,
      expiry: merged.expiry,
      openDate: merged.openDate,
    })
    return { ...merged, hasMark: Boolean(live), pnl: live ? pnl : null, returnPct: live ? returnPct : null, annualPct: live ? annualPct : null }
  })
}

/** Total across the tracker, which the header shows as Options P&L. */
export function totalOptionsPnl(rows: OptionRowView[]): number | null {
  if (rows.some(row => row.pnl === null && row.ticker && row.contracts)) return null
  return rows.reduce((sum, row) => sum + (row.pnl ?? 0), 0)
}

interface OptionsTableProps {
  portfolio: Portfolio
  rows: OptionRowView[]
  expiries: Record<string, string[]>
  loading: boolean
  onPatch: (rowId: string, patch: Partial<OptionPosition>) => void
  onRemove: (rowId: string) => void
}

export function OptionsTable({
  portfolio,
  rows,
  expiries,
  loading,
  onPatch,
  onRemove,
}: OptionsTableProps) {
  const readOnly = portfolio.readOnly

  const selectClass =
    'h-7 w-full border border-transparent bg-transparent px-1 text-2xs text-text outline-none hover:border-border-strong focus:border-accent'

  const columns: Array<Column<OptionRowView>> = [
    {
      key: 'ticker',
      header: 'Ticker',
      sortValue: (row) => row.ticker,
      cell: (row) =>
        readOnly ? (
          row.ticker
        ) : (
          <input
            aria-label="Option ticker"
            defaultValue={row.ticker}
            spellCheck={false}
            onBlur={(event) => {
              const next = event.target.value.trim().toUpperCase()
              if (next !== row.ticker) onPatch(row.rowId, { ticker: next })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className="h-7 w-16 border border-transparent bg-transparent px-1 text-2xs text-text uppercase outline-none hover:border-border-strong focus:border-accent"
          />
        ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (row) =>
        readOnly ? (
          row.strategy
        ) : (
          <select
            aria-label="Strategy"
            value={row.strategy}
            onChange={(event) => onPatch(row.rowId, { strategy: event.target.value })}
            className={selectClass}
          >
            {OPTION_STRATEGIES.map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy}
              </option>
            ))}
          </select>
        ),
    },
    {
      key: 'expiry',
      header: 'Expiry',
      cell: (row) => {
        const available = expiries[row.ticker] ?? []
        if (readOnly || !available.length) return row.expiry || '--'
        return (
          <select
            aria-label="Expiry"
            value={row.expiry}
            onChange={(event) => onPatch(row.rowId, { expiry: event.target.value })}
            className={`num ${selectClass}`}
          >
            <option value="">--</option>
            {available.map((expiry) => (
              <option key={expiry} value={expiry}>
                {expiry}
              </option>
            ))}
          </select>
        )
      },
    },
    {
      key: 'strike',
      header: 'Strike',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.strike,
      cell: (row) =>
        readOnly ? (
          decimals(row.strike, 1)
        ) : (
          <NumberInput
            aria-label="Strike"
            value={row.strike}
            decimals={1}
            onCommit={(value) => onPatch(row.rowId, { strike: value })}
          />
        ),
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.contracts,
      cell: (row) =>
        readOnly ? (
          integer(row.contracts)
        ) : (
          <NumberInput
            aria-label="Contracts"
            value={row.contracts}
            onCommit={(value) => onPatch(row.rowId, { contracts: value })}
          />
        ),
    },
    {
      key: 'premium',
      header: 'Premium',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.premium,
      cell: (row) =>
        readOnly ? (
          decimals(row.premium, 2)
        ) : (
          <NumberInput
            aria-label="Premium"
            value={row.premium}
            decimals={2}
            onCommit={(value) => onPatch(row.rowId, { premium: value })}
          />
        ),
    },
    {
      key: 'market',
      header: 'Last trade',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.currentPrice,
      cell: (row) => (row.hasMark ? <span className={row.markStale ? 'text-warn' : undefined}
        title={`${row.source ?? 'Yahoo Finance last trade'} · ${row.asOf === undefined ? 'Trade time unavailable' : `${new Date(row.asOf).toLocaleString()} · ${Math.max(0, (Date.now() - row.asOf) / 3600_000).toFixed(1)} hours old`}${row.markReason ? ` · ${row.markReason}` : ''}`}>
        {decimals(row.currentPrice, 2)}{row.markStale ? ' (stale)' : ''}
      </span> : 'N/A'),
    },
    {
      key: 'vol',
      header: 'Vol',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.volume,
      cell: (row) => row.hasMark ? integer(row.volume) : 'N/A',
    },
    {
      key: 'oi',
      header: 'OI',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.openInterest,
      cell: (row) => row.hasMark ? integer(row.openInterest) : 'N/A',
    },
    {
      key: 'iv',
      header: 'IV',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.impliedVolatility,
      cell: (row) => (row.impliedVolatility ? percent(row.impliedVolatility * 100, 0) : '--'),
    },
    {
      key: 'pnl',
      header: 'P&L ($)',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.pnl,
      cell: (row) => (
        <span className={row.pnl === null ? 'text-text-muted' : row.pnl >= 0 ? 'text-up' : 'text-down'}>
          {row.pnl === null ? 'N/A' : `${row.pnl >= 0 ? '+' : '-'}$${Math.abs(row.pnl).toFixed(2)}`}
        </span>
      ),
    },
    {
      key: 'return',
      header: 'Return %',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.returnPct,
      cell: (row) => (
        <span className={row.returnPct === null ? 'text-text-muted' : row.returnPct >= 0 ? 'text-up' : 'text-down'}>
          {percent(row.returnPct, 1)}
        </span>
      ),
    },
    {
      key: 'annual',
      header: 'Annual %',
      align: 'right',
      numeric: true,
      sortValue: (row) => row.annualPct,
      cell: (row) => (
        <span className={row.annualPct === null ? 'text-text-muted' : row.annualPct >= 0 ? 'text-up' : 'text-down'}>
          {percent(row.annualPct, 1)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) =>
        readOnly ? (
          row.status
        ) : (
          <select
            aria-label="Status"
            value={row.status}
            onChange={(event) => onPatch(row.rowId, { status: event.target.value })}
            className={selectClass}
          >
            {OPTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        ),
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
          aria-label="Remove option position"
          onClick={() => onRemove(row.rowId)}
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
      rowKey={(row) => row.rowId}
      showIndex
      empty={loading ? 'Loading option quotes...' : 'No option positions tracked.'}
    />
  )
}
