import { useEffect, useMemo, useState } from 'react'

import type { EtfAumPayload } from '@shared/contract'
import { etfAum, filterAumRows } from '@shared/etf'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/SearchInput'

const QUICK_FUNDS = ['SPY', 'QQQ', 'VOO', 'VTI', 'IVV', 'IWM', 'DIA', 'ARKK', 'GLD', 'TLT', 'BND', 'SCHD']
const PAGE_SIZE = 60

export function AumRail({ payload, loading, failureReason, filter, onFilterChange, onSelect, onRefresh, refreshing, selected }: {
  payload: EtfAumPayload | undefined
  loading: boolean
  failureReason: string
  filter: string
  onFilterChange: (value: string) => void
  onSelect: (ticker: string) => void
  onRefresh: () => void
  refreshing: boolean
  selected: string
}) {
  const [category, setCategory] = useState('All')
  const [page, setPage] = useState(0)
  const categories = useMemo(() => ['All', ...new Set(payload?.rows.map(row => row.category).filter((value): value is string => Boolean(value)))], [payload])
  const rows = useMemo(() => filterAumRows(payload?.rows ?? [], filter)
    .filter(row => category === 'All' || row.category === category), [payload, filter, category])
  useEffect(() => setPage(0), [filter, category, payload])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)

  return (
    <aside className="etf-browser" aria-label="ETF fund browser">
      <header className="etf-browser-heading">
        <div><span className="etf-eyebrow">Discover</span><h2>Fund browser</h2></div>
        <Button onClick={onRefresh} disabled={refreshing || loading} title="Refresh the directory. Repeated clicks reuse the cache for at least one minute.">Refresh list</Button>
      </header>
      <SearchInput aria-label="Search ETFs" value={filter} onChange={onFilterChange} placeholder="Ticker, fund name or asset class" />
      <label className="etf-category">Asset class
        <select aria-label="ETF asset class" value={category} onChange={event => setCategory(event.target.value)}>
          {categories.map(value => <option key={value}>{value}</option>)}
        </select>
      </label>
      <div className="etf-quick-funds" aria-label="Popular ETFs">
        {QUICK_FUNDS.map(ticker => <button type="button" key={ticker} aria-pressed={selected === ticker} onClick={() => onSelect(ticker)}>{ticker}</button>)}
      </div>
      <div className="etf-browser-count"><span>{payload ? `${payload.rows.length.toLocaleString()} funds` : loading ? 'Loading fund directory…' : 'Directory unavailable'}</span><span>Assets ↓</span></div>
      {failureReason ? <p role="alert" className="etf-warning">{failureReason} {payload ? 'Showing the saved directory.' : 'Popular tickers above still work.'}</p> : null}
      <div className="etf-fund-list">
        {rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map(row => (
          <button type="button" key={row.ticker} className="etf-fund-row" aria-pressed={selected === row.ticker} onClick={() => onSelect(row.ticker)}>
            <span className="etf-fund-row-top"><strong>{row.ticker}</strong><span>{etfAum(row.netAssets)}</span></span>
            <span className="etf-fund-name">{row.name || row.ticker}</span>
            <span className="etf-fund-category">{row.category || 'ETF'}</span>
          </button>
        ))}
        {!rows.length ? <p className="etf-empty">{loading ? 'Loading the directory independently of holdings…' : payload ? 'No funds match these filters.' : 'Choose a popular fund or enter a ticker to get started.'}</p> : null}
      </div>
      <footer className="etf-browser-footer">
        <div><Button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</Button><span>{safePage + 1} / {pages}</span><Button disabled={safePage + 1 >= pages} onClick={() => setPage(safePage + 1)}>Next</Button></div>
        <p>{rows.length.toLocaleString()} matches · {payload?.source || 'Public fund directory'}</p>
        <p>{payload ? `Saved ${new Date(payload.fetchedAt).toLocaleString()}` : 'Directory and holdings cached for 24 hours.'}</p>
        {payload?.missingCount ? <p>{payload.missingCount} funds have no published AUM.</p> : null}
        <p>Provider AUM may include other share classes.</p>
      </footer>
    </aside>
  )
}
