import { useMemo } from 'react'

import type { Portfolio, Quote } from '@shared/contract'
import { buildPortfolioRows, type PortfolioRow } from '@shared/portfolioMath'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel } from '@/components/ui/Panel'
import { currency, percent, plainPercent, signedCurrency } from '@/lib/format'

interface PortfolioPanelProps {
  portfolios: Portfolio[]
  selected: Portfolio | null
  quotes: Record<string, Quote>
  loading: boolean
  warning?: string
  className?: string
  onSelectPortfolio: (id: string) => void
  onSelectTicker: (ticker: string) => void
}

/**
 * Read-only holdings. The PySide6 app still owns edits, so there is no add or remove
 * here — clicking a row loads that ticker into the chart instead.
 */
export function PortfolioPanel({
  portfolios,
  selected,
  quotes,
  loading,
  warning,
  className,
  onSelectPortfolio,
  onSelectTicker,
}: PortfolioPanelProps) {
  const rows = useMemo(
    () => (selected ? buildPortfolioRows(selected, quotes) : []),
    [selected, quotes],
  )

  const columns: Array<Column<PortfolioRow>> = [
    { key: 'ticker', header: 'Ticker', cell: (row) => row.ticker },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      numeric: true,
      cell: (row) => currency(row.price),
    },
    {
      key: 'change',
      header: 'Chg %',
      align: 'right',
      numeric: true,
      cell: (row) => (
        <span className={(row.changePercent ?? 0) >= 0 ? 'text-up' : 'text-down'}>
          {percent(row.changePercent)}
        </span>
      ),
    },
    {
      key: 'weight',
      header: 'Weight',
      align: 'right',
      numeric: true,
      cell: (row) => plainPercent(row.weight),
    },
    {
      key: 'gain',
      header: 'Gain $',
      align: 'right',
      numeric: true,
      cell: (row) => (
        <span className={(row.gain ?? 0) >= 0 ? 'text-up' : 'text-down'}>
          {signedCurrency(row.gain)}
        </span>
      ),
    },
  ]

  return (
    <Panel
      title={`${selected?.name ?? 'Portfolio'} (${rows.length})`}
      warning={warning}
      className={className}
      actions={
        portfolios.length > 1 ? (
          <select
            value={selected?.id ?? ''}
            onChange={(event) => onSelectPortfolio(event.target.value)}
            className="h-7 border border-border-strong bg-surface px-1 text-2xs text-text outline-none"
          >
            {portfolios.map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      {Object.values(quotes).some(quote => quote.priceBasis === 'published-close') && <div className="shrink-0 px-2 py-1 text-2xs text-text-dim">DefeatBeta prices are published daily closes, not live quotes.</div>}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.ticker}
        onRowClick={(row) => onSelectTicker(row.ticker)}
        // A faint tint per row direction, as in the reference table.
        rowClassName={(row) =>
          !row.hasQuote ? '' : (row.changePercent ?? 0) >= 0 ? 'bg-up-bg/40' : 'bg-down-bg/40'
        }
        empty={loading ? 'Loading holdings...' : 'No holdings in this portfolio'}
      />
    </Panel>
  )
}
