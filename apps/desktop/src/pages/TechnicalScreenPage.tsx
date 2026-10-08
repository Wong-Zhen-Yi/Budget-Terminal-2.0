import { useEffect, useMemo, useState } from 'react'

import type { TechnicalScanRow } from '@shared/contract'
import { TECHNICAL_PRESETS, type TechnicalPreset } from '@shared/technicalScreen'
import { useTechnicalScan, useTechnicalSnapshot } from '@/api/technicalScreenQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Select } from '@/components/ui/Select'

const number = (value: number) => value.toFixed(2)
const percent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
const dateTime = (value: string) => new Date(value).toLocaleString()

export function TechnicalScreenPage({
  onStatusChange,
  onNavigate,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const [preset, setPreset] = useState<TechnicalPreset>('aboveSma200')
  const [search, setSearch] = useState('')
  const [clock, setClock] = useState(Date.now())
  const snapshot = useTechnicalSnapshot()
  const scan = useTechnicalScan()
  const envelope = snapshot.data
  const age = Math.max(clock, Date.now()) - Date.parse(envelope?.data?.completedAt ?? '')
  const expired = Boolean(envelope?.data) && (!Number.isFinite(age) || age < 0 || age > 12 * 60 * 60_000)
  const payload = expired ? null : envelope?.data
  const failure = scan.data?.meta.freshness === 'failed'
    ? scan.data.meta.failureReason
    : scan.error?.message

  useEffect(() => {
    onStatusChange([{ label: 'Technical Indicators', envelope, error: scan.error ?? snapshot.error, enabled: true, loading: scan.isPending || snapshot.isFetching }], '')
  }, [onStatusChange, envelope, scan.isPending])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (payload?.rows ?? []).filter((row) =>
      row.matches[preset] && `${row.ticker} ${row.name}`.toLowerCase().includes(needle),
    )
  }, [payload, preset, search])

  const columns = useMemo<Array<Column<TechnicalScanRow>>>(() => {
    const common: Array<Column<TechnicalScanRow>> = [
      { key: 'ticker', header: 'Ticker', cell: (row) => <strong className="text-text">{row.ticker}</strong>, width: '8%', sortValue: (row) => row.ticker },
      { key: 'name', header: 'Company', cell: (row) => row.name, width: '25%', sortValue: (row) => row.name },
      { key: 'close', header: 'Close', cell: (row) => number(row.close), align: 'right', numeric: true, width: '9%', sortValue: (row) => row.close },
    ]
    const metrics: Array<Column<TechnicalScanRow>> = preset === 'aboveSma200' ? [
      { key: 'sma200', header: 'SMA200', cell: (row) => number(row.sma200), align: 'right', numeric: true, width: '10%', sortValue: (row) => row.sma200 },
      { key: 'distance', header: 'Above SMA200', cell: (row) => percent((row.close / row.sma200 - 1) * 100), align: 'right', numeric: true, width: '13%', sortValue: (row) => row.close / row.sma200 - 1 },
    ] : preset === 'goldenCross' ? [
      { key: 'sma50', header: 'SMA50', cell: (row) => number(row.sma50), align: 'right', numeric: true, width: '10%', sortValue: (row) => row.sma50 },
      { key: 'sma200', header: 'SMA200', cell: (row) => number(row.sma200), align: 'right', numeric: true, width: '10%', sortValue: (row) => row.sma200 },
      { key: 'spread', header: '50 vs 200', cell: (row) => percent((row.sma50 / row.sma200 - 1) * 100), align: 'right', numeric: true, width: '12%', sortValue: (row) => row.sma50 / row.sma200 - 1 },
    ] : preset === 'rsiBreakout' ? [
      { key: 'rsi', header: 'RSI14', cell: (row) => number(row.rsi), align: 'right', numeric: true, width: '10%', sortValue: (row) => row.rsi },
      { key: 'projectedRsi', header: 'Projected RSI', cell: (row) => number(row.projectedRsi), align: 'right', numeric: true, width: '14%', sortValue: (row) => row.projectedRsi },
    ] : [
      { key: 'macd', header: 'MACD', cell: (row) => number(row.macd), align: 'right', numeric: true, width: '10%', sortValue: (row) => row.macd },
      { key: 'signal', header: 'Signal', cell: (row) => number(row.macdSignal), align: 'right', numeric: true, width: '10%', sortValue: (row) => row.macdSignal },
      { key: 'projectedGap', header: 'Projected gap', cell: (row) => number(row.projectedMacdGap), align: 'right', numeric: true, width: '14%', sortValue: (row) => row.projectedMacdGap },
    ]
    return [...common, ...metrics,
      { key: 'barDate', header: 'Bar date', cell: (row) => row.barDate, width: '12%', sortValue: (row) => row.barDate },
      { key: 'volume', header: 'Median $ volume', cell: (row) => `$${(row.medianDollarVolume / 1e6).toFixed(1)}M`, align: 'right', numeric: true, width: '13%', sortValue: (row) => row.medianDollarVolume },
    ]
  }, [preset])

  const selected = TECHNICAL_PRESETS.find((entry) => entry.id === preset)!
  const matches = payload?.rows.filter((row) => row.matches[preset]).length ?? 0
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-baseline gap-3">
        <h1 className="text-sm font-semibold text-text">Technical Indicators</h1>
        <p className="text-2xs text-text-muted">Daily signals from the top 100 liquid US stocks in the Quant shortlist.</p>
      </div>

      <section className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface p-2">
        <Button variant="accent" disabled={scan.isPending} onClick={() => scan.mutate()}>
          {scan.isPending ? 'Scanning…' : 'Run scan'}
        </Button>
        <Select value={preset} options={TECHNICAL_PRESETS.map((entry) => ({ value: entry.id, label: entry.label }))}
          onChange={setPreset} className="w-52" aria-label="Technical screen" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticker or company"
          aria-label="Search technical results" className="h-7 w-48 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none focus:border-accent" />
        <span className="ml-auto text-2xs text-text-muted">
          {scan.isPending ? 'Fetching daily history…' : payload ? `Updated ${dateTime(payload.completedAt)}` : expired ? 'Saved scan expired — run again' : 'Run a scan to find matches'}
        </span>
      </section>

      <section className="flex shrink-0 flex-wrap gap-x-5 gap-y-1 border border-border bg-surface px-3 py-2 text-2xs">
        <span><strong className="text-text">{matches}</strong> matches</span>
        <span><strong className="text-text">{payload?.scannedCount ?? 0}</strong> scanned</span>
        <span><strong className="text-text">{Object.keys(payload?.errors ?? {}).length}</strong> failed</span>
        <span><strong className="text-text">{payload?.universeCount ?? 0}</strong> in shortlist</span>
        <span className="text-text-muted">Double-click a stock to inspect it.</span>
      </section>

      {selected.estimated ? (
        <p className="shrink-0 text-2xs text-warn">Estimate: extrapolates the last two completed indicator readings one session ahead. A projected cross is not a confirmed signal or price forecast.</p>
      ) : null}
      {failure ? <p className="shrink-0 text-2xs text-down">Scan failed: {failure}{payload ? ' Showing the previous result.' : ''}</p> : null}
      {payload && Object.keys(payload.errors).length ? (
        <p className="shrink-0 text-2xs text-warn">{Object.keys(payload.errors).length} ticker(s) had insufficient or unavailable daily history and were excluded.</p>
      ) : null}

      <DataTable columns={columns} rows={rows} rowKey={(row) => row.ticker} layout="fixed" minWidth="900px"
        defaultSort={{ key: 'volume', direction: 'desc' }} onRowDoubleClick={(row) => onNavigate('stocks', row.ticker)}
        empty={payload ? (matches ? 'No matches for this search.' : `No stocks matched ${selected.label} in this scan.`) : 'Run a scan to load technical results.'} />
    </div>
  )
}
