import { useEffect, useMemo, useState } from 'react'
import { MARKET_CAP_TIERS, marketCapInTier } from '@shared/marketCap'
import type { MarketCapRow, MarketCapTier } from '@shared/contract'
import { formatPriceScreenMarketCap } from '@shared/priceScreen'
import { useMarketCap, useMarketCapSales } from '@/api/marketCapQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const metric = (value: number | null | undefined, suffix = '') =>
  value == null || !Number.isFinite(value) ? 'N/A' : `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`
type MetricsRow = MarketCapRow & { priceToSales: number | null }
const columns: Column<MetricsRow>[] = [
  { key: 'rank', header: 'Rank', cell: (row) => row.rank, numeric: true, width: 'w-16' },
  { key: 'ticker', header: 'Ticker', cell: (row) => <span className="text-accent">{row.ticker}</span>, width: 'w-24' },
  { key: 'name', header: 'Company', cell: (row) => row.name, wrap: true },
  { key: 'marketCap', header: 'Market Cap', cell: (row) => <span title={money(row.marketCap)}>{formatPriceScreenMarketCap(row.marketCap)}</span>, sortValue: (row) => row.marketCap, numeric: true, align: 'right', width: 'w-36' },
  { key: 'price', header: 'Share Price', cell: (row) => row.price === null ? 'N/A' : money(row.price), numeric: true, align: 'right', width: 'w-32' },
  { key: 'trailingEps', header: <span title="Reported earnings per share over the trailing twelve months">EPS (TTM)</span>, cell: (row) => metric(row.trailingEps), sortValue: (row) => row.trailingEps ?? null, numeric: true, align: 'right', width: 'w-28' },
  { key: 'trailingPe', header: <span title="Price divided by trailing twelve-month earnings per share">P/E (TTM)</span>, cell: (row) => metric(row.trailingPe, 'x'), sortValue: (row) => row.trailingPe ?? null, numeric: true, align: 'right', width: 'w-28' },
  { key: 'forwardPe', header: <span title="Yahoo Finance forward price-to-earnings estimate">Forward P/E</span>, cell: (row) => metric(row.forwardPe, 'x'), sortValue: (row) => row.forwardPe ?? null, numeric: true, align: 'right', width: 'w-28' },
  { key: 'priceToSales', header: <span title="Price-to-sales ratio using trailing twelve-month revenue">P/S (TTM)</span>, cell: (row) => metric(row.priceToSales, 'x'), sortValue: (row) => row.priceToSales, numeric: true, align: 'right', width: 'w-28' },
  { key: 'exchange', header: 'Exchange', cell: (row) => row.exchange, width: 'w-32' },
]

export function MarketCapPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const [tier, setTier] = useState<MarketCapTier>('all')
  const query = useMarketCap(tier)
  const [search, setSearch] = useState('')
  const received = query.data?.data
  const mismatched = received?.rows.some((row) => !marketCapInTier(row.marketCap, tier)) ?? false
  const payload = mismatched ? undefined : received
  const sales = useMarketCapSales((payload?.rows ?? []).map((row) => row.ticker))
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (payload?.rows ?? []).filter((row) => `${row.ticker} ${row.name}`.toLowerCase().includes(needle))
      .map((row) => ({ ...row, priceToSales: sales.data?.data[row.ticker] ?? null }))
  }, [payload, search, sales.data])
  useEffect(() => {
    onStatusChange([{ label: 'Market Cap', envelope: query.data, loading: query.isFetching }, { label: 'P/S', envelope: sales.data, loading: sales.isFetching }], '')
  }, [onStatusChange, query.data, query.isFetching, sales.data, sales.isFetching])
  const warning = mismatched
    ? 'The cached ranking does not match this range. Refresh to load matching companies.'
    : query.error?.message ?? query.data?.meta.failureReason

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-sm font-semibold text-text">Market Cap</h1>
        <select aria-label="Market cap range" value={tier} onChange={(event) => { setTier(event.target.value as MarketCapTier); setSearch('') }} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text">
          {MARKET_CAP_TIERS.map((range) => <option key={range.id} value={range.id}>{range.label}</option>)}
        </select>
        <input aria-label="Search companies" placeholder="Search ticker or company" value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 w-64 border border-border-strong bg-surface-raised px-2 text-2xs text-text" />
        <Button onClick={() => { void query.refresh(); void sales.refresh() }} disabled={query.isFetching}>{query.isFetching ? 'Loading…' : 'Refresh'}</Button>
        <span className="text-2xs text-text-muted">{rows.length} / {payload?.rows.length ?? 0} stocks</span>
      </div>
      <p className="text-2xs text-text-muted">Largest 100 US-listed equities in the selected range · USD · Ranks, search and sorting apply within this range. Double-click a row to open Stocks.</p>
      <p className="text-2xs text-text-dim">{payload?.source ?? 'Yahoo Finance'} · Updated {payload?.asOf ? new Date(payload.asOf).toLocaleString() : '—'}</p>
      {sales.isFetching ? <p className="text-2xs text-text-muted">Loading P/S ratios...</p> : null}
      {sales.isError || sales.data?.errors.length ? <p className="text-2xs text-warn">Some P/S ratios could not be refreshed; cached values are retained where available.</p> : null}
      {warning ? <p role="alert" className="text-2xs text-warn">{warning}</p> : null}
      <DataTable key={tier} columns={columns} rows={rows} rowKey={(row) => row.ticker} defaultSort={{ key: 'marketCap', direction: 'desc' }} layout="fixed" minWidth="1240px" onRowDoubleClick={(row) => onNavigate('stocks', row.ticker)} empty={query.isFetching ? 'Loading market-cap ranking…' : warning && !payload?.rows.length ? 'Ranking unavailable. Try Refresh.' : search ? 'No matching companies in this range’s top 100.' : 'No eligible companies returned in this range.'} />
    </div>
  )
}
