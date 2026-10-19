import { useMemo } from 'react'

import type { EtfHoldingRow, EtfSectorSlice } from '@shared/contract'
import { buildDonut, etfWeight, filterHoldings } from '@shared/etf'
import { Donut } from '@/components/charts/Donut'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { SearchInput } from '@/components/ui/SearchInput'

export function HoldingsTab({ holdings, sectors, filter, onFilterChange, onOpenSymbol, loading }: {
  holdings: EtfHoldingRow[]
  sectors: EtfSectorSlice[]
  filter: string
  onFilterChange: (value: string) => void
  onOpenSymbol: (symbol: string) => void
  loading: boolean
}) {
  const rows = useMemo(() => filterHoldings(holdings, filter), [holdings, filter])
  const donut = useMemo(() => buildDonut(holdings), [holdings])
  const columns: Array<Column<EtfHoldingRow>> = [
    { key: 'symbol', header: 'Symbol', width: '100px', cell: row => <strong>{row.symbol}</strong>, sortValue: row => row.symbol },
    { key: 'name', header: 'Holding', cell: row => <span className="text-text-muted">{row.name}</span>, sortValue: row => row.name },
    { key: 'weight', header: 'Allocation', width: '150px', align: 'right', numeric: true,
      cell: row => <span className="etf-weight"><span className="etf-weight-track"><span style={{ width: `${Math.min(100, Math.max(0, (row.weight ?? 0) * 1000))}%` }} /></span>{etfWeight(row.weight)}</span>, sortValue: row => row.weight },
  ]
  return (
    <div className="etf-holdings-layout">
      <section className="etf-holdings-table">
        <div className="etf-table-tools"><SearchInput aria-label="Filter holdings by ticker or name" value={filter} onChange={onFilterChange} placeholder="Find a holding…" /><span>{rows.length} / {holdings.length} rows</span></div>
        <DataTable columns={columns} rows={rows} layout="fixed" minWidth="400px" rowKey={(row, index) => `${row.symbol}-${index}`} onRowDoubleClick={row => onOpenSymbol(row.symbol)} defaultSort={{ key: 'weight', direction: 'desc' }} empty={loading ? 'Loading published holdings…' : 'No holdings available. Try another ETF or refresh.'} />
        <p className="etf-table-note">Double-click a holding to open its chart. Allocation bars are scaled to 10%.</p>
      </section>
      <aside className="etf-allocation-panel">
        <header><span className="etf-eyebrow">Portfolio composition</span><h3>Holdings allocation</h3></header>
        <div className="etf-donut"><Donut slices={donut.slices} startAngle={donut.startAngle} centerText={`${donut.coveragePct.toFixed(1)}%`} centerSubtext="Weight covered" empty={loading ? 'Loading allocation…' : 'No allocation data'} /></div>
        <p className="etf-composition-note">Largest positions plus Others. Others includes smaller positions and any uncovered weight.</p>
        <div className="etf-sectors"><h3>Sector exposure</h3>
          {sectors.length ? sectors.map(slice => <div className="etf-sector" key={slice.sector}><div><span>{slice.sector}</span><strong>{slice.percent.toFixed(1)}%</strong></div><span className="etf-sector-track"><span style={{ width: `${Math.min(100, Math.max(0, slice.percent))}%` }} /></span></div>) : <p>Sector breakdown is not supplied by this source.</p>}
        </div>
      </aside>
    </div>
  )
}
