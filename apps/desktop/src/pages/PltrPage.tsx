import { useEffect, useMemo, useRef, useState } from 'react'
import { STOCKS_RANGE_PRESETS } from '@shared/contract'
import type { Envelope, StocksRangePreset } from '@shared/contract'
import { pltrHistory } from '@shared/pltr'
import { queryKeys } from '@/api/client'
import { useStocks, useRefreshStocks } from '@/api/stocksQueries'
import { useFundamentalsPage, useRefreshFundamentalsPage } from '@/api/fundamentalsPageQueries'
import { effectiveFreshness, feedErrorText, useSnapshotClock } from '@/api/snapshotHealth'
import { queryFreshness } from '@/api/queryPersistence'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { CandlestickChart } from '@/components/charts/CandlestickChart'
import { FinancialCharts, FinancialHistory, LatestSources, OwnershipPanels, RevenueChart, SourcePanels, ValuationPanel, VolumeChart } from '@/components/pltr/PltrPanels'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { compactCurrency, compactNumber, currency, percent, signedCurrencyPrecise } from '@/lib/format'
import '@/styles/pltr.css'

const SECTIONS = ['Overview', 'Financials', 'Valuation', 'Ownership', 'News & filings'] as const
type Section = (typeof SECTIONS)[number]
const sectionId = (section: Section) => `pltr-${SECTIONS.indexOf(section)}`

function problems(envelope: Envelope<unknown> | undefined, error: Error | null): string {
  return [error?.message, envelope?.meta.failureReason, ...envelope?.errors.map(feedErrorText) ?? []].filter(Boolean).join(' · ')
}

export function PltrPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const marketQuery = useStocks('PLTR', null)
  const financialQuery = useFundamentalsPage('PLTR', null)
  const refreshMarket = useRefreshStocks()
  const refreshFinancials = useRefreshFundamentalsPage()
  const now = useSnapshotClock()
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const [section, setSection] = useState<Section>('Overview')
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const market = marketQuery.data?.data
  const financials = financialQuery.data?.data.displayCurrency === 'USD' && financialQuery.data.data.currencyVersion === 2 ? financialQuery.data.data : null
  const history = useMemo(() => pltrHistory(financials), [financials])
  const latest = history.at(-1)
  const stats = market?.chart.stats
  const busy = refreshing || marketQuery.isFetching || financialQuery.isFetching
  const marketWarning = problems(marketQuery.data, marketQuery.error)
  const financialWarning = [problems(financialQuery.data, financialQuery.error), ...financials?.warnings ?? []].filter(Boolean).join(' · ')
  const candles = useMemo(() => {
    const all = market?.chart.candles ?? []
    const end = all.at(-1)
    if (!end) return []
    const start = new Date(end.time * 1000)
    start.setUTCMonth(start.getUTCMonth() - ({ '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36 }[range || '1Y']))
    return all.filter(candle => candle.time * 1000 >= start.getTime())
  }, [market?.chart.candles, range])

  useEffect(() => {
    onStatusChange([
      { label: 'PLTR market', envelope: marketQuery.data, error: marketQuery.error, enabled: marketQuery.isEnabled, loading: marketQuery.isFetching },
      { label: 'PLTR financials', envelope: financialQuery.data, error: financialQuery.error, enabled: financialQuery.isEnabled, loading: financialQuery.isFetching },
    ], '')
  }, [marketQuery.data, marketQuery.error, marketQuery.isEnabled, marketQuery.isFetching, financialQuery.data, financialQuery.error, financialQuery.isEnabled, financialQuery.isFetching, onStatusChange])

  const refresh = async () => {
    setNotice('')
    setRefreshing(true)
    const results = await Promise.allSettled([refreshMarket('PLTR'), refreshFinancials('PLTR')])
    setNotice(results.flatMap(result => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []).join(' · '))
    setRefreshing(false)
  }
  const freshness = (envelope: Envelope<unknown> | undefined, fetching: boolean, lifetime: number) => fetching ? 'loading…' : envelope ? effectiveFreshness(envelope, now, lifetime) : 'unavailable'
  const marketStatus = freshness(marketQuery.data, marketQuery.isFetching, queryFreshness(queryKeys.stocks('PLTR')))
  const financialStatus = freshness(financialQuery.data, financialQuery.isFetching, queryFreshness(queryKeys.fundamentalsPage('PLTR')))
  const period = latest?.endDate ?? 'unavailable'
  const tiles = [
    ['Quarterly revenue', compactCurrency(latest?.revenue), `${percent(latest?.revenueGrowth)} Y/Y`],
    ['GAAP net income', compactCurrency(latest?.netIncome), `${percent(latest?.netMargin)} net margin`],
    ['Free cash flow', compactCurrency(latest?.freeCashFlow), `${percent(latest?.fcfMargin)} FCF margin`],
    ['Market cap', compactCurrency(financials?.facts.marketCap), 'Latest snapshot'],
    ['Shares outstanding', compactNumber(latest?.sharesOutstanding), `${percent(latest?.shareGrowth)} Y/Y · period end`],
  ]
  const historyProps = { history, loading: financialQuery.isFetching, warning: financialWarning, source: financialQuery.data?.meta.source || '' }
  const valuation = <ValuationPanel market={market} financials={financials} warning={[marketWarning, financialWarning].filter(Boolean).join(' · ')} onOpen={() => onNavigate('valuation', 'PLTR')} />

  return <div className="pltr-page flex min-h-0 flex-1 flex-col overflow-auto" data-pltr-page data-pltr-section={section}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-xl font-semibold">PLTR <span className="text-sm font-normal text-text-muted">Palantir Technologies</span></h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-text-muted">
          <span>{market?.company.exchange || financials?.company.exchange || 'Exchange unavailable'}</span>
          <span>{market?.company.sector || financials?.company.sector || 'Sector unavailable'}</span>
          <span>{stats?.priceSource ?? 'USD · daily close'}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="num text-2xl font-semibold">{currency(stats?.price)}</span>
        <span className={`num text-2xs ${stats ? stats.change >= 0 ? 'text-up' : 'text-down' : 'text-text-muted'}`}>{signedCurrencyPrecise(stats?.absChange)} ({percent(stats?.change)})</span>
        <Button variant="accent" disabled={busy} onClick={() => { void refresh() }}>{busy ? 'Loading PLTR…' : 'Refresh'}</Button>
      </div>
    </header>
    <nav className="pltr-tabs shrink-0" aria-label="PLTR research navigation">
      <div className="flex flex-wrap gap-x-5" role="tablist" aria-label="PLTR sections">
        {SECTIONS.map((item, index) => <button key={item} ref={element => { tabRefs.current[index] = element }} id={`${sectionId(item)}-tab`} role="tab" aria-selected={section === item} aria-controls="pltr-section-panel" tabIndex={section === item ? 0 : -1} className="pltr-tab text-2xs" onClick={() => setSection(item)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % SECTIONS.length : event.key === 'ArrowLeft' ? (index + SECTIONS.length - 1) % SECTIONS.length : event.key === 'Home' ? 0 : event.key === 'End' ? SECTIONS.length - 1 : null
          if (next !== null) { event.preventDefault(); setSection(SECTIONS[next]); tabRefs.current[next]?.focus() }
        }}>{item}</button>)}
      </div>
      <div className="ml-auto flex flex-wrap gap-1 pb-1">{['stocks', 'charts', 'fundamentals', 'options', 'valuation'].map(id => <Button key={id} className="capitalize" aria-label={`Open PLTR ${id}`} onClick={() => onNavigate(id, 'PLTR')}>{id} ↗</Button>)}</div>
    </nav>
    {notice || marketWarning || financialWarning ? <div role="status" className="shrink-0 border border-warn/40 bg-surface p-2 text-xs text-warn">{[notice, marketWarning, financialWarning].filter(Boolean).join(' · ')}</div> : null}
    <div className="pltr-kpis shrink-0" aria-label="PLTR financial snapshot">{tiles.map(([label, value, subtitle]) => <div key={label} className="pltr-kpi"><div className="text-2xs text-text-muted">{label}</div><div className="num my-1 text-xl font-semibold">{value}</div><div className="text-2xs text-text-muted">{subtitle}</div></div>)}</div>
    <div id="pltr-section-panel" role="tabpanel" aria-labelledby={`${sectionId(section)}-tab`} className="flex shrink-0 flex-col gap-3">
      {section === 'Overview' ? <>
        <div className="pltr-market-grid">
          <Panel title="Price action · PLTR" warning={marketWarning} className="pltr-price-panel" actions={<div className="flex flex-wrap justify-end gap-1">{STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} variant="toggle" active={range === preset} onClick={() => setRange(preset)}>{preset}</Button>)}</div>}>
            <div className="flex min-h-0 flex-[3] flex-col overflow-hidden p-2" data-pltr-price-range={range} data-pltr-candle-count={candles.length}>{candles.length ? <CandlestickChart candles={candles} /> : <PanelMessage>{marketQuery.isFetching ? 'Loading price history…' : 'Price history unavailable.'}</PanelMessage>}</div>
            <div className="shrink-0 border-t border-border px-2 pt-1 text-2xs text-text-muted">Daily volume · shares</div>
            <div className="pltr-volume flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-1"><VolumeChart candles={candles} /></div>
            <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">USD · daily bars{market?.chart.candles.at(-1) ? ` as of ${new Date(market.chart.candles.at(-1)!.time * 1000).toISOString().slice(0, 10)}` : ''}</div>
          </Panel>
          {valuation}
        </div>
        <div className="pltr-overview-grid">
          <RevenueChart history={history} financials={financials} loading={financialQuery.isFetching} warning={financialWarning} onOpen={() => setSection('Financials')} />
          <FinancialHistory {...historyProps} compact onOpen={() => setSection('Financials')} />
          <LatestSources market={market} financials={financials} loading={busy} warning={[marketWarning, financialWarning].filter(Boolean).join(' · ')} onOpen={() => setSection('News & filings')} />
        </div>
        <details className="shrink-0 border border-border bg-surface p-3 text-2xs"><summary className="text-text-muted">Company profile</summary><p className="mt-2">{market?.company.description || (marketQuery.isFetching ? 'Loading company profile…' : 'Company profile unavailable.')}</p></details>
      </> : section === 'Financials' ? <>
        <FinancialCharts history={history} loading={financialQuery.isFetching} warning={financialWarning} />
        <FinancialHistory {...historyProps} />
      </> : section === 'Valuation' ? <div className="pltr-market-grid">{valuation}<Panel title="Valuation context"><div className="p-3 text-2xs text-text-muted">Multiples and analyst targets reflect their latest available snapshots and may differ in observation date. The Valuation workspace offers peer comparisons and calculation details.<p className="mt-3">{market?.company.description || 'Company profile unavailable.'}</p></div></Panel></div>
      : section === 'Ownership' ? <OwnershipPanels market={market} loading={marketQuery.isFetching} warning={marketWarning} />
      : <SourcePanels market={market} financials={financials} marketLoading={marketQuery.isFetching} financialLoading={financialQuery.isFetching} marketWarning={marketWarning} financialWarning={financialWarning} />}
    </div>
    <footer className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-2 text-2xs text-text-muted">
      <div>Market {marketStatus} · Financials {financialStatus}</div><div>Quarter ended {period} · USD</div>
      <details><summary>Source details</summary><div className="mt-1">Market: {marketQuery.data?.meta.source || 'Unavailable'} · fetched {marketQuery.data ? new Date(marketQuery.data.meta.fetchedAt).toLocaleString() : 'unavailable'}<br />Financials: {financialQuery.data?.meta.source || 'Unavailable'} · fetched {financialQuery.data ? new Date(financialQuery.data.meta.fetchedAt).toLocaleString() : 'unavailable'}</div></details>
    </footer>
  </div>
}
