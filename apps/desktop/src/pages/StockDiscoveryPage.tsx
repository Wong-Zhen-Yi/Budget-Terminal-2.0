import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { analyzeDiscovery, DISCOVERY_MAX_SECONDS, DISCOVERY_MIN_SECONDS, parseDiscoveryInterval } from '@shared/discovery'
import { isTextEntry } from '@/lib/shortcuts'
import { useChartsStore } from '@/stores/charts'
import { useDiscoverySettings } from '@/stores/discovery'
import { CompanyPanel, DiscoveryMetrics, TerminalPanel } from './stockDiscovery/DiscoveryPanels'
import { compact, money, signedPercent } from './stockDiscovery/format'
import { useDiscoveryScan } from './stockDiscovery/useDiscoveryScan'
import './stockDiscovery/discovery.css'

export function StockDiscoveryPage({ active }: { active: boolean }) {
  const intervalSeconds = useDiscoverySettings((state) => state.intervalSeconds)
  const setIntervalSeconds = useDiscoverySettings((state) => state.setIntervalSeconds)
  const [intervalDraft, setIntervalDraft] = useState(String(intervalSeconds))
  const [intervalError, setIntervalError] = useState('')
  const scan = useDiscoveryScan(active, intervalSeconds)
  const scanRef = useRef(scan)
  scanRef.current = scan
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const watchlist = useChartsStore((state) => state.watchlist)
  const setWatchlist = useChartsStore((state) => state.setWatchlist)
  const analysis = useMemo(() => scan.snapshot ? analyzeDiscovery(scan.snapshot) : null, [scan.snapshot])
  const price = scan.snapshot?.price ?? null
  const previousClose = scan.snapshot?.previousClose ?? null
  const change = price !== null && previousClose !== null ? price - previousClose : null
  const changePercent = change !== null && previousClose ? change / previousClose * 100 : null

  useEffect(() => setIntervalDraft(String(intervalSeconds)), [intervalSeconds])

  useEffect(() => {
    if (!active) return
    const handle = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTextEntry(event.target)) return
      const key = event.key.toLowerCase()
      if (event.code === 'Space') { event.preventDefault(); scanRef.current.togglePause() }
      else if (key === 'n') { event.preventDefault(); scanRef.current.next() }
      else if (key === 'p') { event.preventDefault(); scanRef.current.previous() }
      else if (key === '/') { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [active])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const symbol = search.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return
    scan.search(symbol)
    setSearch('')
    searchRef.current?.blur()
  }

  const submitInterval = (event: FormEvent) => {
    event.preventDefault()
    const valid = parseDiscoveryInterval(intervalDraft)
    if (valid === null) {
      setIntervalError(`ENTER ${DISCOVERY_MIN_SECONDS}–${DISCOVERY_MAX_SECONDS} WHOLE SECONDS`)
      return
    }
    setIntervalError('')
    setIntervalDraft(String(valid))
    if (valid === intervalSeconds) scan.resetCountdown()
    else setIntervalSeconds(valid)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  return <div className="sd-root">
    <div className="sd-toolbar">
      <div className="sd-title"><span className="sd-live-dot" /> DISCOVERY <span className="sd-muted">// {scan.paused ? 'SCAN PAUSED' : scan.loading ? 'ACQUIRING TARGET' : 'AUTO-SCAN ACTIVE'}</span></div>
      <div className="sd-timer">{scan.paused ? 'PAUSED' : scan.loading ? 'SCANNING MARKET...' : `NEXT TARGET IN ${(scan.remaining / 1000).toFixed(1)}s`}</div>
      <div className="sd-controls">
        <form className="sd-interval-form" onSubmit={submitInterval} title={`${DISCOVERY_MIN_SECONDS}–${DISCOVERY_MAX_SECONDS} seconds; applying resets the countdown`} noValidate>
          <label htmlFor="sd-interval">EVERY</label>
          <input id="sd-interval" type="number" min={DISCOVERY_MIN_SECONDS} max={DISCOVERY_MAX_SECONDS} step="1" inputMode="numeric" value={intervalDraft} onChange={(event) => { setIntervalDraft(event.target.value); setIntervalError('') }} aria-label="Scan interval in seconds" aria-invalid={Boolean(intervalError)} />
          <span>SEC</span><button type="submit">SET</button>
        </form>
        <button type="button" onClick={scan.togglePause}>{scan.paused ? 'RESUME' : 'PAUSE'}</button>
        <button type="button" onClick={scan.previous} disabled={scan.loading || scan.history.length < 2}>PREVIOUS</button>
        <button type="button" onClick={scan.next} disabled={scan.loading || !scan.universeCount}>NEXT STOCK</button>
        <form className="sd-search-form" onSubmit={submit}><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value.toUpperCase())} placeholder="TICKER /" aria-label="Search ticker" maxLength={10} /><button type="submit" disabled={!search.trim()}>GO</button></form>
      </div>
    </div>

    <div className="sd-scroll">
      <div className="sd-hero" key={scan.snapshot?.symbol ?? 'initial'}>
        <div className="sd-identity">
          <div><span className="sd-symbol">{scan.snapshot?.symbol ?? '—'}</span><span className="sd-company-name">{scan.snapshot?.name ?? 'ACQUIRING FIRST TARGET'}</span></div>
          <div className="sd-classification">{[scan.snapshot?.exchange, scan.snapshot?.sector, scan.snapshot?.industry].filter(Boolean).join('  /  ') || 'NASDAQ · NYSE · NYSE AMERICAN'}</div>
        </div>
        <div className="sd-quote"><div className="sd-price">{money(price)}</div><div className={change === null ? 'sd-change' : `sd-change ${change >= 0 ? 'sd-positive' : 'sd-negative'}`}>{change === null ? 'N/A' : `${change >= 0 ? '+' : '-'}${money(Math.abs(change))}  ${signedPercent(changePercent)}`}</div><div className="sd-quote-status">QUOTE: {scan.snapshot?.quoteStatus.toUpperCase() ?? 'UNAVAILABLE'}{scan.snapshot?.quoteDelayedMinutes ? ` · ${scan.snapshot.quoteDelayedMinutes} MIN DELAY` : ''}{scan.snapshot?.stale ? ' · PARTIAL/CACHED' : ''}</div>{scan.snapshot ? <button className="sd-watch" type="button" disabled={watchlist.includes(scan.snapshot.symbol)} onClick={() => setWatchlist([...watchlist, scan.snapshot!.symbol])}>{watchlist.includes(scan.snapshot.symbol) ? 'IN CHARTS WATCHLIST' : '+ CHARTS WATCHLIST'}</button> : null}</div>
      </div>

      <div className="sd-status"><span>{intervalError || (scan.loading ? 'SCANNING MARKET... CURRENT STOCK REMAINS VISIBLE' : scan.error || `${scan.universeCount.toLocaleString()} U.S. COMPANY SYMBOLS IN DIRECTORY`)}</span><span>{scan.snapshot?.quoteTime ? `QUOTE ${new Date(scan.snapshot.quoteTime).toLocaleString()}` : 'QUOTE TIME N/A'}</span></div>

      {scan.snapshot && analysis ? <>
        <DiscoveryMetrics snapshot={scan.snapshot} analysis={analysis} />
        <CompanyPanel snapshot={scan.snapshot} />
      </> : <div className="sd-first-load">{scan.error || 'LOADING U.S. STOCK DIRECTORY AND FIRST TARGET...'}</div>}

      <TerminalPanel title="RECENT DISCOVERIES" aside="SESSION HISTORY · CLICK TO INSPECT">
        {scan.history.length ? <div className="sd-history">{scan.history.map((entry, index) => {
          const base = entry.snapshot.previousClose
          const value = entry.snapshot.price
          const pct = value !== null && base ? (value / base - 1) * 100 : null
          return <button type="button" key={`${entry.seenAt}:${index}`} onClick={() => scan.inspect(entry)} disabled={scan.loading} className={entry.snapshot === scan.snapshot ? 'sd-history-active' : ''}><span>{new Date(entry.seenAt).toLocaleTimeString('en-GB')}</span><strong>{entry.snapshot.symbol}</strong><span>{money(value)}</span><span className={pct === null ? '' : pct >= 0 ? 'sd-positive' : 'sd-negative'}>{signedPercent(pct)}</span></button>
        })}</div> : <div className="sd-empty">DISCOVERIES WILL APPEAR HERE</div>}
      </TerminalPanel>
      <div className="sd-footer">SPACE PAUSE / RESUME · N NEXT · P PREVIOUS · / SEARCH <span>20D VOL {compact(analysis?.technicals.avgVolume20)}</span></div>
    </div>
  </div>
}
