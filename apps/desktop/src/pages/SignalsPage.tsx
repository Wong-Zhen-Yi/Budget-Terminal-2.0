import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DayTradingResult, SignalsPageSettings } from '@shared/contract'
import {
  DAY_TRADING_SETUPS, DAY_TRADING_STATUSES, DEFAULT_DAY_TRADING_SETTINGS,
  dayTradingDataMessage, dayTradingSession, dayTradingStatus, dayTradingVisible, normalizeDayTradingSettings, shouldRefreshDayTrading,
} from '@shared/dayTrading'
import { useSignalsLatest, useSignalsScan } from '@/api/signalsQueries'
import { signalsHealth } from '@/api/signalsHealth'
import { useSettings, useSettingsMutation } from '@/api/settingsQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'

const money = (value: number | null) => value === null ? '—' : value.toFixed(2)
const timestamp = (value: string | null) => value ? new Date(value).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}) + ' ET' : '—'
const age = (value: string | null, now: number) => {
  if (!value) return '—'
  const seconds = Math.max(0, Math.floor((now - Date.parse(value) - 60_000) / 1000))
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`
}
const statusColor = (status: DayTradingResult['status']) => status === 'ready' ? 'text-up'
  : status === 'error' || status === 'invalidated' ? 'text-down' : status === 'stale' || status === 'awaiting_data' ? 'text-warn' : 'text-text-muted'
const statusOptions = [{ value: 'all' as const, label: 'All statuses' },
  ...Object.entries(DAY_TRADING_STATUSES).map(([value, label]) => ({ value: value as DayTradingResult['status'], label }))]
const setupOptions = [{ value: 'all' as const, label: 'All setups' },
  ...Object.entries(DAY_TRADING_SETUPS).map(([value, label]) => ({ value: value as DayTradingResult['setup'], label }))]

export function SignalsPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const latest = useSignalsLatest()
  const scan = useSignalsScan()
  const settings = useSettings()
  const saveSettings = useSettingsMutation()
  const [controls, setControls] = useState<SignalsPageSettings>(DEFAULT_DAY_TRADING_SETTINGS)
  const [selected, setSelected] = useState('')
  const [now, setNow] = useState(Date.now)
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const hydrated = useRef(false)
  const busy = useRef(false)
  const latestFetching = useRef(latest.isFetching)
  latestFetching.current = latest.isFetching
  const scanning = latest.isFetching || scan.isPending
  // Startup already refreshed this workspace; resume its cadence without launching
  // another initial scan merely because the page is visited for the first time.
  const lastStarted = useRef(latest.data?.meta.fetchedAt ?? -Infinity)
  const envelope = latest.data
  const payload = envelope?.data ?? null
  const session = dayTradingSession(now)
  const runScan = useCallback(async (force = false) => {
    if (busy.current || latestFetching.current) return
    busy.current = true
    lastStarted.current = Date.now()
    try {
      await scan.mutateAsync({ forceMarketRefresh: force, forceUniverseRefresh: force })
    } catch { /* The mutation error is displayed beside the preserved query data. */ }
    finally { busy.current = false }
  }, [scan.mutateAsync])

  useEffect(() => {
    const health = signalsHealth(envelope, now)
    onStatusChange([{ label: 'Day Trading', envelope: health, error: scan.error ?? latest.error, enabled: true, loading: scanning }], '')
  }, [onStatusChange, envelope, payload, session.open, now, scanning, scan.error, latest.error])
  useEffect(() => { if (latest.isFetching) lastStarted.current = Date.now() }, [latest.isFetching])
  useEffect(() => {
    if (!settings.data?.data || hydrated.current) return
    hydrated.current = true
    setControls(normalizeDayTradingSettings(settings.data.data.signalsPage))
  }, [settings.data])
  useEffect(() => {
    if (!hydrated.current) return
    const timer = setTimeout(() => { void saveSettings({ type: 'setSignalsPage', value: controls }) }, 150)
    return () => clearTimeout(timer)
  }, [controls, saveSettings])
  useEffect(() => {
    const tick = () => {
      const time = Date.now()
      setNow(time)
      if (shouldRefreshDayTrading(time, document.visibilityState === 'visible', busy.current || latestFetching.current, lastStarted.current)) void runScan()
    }
    const visibility = () => {
      const shown = document.visibilityState === 'visible'
      setVisible(shown)
      if (shown) lastStarted.current = -Infinity
      tick()
    }
    tick()
    const timer = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [runScan])

  const rows = useMemo(() => (payload?.results ?? []).map((row) => {
    const status = dayTradingStatus(row, now)
    return { ...row, status: (scan.isError || envelope?.meta.freshness === 'failed') && status === 'ready' ? 'stale' as const : status }
  }), [payload, now, envelope?.meta.freshness, scan.isError])
  const filtered = rows.filter((row) => dayTradingVisible(row, controls))
  const selectionKey = (row: DayTradingResult) => `${row.ticker}:${row.setup}`
  const detail = filtered.find((row) => selectionKey(row) === selected) ?? filtered[0]
  const stocks = rows.filter((row) => row.setup === 'opening_range')
  const missing = stocks.filter((row) => row.status === 'awaiting_data').length
  const delayed = stocks.filter((row) => row.status === 'stale').length
  const errors = stocks.filter((row) => row.error).length
  const current = stocks.filter((row) => ['ready', 'watching', 'expired', 'invalidated'].includes(row.status)).length
  const columns: Column<DayTradingResult>[] = [
    { key: 'ticker', header: 'Ticker', cell: (row) => row.ticker, width: '75px', sortValue: (row) => row.ticker },
    { key: 'setup', header: 'Setup', cell: (row) => DAY_TRADING_SETUPS[row.setup], width: '155px', wrap: true },
    { key: 'status', header: 'Status', cell: (row) => <span className={statusColor(row.status)}>{DAY_TRADING_STATUSES[row.status]}</span>, width: '110px', wrap: true,
      sortValue: (row) => Object.keys(DAY_TRADING_STATUSES).indexOf(row.status) },
    { key: 'time', header: 'Signal time (ET)', cell: (row) => timestamp(row.confirmedAt), width: '155px', wrap: true, sortValue: (row) => row.confirmedAt },
    ...(['latestPrice', 'vwap', 'entry', 'stop', 'target1', 'target2'] as const).map((key, index) => ({
      key, header: ['Latest close', 'VWAP', 'Entry', 'Stop', '1R target', '2R target'][index], cell: (row: DayTradingResult) => money(row[key]),
      width: '80px', numeric: true, align: 'right' as const, sortValue: (row: DayTradingResult) => row[key],
    })),
    { key: 'age', header: 'Data age', cell: (row) => age(row.barTime, now), width: '90px', align: 'right', sortValue: (row) => row.barTime },
  ]
  const failure = scan.error?.message ?? (envelope?.meta.freshness === 'failed' ? envelope.meta.failureReason : null)
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-sm font-semibold text-text">Day Trading</h1>
        <p className="text-2xs text-text-muted">Long US stocks · 5-minute opening range breakouts · VWAP pullbacks</p>
      </header>
      <section className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface p-2">
        <span className={`text-2xs ${session.open ? 'text-up' : 'text-text-muted'}`}>US MARKET {session.open ? 'OPEN' : 'CLOSED'}</span>
        <Button variant="accent" disabled={scanning} onClick={() => void runScan()}>{scanning ? 'Refreshing…' : 'Refresh now'}</Button>
        <Button disabled={scanning} onClick={() => void runScan(true)}>Force full re-download</Button>
        <Select value={controls.setup} options={setupOptions} onChange={(setup) => setControls((old) => ({ ...old, setup }))} className="!w-48" aria-label="Setup filter" />
        <Select value={controls.filter} options={statusOptions} onChange={(filter) => setControls((old) => ({ ...old, filter }))} className="!w-36" aria-label="Status filter" />
        <SearchInput value={controls.search} onChange={(search) => setControls((old) => ({ ...old, search }))} placeholder="Search ticker" className="w-32" aria-label="Search ticker" />
        <span className="text-2xs text-text-muted">{scanning ? `Checking Yahoo · ${Math.max(0, Math.floor((now - lastStarted.current) / 1000))}s` : visible && session.open ? `Next scan in ${Math.max(0, Math.ceil((60_000 - now + lastStarted.current) / 1000))}s` : 'Auto-refresh paused'}</span>
      </section>
      <div className="shrink-0 space-y-1 border border-border bg-surface px-3 py-2 text-2xs text-text-muted">
        <p><span className="text-up">{rows.filter((row) => row.status === 'ready').length} Ready</span> · {payload?.candidates.length ?? 0} stocks · {filtered.length} setups shown · Yahoo Finance polling · Last scan: {timestamp(payload?.completedAt ?? null)}</p>
        {session.open && payload ? <p aria-label="Feed health"><span className="text-up">{current}/{stocks.length} stocks current</span> · <span className="text-warn">{missing} awaiting candles · {delayed} delayed</span> · <span className={errors ? 'text-down' : ''}>{errors} data errors</span></p> : null}
        {session.open && session.minute < 575 ? <p className="text-warn">Opening range forming until 09:35 ET. Setups require a completed confirmation candle after the range.</p> : null}
        {session.open && (missing > 0 || delayed > 0) ? <p className="text-warn">A completed scan does not guarantee fresh prices. Yahoo candle publication may lag; missing or delayed data cannot produce Ready signals. Refresh now checks the feed again.</p> : null}
        <p>Regular session only. Completed 1-minute candles; data age is measured from candle close. Ready expires after 2 minutes. Entry, stop and 1R/2R targets are signal references, not executed trades.</p>
        <p>Universe: price ≥ $5 · market cap ≥ $2B · 20-session median dollar volume ≥ $20M · up to 30 names by screener dollar volume.</p>
        {failure ? <p role="alert" className="text-down">Refresh failed: {failure}. Showing previous results where available.</p> : null}
        {payload && Object.keys(payload.errors).length > 0 ? <p role="alert" className="text-warn">{Object.keys(payload.errors).length} ticker(s) have incomplete data. Inspect their details.</p> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 xl:flex-row">
        <section className="flex min-h-48 min-w-0 flex-1 flex-col overflow-hidden border border-border">
          <DataTable columns={columns} rows={filtered} rowKey={(row) => row.id} layout="fixed" minWidth="1050px" defaultSort={{ key: 'status', direction: 'asc' }}
            onRowClick={(row) => setSelected(selectionKey(row))} rowClassName={(row) => row.id === detail?.id ? 'bg-accent-dim/60' : ''}
            empty={payload ? 'No setups match these filters.' : scan.isPending ? 'Loading liquid US stocks…' : 'No scan yet. Click Refresh now; automatic scans run during the regular session.'} />
        </section>
        <aside className="max-h-64 shrink-0 overflow-y-auto border border-border bg-surface p-3 text-2xs xl:max-h-none xl:w-72" aria-label="Setup details">
          {detail ? <>
            <h2 className="mb-2 text-sm font-semibold text-text">{detail.ticker} · {DAY_TRADING_SETUPS[detail.setup]}</h2>
            <p className={`mb-2 ${statusColor(detail.status)}`}>{DAY_TRADING_STATUSES[detail.status]}</p>
            <p className="mb-3 leading-5 text-text-muted">{dayTradingDataMessage(detail, now)}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              {([['Entry reference', money(detail.entry)], ['Stop', money(detail.stop)], ['1R target', money(detail.target1)], ['2R target', money(detail.target2)],
                ['Opening high', money(detail.openingHigh)], ['Opening low', money(detail.openingLow)], ['Session VWAP', money(detail.vwap)],
                ['Latest close', money(detail.latestPrice)], ['Session', detail.session], ['Signal confirmed', timestamp(detail.confirmedAt)],
                ['Provider bar start', timestamp(detail.barTime)], ['Data age', age(detail.barTime, now)]]).map(([label, value]) => <div key={label}><dt className="text-text-dim">{label}</dt><dd className="break-words text-text">{value}</dd></div>)}
            </dl>
            <div className="mt-3 space-y-2 leading-5 text-text-muted">{detail.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div>
            {detail.invalidatedAt ? <p className="mt-2 text-down">Stop touched at {timestamp(detail.invalidatedAt)}.</p> : null}
            {detail.error ? <p className="mt-2 text-down">{detail.error}</p> : null}
            <p className="mt-3 leading-5 text-text-dim">Latest confirmation per setup. Stops are checked against subsequent completed candle lows. Targets express risk multiples; no fill or performance is assumed.</p>
          </> : <p className="text-text-muted">Select a setup to inspect its conditions and reference levels.</p>}
        </aside>
      </div>
    </div>
  )
}
