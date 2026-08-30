import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  QuantActiveTab,
  QuantPairDetail,
  QuantPairFilter,
  QuantPairRow,
  QuantScreenFilter,
  QuantScreenRow,
} from '@shared/contract'
import {
  buildQuantExport,
  DEFAULT_QUANT_PAGE_SETTINGS,
  describeDickeyFuller,
  filterPairRows,
  filterScreenRows,
  normalizeQuantPageSettings,
  QUANT_PAIR_FILTERS,
  QUANT_SCREEN_FILTERS,
} from '@shared/quant'
import { useQuantLatest, useQuantPair, useQuantScan } from '@/api/quantQueries'
import { useSettings, useSettingsMutation } from '@/api/settingsQueries'
import { LineChart } from '@/components/charts/LineChart'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'

type Tone = 'muted' | 'positive' | 'warning' | 'negative'

const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

function plain(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits)
}

function percent(value: number | null, digits = 1): string {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function price(value: number | null): string {
  return value === null
    ? '—'
    : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function age(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000))
  if (seconds < 90) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 90) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 36 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

function directional(value: number | null, higher = true): string {
  if (value === null || value === 0) return ''
  return (higher ? value > 0 : value < 0) ? 'text-up' : 'text-down'
}

export function QuantPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const latest = useQuantLatest()
  const scan = useQuantScan()
  const pair = useQuantPair()
  const settings = useSettings()
  const saveSettings = useSettingsMutation()
  const hydrated = useRef(false)

  const [activeTab, setActiveTab] = useState<QuantActiveTab>(DEFAULT_QUANT_PAGE_SETTINGS.activeTab)
  const [screenFilter, setScreenFilter] = useState<QuantScreenFilter>(DEFAULT_QUANT_PAGE_SETTINGS.screenFilter)
  const [pairFilter, setPairFilter] = useState<QuantPairFilter>(DEFAULT_QUANT_PAGE_SETTINGS.pairFilter)
  const [search, setSearch] = useState(DEFAULT_QUANT_PAGE_SETTINGS.search)
  const [pairLeft, setPairLeft] = useState(DEFAULT_QUANT_PAGE_SETTINGS.pairLeft)
  const [pairRight, setPairRight] = useState(DEFAULT_QUANT_PAGE_SETTINGS.pairRight)
  const [pairDetail, setPairDetail] = useState<QuantPairDetail | null>(null)
  const [notice, setNotice] = useState('')

  const envelope = scan.data ?? latest.data
  const payload = envelope?.data ?? null

  useEffect(() => {
    const panels: PanelStatus[] = [
      { label: 'Quant scan', envelope, loading: latest.isPending || scan.isPending },
    ]
    if (pair.data || pair.isPending) panels.push({ label: 'Pair model', envelope: pair.data, loading: pair.isPending })
    onStatusChange(panels, '')
  }, [onStatusChange, envelope, latest.isPending, scan.isPending, pair.data, pair.isPending])

  useEffect(() => {
    const saved = settings.data?.data.quantPage
    if (!saved || hydrated.current) return
    const normalized = normalizeQuantPageSettings(saved)
    hydrated.current = true
    setActiveTab(normalized.activeTab)
    setScreenFilter(normalized.screenFilter)
    setPairFilter(normalized.pairFilter)
    setSearch(normalized.search)
    setPairLeft(normalized.pairLeft)
    setPairRight(normalized.pairRight)
  }, [settings.data])

  useEffect(() => {
    if (!hydrated.current) return
    const timer = setTimeout(() => {
      void saveSettings({
        type: 'setQuantPage',
        value: { activeTab, screenFilter, pairFilter, search, pairLeft, pairRight },
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [activeTab, screenFilter, pairFilter, search, pairLeft, pairRight, saveSettings])

  const screenRows = useMemo(
    () => filterScreenRows(payload?.rows ?? [], screenFilter, search),
    [payload, screenFilter, search],
  )
  const pairRows = useMemo(
    () => filterPairRows(payload?.pairs ?? [], pairFilter),
    [payload, pairFilter],
  )

  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (notice) return { text: notice, tone: 'positive' }
    if (pair.isPending) return { text: `Modelling ${pairLeft.trim().toUpperCase()} / ${pairRight.trim().toUpperCase()}…`, tone: 'warning' }
    if (pair.data?.meta.freshness === 'failed') return { text: `Pair analysis failed: ${pair.data.meta.failureReason ?? 'Pair unavailable'}`, tone: 'negative' }
    if (scan.isPending) return { text: 'Sourcing universe and computing factors…', tone: 'warning' }
    if (scan.data?.meta.freshness === 'failed') return { text: `Scan failed: ${scan.data.meta.failureReason ?? 'Quant unavailable'}`, tone: 'negative' }
    if (!payload?.rows.length) return { text: 'No Quant scan yet. Run a scan to source and rank a universe.', tone: 'muted' }
    const detail = `${payload.rows.length} ranked, ${payload.pairs.length} pair(s) — scanned ${age(payload.completedAt)}`
    const errors = Object.keys(payload.errors).length
    return errors
      ? { text: `${detail}; ${errors} ticker(s) returned incomplete data.`, tone: 'warning' }
      : { text: detail, tone: 'positive' }
  }, [notice, pair.isPending, pair.data, pairLeft, pairRight, scan.isPending, scan.data, payload])

  const analyze = useCallback((leftInput = pairLeft, rightInput = pairRight) => {
    const left = leftInput.trim().toUpperCase().slice(0, 12)
    const right = rightInput.trim().toUpperCase().slice(0, 12)
    setPairLeft(left)
    setPairRight(right)
    setNotice('')
    pair.mutate({ left, right }, {
      onSuccess: (result) => {
        if (result.data) setPairDetail(result.data)
      },
    })
  }, [pair, pairLeft, pairRight])

  const exportVisible = useCallback(async () => {
    if (!payload?.rows.length) return
    const screenLabel = QUANT_SCREEN_FILTERS.find((entry) => entry.value === screenFilter)?.label ?? 'All ranked'
    const pairLabel = QUANT_PAIR_FILTERS.find((entry) => entry.value === pairFilter)?.label ?? 'All pairs'
    await window.api.writeClipboard(buildQuantExport(payload, {
      screenRows,
      pairRows,
      screenFilterLabel: screenLabel,
      pairFilterLabel: pairLabel,
      search,
      pairDetail,
    }))
    setNotice(`Copied ${screenRows.length} screener row(s) and ${pairRows.length} pair(s) to the clipboard.`)
  }, [payload, screenFilter, pairFilter, screenRows, pairRows, search, pairDetail])

  const stationary = payload?.pairs.filter((row) => row.stationaryAt === '1%' || row.stationaryAt === '5%').length ?? 0
  const leader = payload?.rows[0]
  const metrics = [
    ['Ranked', payload ? payload.rows.length : '—'],
    ['Universe', payload ? payload.universeSize : '—'],
    ['Pairs', payload ? payload.pairs.length : '—'],
    ['Stationary', payload ? stationary : '—'],
    ['Top composite', leader ? `${leader.ticker} (${plain(leader.composite)})` : '—'],
    ['Data errors', payload ? Object.keys(payload.errors).length : '—'],
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-baseline gap-3">
        <h1 className="text-sm font-semibold text-text">Quant</h1>
        <p className="text-2xs text-text-muted">
          Sources its own liquid US universe, ranks it on cross-sectional factors, and hunts mean-reverting pairs. Decision support only.
        </p>
      </div>

      <section className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface p-2">
        <Button variant="accent" disabled={scan.isPending} onClick={() => { setNotice(''); scan.mutate({}) }}>
          {scan.isPending ? 'Scanning…' : 'Run scan'}
        </Button>
        <Button
          disabled={scan.isPending}
          title="Re-screen the universe from scratch, ignoring the cached shortlist."
          onClick={() => { setNotice(''); scan.mutate({ forceUniverseRefresh: true }) }}
        >
          Force universe refresh
        </Button>
        <Button variant="positive" disabled={!payload?.rows.length} onClick={() => void exportVisible()}>
          Export to LLM
        </Button>
        <span className={`ml-auto text-right text-2xs ${toneClass[status.tone]}`}>{status.text}</span>
      </section>

      <section className="flex shrink-0 gap-6 overflow-x-auto border border-border bg-surface px-3 py-2">
        {metrics.map(([caption, value]) => (
          <div key={caption} className="min-w-16 shrink-0">
            <div className="text-[10px] text-text-dim">{caption}</div>
            <div className="num text-xs font-semibold text-text">{value}</div>
          </div>
        ))}
      </section>

      {scan.isPending ? <div className="h-1 shrink-0 animate-pulse bg-accent" /> : null}

      <div className="flex shrink-0 border-b border-border">
        {([['screener', 'Screener'], ['pairs', 'Pairs']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`border-b-2 px-4 py-1.5 text-2xs ${activeTab === key ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'screener' ? (
        <ScreenerTab
          rows={screenRows}
          hasPayload={Boolean(payload)}
          filter={screenFilter}
          search={search}
          onFilter={setScreenFilter}
          onSearch={setSearch}
        />
      ) : (
        <PairsTab
          rows={pairRows}
          hasPayload={Boolean(payload)}
          filter={pairFilter}
          left={pairLeft}
          right={pairRight}
          detail={pairDetail}
          loading={pair.isPending}
          onFilter={setPairFilter}
          onLeft={setPairLeft}
          onRight={setPairRight}
          onAnalyze={() => analyze()}
          onSelect={(row) => analyze(row.left, row.right)}
        />
      )}
    </div>
  )
}

function ScreenerTab({
  rows,
  hasPayload,
  filter,
  search,
  onFilter,
  onSearch,
}: {
  rows: QuantScreenRow[]
  hasPayload: boolean
  filter: QuantScreenFilter
  search: string
  onFilter: (value: QuantScreenFilter) => void
  onSearch: (value: string) => void
}) {
  const factor = (key: keyof QuantScreenRow, header: string, digits = 1, color = false): Column<QuantScreenRow> => ({
    key,
    header,
    cell: (row) => <span className={color ? directional(row[key] as number | null) : ''}>{plain(row[key] as number | null, digits)}</span>,
    sortValue: (row) => row[key] as number | null,
    align: 'right',
    numeric: true,
    width: '72px',
  })
  const columns: Array<Column<QuantScreenRow>> = [
    { key: 'rank', header: 'Rank', cell: (row) => row.rank, sortValue: (row) => row.rank, align: 'right', numeric: true, width: '52px' },
    { key: 'ticker', header: 'Ticker', cell: (row) => <span title={row.name}>{row.ticker}</span>, sortValue: (row) => row.ticker, width: '74px' },
    { key: 'price', header: 'Price', cell: (row) => price(row.lastPrice), sortValue: (row) => row.lastPrice, align: 'right', numeric: true, width: '84px' },
    { ...factor('momentum1m', '1M %', 1, true), cell: (row) => <span className={directional(row.momentum1m)}>{percent(row.momentum1m)}</span> },
    { ...factor('momentum3m', '3M %', 1, true), cell: (row) => <span className={directional(row.momentum3m)}>{percent(row.momentum3m)}</span> },
    { ...factor('momentum6m', '6M %', 1, true), cell: (row) => <span className={directional(row.momentum6m)}>{percent(row.momentum6m)}</span> },
    { ...factor('momentum12m', '12M %', 1, true), cell: (row) => <span className={directional(row.momentum12m)}>{percent(row.momentum12m)}</span> },
    factor('volatilityPct', 'Vol %'),
    factor('sharpe', 'Sharpe', 2, true),
    { ...factor('maxDrawdownPct', 'Max DD %'), cell: (row) => percent(row.maxDrawdownPct) },
    factor('zScore', 'Z-Score', 2),
    factor('rsi', 'RSI'),
    { ...factor('composite', 'Composite'), cell: (row) => <span className={(row.composite ?? 0) >= 75 ? 'text-accent-hover' : ''}>{plain(row.composite)}</span>, width: '86px' },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-2xs text-text-muted">Filter</span>
        <Select value={filter} options={QUANT_SCREEN_FILTERS} onChange={onFilter} className="w-48" aria-label="Quant screener filter" />
        <span className="ml-2 text-2xs text-text-muted">Search</span>
        <SearchInput value={search} onChange={onSearch} placeholder="Ticker" className="w-28" aria-label="Quant ticker search" />
      </div>
      <p className="shrink-0 text-[10px] leading-4 text-text-dim">
        Universe: US common stocks · price ≥ $5 · market cap ≥ $2B · 20-session median dollar volume ≥ $20M. Composite is a cross-sectional percentile: 50% momentum (3/6/12M), 30% Sharpe, 20% low volatility.
      </p>
      <div className="flex min-h-0 flex-1 overflow-hidden border border-border">
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.ticker} layout="fixed" defaultSort={{ key: 'rank', direction: 'asc' }} empty={hasPayload ? 'No screener rows match the active filter.' : 'Run a scan to source and rank the Quant universe.'} />
      </div>
    </div>
  )
}

function PairsTab({
  rows,
  hasPayload,
  filter,
  left,
  right,
  detail,
  loading,
  onFilter,
  onLeft,
  onRight,
  onAnalyze,
  onSelect,
}: {
  rows: QuantPairRow[]
  hasPayload: boolean
  filter: QuantPairFilter
  left: string
  right: string
  detail: QuantPairDetail | null
  loading: boolean
  onFilter: (value: QuantPairFilter) => void
  onLeft: (value: string) => void
  onRight: (value: string) => void
  onAnalyze: () => void
  onSelect: (row: QuantPairRow) => void
}) {
  const columns: Array<Column<QuantPairRow>> = [
    { key: 'rank', header: 'Rank', cell: (row) => row.rank, sortValue: (row) => row.rank, align: 'right', numeric: true, width: '52px' },
    { key: 'left', header: 'Long', cell: (row) => row.left, sortValue: (row) => row.left, width: '70px' },
    { key: 'right', header: 'Short', cell: (row) => row.right, sortValue: (row) => row.right, width: '70px' },
    { key: 'correlation', header: 'Corr', cell: (row) => plain(row.correlation, 2), sortValue: (row) => row.correlation, align: 'right', numeric: true, width: '62px' },
    { key: 'hedge', header: 'Hedge', cell: (row) => <span title="Shares of the short leg per share of the long leg (OLS on price levels).">{plain(row.hedgeRatio, 3)}</span>, sortValue: (row) => row.hedgeRatio, align: 'right', numeric: true, width: '70px' },
    { key: 'spreadZ', header: 'Spread Z', cell: (row) => <span className={row.spreadZ !== null && Math.abs(row.spreadZ) >= 2 ? 'text-warn' : ''}>{plain(row.spreadZ, 2)}</span>, sortValue: (row) => row.spreadZ, align: 'right', numeric: true, width: '76px' },
    { key: 'halfLife', header: 'Half-life', cell: (row) => row.halfLife === null ? '—' : `${row.halfLife.toFixed(1)}d`, sortValue: (row) => row.halfLife, align: 'right', numeric: true, width: '78px' },
    { key: 'hurst', header: 'Hurst', cell: (row) => <span className={row.hurst !== null && row.hurst < 0.45 ? 'text-up' : ''}>{plain(row.hurst, 2)}</span>, sortValue: (row) => row.hurst, align: 'right', numeric: true, width: '62px' },
    { key: 'df', header: 'DF stat', cell: (row) => <span title={describeDickeyFuller(row.dickeyFuller, row.stationaryAt)}>{plain(row.dickeyFuller, 2)}</span>, sortValue: (row) => row.dickeyFuller, align: 'right', numeric: true, width: '70px' },
    { key: 'stationary', header: 'Stationary', cell: (row) => <span className={row.stationaryAt ? 'text-up' : 'text-text-muted'}>{row.stationaryAt || 'no'}</span>, sortValue: (row) => ({ '1%': 3, '5%': 2, '10%': 1 }[row.stationaryAt] ?? 0), width: '86px' },
    { key: 'score', header: 'Score', cell: (row) => <span className={(row.score ?? 0) >= 60 ? 'text-accent-hover' : ''}>{plain(row.score)}</span>, sortValue: (row) => row.score, align: 'right', numeric: true, width: '66px' },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-2xs text-text-muted">Filter</span>
        <Select value={filter} options={QUANT_PAIR_FILTERS} onChange={onFilter} className="w-56" aria-label="Quant pair filter" />
        <span className="ml-2 text-2xs text-text-muted">Inspect pair</span>
        <input value={left} onChange={(event) => onLeft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onAnalyze() }} placeholder="Long" aria-label="Long ticker" className="h-8 w-20 border border-border-strong bg-surface-raised px-2 text-2xs uppercase text-text outline-none focus:border-accent" />
        <input value={right} onChange={(event) => onRight(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onAnalyze() }} placeholder="Short" aria-label="Short ticker" className="h-8 w-20 border border-border-strong bg-surface-raised px-2 text-2xs uppercase text-text outline-none focus:border-accent" />
        <Button disabled={loading} onClick={onAnalyze}>{loading ? 'Analysing…' : 'Analyse'}</Button>
      </div>
      <p className="shrink-0 text-[10px] leading-4 text-text-dim">
        Pairs are prescreened by return correlation, then the spread is fitted by OLS on price levels and tested for mean reversion. Because many pairs are tested at once, roughly 1 in 20 will clear the 5% Dickey-Fuller threshold by chance — treat a stationary verdict as a shortlist, not a conclusion.
      </p>
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex min-h-0 basis-[56%] overflow-hidden border border-border">
          <DataTable columns={columns} rows={rows} rowKey={(row) => `${row.left}/${row.right}`} layout="fixed" defaultSort={{ key: 'rank', direction: 'asc' }} onRowClick={onSelect} empty={hasPayload ? 'No pairs match the active filter.' : 'Run a scan to discover pairs, or inspect any two tickers above.'} />
        </div>
        <PairDetail detail={detail} loading={loading} />
      </div>
    </div>
  )
}

function PairDetail({ detail, loading }: { detail: QuantPairDetail | null; loading: boolean }) {
  if (!detail) {
    return (
      <aside className="flex min-h-0 min-w-0 flex-1 items-center justify-center border border-border p-3 text-2xs text-text-dim">
        {loading ? 'Loading pair history…' : 'Select a discovered pair or enter two tickers to inspect.'}
      </aside>
    )
  }
  const validSpread = detail.points.filter((point) => point.spreadZ !== null)
  const lines = [
    `Pair: long ${detail.left} / short ${detail.right}`,
    `Hedge ratio: ${plain(detail.hedgeRatio, 3)} shares of ${detail.right} per share of ${detail.left}`,
    `Correlation of daily returns: ${plain(detail.correlation, 2)}`,
    `Spread Z-score: ${plain(detail.latestZ, 2)}`,
    `Half-life of mean reversion: ${detail.halfLife === null ? '—' : `${detail.halfLife.toFixed(1)}d`}`,
    `Hurst exponent: ${plain(detail.hurst, 2)}`,
    describeDickeyFuller(detail.dickeyFuller, detail.stationaryAt),
    `Overlapping sessions: ${detail.observations}`,
  ]
  if (detail.latestZ !== null && Math.abs(detail.latestZ) >= 2) lines.push(`Spread is stretched beyond 2 sigma — the mean-reversion setup is to ${detail.latestZ > 0 ? 'short' : 'long'} the spread.`)
  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-auto border border-border bg-surface p-2">
      <h2 className="shrink-0 text-sm font-semibold text-text">{detail.left} / {detail.right}</h2>
      <div className="h-36 shrink-0 border border-border bg-bg">
        <LineChart labels={validSpread.map((point) => point.date)} series={[
          { label: 'Spread Z', color: 'var(--color-accent)', values: validSpread.map((point) => point.spreadZ) },
          { label: '+2σ', color: 'var(--color-warn)', dashed: true, values: validSpread.map(() => 2) },
          { label: '-2σ', color: 'var(--color-warn)', dashed: true, values: validSpread.map(() => -2) },
        ]} format={(value) => value.toFixed(1)} baseline="zero" ticks={5} />
      </div>
      <div className="h-32 shrink-0 border border-border bg-bg">
        <LineChart labels={detail.points.map((point) => point.date)} series={[
          { label: detail.left, color: 'var(--color-accent)', values: detail.points.map((point) => point.leftIndexed - 100) },
          { label: detail.right, color: 'var(--color-up)', values: detail.points.map((point) => point.rightIndexed - 100) },
        ]} format={(value) => `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`} baseline="zero" ticks={5} />
      </div>
      <pre className="whitespace-pre-wrap border border-border bg-bg p-2 font-mono text-[10px] leading-4 text-text-muted">{lines.join('\n')}</pre>
    </aside>
  )
}
