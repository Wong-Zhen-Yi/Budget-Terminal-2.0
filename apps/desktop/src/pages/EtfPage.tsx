import { useCallback, useEffect, useMemo, useState } from 'react'

import { arbitrageClipboard, buildDonut, filterHoldings, holdingsClipboard, etfWeight } from '@shared/etf'
import { FRESHNESS } from '@shared/freshness'
import { api } from '@/api/client'
import { useEtfArbitrage, useEtfAum, useEtfHoldings, useRefreshEtfArbitrage, useRefreshEtfAum, useRefreshEtfHoldings } from '@/api/etfQueries'
import { ArbitrageTab } from '@/components/etf/ArbitrageTab'
import { AumRail } from '@/components/etf/AumRail'
import { HoldingsTab } from '@/components/etf/HoldingsTab'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataFreshness } from '@/components/ui/DataFreshness'
import { useEtfPage } from '@/stores/etf'
import '@/styles/etf.css'

const message = (error: unknown): string => error instanceof Error ? error.message : error ? String(error) : ''

export function EtfPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate?: (tabId: string, symbol?: string) => void
}) {
  const { ticker, setTicker, subtab, setSubtab, holdingsFilter, setHoldingsFilter, aumFilter, setAumFilter } = useEtfPage()
  const [draft, setDraft] = useState(ticker)
  const [notice, setNotice] = useState('')
  useEffect(() => setDraft(ticker), [ticker])
  const holdingsQuery = useEtfHoldings(ticker)
  const arbitrageQuery = useEtfArbitrage(ticker)
  const aumQuery = useEtfAum()
  const refreshHoldings = useRefreshEtfHoldings()
  const refreshArbitrage = useRefreshEtfArbitrage()
  const refreshAum = useRefreshEtfAum()
  const fund = holdingsQuery.data?.data.ticker === ticker ? holdingsQuery.data.data : undefined
  const arbitrage = arbitrageQuery.data?.data.ticker === ticker ? arbitrageQuery.data.data : undefined
  const holdings = useMemo(() => fund?.holdings ?? [], [fund])
  const coverage = useMemo(() => buildDonut(holdings).coveragePct, [holdings])
  const topTen = holdings.slice(0, 10).reduce((sum, row) => sum + Math.max(0, row.weight ?? 0), 0)
  const directoryEntry = aumQuery.data?.data.rows.find(row => row.ticker === ticker)
  const failure = message(holdingsQuery.error)
  const aumFailure = message(aumQuery.error) || aumQuery.data?.meta.failureReason || ''

  useEffect(() => {
    onStatusChange([
      { label: 'ETF holdings', envelope: holdingsQuery.data, error: holdingsQuery.error, enabled: true, loading: holdingsQuery.isFetching },
      { label: 'ETF directory', envelope: aumQuery.data, error: aumQuery.error, enabled: true, loading: aumQuery.isFetching },
      { label: 'ETF basket analysis', envelope: arbitrageQuery.data, error: arbitrageQuery.error, enabled: Boolean(arbitrageQuery.data) || arbitrageQuery.isFetching, loading: arbitrageQuery.isFetching },
    ], '')
  }, [onStatusChange, holdingsQuery.data, holdingsQuery.error, holdingsQuery.isFetching, aumQuery.data, aumQuery.error, aumQuery.isFetching, arbitrageQuery.data, arbitrageQuery.error, arbitrageQuery.isFetching])

  const select = useCallback((next: string) => {
    const symbol = next.trim().toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) {
      setNotice('Enter a valid ETF ticker, for example SPY, QQQ or VOO.')
      return
    }
    setNotice('')
    setDraft(symbol)
    setTicker(symbol)
    setHoldingsFilter('')
    // Selection only changes the query key. It never bypasses either cache.
  }, [setTicker, setHoldingsFilter])

  const perform = useCallback(async (action: () => Promise<void>) => {
    setNotice('')
    try { await action() } catch (error) { setNotice(message(error)) }
  }, [])

  const copy = async () => {
    if (subtab === 'arbitrage') {
      if (!arbitrage?.rows.length) return
      await api.writeClipboard(arbitrageClipboard(arbitrage.rows))
      setNotice(`Copied ${arbitrage.rows.length} basket rows.`)
    } else {
      const rows = filterHoldings(holdings, holdingsFilter)
      if (!rows.length) return
      await api.writeClipboard(holdingsClipboard(rows))
      setNotice(`Copied ${rows.length} holdings.`)
    }
  }

  const metrics = [
    { label: 'Net assets', value: fund?.netAssets && fund.netAssets !== '--' ? `$${fund.netAssets}` : '--', detail: 'Published fund assets' },
    { label: 'Expense ratio', value: fund?.expenseRatio || '--', detail: 'Annual fund expense' },
    { label: 'Holdings loaded', value: fund ? holdings.length.toLocaleString() : '--', detail: fund?.isPartial ? 'Partial public snapshot' : 'Published issuer holdings' },
    { label: 'Weight covered', value: fund ? `${coverage.toFixed(1)}%` : '--', detail: 'Of total fund allocation' },
    { label: 'Top 10 weight', value: fund ? etfWeight(topTen) : '--', detail: 'Loaded position concentration' },
  ]

  return (
    <div className="etf-workspace">
      <header className="etf-workspace-header">
        <div><span className="etf-eyebrow">Research workspace</span><h1>ETF Explorer</h1><p>Find a fund. Understand what you own.</p></div>
        <div className="etf-cache-badge"><span />Cache-first research<small>24h fund snapshots · no automatic basket polling</small></div>
      </header>
      <div className="etf-workspace-body">
        <AumRail payload={aumQuery.data?.data} loading={aumQuery.isFetching} failureReason={aumFailure} filter={aumFilter} onFilterChange={setAumFilter} onSelect={select} onRefresh={() => void perform(refreshAum)} refreshing={aumQuery.isFetching} selected={ticker} />
        <main className="etf-detail">
          <form className="etf-ticker-form" onSubmit={event => { event.preventDefault(); select(draft) }}>
            <label htmlFor="etf-ticker">Open a fund</label>
            <input id="etf-ticker" aria-label="ETF ticker" value={draft} maxLength={15} onChange={event => setDraft(event.target.value.toUpperCase())} placeholder="SPY, QQQ, VOO…" autoComplete="off" spellCheck={false} />
            <Button type="submit" variant="accent">Open ETF</Button>
            <Button onClick={() => void perform(() => refreshHoldings(ticker))} disabled={holdingsQuery.isFetching} title="Request an updated fund snapshot. Cached for at least one minute even on manual refresh.">{holdingsQuery.isFetching ? 'Loading…' : 'Refresh holdings'}</Button>
          </form>
          <section className="etf-fund-hero" aria-label="Selected ETF">
            <div className="etf-symbol-mark">{ticker}</div>
            <div className="etf-fund-title"><div className="etf-fund-tags"><span>{directoryEntry?.category || 'Exchange-traded fund'}</span><span className={fund?.isPartial ? 'etf-partial-tag' : ''}>{fund ? fund.isPartial ? 'Partial holdings' : 'Issuer holdings' : holdingsQuery.isFetching ? 'Loading snapshot' : 'Snapshot unavailable'}</span></div><h2>{fund?.fundName || directoryEntry?.name || ticker}</h2><p>{fund?.issuer || 'Published fund research'} · Holdings as of {fund?.asOfDate || 'not supplied'}</p></div>
            {fund?.sourceUrl ? <Button onClick={() => void perform(() => api.openExternal(fund.sourceUrl))}>View source ↗</Button> : null}
          </section>
          <div className="etf-metrics">{metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>)}</div>
          {notice ? <p className="etf-notice" role="status">{notice}</p> : null}
          {failure ? <div className="etf-warning" role="alert"><strong>{fund ? 'Refresh unavailable. Saved holdings remain visible.' : `Could not load ${ticker}.`}</strong> {failure}</div> : null}
          {holdingsQuery.data?.meta.freshness === 'stale' ? <p className="etf-warning" role="status">Showing saved holdings. {holdingsQuery.data.meta.failureReason || 'The provider could not refresh this snapshot.'}</p> : null}
          {fund?.coverageNote ? <p className="etf-warning">{fund.coverageNote}</p> : null}
          <div className="etf-content-tabs" role="tablist" aria-label="ETF research views">
            <button type="button" role="tab" aria-selected={subtab === 'holdings'} onClick={() => setSubtab('holdings')}>Holdings & exposure <span>{holdings.length}</span></button>
            <button type="button" role="tab" aria-selected={subtab === 'arbitrage'} onClick={() => setSubtab('arbitrage')}>Basket analysis</button>
            <Button className="ml-auto" onClick={() => void perform(copy)} disabled={subtab === 'holdings' ? !holdings.length : !arbitrage?.rows.length}>Copy table</Button>
          </div>
          {subtab === 'holdings' ? <>
            <DataFreshness envelope={holdingsQuery.data} loading={holdingsQuery.isFetching} error={holdingsQuery.error} freshnessMs={FRESHNESS.etfHoldings} coverage={fund ? `${holdings.length} holdings · ${coverage.toFixed(1)}% weight${fund.isPartial ? ' · incomplete list' : ''}` : undefined} />
            <HoldingsTab holdings={holdings} sectors={fund?.sectorBreakdown ?? []} filter={holdingsFilter} onFilterChange={setHoldingsFilter} onOpenSymbol={symbol => onNavigate?.('charts', symbol)} loading={holdingsQuery.isFetching} />
          </> : <div className="etf-basket-view">
            <p className="etf-analysis-note">On-demand Yahoo Finance quotes, shared with other pages and cached for at least 2 minutes. Opening this view does not call Yahoo. This is a return comparison, not a tradable NAV premium; partial holdings can make the gap misleading.</p>
            {arbitrageQuery.data || arbitrageQuery.error ? <DataFreshness envelope={arbitrageQuery.data} loading={arbitrageQuery.isFetching} error={arbitrageQuery.error} freshnessMs={FRESHNESS.etfArbitrage} /> : null}
            <ArbitrageTab payload={arbitrage} loading={arbitrageQuery.isFetching} failureReason={message(arbitrageQuery.error) || arbitrageQuery.data?.meta.failureReason || ''} hasHoldings={holdings.length > 0} onRefresh={() => void perform(() => refreshArbitrage(ticker))} onOpenSymbol={symbol => onNavigate?.('charts', symbol)} />
          </div>}
          <footer className="etf-policy">Saved across restarts · Refresh cooldown: 1 min for funds / 2 min for quotes · Failed providers pause for 5 min · Last good data retained on errors</footer>
        </main>
      </div>
    </div>
  )
}
