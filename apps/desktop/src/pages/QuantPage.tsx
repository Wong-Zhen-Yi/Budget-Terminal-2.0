import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import type {
  QuantActiveTab,
  QuantPairDetail,
  QuantPairFilter,
  QuantPairRow,
  QuantScanPayload,
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
import { DataTable, type Column } from '@/components/ui/DataTable'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'
import '@/styles/quant.css'

type Tone = 'muted' | 'positive' | 'warning' | 'negative'
type Notice = { text: string; tone: Tone }

function plain(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits)
}

function percent(value: number | null, digits = 1): string {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function price(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function age(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000))
  if (seconds < 90) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 90) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 36 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

function directional(value: number | null): string {
  return value === null || value === 0 ? '' : value > 0 ? 'text-up' : 'text-down'
}

function Icon({ name }: { name: 'scan' | 'export' | 'arrow' | 'layers' }) {
  const paths = {
    scan: 'M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M8 12h8m-4-4v8',
    export: 'M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5',
    arrow: 'M5 12h14m-5-5 5 5-5 5',
    layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  }
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

export function QuantPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
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
  const [lastPayload, setLastPayload] = useState<QuantScanPayload | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const envelope = scan.data ?? latest.data
  const payload = envelope?.data ?? lastPayload

  // Keep the last usable snapshot visible if a refresh returns a failed envelope.
  useEffect(() => {
    if (envelope?.data) setLastPayload(envelope.data)
  }, [envelope])

  useEffect(() => {
    const panels: PanelStatus[] = [
      { label: 'Quant scan', envelope, error: scan.error ?? latest.error, enabled: true, loading: latest.isPending || scan.isPending },
    ]
    if (pair.data || pair.isPending || pair.error) panels.push({ label: 'Pair model', envelope: pair.data, error: pair.error, enabled: true, loading: pair.isPending })
    onStatusChange(panels, '')
  }, [onStatusChange, envelope, latest.isPending, latest.error, scan.isPending, scan.error, pair.data, pair.isPending, pair.error])

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
      void saveSettings({ type: 'setQuantPage', value: { activeTab, screenFilter, pairFilter, search, pairLeft, pairRight } })
    }, 150)
    return () => clearTimeout(timer)
  }, [activeTab, screenFilter, pairFilter, search, pairLeft, pairRight, saveSettings])

  const screenRows = useMemo(() => filterScreenRows(payload?.rows ?? [], screenFilter, search), [payload, screenFilter, search])
  const pairRows = useMemo(() => filterPairRows(payload?.pairs ?? [], pairFilter), [payload, pairFilter])
  const scanFailure = scan.error?.message ?? latest.error?.message ?? (envelope?.meta.freshness === 'failed' ? envelope.meta.failureReason ?? 'Quant unavailable' : null)
  const pairFailure = pair.error?.message ?? (pair.data?.meta.freshness === 'failed' ? pair.data.meta.failureReason ?? 'Pair unavailable' : null)
  const status = useMemo<Notice>(() => {
    if (scan.isPending) return { text: 'Sourcing the liquid US universe and computing factors. This can take a few minutes.', tone: 'warning' }
    if (scanFailure) return { text: `Scan failed: ${scanFailure}.${payload ? ' Showing the last available snapshot.' : ' Try running a new scan.'}`, tone: 'negative' }
    if (latest.isPending) return { text: 'Restoring the latest research snapshot…', tone: 'warning' }
    if (notice) return notice
    if (!payload) return { text: 'Your workspace is ready. Run a scan to build a ranked universe and discover pairs.', tone: 'muted' }
    const errors = Object.keys(payload.errors).length
    return errors
      ? { text: `${errors} ticker(s) returned incomplete data. Available results remain usable; review data coverage below.`, tone: 'warning' }
      : { text: 'Research snapshot loaded. Filter, compare and inspect without running another scan.', tone: 'positive' }
  }, [notice, scan.isPending, scanFailure, latest.isPending, payload])

  const analyze = useCallback((leftInput = pairLeft, rightInput = pairRight) => {
    const left = leftInput.trim().toUpperCase().slice(0, 12)
    const right = rightInput.trim().toUpperCase().slice(0, 12)
    if (!left || !right || left === right || pair.isPending) return
    setPairLeft(left)
    setPairRight(right)
    setNotice(null)
    pair.mutate({ left, right }, { onSuccess: (result) => { if (result.data) setPairDetail(result.data) } })
  }, [pair, pairLeft, pairRight])

  const exportVisible = useCallback(async () => {
    if (!payload?.rows.length) return
    try {
      await window.api.writeClipboard(buildQuantExport(payload, {
        screenRows,
        pairRows,
        screenFilterLabel: QUANT_SCREEN_FILTERS.find((entry) => entry.value === screenFilter)?.label ?? 'All ranked',
        pairFilterLabel: QUANT_PAIR_FILTERS.find((entry) => entry.value === pairFilter)?.label ?? 'All pairs',
        search,
        pairDetail,
      }))
      setNotice({ text: `Copied ${screenRows.length} screener row(s) and ${pairRows.length} pair(s) to the clipboard.`, tone: 'positive' })
    } catch (error) {
      setNotice({ text: `Export failed: ${error instanceof Error ? error.message : 'Clipboard unavailable'}`, tone: 'negative' })
    }
  }, [payload, screenRows, pairRows, screenFilter, pairFilter, search, pairDetail])

  const stationary = payload?.pairs.filter((row) => row.stationaryAt === '1%' || row.stationaryAt === '5%').length ?? 0
  const leader = payload?.rows[0]
  const errors = payload ? Object.keys(payload.errors).length : 0

  return (
    <div className="quant-page">
      <header className="quant-hero">
        <div className="quant-heading">
          <div className="quant-monogram" aria-hidden="true">∑</div>
          <div>
            <div className="quant-eyebrow">RESEARCH WORKSPACE <span>/</span> SYSTEMATIC STRATEGIES</div>
            <h1>Quant research<span className="quant-title-dot">.</span></h1>
            <p>Find relative strength. Investigate mean reversion.</p>
          </div>
        </div>
        <div className="quant-hero-actions">
          <span className={`quant-snapshot ${scan.isPending ? 'is-busy' : ''}`}><i />{scan.isPending ? 'Scan in progress' : payload ? `Snapshot · ${age(payload.completedAt)}` : 'Awaiting first scan'}</span>
          <div className="quant-action-row">
            <button type="button" className="quant-button" disabled={!payload?.rows.length} onClick={() => void exportVisible()} title="Copy filtered screener, pairs and inspected model as LLM-ready research"><Icon name="export" /> Export to LLM</button>
            <button type="button" className="quant-button quant-button-primary" disabled={scan.isPending} onClick={() => { setNotice(null); scan.mutate({}) }}><Icon name="scan" />{scan.isPending ? 'Scanning…' : 'Run scan'}</button>
          </div>
        </div>
      </header>

      <section className="quant-overview" aria-label="Scan overview">
        <OverviewCard label="01 / INVESTABLE UNIVERSE" value={payload ? payload.rows.length.toLocaleString() : '—'} suffix="ranked stocks" footer={payload ? `${payload.universeSize.toLocaleString()} candidates sourced` : 'Liquid US common stocks'}>
          <div className="quant-coverage-track"><span style={{ width: payload?.universeSize ? `${Math.min(100, payload.rows.length / payload.universeSize * 100)}%` : '0%' }} /></div>
        </OverviewCard>
        <OverviewCard label="02 / FACTOR LEADER" value={leader?.ticker ?? '—'} suffix={leader ? `${plain(leader.composite)} / 100` : 'composite score'} footer={leader?.name ?? 'Momentum × risk-adjusted quality'}>
          <div className="quant-weight-track"><i /><i /><i /></div>
        </OverviewCard>
        <OverviewCard label="03 / MEAN REVERSION" value={payload ? String(stationary) : '—'} suffix="stationary pairs" footer={payload ? `${payload.pairs.length} discovered · 5% threshold or better` : 'Correlation → OLS → stationarity'}>
          <span className="quant-card-symbol" aria-hidden="true">↔</span>
        </OverviewCard>
        <OverviewCard label="04 / DATA COVERAGE" value={payload ? String(errors) : '—'} suffix="incomplete tickers" footer={payload ? errors ? 'Partial coverage · inspect details below' : 'No ticker errors in this snapshot' : 'Coverage reported after each scan'} tone={errors ? 'warning' : 'positive'}>
          <span className="quant-card-symbol" aria-hidden="true">{payload ? errors ? '!' : '✓' : '·'}</span>
        </OverviewCard>
      </section>

      <div className={`quant-status quant-tone-${status.tone}`} role="status" aria-live="polite">
        <span className={`quant-status-dot ${scan.isPending || latest.isPending ? 'is-busy' : ''}`} />
        <span>{status.text}</span>
        <button type="button" className="quant-text-button" disabled={scan.isPending} title="Re-source the universe from scratch, ignoring the cached shortlist" onClick={() => { setNotice(null); scan.mutate({ forceUniverseRefresh: true }) }}>Force universe refresh <span aria-hidden="true">↗</span></button>
      </div>

      <nav className="quant-workspace-nav" aria-label="Quant research views">
        <div className="quant-tabs" role="tablist" aria-label="Research mode">
          {([['screener', 'Factor screener', payload?.rows.length], ['pairs', 'Pairs lab', payload?.pairs.length]] as const).map(([key, label, count]) => (
            <button key={key} type="button" role="tab" id={`quant-tab-${key}`} aria-label={label} aria-selected={activeTab === key} aria-controls={`quant-panel-${key}`} onClick={() => setActiveTab(key)} onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
                event.preventDefault()
                const next = event.key === 'Home' ? 'screener' : event.key === 'End' ? 'pairs' : key === 'screener' ? 'pairs' : 'screener'
                setActiveTab(next)
                document.getElementById(`quant-tab-${next}`)?.focus()
              }
            }} tabIndex={activeTab === key ? 0 : -1}>{label}<span>{count ?? '—'}</span></button>
          ))}
        </div>
        <span className="quant-nav-note">US EQUITIES <span>•</span> DAILY FACTORS</span>
      </nav>

      <section className="quant-workspace" role="tabpanel" id={`quant-panel-${activeTab}`} aria-labelledby={`quant-tab-${activeTab}`}>
        {activeTab === 'screener' ? (
          <ScreenerTab rows={screenRows} total={payload?.rows.length ?? 0} hasPayload={Boolean(payload)} loading={latest.isPending || scan.isPending} filter={screenFilter} search={search} onFilter={setScreenFilter} onSearch={setSearch} />
        ) : (
          <PairsTab rows={pairRows} hasPayload={Boolean(payload)} filter={pairFilter} left={pairLeft} right={pairRight} detail={pairDetail} loading={pair.isPending} failure={pairFailure} onFilter={setPairFilter} onLeft={setPairLeft} onRight={setPairRight} onAnalyze={() => analyze()} onSelect={(row) => analyze(row.left, row.right)} />
        )}
      </section>

      {errors > 0 && payload ? <details className="quant-data-errors"><summary>Data coverage · {errors} incomplete ticker(s)</summary><div>{Object.entries(payload.errors).map(([ticker, reason]) => <p key={ticker}><strong>{ticker}</strong> {reason}</p>)}</div></details> : null}
      <footer className="quant-footer"><span><Icon name="layers" /> Quantitative research, not a trading recommendation.</span><span>Cross-sectional factors · Historical relationships may not persist.</span></footer>
    </div>
  )
}

function OverviewCard({ label, value, suffix, footer, children, tone }: { label: string; value: string; suffix: string; footer: string; children: ReactNode; tone?: Tone }) {
  return <div className={`quant-overview-card ${tone ? `quant-card-${tone}` : ''}`}><div className="quant-eyebrow">{label}</div><div className="quant-card-value"><strong className="num">{value}</strong><span>{suffix}</span></div><p title={footer}>{footer}</p>{children}</div>
}

function EmptyState({ title, children, loading = false }: { title: string; children: ReactNode; loading?: boolean }) {
  return <div className="quant-empty"><div className={`quant-empty-icon ${loading ? 'is-busy' : ''}`}><Icon name="scan" /></div><h3>{title}</h3><p>{children}</p></div>
}

function ScreenerTab({ rows, total, hasPayload, loading, filter, search, onFilter, onSearch }: {
  rows: QuantScreenRow[]; total: number; hasPayload: boolean; loading: boolean; filter: QuantScreenFilter; search: string
  onFilter: (value: QuantScreenFilter) => void; onSearch: (value: string) => void
}) {
  const [selected, setSelected] = useState('')
  const instrument = rows.find((row) => row.ticker === selected) ?? rows[0] ?? null
  const factor = (key: keyof QuantScreenRow, header: string, digits = 1, color = false): Column<QuantScreenRow> => ({
    key, header, cell: (row) => <span className={color ? directional(row[key] as number | null) : ''}>{plain(row[key] as number | null, digits)}</span>,
    sortValue: (row) => row[key] as number | null, align: 'right', numeric: true, width: '78px',
  })
  const columns: Array<Column<QuantScreenRow>> = [
    { key: 'rank', header: '#', cell: (row) => <span className="quant-rank">{String(row.rank).padStart(2, '0')}</span>, sortValue: (row) => row.rank, align: 'right', numeric: true, width: '48px' },
    { key: 'ticker', header: 'Instrument', cell: (row) => <button type="button" className="quant-ticker-button" onClick={() => setSelected(row.ticker)} title={`Inspect ${row.name}`} aria-pressed={instrument?.ticker === row.ticker}>{row.ticker}</button>, sortValue: (row) => row.ticker, width: '100px' },
    { ...factor('composite', 'Score'), cell: (row) => <span className="quant-score-cell"><i style={{ width: `${Math.max(0, Math.min(100, row.composite ?? 0))}%` }} /><b>{plain(row.composite)}</b></span>, width: '88px' },
    { key: 'price', header: 'Price', cell: (row) => price(row.lastPrice), sortValue: (row) => row.lastPrice, align: 'right', numeric: true, width: '96px' },
    ...(['momentum1m', 'momentum3m', 'momentum6m', 'momentum12m'] as const).map((key, index) => ({ ...factor(key, ['1M %', '3M %', '6M %', '12M %'][index]), cell: (row: QuantScreenRow) => <span className={directional(row[key])}>{percent(row[key])}</span> })),
    factor('volatilityPct', 'Vol %'), factor('sharpe', 'Sharpe', 2, true),
    { ...factor('maxDrawdownPct', 'Max DD %'), cell: (row) => <span className="text-down">{percent(row.maxDrawdownPct)}</span>, width: '90px' },
    factor('zScore', 'Z-score', 2), factor('rsi', 'RSI'),
  ]
  return <>
    <div className="quant-toolbar">
      <div className="quant-section-heading"><h2>Cross-sectional rankings</h2><span>{rows.length} / {total} instruments</span></div>
      <div className="quant-filter-controls"><Select value={filter} options={QUANT_SCREEN_FILTERS} onChange={onFilter} aria-label="Quant screener filter" /><SearchInput value={search} onChange={onSearch} placeholder="Search ticker…" aria-label="Quant ticker search" />{filter !== 'all' || search ? <button type="button" className="quant-text-button" onClick={() => { onFilter('all'); onSearch('') }}>Reset</button> : null}</div>
    </div>
    <div className="quant-screener-layout">
      <div className="quant-table-panel">
        <div className="quant-panel-caption"><span><i className="quant-small-dot" /> FACTOR MATRIX</span><span>Click a column to sort · Select a ticker to inspect</span></div>
        <div className="quant-table-scroll"><DataTable columns={columns} rows={rows} rowKey={(row) => row.ticker} layout="fixed" minWidth="1500px" defaultSort={{ key: 'rank', direction: 'asc' }} onRowClick={(row) => setSelected(row.ticker)} rowClassName={(row) => instrument?.ticker === row.ticker ? 'quant-selected-row' : ''} empty={<EmptyState loading={loading} title={loading ? 'Building your research universe' : hasPayload ? 'No matching instruments' : 'Start with the universe'}>{loading ? 'Available results will appear here when loading completes.' : hasPayload ? 'Try a different factor filter or clear your ticker search.' : 'Run a scan to source liquid US stocks, compute daily factors and rank relative strength.'}</EmptyState>} /></div>
        <div className="quant-table-footnote">Universe rules <span>Price ≥ $5</span><span>Market cap ≥ $2B</span><span>20-session median dollar volume ≥ $20M</span></div>
      </div>
      <InstrumentDetail row={instrument} />
    </div>
    <Methodology />
  </>
}

function InstrumentDetail({ row }: { row: QuantScreenRow | null }) {
  if (!row) return <aside className="quant-inspector"><div className="quant-panel-caption">INSTRUMENT LENS</div><EmptyState title="A closer look at the factors">Select a ranked instrument to explore its momentum, composite score and risk profile.</EmptyState><div className="quant-inspector-note">No synthetic scores. Every factor comes from the scanned price history.</div></aside>
  const horizons = [['1 month', row.momentum1m], ['3 months', row.momentum3m], ['6 months', row.momentum6m], ['12 months', row.momentum12m]] as const
  const max = Math.max(1, ...horizons.map(([, value]) => Math.abs(value ?? 0)))
  return <aside className="quant-inspector" aria-label={`Factor detail for ${row.ticker}`}>
    <div className="quant-panel-caption"><span>INSTRUMENT LENS</span><span className="num">RANK #{row.rank}</span></div>
    <div className="quant-instrument-title"><div><h3>{row.ticker}</h3><p title={row.name}>{row.name}</p><span className="quant-exchange">{row.exchange}</span></div><div className="quant-instrument-price num">{price(row.lastPrice)}<small>Latest close</small></div></div>
    <div className="quant-composite"><div className="quant-score-ring" style={{ '--quant-score': `${Math.max(0, Math.min(100, row.composite ?? 0))}%` } as CSSProperties}><strong className="num">{plain(row.composite, 0)}</strong></div><div><h4>Composite percentile</h4><p>Relative to this scan’s universe.<br />Higher ranks stronger.</p></div></div>
    <div className="quant-detail-section"><div className="quant-detail-label">MOMENTUM PROFILE <span>Return by horizon</span></div><div className="quant-horizon-list">{horizons.map(([label, value]) => <div className="quant-horizon" key={label}><span>{label}</span><div className="quant-return-track"><i className={value !== null && value < 0 ? 'is-negative' : ''} style={{ width: `${Math.abs(value ?? 0) / max * 50}%`, left: value !== null && value < 0 ? `${50 - Math.abs(value) / max * 50}%` : '50%' }} /></div><strong className={`num ${directional(value)}`}>{percent(value)}</strong></div>)}</div></div>
    <div className="quant-detail-section"><div className="quant-detail-label">RISK & CHARACTER</div><dl className="quant-diagnostics"><Diagnostic label="Sharpe ratio" value={plain(row.sharpe, 2)} /><Diagnostic label="Annualized vol" value={row.volatilityPct === null ? '—' : `${plain(row.volatilityPct)}%`} /><Diagnostic label="Max drawdown" value={percent(row.maxDrawdownPct)} /><Diagnostic label="RSI / 14 sessions" value={plain(row.rsi)} /><Diagnostic label="Price Z-score" value={plain(row.zScore, 2)} /><Diagnostic label="Observations" value={String(row.observations)} /></dl></div>
  </aside>
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd className="num">{value}</dd></div>
}

function Methodology() {
  return <details className="quant-methodology"><summary><span className="quant-methodology-label">MODEL NOTES</span> How the composite is built <span className="quant-methodology-weights">50% momentum / 30% Sharpe / 20% low volatility</span></summary><p>The composite is a cross-sectional percentile, not an expected return. Momentum uses 3, 6 and 12-month returns; Sharpe rewards risk-adjusted performance, and the low-volatility component rewards steadier price histories. Rankings are relative to the current scanned universe and do not predict future performance.</p></details>
}

function PairsTab({ rows, hasPayload, filter, left, right, detail, loading, failure, onFilter, onLeft, onRight, onAnalyze, onSelect }: {
  rows: QuantPairRow[]; hasPayload: boolean; filter: QuantPairFilter; left: string; right: string; detail: QuantPairDetail | null; loading: boolean; failure: string | null
  onFilter: (value: QuantPairFilter) => void; onLeft: (value: string) => void; onRight: (value: string) => void; onAnalyze: () => void; onSelect: (row: QuantPairRow) => void
}) {
  const valid = Boolean(left.trim() && right.trim() && left.trim().toUpperCase() !== right.trim().toUpperCase())
  const columns: Array<Column<QuantPairRow>> = [
    { key: 'rank', header: '#', cell: (row) => <span className="quant-rank">{String(row.rank).padStart(2, '0')}</span>, sortValue: (row) => row.rank, align: 'right', numeric: true, width: '44px' },
    { key: 'pair', header: 'Pair / long · short', cell: (row) => <button type="button" className="quant-ticker-button" disabled={loading} onClick={(event) => { event.stopPropagation(); onSelect(row) }}>{row.left}<span className="quant-pair-divider"> / </span>{row.right}</button>, sortValue: (row) => `${row.left}/${row.right}`, width: '160px' },
    { key: 'score', header: 'Score', cell: (row) => <span className="quant-pair-score">{plain(row.score)}</span>, sortValue: (row) => row.score, align: 'right', numeric: true, width: '66px' },
    { key: 'spreadZ', header: 'Spread Z', cell: (row) => <span className={row.spreadZ !== null && Math.abs(row.spreadZ) >= 2 ? 'quant-stretched' : ''}>{plain(row.spreadZ, 2)}</span>, sortValue: (row) => row.spreadZ, align: 'right', numeric: true, width: '84px' },
    { key: 'stationary', header: 'Stationary', cell: (row) => <span className={`quant-verdict ${row.stationaryAt ? 'is-stationary' : ''}`}>{row.stationaryAt || 'No'}</span>, sortValue: (row) => ({ '1%': 3, '5%': 2, '10%': 1 }[row.stationaryAt] ?? 0), width: '94px' },
    { key: 'correlation', header: 'Corr', cell: (row) => plain(row.correlation, 2), sortValue: (row) => row.correlation, align: 'right', numeric: true, width: '66px' },
    { key: 'halfLife', header: 'Half-life', cell: (row) => row.halfLife === null ? '—' : `${plain(row.halfLife)}d`, sortValue: (row) => row.halfLife, align: 'right', numeric: true, width: '86px' },
    { key: 'hedge', header: 'Hedge', cell: (row) => <span title="Shares of the short leg per share of the long leg (OLS on price levels)">{plain(row.hedgeRatio, 3)}</span>, sortValue: (row) => row.hedgeRatio, align: 'right', numeric: true, width: '78px' },
    { key: 'hurst', header: 'Hurst', cell: (row) => plain(row.hurst, 2), sortValue: (row) => row.hurst, align: 'right', numeric: true, width: '66px' },
    { key: 'df', header: 'DF stat', cell: (row) => <span title={describeDickeyFuller(row.dickeyFuller, row.stationaryAt)}>{plain(row.dickeyFuller, 2)}</span>, sortValue: (row) => row.dickeyFuller, align: 'right', numeric: true, width: '72px' },
  ]
  return <>
    <div className="quant-toolbar"><div className="quant-section-heading"><h2>Mean-reversion candidates</h2><span>{rows.length} pairs in view</span></div><div className="quant-filter-controls"><Select value={filter} options={QUANT_PAIR_FILTERS} onChange={onFilter} aria-label="Quant pair filter" /></div></div>
    <form className="quant-pair-builder" onSubmit={(event) => { event.preventDefault(); if (valid && !loading) onAnalyze() }}>
      <div><span className="quant-eyebrow">CUSTOM PAIR</span><p>Test a relationship</p></div>
      <label><span>Long leg</span><input value={left} onChange={(event) => onLeft(event.target.value)} maxLength={12} placeholder="e.g. KO" aria-label="Long ticker" autoComplete="off" spellCheck={false} /></label>
      <span className="quant-pair-link" aria-hidden="true">↔</span>
      <label><span>Short leg</span><input value={right} onChange={(event) => onRight(event.target.value)} maxLength={12} placeholder="e.g. PEP" aria-label="Short ticker" autoComplete="off" spellCheck={false} /></label>
      <button type="submit" className="quant-button quant-button-primary" disabled={!valid || loading}>{loading ? 'Analysing…' : 'Analyse pair'}<Icon name="arrow" /></button>
      <span className="quant-builder-note">{left.trim() && right.trim() && !valid ? 'Choose two different tickers.' : 'Inspect any two tickers, even before a universe scan.'}</span>
    </form>
    {failure ? <div className="quant-inline-error" role="alert">Pair analysis failed: {failure}.{detail ? ` Previous model for ${detail.left} / ${detail.right} remains below.` : ' Check the tickers and try again.'}</div> : null}
    <div className="quant-pairs-layout">
      <div className="quant-table-panel"><div className="quant-panel-caption"><span><i className="quant-small-dot" /> DISCOVERED RELATIONSHIPS</span><span>Select to model <Icon name="arrow" /></span></div><div className="quant-table-scroll"><DataTable columns={columns} rows={rows} rowKey={(row) => `${row.left}/${row.right}`} layout="fixed" minWidth="1100px" defaultSort={{ key: 'rank', direction: 'asc' }} onRowClick={loading ? undefined : onSelect} rowClassName={(row) => detail?.left === row.left && detail.right === row.right ? 'quant-selected-row' : ''} empty={<EmptyState title={hasPayload ? 'No pairs in this view' : 'Discover a relationship'}>{hasPayload ? 'Try a broader pair filter to see more candidates.' : 'Run a universe scan to discover correlated pairs, or enter two tickers above to build a custom model.'}</EmptyState>} /></div><div className="quant-table-footnote">Prescreen <span>Return correlation</span><span>OLS price-level spread</span><span>Dickey-Fuller test</span></div></div>
      <PairDetail detail={detail} loading={loading} />
    </div>
    <details className="quant-methodology"><summary><span className="quant-methodology-label">MODEL NOTES</span> Stationarity is a shortlist, not a conclusion</summary><p>Pairs are prescreened by return correlation, then fitted by OLS on price levels and tested for mean reversion. Because many pairs are tested at once, roughly 1 in 20 will clear the 5% Dickey-Fuller threshold by chance. Leg labels describe the model orientation; a trade’s direction depends on the sign of the spread. Consider costs, borrow availability and out-of-sample validation.</p></details>
  </>
}

function PairDetail({ detail, loading }: { detail: QuantPairDetail | null; loading: boolean }) {
  if (!detail) return <aside className="quant-pair-detail"><div className="quant-panel-caption">RELATIONSHIP LENS</div><EmptyState loading={loading} title={loading ? 'Fitting the relationship' : 'Two assets. One relationship.'}>{loading ? 'Loading overlapping histories, fitting the hedge and testing the spread.' : 'Select a discovered pair or enter two tickers to inspect the spread, price performance and reversion diagnostics.'}</EmptyState><div className="quant-pair-empty-steps"><span>01 <b>Align histories</b></span><span>02 <b>Fit spread</b></span><span>03 <b>Test reversion</b></span></div></aside>
  const validSpread = detail.points.filter((point) => point.spreadZ !== null)
  const stretched = detail.latestZ !== null && Math.abs(detail.latestZ) >= 2
  return <aside className={`quant-pair-detail ${loading ? 'quant-model-loading' : ''}`} aria-label={`Pair model for ${detail.left} and ${detail.right}`} aria-busy={loading}>
    <div className="quant-panel-caption"><span>RELATIONSHIP LENS</span><span>{loading ? 'UPDATING MODEL…' : `${detail.observations} OVERLAPPING SESSIONS`}</span></div>
    <div className="quant-pair-title"><div><span className="quant-eyebrow">LONG / SHORT</span><h3>{detail.left}<span>/</span>{detail.right}</h3></div><span className={`quant-verdict ${detail.stationaryAt ? 'is-stationary' : ''}`}>{detail.stationaryAt ? `Stationary at ${detail.stationaryAt}` : 'Not stationary'}</span></div>
    <div className="quant-pair-kpis"><div><span>Spread Z</span><strong className={`num ${stretched ? 'quant-stretched' : ''}`}>{plain(detail.latestZ, 2)}<small>σ</small></strong></div><div><span>Half-life</span><strong className="num">{plain(detail.halfLife)}<small>days</small></strong></div><div><span>Correlation</span><strong className="num">{plain(detail.correlation, 2)}</strong></div></div>
    <div className="quant-chart-block"><div className="quant-chart-heading"><h4>Spread deviation</h4><span><i /> Z-score <b>±2σ threshold</b></span></div><div className="quant-spread-chart"><LineChart labels={validSpread.map((point) => point.date)} series={[
      { label: 'Spread Z', color: 'var(--quant-highlight)', values: validSpread.map((point) => point.spreadZ) },
      { label: '+2σ', color: 'var(--color-warn)', dashed: true, values: validSpread.map(() => 2) },
      { label: '-2σ', color: 'var(--color-warn)', dashed: true, values: validSpread.map(() => -2) },
    ]} format={(value) => value.toFixed(1)} baseline="zero" ticks={4} /></div></div>
    <div className="quant-chart-block"><div className="quant-chart-heading"><h4>Relative performance</h4><span><i />{detail.left}<i className="quant-legend-secondary" />{detail.right}</span></div><div className="quant-performance-chart"><LineChart labels={detail.points.map((point) => point.date)} series={[
      { label: detail.left, color: 'var(--quant-highlight)', values: detail.points.map((point) => point.leftIndexed - 100) },
      { label: detail.right, color: 'var(--color-up)', values: detail.points.map((point) => point.rightIndexed - 100) },
    ]} format={(value) => `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`} baseline="zero" ticks={4} /></div></div>
    <div className="quant-detail-section"><div className="quant-detail-label">MODEL DIAGNOSTICS</div><dl className="quant-diagnostics"><Diagnostic label="Hedge ratio" value={plain(detail.hedgeRatio, 3)} /><Diagnostic label="Hurst exponent" value={plain(detail.hurst, 2)} /><Diagnostic label="Dickey-Fuller" value={plain(detail.dickeyFuller, 2)} /><Diagnostic label="Observations" value={String(detail.observations)} /></dl><p className="quant-model-note">Hedge: {plain(detail.hedgeRatio, 3)} shares of {detail.right} per share of {detail.left}. {describeDickeyFuller(detail.dickeyFuller, detail.stationaryAt)}</p></div>
    {stretched ? <div className="quant-setup-note">Spread is beyond 2σ. The mean-reversion hypothesis is to <strong>{detail.latestZ! > 0 ? 'short' : 'long'} the spread</strong> — not an execution signal.</div> : null}
  </aside>
}
