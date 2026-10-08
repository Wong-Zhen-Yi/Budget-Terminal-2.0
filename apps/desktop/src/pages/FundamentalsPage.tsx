import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Envelope, FundamentalsPagePayload } from '@shared/contract'
import {
  buildFundamentalsCharts,
  computeHeadlineMetrics,
  FUNDAMENTALS_MAX_PERIODS,
  FUNDAMENTALS_MIN_PERIODS,
  type FundamentalsChartModel,
  type FundamentalsHeadlineMetrics,
} from '@shared/fundamentalsPage'
import { api } from '@/api/client'
import { useFundamentalsPage, useRefreshFundamentalsPage } from '@/api/fundamentalsPageQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import {
  FundamentalsBarChart,
  FundamentalsChartLegend,
} from '@/components/fundamentals/FundamentalsBarChart'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { compactCurrency, decimals } from '@/lib/format'
import { useFundamentalsStore } from '@/stores/fundamentals'

type Tone = 'muted' | 'positive' | 'warning' | 'negative'
type WorkspaceTab = 'statements' | 'filings'

const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

export function FundamentalsPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const {
    symbol,
    compareSymbol,
    period,
    periodCount,
    indexed,
    growthBasis,
    snapshot,
    setSymbol,
    setCompareSymbol,
    setPeriod,
    setPeriodCount,
    toggleIndexed,
    setGrowthBasis,
    setSnapshot,
  } = useFundamentalsStore()
  const [draft, setDraft] = useState(symbol)
  const [compareDraft, setCompareDraft] = useState(compareSymbol)
  const [primaryBusy, setPrimaryBusy] = useState(false)
  const [compareBusy, setCompareBusy] = useState(false)
  const [primaryNotice, setPrimaryNotice] = useState<{ text: string; tone: Tone } | null>(null)
  const [compareNotice, setCompareNotice] = useState<{ text: string; tone: Tone } | null>(null)
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('statements')
  const [fullscreen, setFullscreen] = useState<FundamentalsChartModel | null>(null)

  const primaryQuery = useFundamentalsPage(symbol, snapshot)
  const compareQuery = useFundamentalsPage(compareSymbol, null)
  const refresh = useRefreshFundamentalsPage()
  const primaryPayload = primaryQuery.data?.data.displayCurrency === 'USD' && primaryQuery.data.data.currencyVersion === 2 ? primaryQuery.data.data : null
  const comparePayload = compareQuery.data?.data.displayCurrency === 'USD' && compareQuery.data.data.currencyVersion === 2 ? compareQuery.data.data : null

  useEffect(() => setDraft(symbol), [symbol])
  useEffect(() => setCompareDraft(compareSymbol), [compareSymbol])
  useEffect(() => {
    if (primaryPayload && !primaryQuery.isPlaceholderData && primaryPayload.generatedAt > 0) {
      setSnapshot(primaryPayload)
    }
  }, [primaryPayload, primaryQuery.isPlaceholderData, setSnapshot])

  useEffect(() => {
    const panels: PanelStatus[] = [{
      label: 'Fundamentals',
      envelope: primaryQuery.data, error: primaryQuery.error, enabled: primaryQuery.isEnabled,
      loading: primaryQuery.isFetching,
    }]
    if (compareSymbol) {
      panels.push({
        label: `Compare ${compareSymbol}`,
        envelope: compareQuery.data, error: compareQuery.error, enabled: compareQuery.isEnabled,
        loading: compareQuery.isFetching,
      })
    }
    onStatusChange(panels, '')
  }, [compareQuery.data, compareQuery.isFetching, compareSymbol, onStatusChange, primaryQuery.data, primaryQuery.isFetching])

  const analyze = useCallback(async () => {
    const next = normalizeTicker(draft)
    if (!next) {
      setPrimaryNotice({ text: 'Enter a ticker before analyzing.', tone: 'warning' })
      return
    }
    setDraft(next)
    setSymbol(next)
    setPrimaryNotice(null)
    setPrimaryBusy(true)
    try {
      await refresh(next)
    } catch (error) {
      setPrimaryNotice({ text: errorText(error), tone: 'negative' })
    } finally {
      setPrimaryBusy(false)
    }
  }, [draft, refresh, setSymbol])

  const compare = useCallback(async () => {
    const next = normalizeTicker(compareDraft)
    if (!next) {
      setCompareNotice({ text: 'Enter a comparison ticker.', tone: 'warning' })
      return
    }
    if (next === normalizeTicker(symbol)) {
      setCompareNotice({ text: 'Comparison ticker must differ from the primary ticker.', tone: 'warning' })
      return
    }
    setCompareDraft(next)
    setCompareSymbol(next)
    setCompareNotice(null)
    setCompareBusy(true)
    try {
      await refresh(next)
    } catch (error) {
      setCompareNotice({ text: errorText(error), tone: 'negative' })
    } finally {
      setCompareBusy(false)
    }
  }, [compareDraft, refresh, setCompareSymbol, symbol])

  const clearCompare = useCallback(() => {
    setCompareDraft('')
    setCompareSymbol('')
    setCompareNotice(null)
  }, [setCompareSymbol])

  const charts = useMemo(() => primaryPayload ? buildFundamentalsCharts(
    primaryPayload,
    comparePayload,
    { period, periodCount, indexed, growthBasis },
  ) : [], [comparePayload, growthBasis, indexed, period, periodCount, primaryPayload])

  const primaryStatus = statusFor(
    primaryQuery.data,
    primaryPayload,
    primaryQuery.isFetching || primaryBusy,
    primaryQuery.isPlaceholderData,
    primaryNotice,
    'primary',
  )
  const compareStatus = compareSymbol
    ? statusFor(
        compareQuery.data,
        comparePayload,
        compareQuery.isFetching || compareBusy,
        false,
        compareNotice,
        'comparison',
      )
    : (compareNotice ?? { text: 'Comparison is clear.', tone: 'muted' as const })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <section className="shrink-0 border-b border-border bg-surface px-2 py-1">
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex min-w-[310px] flex-1 items-center gap-1" onSubmit={(event) => { event.preventDefault(); void analyze() }}>
            <label className="shrink-0 text-2xs font-semibold tracking-wide text-text-muted uppercase">Primary</label>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value.toUpperCase())}
              placeholder="Ticker"
              aria-label="Primary ticker"
              maxLength={12}
              className="num h-7 min-w-0 flex-1 border border-border-strong bg-surface-raised px-2 text-center text-sm font-semibold tracking-wide text-text outline-none focus:border-accent"
            />
            <Button type="submit" variant="accent" className="h-7" disabled={primaryBusy}>{primaryBusy ? 'Loading...' : 'Analyze'}</Button>
          </form>
          <form className="flex min-w-[390px] flex-1 items-center gap-1" onSubmit={(event) => { event.preventDefault(); void compare() }}>
            <label className="shrink-0 text-2xs font-semibold tracking-wide text-text-muted uppercase">Compare</label>
            <input
              value={compareDraft}
              onChange={(event) => setCompareDraft(event.target.value.toUpperCase())}
              placeholder="Optional ticker"
              aria-label="Comparison ticker"
              maxLength={12}
              className="num h-7 min-w-0 flex-1 border border-border-strong bg-surface-raised px-2 text-center text-sm font-semibold tracking-wide text-text outline-none focus:border-accent"
            />
            <Button type="submit" className="h-7" disabled={compareBusy}>{compareBusy ? 'Loading...' : 'Compare'}</Button>
            <Button className="h-7" onClick={clearCompare} disabled={!compareSymbol && !compareDraft}>Clear</Button>
          </form>
        </div>
        <div className="mt-1 grid grid-cols-1 gap-x-4 text-2xs lg:grid-cols-2">
          <p className={`truncate ${toneClass[primaryStatus.tone]}`} title={primaryStatus.text}>{primaryStatus.text}</p>
          {compareSymbol || compareNotice ? (
            <p className={`truncate ${toneClass[compareStatus.tone]}`} title={compareStatus.text}>{compareStatus.text}</p>
          ) : null}
        </div>
      </section>

      {primaryPayload ? (
        <>
          <CompanyHeader primary={primaryPayload} compare={comparePayload} />
          {/* Tabs and the presentation controls share one strip; stacked they cost 72px of chart. */}
          <nav className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-border bg-surface px-2">
            <TabButton active={workspaceTab === 'statements'} onClick={() => setWorkspaceTab('statements')}>Statements</TabButton>
            <TabButton active={workspaceTab === 'filings'} onClick={() => setWorkspaceTab('filings')}>
              {`SEC Filings (${primaryPayload.sec.filings.length})`}
            </TabButton>
            {workspaceTab === 'statements' ? (
              <PresentationControls
                period={period}
                periodCount={periodCount}
                indexed={indexed}
                growthBasis={growthBasis}
                onPeriod={setPeriod}
                onPeriodCount={setPeriodCount}
                onIndexed={toggleIndexed}
                onGrowth={setGrowthBasis}
              />
            ) : null}
          </nav>

          {workspaceTab === 'statements' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/*
                * Six charts, so the grid is 3x2 on a wide window and every row shares the
                * height that is left: the page is meant to be read without scrolling.
                * Narrower windows fall back to one and two columns and do scroll.
                */}
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-1 overflow-auto p-1 lg:grid-cols-2 xl:grid-cols-3 xl:grid-rows-2 xl:overflow-hidden">
                {charts.map((chart) => (
                  <Panel
                    key={chart.title}
                    title={chart.title}
                    className="min-h-[260px] xl:min-h-0"
                    actions={<Button className="h-6 px-1.5" onClick={() => setFullscreen(chart)}>Full</Button>}
                  >
                    <FundamentalsChartLegend model={chart} />
                    <FundamentalsBarChart model={chart} />
                  </Panel>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
              <Panel
                title={`SEC Filings · ${primaryPayload.symbol}`}
                className="min-h-0 flex-1"
                warning={primaryPayload.sec.warnings.join(' · ') || undefined}
              >
                {primaryPayload.sec.warnings.length ? (
                  <p className="shrink-0 border-b border-border px-2 py-1 text-2xs text-warn">
                    {primaryPayload.sec.warnings.join(' · ')}
                  </p>
                ) : null}
                <FilingsTable filings={primaryPayload.sec.filings} />
              </Panel>
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="max-w-[520px] text-center">
            <p className="text-sm font-semibold text-text">Fundamentals workspace</p>
            <p className="mt-1 text-2xs text-text-muted">
              Enter a ticker above and choose Analyze to load SEC and Yahoo statements.
            </p>
            <p className="mt-2 text-2xs text-text-dim">
              Add a second ticker under Compare to overlay both companies on every chart.
            </p>
          </div>
        </div>
      )}

      {fullscreen ? (
        <Modal title={`${fullscreen.title} · ${fullscreen.series.every((series) => series.metric === 'sharesOutstanding') ? 'Shares' : 'USD'}${fullscreen.indexed ? ' · Indexed' : ''}`} width="calc(100vw - 32px)" onClose={() => setFullscreen(null)}>
          <div className="flex h-[calc(100vh-105px)] min-h-[420px] flex-col">
            <FundamentalsChartLegend model={fullscreen} fullscreen />
            <FundamentalsBarChart model={fullscreen} fullscreen />
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function CompanyHeader({
  primary,
  compare,
}: {
  primary: FundamentalsPagePayload
  compare: FundamentalsPagePayload | null
}) {
  const subtitle = [primary.company.exchange, primary.company.sector, primary.company.industry]
    .filter(Boolean)
    .join(' · ')
  return (
    <section className="shrink-0 border-b border-border bg-bg px-2 py-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-sm font-semibold text-text">{primary.company.name || primary.symbol}</h1>
        <span className="num text-2xs font-semibold text-accent-hover">{primary.symbol}</span>
        <span className="text-2xs text-text-muted">Amounts in USD</span>
        {subtitle ? <span className="text-2xs text-text-muted">{subtitle}</span> : null}
        <span className="ml-auto flex items-center gap-1">
          {primary.company.website ? <Button className="h-6" onClick={() => void api.openExternal(primary.company.website)}>Website</Button> : null}
          <Button className="h-6" onClick={() => void api.openExternal(irUrl(primary))}>Investor Relations</Button>
        </span>
      </div>
      <HeadlineMetricRow symbol={primary.symbol} metrics={computeHeadlineMetrics(primary)} />
      {compare ? <HeadlineMetricRow symbol={compare.symbol} metrics={computeHeadlineMetrics(compare)} comparison /> : null}
      <p className="mt-1 text-2xs text-text-dim">
        {[primary, ...(compare ? [compare] : [])].map((payload) => `${payload.symbol}: ${payload.currencyNote ?? 'USD'}`).join(' · ')}
        {' · Foreign amounts use the latest available FX rate for all periods; share counts are unchanged.'}
      </p>
    </section>
  )
}

const HEADLINE_METRICS: ReadonlyArray<{
  label: string
  key: keyof FundamentalsHeadlineMetrics
  format: (value: number | null) => string
}> = [
  { label: 'P/E', key: 'pe', format: ratio },
  { label: 'Fwd P/E', key: 'forwardPe', format: ratio },
  { label: 'P/S', key: 'priceToSales', format: ratio },
  { label: 'PEG', key: 'peg', format: ratio },
  { label: 'FCF Margin', key: 'fcfMarginPct', format: (value) => value === null ? '--' : `${value.toFixed(1)}%` },
  { label: 'EV/Revenue', key: 'evRevenue', format: ratio },
  { label: 'EV/EBITDA', key: 'evEbitda', format: ratio },
  { label: 'Net Cash & Bonds', key: 'netCash', format: compactCurrency },
  { label: 'Beta', key: 'beta', format: (value) => decimals(value, 2) },
  { label: 'Market Cap', key: 'marketCap', format: compactCurrency },
]

function HeadlineMetricRow({
  symbol,
  metrics,
  comparison = false,
}: {
  symbol: string
  metrics: FundamentalsHeadlineMetrics
  comparison?: boolean
}) {
  return (
    <div className={`mt-1 flex overflow-x-auto border bg-surface ${comparison ? 'border-accent-dim' : 'border-border'}`}>
      <div className={`num flex w-20 shrink-0 items-center justify-center px-2 text-2xs font-semibold ${comparison ? 'text-accent-hover' : 'text-text'}`}>
        {symbol}
      </div>
      {HEADLINE_METRICS.map((metric) => (
        <div key={metric.key} className="min-w-[116px] flex-1 border-l border-border px-2 py-1 text-center">
          <p className="truncate text-2xs tracking-wide text-text-muted uppercase" title={metric.label}>{metric.label}</p>
          <p className="num truncate text-xs font-semibold text-text">{metric.format(metrics[metric.key])}</p>
        </div>
      ))}
    </div>
  )
}

function PresentationControls({
  period,
  periodCount,
  indexed,
  growthBasis,
  onPeriod,
  onPeriodCount,
  onIndexed,
  onGrowth,
}: {
  period: 'annual' | 'quarterly'
  periodCount: number
  indexed: boolean
  growthBasis: 'prior_period' | 'year_ago'
  onPeriod: (value: 'annual' | 'quarterly') => void
  onPeriodCount: (value: number) => void
  onIndexed: () => void
  onGrowth: (value: 'prior_period' | 'year_ago') => void
}) {
  return (
    <>
      <span className="ml-3 text-2xs font-semibold text-text-muted">View</span>
      <Button variant="toggle" className="h-7" active={period === 'annual'} onClick={() => onPeriod('annual')}>Annual</Button>
      <Button variant="toggle" className="h-7" active={period === 'quarterly'} onClick={() => onPeriod('quarterly')}>Quarterly</Button>
      {period === 'quarterly' ? (
        <>
          <span className="ml-2 text-2xs text-text-muted">Growth</span>
          <Button variant="toggle" className="h-7" active={growthBasis === 'year_ago'} onClick={() => onGrowth('year_ago')}>YoY</Button>
          <Button variant="toggle" className="h-7" active={growthBasis === 'prior_period'} onClick={() => onGrowth('prior_period')}>QoQ</Button>
        </>
      ) : null}
      <label className="ml-2 flex items-center gap-1 text-2xs text-text-muted">
        Periods
        <input
          type="number"
          min={FUNDAMENTALS_MIN_PERIODS}
          max={FUNDAMENTALS_MAX_PERIODS}
          value={periodCount}
          onChange={(event) => onPeriodCount(Number(event.target.value))}
          className="num h-7 w-14 border border-border-strong bg-surface-raised px-1 text-center text-text outline-none focus:border-accent"
        />
      </label>
      <Button variant="toggle" active={!indexed} className="ml-2 h-7" onClick={() => { if (indexed) onIndexed() }}>Raw</Button>
      <Button variant="toggle" active={indexed} className="h-7" onClick={() => { if (!indexed) onIndexed() }}>Indexed</Button>
      <span className="ml-auto truncate text-2xs text-text-dim">
        {indexed ? 'Oldest visible non-zero value = ±100' : 'Statement values in USD · shares in units'} · {period === 'annual' ? 'prior-year growth' : growthBasis === 'year_ago' ? 'year-over-year growth' : 'quarter-over-quarter growth'}
      </span>
    </>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 border-b-2 px-3 text-2xs transition-colors ${active ? 'border-accent font-semibold text-text' : 'border-transparent text-text-muted hover:text-text'}`}
    >
      {children}
    </button>
  )
}

function statusFor(
  envelope: Envelope<FundamentalsPagePayload> | undefined,
  payload: FundamentalsPagePayload | null,
  loading: boolean,
  restored: boolean,
  notice: { text: string; tone: Tone } | null,
  label: 'primary' | 'comparison',
): { text: string; tone: Tone } {
  if (notice) return notice
  if (loading) return { text: `Loading ${label} Fundamentals...`, tone: 'muted' }
  if (!envelope && !payload) return { text: label === 'primary' ? 'Ready.' : 'Comparison is clear.', tone: 'muted' }
  if (envelope?.meta.freshness === 'failed') {
    return { text: `${capitalize(label)} load failed: ${envelope.meta.failureReason ?? 'unknown error'}`, tone: 'negative' }
  }
  if (!payload) return { text: `No ${label} Fundamentals data is available.`, tone: 'warning' }
  if (restored) return { text: `Restored last session for ${payload.symbol}; refreshing in the background.`, tone: 'muted' }
  const source = sourceLabel(payload)
  if (envelope?.errors.length || payload.warnings.length) {
    return { text: `Loaded ${payload.symbol} from ${source} with warnings.`, tone: 'warning' }
  }
  return { text: `Loaded ${payload.symbol} from ${source}.`, tone: 'positive' }
}

function sourceLabel(payload: FundamentalsPagePayload): string {
  if (!payload.sec.available) return 'yfinance only'
  return payload.sec.freshness === 'cached' || payload.sec.freshness === 'stale'
    ? 'SEC cached + yfinance'
    : 'SEC EDGAR + yfinance'
}

function irUrl(payload: FundamentalsPagePayload): string {
  if (payload.company.irWebsite) return payload.company.irWebsite
  return `https://www.google.com/search?q=${encodeURIComponent(`${payload.company.name || payload.symbol} investor relations`)}`
}

function ratio(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(2)}x`
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
