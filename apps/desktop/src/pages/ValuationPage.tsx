import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  ValuationAssumptions,
  ValuationPeerRow,
  ValuationProvenanceEntry,
} from '@shared/contract'
import {
  assumptionsFromSuggestions,
  calculateValuationScenarios,
  DEFAULT_VALUATION_ASSUMPTIONS,
  derivationSummary,
  normalizeValuationAssumptions,
  peerExitMultiple,
  valuationCurrencyWarnings,
} from '@shared/valuation'
import { useRefreshValuation, useValuation } from '@/api/valuationQueries'
import { DataFreshness } from '@/components/ui/DataFreshness'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { SearchInput } from '@/components/ui/SearchInput'
import { AssumptionsPanel } from '@/components/valuation/AssumptionsPanel'
import {
  BAND_COLOR,
  FairValueBandChart,
  HistoricalPeChart,
  TrendChart,
} from '@/components/valuation/ValuationCharts'
import { compactCurrency, currency, EM_DASH, timestampLabel } from '@/lib/format'
import { savedAssumptions, useValuationPage, type ValuationTab } from '@/stores/valuation'

/**
 * The Valuation page, ported from `ValuationMixin` (page23).
 *
 * One load answers with the metrics, five years of statements, the peer table and a full
 * derivation of every assumption. Everything after that is solved here: the DCF, the
 * bear/base/bull ladder, the verdict and the band chart all come out of
 * `calculateValuationScenarios` running on whatever the assumption form currently holds,
 * so editing a growth rate repaints instantly and never goes back to the network. That is
 * the same split the reference has — `_valuation_recalculate_from_controls` is wired to
 * every spin box and touches no worker.
 *
 * A load always re-derives, exactly as `_valuation_apply_derived_assumptions` documents:
 * saved per-ticker assumptions are the first-paint defaults, never an input to the
 * derivation. Manual edits survive until the next load or the Re-derive button.
 */

type Tone = 'muted' | 'positive' | 'warning' | 'negative'
const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

const TABS: ReadonlyArray<{ key: ValuationTab; label: string }> = [
  { key: 'main', label: 'Main' },
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'peers', label: 'Peers' },
  { key: 'risk', label: 'Risk' },
  { key: 'trends', label: 'Trends' },
  { key: 'notes', label: 'Notes' },
  { key: 'sources', label: 'Sources' },
]

/** The nine ratio cards, in `_VALUATION_METRIC_DEFS` order. */
const METRIC_DEFS: ReadonlyArray<{
  label: string
  key:
    | 'pe'
    | 'forwardPe'
    | 'ps'
    | 'pb'
    | 'evEbitda'
    | 'fcfYield'
    | 'earningsYield'
    | 'peg'
    | 'dividendYield'
  kind: 'ratio' | 'pct'
}> = [
  { label: 'P/E', key: 'pe', kind: 'ratio' },
  { label: 'Forward P/E', key: 'forwardPe', kind: 'ratio' },
  { label: 'P/S', key: 'ps', kind: 'ratio' },
  { label: 'P/B', key: 'pb', kind: 'ratio' },
  { label: 'EV/EBITDA', key: 'evEbitda', kind: 'ratio' },
  { label: 'FCF Yield', key: 'fcfYield', kind: 'pct' },
  { label: 'Earnings Yield', key: 'earningsYield', kind: 'pct' },
  { label: 'PEG', key: 'peg', kind: 'ratio' },
  { label: 'Dividend Yield', key: 'dividendYield', kind: 'pct' },
]

/**
 * The ratios this page derives by dividing a quoted figure by a reported one. The service
 * withholds them outright when the two currencies differ, so they are the ones whose
 * blank cell needs explaining.
 */
const CROSSED_METRIC_KEYS = new Set(['pe', 'ps', 'evEbitda', 'fcfYield', 'earningsYield'])

/** An EPS basis reports `earnings_multiple`; the other two are the user's own choice. */
const METHOD_LABEL: Record<string, string> = {
  gordon_growth: 'Gordon growth',
  exit_multiple: 'Exit multiple',
  earnings_multiple: 'Earnings multiple',
}

function ratio(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? EM_DASH
    : `${value.toFixed(2)}x`
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? EM_DASH
    : `${value.toFixed(1)}%`
}

function money(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? EM_DASH
    : currency(value)
}

function verdictClass(verdict: string): string {
  const text = verdict.toLowerCase()
  if (text.includes('under')) return 'text-up'
  if (text.includes('over')) return 'text-down'
  if (text.includes('fair')) return 'text-warn'
  return 'text-text-muted'
}

/** Model quality reads as a confidence, so it is toned like one. */
function qualityClass(quality: string): string {
  if (quality === 'High') return 'text-up'
  if (quality === 'Medium') return 'text-warn'
  if (quality === 'Low') return 'text-down'
  return 'text-text-muted'
}

/**
 * One figure in the verdict band. `caption` carries the unit or the second half of a
 * paired figure, so a tile never has to pack two numbers onto one line and truncate.
 */
function Tile({
  title,
  value,
  caption,
  className = 'text-text',
  emphasis = false,
}: {
  title: string
  value: string
  caption?: string
  className?: string
  emphasis?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-0.5 px-2">
      <span
        className="w-full truncate text-center text-2xs tracking-wide text-text-muted uppercase"
        title={title}
      >
        {title}
      </span>
      <span
        className={`num w-full truncate text-center font-bold ${
          emphasis ? 'text-base' : 'text-sm'
        } ${className}`}
        title={value}
      >
        {value}
      </span>
      {caption ? (
        <span className="w-full truncate text-center text-2xs text-text-dim" title={caption}>
          {caption}
        </span>
      ) : null}
    </div>
  )
}

/** A labelled figure in the header strip, matching the Portfolio summary bar's chips. */
function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border border-border bg-surface-raised px-2 py-0.5">
      <span className="text-2xs tracking-wide text-text-muted uppercase">{label}</span>
      <span className="num text-2xs font-semibold text-text">{children}</span>
    </div>
  )
}

export function ValuationPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const {
    ticker,
    activeTab,
    assumptionsByTicker,
    notesByTicker,
    customPeersByTicker,
    setTicker,
    setActiveTab,
    setAssumptions,
    setNotes,
    addCustomPeer,
    removeCustomPeer,
  } = useValuationPage()

  const [draft, setDraft] = useState(ticker)
  const [peerDraft, setPeerDraft] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  // `_valuation_on_show` issues one non-forced load the first time the page is shown, and
  // this component only mounts when its tab is opened — so being armed from the start is
  // that first load, not a fetch from the app's startup.
  const [armed, setArmed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)
  /**
   * The last ticker whose derived assumptions were written into the form. A load re-derives
   * once per payload; after that the form is the user's, until the next load or Re-derive.
   */
  const [derivedFor, setDerivedFor] = useState('')

  const customPeers = useMemo(
    () => customPeersByTicker[ticker] ?? [],
    [customPeersByTicker, ticker],
  )
  const query = useValuation(ticker, customPeers, armed)
  const refresh = useRefreshValuation()
  // A handoff must never label the previous ticker's valuation as the new ticker.
  const envelope = query.data?.data.ticker === ticker ? query.data : undefined
  const payload = envelope?.data
  const loaded = Boolean(payload && payload.generatedAt)

  useEffect(() => setDraft(ticker), [ticker])

  useEffect(() => {
    onStatusChange([{ label: 'Valuation', envelope, loading: query.isFetching }], '')
  }, [onStatusChange, envelope, query.isFetching])

  const assumptions = useMemo(
    () => savedAssumptions(assumptionsByTicker, ticker),
    [assumptionsByTicker, ticker],
  )

  // A completed load overwrites every derivable assumption, once.
  useEffect(() => {
    if (!payload || !payload.generatedAt) return
    if (derivedFor === `${payload.ticker}:${payload.generatedAt}`) return
    setDerivedFor(`${payload.ticker}:${payload.generatedAt}`)
    setAssumptions(
      payload.ticker,
      assumptionsFromSuggestions(
        payload.suggestions,
        payload.metrics,
        savedAssumptions(assumptionsByTicker, payload.ticker),
      ),
    )
    // `assumptionsByTicker` is read, not tracked: re-running on our own write would undo
    // the manual edit that write is meant to seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, derivedFor, setAssumptions])

  const metrics = payload?.metrics
  const trends = payload?.trends

  const scenarios = useMemo(() => {
    const materialWarnings = trends?.perShareApproximate
      ? ['Historical per-share trends use current shares and are approximate.']
      : []
    return calculateValuationScenarios(metrics?.price ?? null, assumptions, {
      historyPoints: trends?.comparableHistoryPoints ?? 0,
      materialWarnings,
      blockingWarnings: valuationCurrencyWarnings(metrics),
    })
  }, [assumptions, metrics, trends])

  const derived = useMemo(() => {
    if (!payload || !payload.generatedAt) return { summary: 'Manual assumptions', detail: '' }
    const stamp = payload.market?.asOf || timestampLabel(payload.generatedAt)
    return derivationSummary(payload.suggestions, stamp)
  }, [payload])

  const load = useCallback(
    async (symbolInput?: string, peers?: string[]) => {
      const symbol = (symbolInput ?? draft).trim().toUpperCase()
      if (!symbol) {
        setNotice({ text: 'Enter a ticker to load valuation data.', tone: 'warning' })
        return
      }
      setTicker(symbol)
      setArmed(true)
      setNotice(null)
      setBusy(true)
      try {
        await refresh(symbol, peers ?? customPeersByTicker[symbol] ?? [])
      } finally {
        setBusy(false)
      }
    },
    [customPeersByTicker, draft, refresh, setTicker],
  )

  const rederive = useCallback(() => {
    if (!payload || !payload.generatedAt) {
      setNotice({ text: 'Load a ticker before re-deriving assumptions.', tone: 'warning' })
      return
    }
    setAssumptions(
      payload.ticker,
      assumptionsFromSuggestions(payload.suggestions, payload.metrics, assumptions),
    )
    setNotice({ text: 'Re-derived every assumption from the loaded data.', tone: 'positive' })
  }, [assumptions, payload, setAssumptions])

  const addPeer = useCallback(() => {
    const symbol = peerDraft.trim().toUpperCase()
    if (!symbol) {
      setNotice({ text: 'Enter a peer ticker to add.', tone: 'warning' })
      return
    }
    if (symbol === ticker) {
      setNotice({
        text: 'The loaded ticker is already included as the first peer row.',
        tone: 'warning',
      })
      return
    }
    if (customPeers.includes(symbol)) {
      setNotice({ text: `${symbol} is already a custom peer for ${ticker}.`, tone: 'warning' })
      return
    }
    addCustomPeer(ticker, symbol)
    setPeerDraft('')
    setNotice({
      text: `Added ${symbol} as a custom peer for ${ticker}. Reloading...`,
      tone: 'positive',
    })
    void load(ticker, [...customPeers, symbol])
  }, [addCustomPeer, customPeers, load, peerDraft, ticker])

  const dropPeer = useCallback(
    (symbol: string) => {
      removeCustomPeer(ticker, symbol)
      setNotice({
        text: `Removed ${symbol} from custom peers for ${ticker}. Reloading...`,
        tone: 'positive',
      })
      void load(
        ticker,
        customPeers.filter((peer) => peer !== symbol),
      )
    },
    [customPeers, load, removeCustomPeer, ticker],
  )

  const blocked = !scenarios.priceComparisonValid
  const invalid = scenarios.baseFairValue === null
  const verdict = scenarios.verdict ?? (invalid ? EM_DASH : blocked ? 'Not comparable' : 'Too uncertain')
  const upside =
    !blocked && scenarios.baseFairValue !== null && metrics?.price
      ? (scenarios.baseFairValue / metrics.price - 1) * 100
      : null
  const quality = scenarios.modelQuality ?? (invalid ? 'Unavailable' : 'Medium')
  const change =
    metrics?.price && metrics.previousClose ? metrics.price - metrics.previousClose : null
  const changePct =
    change !== null && metrics?.previousClose ? (change / metrics.previousClose) * 100 : null

  const status = useMemo((): { text: string; tone: Tone } => {
    if (!loaded && query.isFetching) {
      return { text: `Loading ${ticker} valuation data...`, tone: 'warning' }
    }
    if (query.data?.meta.freshness === 'failed') {
      return { text: `Valuation load failed: ${query.data.meta.failureReason}`, tone: 'negative' }
    }
    if (!loaded) return { text: 'Enter a ticker and load valuation data.', tone: 'muted' }
    const peerWarnings = payload?.peerWarnings ?? []
    if (peerWarnings.length) {
      return {
        text: `Loaded valuation data for ${ticker}. ${peerWarnings.slice(0, 2).join(' ')}`,
        tone: 'warning',
      }
    }
    return { text: `Loaded valuation data for ${ticker}.`, tone: 'positive' }
  }, [loaded, payload, query.data, query.isFetching, ticker])

  const peerColumns: Array<Column<ValuationPeerRow>> = [
    {
      key: 'company',
      header: 'Company',
      cell: (row) => `${row.company} (${row.ticker})`,
      sortValue: (row) => `${row.company} (${row.ticker})`.toLowerCase(),
    },
    { key: 'source', header: 'Source', cell: (row) => row.source, sortValue: (row) => row.source },
    {
      key: 'marketCap',
      header: 'Market Cap',
      align: 'right',
      numeric: true,
      cell: (row) => compactCurrency(row.marketCap),
      sortValue: (row) => row.marketCap,
    },
    {
      key: 'revenueGrowth',
      header: 'Rev Growth',
      align: 'right',
      numeric: true,
      cell: (row) => pct(row.revenueGrowth),
      sortValue: (row) => row.revenueGrowth,
    },
    {
      key: 'netMargin',
      header: 'Net Margin',
      align: 'right',
      numeric: true,
      cell: (row) => pct(row.netMargin),
      sortValue: (row) => row.netMargin,
    },
    {
      key: 'pe',
      header: 'P/E',
      align: 'right',
      numeric: true,
      cell: (row) => ratio(row.pe),
      sortValue: (row) => row.pe,
    },
    {
      key: 'forwardPe',
      header: 'Forward P/E',
      align: 'right',
      numeric: true,
      cell: (row) => ratio(row.forwardPe),
      sortValue: (row) => row.forwardPe,
    },
    {
      key: 'evEbitda',
      header: 'EV/EBITDA',
      align: 'right',
      numeric: true,
      cell: (row) => ratio(row.evEbitda),
      sortValue: (row) => row.evEbitda,
    },
    {
      key: 'fcfYield',
      header: 'FCF Yield',
      align: 'right',
      numeric: true,
      cell: (row) => pct(row.fcfYield),
      sortValue: (row) => row.fcfYield,
    },
  ]

  const scenarioRows = useMemo(() => {
    const methods: Array<Pick<ValuationAssumptions, 'basisType' | 'terminalMethod'>> = [
      { basisType: 'FCF', terminalMethod: 'gordon_growth' },
      { basisType: 'FCF', terminalMethod: 'exit_multiple' },
      { basisType: 'EPS', terminalMethod: 'exit_multiple' },
    ]
    return methods.flatMap(({ basisType, terminalMethod }) => {
      const sameBasis = basisType === assumptions.basisType
      const basisValue = sameBasis
        ? assumptions.basisValue
        : (basisType === 'EPS' ? metrics?.eps : metrics?.fcfPerShare) ?? 0
      const exitMultiple = sameBasis
        ? assumptions.exitMultiple
        : peerExitMultiple(payload?.peerRows, basisType, ticker)?.value ??
          DEFAULT_VALUATION_ASSUMPTIONS.exitMultiple
      return calculateValuationScenarios(
        metrics?.price ?? null,
        { ...assumptions, basisType, basisValue, terminalMethod, exitMultiple },
        { blockingWarnings: valuationCurrencyWarnings(metrics) },
      ).scenarios
    })
  }, [assumptions, metrics, payload?.peerRows, ticker])
  const riskRows = useMemo(() => {
    // Cash, debt and net debt are reported figures rendered with a `$` prefix. Naming the
    // reporting currency keeps that prefix from reading as a claim when it is not the
    // currency of the quote.
    const statementCurrency = metrics?.financialCurrency ?? ''
    const unitNote =
      metrics?.currencyMismatch && statementCurrency ? ` - reported in ${statementCurrency}` : ''
    return [
      ['Cash & equivalents', compactCurrency(metrics?.cash), `Liquidity${unitNote}`],
      ['Total debt', compactCurrency(metrics?.debt), `Leverage${unitNote}`],
      ['Net debt', compactCurrency(metrics?.netDebt), `Negative means net cash${unitNote}`],
      ['Revenue growth', pct(metrics?.revenueGrowth), 'Latest available'],
      ['Net margin', pct(metrics?.netMargin), 'Profitability'],
      ['Beta', ratio(metrics?.beta), 'Market sensitivity'],
    ] as Array<[string, string, string]>
  }, [metrics])

  const sourceRows = useMemo(() => {
    const rows: Array<[string, string]> = []
    if (payload?.sources.quote) {
      rows.push(
        ['Live quote', payload.sources.quote],
        ['Statements', payload.sources.statements],
        ['Computed ratios', payload.sources.computed],
        ['Derived assumptions', payload.sources.suggestions],
        ['Last updated', timestampLabel(payload.generatedAt)],
      )
    }
    for (const entry of payload?.provenance ?? []) {
      rows.push([entry.metric, citation(entry)])
    }
    for (const caveat of payload?.suggestions.caveats ?? []) rows.push(['Caveat', caveat])
    const filter = sourceFilter.trim().toLowerCase()
    return filter ? rows.filter((row) => row.join(' ').toLowerCase().includes(filter)) : rows
  }, [payload, sourceFilter])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface px-2 py-1">
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            void load()
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            placeholder="Ticker"
            aria-label="Valuation ticker"
            className="h-8 w-28 border border-border-strong bg-surface-raised px-2 text-center text-2xs font-semibold tracking-wide text-text outline-none focus:border-accent"
          />
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? 'Loading...' : 'Load'}
          </Button>
        </form>

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-sm font-semibold text-text" title={metrics?.companyName}>
            {metrics?.companyName || 'Valuation'}
          </h1>
          <span className="num shrink-0 text-sm font-semibold text-text">
            {money(metrics?.price)}
          </span>
          {change === null ? null : (
            <span
              className={`num shrink-0 text-2xs font-semibold ${change >= 0 ? 'text-up' : 'text-down'}`}
            >
              {`${change >= 0 ? '+' : ''}${change.toFixed(2)} (${
                changePct === null
                  ? EM_DASH
                  : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`
              })`}
            </span>
          )}
        </div>

        <Chip label="Market cap">{compactCurrency(metrics?.marketCap)}</Chip>
        <Chip label="Basis">
          {metrics?.basisValue == null
            ? EM_DASH
            : `${metrics.basisType} ${currency(metrics.basisValue)}`}
        </Chip>
        <span className="max-w-56 truncate text-2xs text-text-muted" title={sectorLine(metrics)}>
          {sectorLine(metrics)}
        </span>
        <span className="text-2xs text-text-dim">
          {loaded ? timestampLabel(payload?.generatedAt) : EM_DASH}
        </span>
      </div>

      <DataFreshness envelope={envelope} loading={query.isFetching} />
      <section className="grid shrink-0 grid-cols-3 divide-x divide-border border border-border bg-surface py-1.5 lg:grid-cols-6">
        <Tile
          title="Verdict"
          value={invalid ? EM_DASH : verdict}
          caption={loaded && invalid ? 'Assumptions do not solve' : undefined}
          className={invalid ? 'text-text-muted' : verdictClass(verdict)}
          emphasis
        />
        {/* The fair value is sound in the reporting currency, but printing it beside a
            quote-currency price invites exactly the comparison being blocked. */}
        <Tile
          title="Estimated Fair Value"
          value={blocked ? EM_DASH : money(scenarios.baseFairValue)}
          caption={
            blocked ? 'Currency mismatch' : loaded ? 'Base case, per share' : 'Nothing loaded'
          }
        />
        <Tile
          title="Upside / Downside"
          value={blocked ? EM_DASH : pct(upside)}
          caption="Against the live price"
          className={
            blocked || upside === null ? 'text-text' : upside >= 0 ? 'text-up' : 'text-down'
          }
        />
        <Tile
          title="Margin of Safety"
          value={pct(assumptions.marginOfSafety)}
          caption="Discount to base case"
        />
        <Tile
          title="Model Quality"
          value={quality}
          caption={
            trends ? `${trends.comparableHistoryPoints} comparable periods` : 'Nothing loaded'
          }
          className={qualityClass(quality)}
        />
        <Tile
          title="Buy Below"
          value={blocked ? EM_DASH : money(scenarios.buyBelow)}
          caption={blocked ? undefined : `Upper scenario ${money(scenarios.upperScenario)}`}
        />
      </section>

      <div className="flex shrink-0 items-center gap-1 border-b border-border" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`h-8 border-b-2 px-3 text-2xs transition-colors ${
              activeTab === tab.key
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tab.label}
            {tab.key === 'peers' && customPeers.length ? (
              <span className="num ml-1 text-text-dim">{customPeers.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {notice ? (
        <p className={`shrink-0 px-1 text-2xs ${toneClass[notice.tone]}`}>{notice.text}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {activeTab === 'main' ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-1 xl:grid-cols-[2fr_3fr]">
            <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
              <div className="grid shrink-0 grid-cols-3 gap-1">
                {METRIC_DEFS.map((definition) => {
                  const value = metrics?.[definition.key] ?? null
                  const crossed = CROSSED_METRIC_KEYS.has(definition.key)
                  // A withheld ratio and a genuinely absent one both print a dash, so the
                  // mismatch note is tinted: it is the one case where the blank is a
                  // deliberate refusal rather than missing data.
                  const mismatched = crossed && Boolean(metrics?.currencyMismatch)
                  return (
                    <div
                      key={definition.key}
                      className="flex flex-col items-center gap-0.5 border border-border bg-surface px-2 py-1.5"
                    >
                      <span className="w-full truncate text-center text-2xs tracking-wide text-text-muted uppercase">
                        {definition.label}
                      </span>
                      <span className="num text-sm font-semibold text-text">
                        {definition.kind === 'pct' ? pct(value) : ratio(value)}
                      </span>
                      <span
                        className={`w-full truncate text-center text-2xs ${
                          mismatched ? 'text-warn' : 'text-text-dim'
                        }`}
                      >
                        {mismatched ? 'currency mismatch' : crossed ? 'computed' : 'quote/statements'}
                      </span>
                    </div>
                  )
                })}
              </div>
              <AssumptionsPanel
                assumptions={assumptions}
                onChange={(next: ValuationAssumptions) =>
                  setAssumptions(ticker, normalizeValuationAssumptions(next))
                }
                onRederive={rederive}
                stateLabel={derived.summary}
                stateTooltip={derived.detail}
                canRederive={loaded}
                warnings={loaded ? scenarios.warnings : []}
                warningTone={invalid || blocked ? 'negative' : 'warning'}
              />
            </div>
            <Panel
              title="Price vs Fair Value Band"
              warning={blocked ? scenarios.blockingWarnings[0] : undefined}
              actions={
                blocked ? null : (
                  <span className="flex items-center gap-2 text-2xs font-semibold">
                    <span style={{ color: BAND_COLOR.price }}>&#9679; Price</span>
                    <span style={{ color: BAND_COLOR.bear }}>&#9679; Bear</span>
                    <span style={{ color: BAND_COLOR.base }}>&#9679; Base</span>
                    <span style={{ color: BAND_COLOR.bull }}>&#9679; Bull</span>
                    <span style={{ color: BAND_COLOR.buyBelow }}>&#9679; Buy below</span>
                  </span>
                )
              }
            >
              {loaded ? (
                <div className="flex min-h-0 flex-1 flex-col p-1">
                  <FairValueBandChart
                    priceHistory={payload?.priceHistory ?? []}
                    scenarios={scenarios}
                  />
                </div>
              ) : (
                <PanelMessage>
                  {query.isFetching
                    ? `Loading ${ticker} valuation data...`
                    : 'Enter a ticker and load valuation data.'}
                </PanelMessage>
              )}
            </Panel>
          </div>
        ) : null}

        {activeTab === 'scenarios' ? (
          <Panel title="Scenarios">
            <DataTable
              rows={scenarioRows}
              rowKey={(row) => `${row.components.method}:${row.name}`}
              layout="fixed"
              empty="Load a ticker to solve the scenario ladder"
              columns={[
                {
                  key: 'name',
                  header: 'Scenario',
                  width: '14%',
                  cell: (row) => (
                    <span className={row.name === 'Base Case' ? 'font-semibold text-text' : ''}>
                      {row.name}
                    </span>
                  ),
                },
                {
                  key: 'fairValue',
                  header: 'Fair Value',
                  align: 'right',
                  numeric: true,
                  width: '12%',
                  cell: (row) => (
                    <span title={row.warnings.join(' ')}>{money(row.fairValue)}</span>
                  ),
                },
                {
                  key: 'upside',
                  header: 'Upside',
                  align: 'right',
                  numeric: true,
                  width: '10%',
                  cell: (row) => (
                    <span
                      className={
                        row.upsidePct === null ? '' : row.upsidePct >= 0 ? 'text-up' : 'text-down'
                      }
                    >
                      {pct(row.upsidePct)}
                    </span>
                  ),
                },
                {
                  // The share of fair value carried by the terminal value is what decides
                  // Model Quality and half the margin of safety, so it is worth showing.
                  key: 'terminalShare',
                  header: 'Terminal Share',
                  align: 'right',
                  numeric: true,
                  width: '13%',
                  cell: (row) =>
                    row.components.terminalValueShare === null
                      ? EM_DASH
                      : pct(row.components.terminalValueShare * 100),
                },
                {
                  key: 'method',
                  header: 'Terminal Method',
                  width: '16%',
                  cell: (row) => METHOD_LABEL[row.components.method],
                },
                {
                  key: 'assumptions',
                  header: 'Assumptions',
                  wrap: true,
                  cell: (row) =>
                    `${row.assumptions.basisType} ${money(row.assumptions.basisValue)} per share, ` +
                    `${row.assumptions.growth1to5.toFixed(1)}% / ${row.assumptions.growth6to10.toFixed(1)}% growth, ` +
                    `${row.assumptions.discountRate.toFixed(1)}% required` +
                    (row.components.method === 'gordon_growth'
                      ? `, ${row.assumptions.terminalGrowth.toFixed(1)}% terminal`
                      : `, ${row.assumptions.exitMultiple.toFixed(1)}x exit`),
                },
              ]}
            />
          </Panel>
        ) : null}

        {activeTab === 'peers' ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-1 xl:grid-cols-[1fr_5fr]">
            <Panel title={`Custom Peers — ${ticker}`}>
              <div className="flex min-h-0 flex-col gap-2 p-2">
                <form
                  className="flex items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault()
                    addPeer()
                  }}
                >
                  <input
                    value={peerDraft}
                    onChange={(event) => setPeerDraft(event.target.value.toUpperCase())}
                    placeholder="Ticker"
                    aria-label="Custom peer ticker"
                    className="h-8 min-w-0 flex-1 border border-border-strong bg-surface-raised px-2 text-2xs font-semibold tracking-wide text-text outline-none focus:border-accent"
                  />
                  <Button type="submit" variant="accent">
                    Add
                  </Button>
                </form>
                <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                  {customPeers.length ? (
                    customPeers.map((peer) => (
                      <li
                        key={peer}
                        className="flex h-8 shrink-0 items-center gap-2 border border-border bg-surface-raised px-2"
                      >
                        <span className="num flex-1 text-2xs font-semibold text-text">{peer}</span>
                        <button
                          type="button"
                          onClick={() => dropPeer(peer)}
                          aria-label={`Remove ${peer}`}
                          className="text-2xs text-text-muted transition-colors hover:text-down"
                        >
                          Remove
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="text-2xs text-text-dim">
                      No custom peers. Auto peers are chosen by industry, sector and size.
                    </li>
                  )}
                </ul>
                <p className="border-t border-border pt-2 text-2xs text-text-dim">
                  Saved per ticker. Adding or removing one reloads, because the peer median
                  sets the exit multiple.
                </p>
              </div>
            </Panel>
            <Panel
              title="Peer Comparison"
              actions={
                <span className="text-2xs text-text-dim">
                  {exitMultipleNote(payload?.suggestions.fields.exitMultiple)}
                </span>
              }
            >
              <DataTable
                rows={payload?.peerRows ?? []}
                rowKey={(row) => row.ticker}
                columns={peerColumns}
                rowClassName={(row) => (row.source === 'Loaded' ? 'text-text' : '')}
                empty="Load a ticker to rank its peers"
              />
            </Panel>
          </div>
        ) : null}

        {activeTab === 'risk' ? (
          <Panel title="Risk">
            <DataTable
              rows={riskRows}
              rowKey={(row) => row[0]}
              layout="fixed"
              empty="Load a ticker to see its balance sheet and risk figures"
              columns={[
                { key: 'metric', header: 'Metric', width: '26%', cell: (row) => row[0] },
                {
                  key: 'value',
                  header: 'Value',
                  align: 'right',
                  numeric: true,
                  width: '18%',
                  cell: (row) => row[1],
                },
                { key: 'notes', header: 'Notes', wrap: true, cell: (row) => row[2] },
              ]}
            />
          </Panel>
        ) : null}

        {activeTab === 'trends' ? (
          <div className="grid min-h-0 flex-1 grid-rows-2 gap-1">
            <Panel
              title="Historical P/E"
              actions={
                <span className="flex items-center gap-3 text-2xs">
                  <span className="num text-text-dim">
                    {`Monthly closes over ${
                      metrics?.eps == null ? EM_DASH : `${currency(metrics.eps)} trailing EPS`
                    }`}
                  </span>
                  <span className="font-semibold" style={{ color: BAND_COLOR.price }}>
                    &#9679; P/E
                  </span>
                  <span className="font-semibold" style={{ color: BAND_COLOR.base }}>
                    &#9679; Current
                  </span>
                </span>
              }
            >
              <div className="flex min-h-0 flex-1 flex-col p-1">
                <HistoricalPeChart
                  priceHistory={payload?.priceHistory ?? []}
                  eps={metrics?.eps ?? null}
                  currentPe={metrics?.pe ?? null}
                  currencyMismatch={Boolean(metrics?.currencyMismatch)}
                />
              </div>
            </Panel>
            <Panel
              title="Revenue / EPS / FCF Trend"
              warning={trends?.perShareApproximate ? trends.perShareSource : undefined}
              actions={
                trends?.labels.length ? (
                  <span className="flex items-center gap-3 text-2xs">
                    <span className="text-text-dim">{trends.perShareSource}</span>
                    <span className="font-semibold" style={{ color: BAND_COLOR.bull }}>
                      &#9679; Revenue $B
                    </span>
                    <span className="font-semibold" style={{ color: BAND_COLOR.base }}>
                      &#9679; FCF $B
                    </span>
                    <span className="font-semibold" style={{ color: BAND_COLOR.price }}>
                      &#9679; EPS $
                    </span>
                  </span>
                ) : null
              }
            >
              <div className="flex min-h-0 flex-1 flex-col p-1">
                {trends ? (
                  <TrendChart trends={trends} />
                ) : (
                  <PanelMessage>No annual history</PanelMessage>
                )}
              </div>
            </Panel>
          </div>
        ) : null}

        {activeTab === 'notes' ? (
          <Panel
            title={`Notes — ${ticker}`}
            actions={
              <span className="text-2xs text-text-dim">
                {notesByTicker[ticker] ? 'Saved for this ticker' : 'Not saved yet'}
              </span>
            }
          >
            <textarea
              value={notesByTicker[ticker] ?? ''}
              onChange={(event) => setNotes(ticker, event.target.value)}
              placeholder="Thesis, key risk, or source notes for this ticker"
              aria-label={`Valuation notes for ${ticker}`}
              className="min-h-0 flex-1 resize-none bg-surface p-2 text-2xs leading-relaxed text-text outline-none placeholder:text-text-dim"
            />
          </Panel>
        ) : null}

        {activeTab === 'sources' ? (
          <Panel
            title="Sources"
            actions={
              <SearchInput
                value={sourceFilter}
                onChange={setSourceFilter}
                placeholder="Filter sources"
                aria-label="Filter sources"
                className="w-48"
              />
            }
          >
            <DataTable
              rows={sourceRows}
              rowKey={(row, index) => `${row[0]}-${index}`}
              layout="fixed"
              columns={[
                { key: 'source', header: 'Source', width: '22%', cell: (row) => row[0] },
                { key: 'detail', header: 'Detail', wrap: true, cell: (row) => row[1] },
              ]}
              empty="Load a ticker to see its sources"
            />
          </Panel>
        ) : null}
      </div>

      <p className={`shrink-0 px-1 text-2xs ${toneClass[status.tone]}`}>{status.text}</p>
    </div>
  )
}

function citation(entry: ValuationProvenanceEntry): string {
  return [entry.source, entry.basis, entry.period, entry.facts.join(', ')]
    .filter((value) => value)
    .join(' | ')
}

/**
 * What the peer table is actually feeding the model. Falling back to the default is the
 * common case on megacap tech, where peer FCF yields put P/FCF outside the 3-50x bounds,
 * so saying so beside the table stops the fallback looking like a missing peer set.
 */
function exitMultipleNote(
  exitMultiple: { value: number; peerCount: number } | undefined,
): string {
  if (!exitMultiple) return ''
  return exitMultiple.peerCount
    ? `Exit multiple ${exitMultiple.value.toFixed(1)}x from ${exitMultiple.peerCount} usable peers`
    : `Exit multiple ${exitMultiple.value.toFixed(1)}x default — too few usable peer multiples`
}

function sectorLine(metrics: { sector: string; industry: string } | undefined): string {
  if (!metrics) return EM_DASH
  return metrics.industry && metrics.industry !== 'N/A'
    ? `${metrics.sector} / ${metrics.industry}`
    : metrics.sector
}
