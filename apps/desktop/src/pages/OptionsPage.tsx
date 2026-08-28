import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  Envelope,
  OptionsChainPayload,
  OptionsExpirationsPayload,
  OptionsRawRow,
  OptionsStrategy,
  OptionsTypeFilter,
} from '@shared/contract'
import {
  bestStrategySummary,
  buildChainExport,
  buildTopVolumeExport,
  formatExpiration,
  formatStrikeOption,
  matchStrike,
  OPTIONS_STRATEGIES,
  OPTIONS_TYPE_FILTERS,
  rankStrategyRows,
  strikeRecords,
  topVolumeRecords,
} from '@shared/optionsPage'
import { api } from '@/api/client'
import {
  useOptionsChain,
  useOptionsExpirations,
  useRefreshOptionsChain,
  useRefreshOptionsExpirations,
} from '@/api/optionsQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { OptionChainTable } from '@/components/options/OptionChainTable'
import { OptionSummaryTable } from '@/components/options/OptionSummaryTable'
import { HIGHLIGHT_LEGEND } from '@/components/options/highlights'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { currency } from '@/lib/format'
import { useOptionsPage, type OptionsTab } from '@/stores/options'

/**
 * The Options page, ported from `OptionsChainMixin` (page5).
 *
 * One shared ticker across three subtabs, exactly as the reference has it: Chain loads
 * a single expiration and computes its Greeks; Options by Top Volume and Options by
 * Strike both work off *every* live expiration. The reference sweeps its chain cache
 * once per subtab; here one `optionsExpirations` payload feeds both, so the type filter
 * and the strike selection reorder what is already loaded instead of refetching — the
 * reference reloads on both, and only its cache keeps that cheap.
 *
 * Nothing loads on mount. `init_page5` fires no request either: every load on this page
 * comes from a button, because a chain sweep is one Yahoo request per listed expiry.
 */

const TABS: ReadonlyArray<{ id: OptionsTab; label: string }> = [
  { id: 'chain', label: 'Chain' },
  { id: 'top-volume', label: 'Options by Top Volume' },
  { id: 'strike', label: 'Options by Strike' },
]

type Tone = 'muted' | 'positive' | 'warning' | 'negative'
const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

/** `_p5_top_volume_grid_column_count`: a grid that narrows with the expiration count. */
function gridColumns(count: number): number {
  if (count <= 1) return 1
  if (count <= 4) return 2
  return 3
}

function failureOf(envelope: Envelope<unknown> | undefined, block: string): string | undefined {
  if (!envelope) return undefined
  const matched = envelope.errors.find((entry) => entry.symbol === block)
  if (matched) return matched.reason
  return envelope.meta.freshness === 'failed' ? envelope.meta.failureReason : undefined
}

function clockNow(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

export function OptionsPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const {
    symbol,
    tab,
    expiry,
    strategy,
    typeFilter,
    selectedStrike,
    summarySort,
    setSymbol,
    setTab,
    setExpiry,
    setStrategy,
    setTypeFilter,
    setSelectedStrike,
    setSummarySort,
  } = useOptionsPage()
  const [draft, setDraft] = useState(symbol)
  // Nothing fetches until the tab in question has been asked for at least once.
  const [armed, setArmed] = useState({ chain: false, sweep: false })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)

  const chainQuery = useOptionsChain(symbol, expiry, armed.chain)
  const sweepQuery = useOptionsExpirations(symbol, armed.sweep)
  const refreshChain = useRefreshOptionsChain()
  const refreshSweep = useRefreshOptionsExpirations()

  const chain = chainQuery.data?.data
  const sweep = sweepQuery.data?.data

  useEffect(() => setDraft(symbol), [symbol])

  useEffect(() => {
    onStatusChange(
      [
        { label: 'Options chain', envelope: chainQuery.data, loading: chainQuery.isFetching },
        { label: 'Options expirations', envelope: sweepQuery.data, loading: sweepQuery.isFetching },
      ],
      '',
    )
  }, [onStatusChange, chainQuery.data, chainQuery.isFetching, sweepQuery.data, sweepQuery.isFetching])

  // The response resolves the expiry when the stored one is gone; follow it so the
  // dropdown and the query key agree on the next load.
  useEffect(() => {
    if (chain?.expiry && chain.expiry !== expiry) setExpiry(chain.expiry)
  }, [chain?.expiry, expiry, setExpiry])

  // Same for the strike: a reload keeps the previous pick only while it is still quoted.
  useEffect(() => {
    if (!sweep) return
    const matched = matchStrike(sweep.strikes, selectedStrike)
    if (matched !== selectedStrike) setSelectedStrike(matched)
  }, [sweep, selectedStrike, setSelectedStrike])

  const loadChain = useCallback(
    async (nextExpiry?: string) => {
      const ticker = draft.trim().toUpperCase()
      if (!ticker) {
        setNotice({ text: 'Enter a ticker above to view the full options chain.', tone: 'muted' })
        return
      }
      const target = nextExpiry ?? (ticker === symbol ? expiry : '')
      setSymbol(ticker)
      setExpiry(target)
      setArmed((state) => ({ ...state, chain: true }))
      setNotice(null)
      setBusy(true)
      try {
        await refreshChain(ticker, target)
      } finally {
        setBusy(false)
      }
    },
    [draft, expiry, refreshChain, setExpiry, setSymbol, symbol],
  )

  const loadSweep = useCallback(async () => {
    const ticker = draft.trim().toUpperCase()
    if (!ticker) {
      setNotice({ text: 'Enter a ticker above to load every expiration.', tone: 'muted' })
      return
    }
    setSymbol(ticker)
    setArmed((state) => ({ ...state, sweep: true }))
    setNotice(null)
    setBusy(true)
    try {
      await refreshSweep(ticker)
    } finally {
      setBusy(false)
    }
  }, [draft, refreshSweep, setSymbol])

  /** `_p5_load_active_subtab`: the shared Load button drives whichever tab is on screen. */
  const loadActive = useCallback(() => {
    if (tab === 'chain') return void loadChain()
    return void loadSweep()
  }, [loadChain, loadSweep, tab])

  const exportChain = useCallback(async () => {
    if (!chain || !chain.rows.length || !chain.expiry) {
      setNotice({ text: 'No chain data is currently loaded to export.', tone: 'warning' })
      return
    }
    await api.writeClipboard(
      buildChainExport({
        ticker: chain.symbol,
        expiry: chain.expiry,
        spotPrice: chain.spotPrice,
        riskFreeRate: chain.riskFreeRate,
        rateSource: chain.rateSource,
        dividendYield: chain.dividendYield,
        dividendSource: chain.dividendSource,
        strategy,
        rows: chain.rows,
        exportedAt: new Date().toLocaleString('sv-SE').slice(0, 19),
      }),
    )
    setNotice({
      text: `Chain export copied to clipboard for ${chain.symbol} ${chain.expiry}`,
      tone: 'positive',
    })
  }, [chain, strategy])

  /** Every expiration's top-volume table under the current type filter. */
  const topVolumeBuckets = useMemo(
    () =>
      (sweep?.buckets ?? []).map((bucket) => ({
        expiry: bucket.expiry,
        rows: topVolumeRecords(bucket.rows, typeFilter),
      })),
    [sweep, typeFilter],
  )

  const strikeBuckets = useMemo(
    () =>
      (sweep?.buckets ?? []).map((bucket) => ({
        expiry: bucket.expiry,
        rows: selectedStrike === null ? [] : strikeRecords(bucket.rows, selectedStrike),
      })),
    [sweep, selectedStrike],
  )

  const exportTopVolume = useCallback(async () => {
    const total = topVolumeBuckets.reduce((sum, bucket) => sum + bucket.rows.length, 0)
    if (!total) {
      setNotice({
        text: 'No options by top volume data is currently loaded to export.',
        tone: 'warning',
      })
      return
    }
    await api.writeClipboard(
      buildTopVolumeExport({
        ticker: sweep?.symbol ?? symbol,
        typeFilter,
        buckets: topVolumeBuckets,
        exportedAt: new Date().toLocaleString('sv-SE').slice(0, 19),
      }),
    )
    setNotice({ text: 'Options by top volume export copied to clipboard', tone: 'positive' })
  }, [sweep, symbol, topVolumeBuckets, typeFilter])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface px-2 py-1">
        <span className="text-2xs font-semibold text-text">Ticker:</span>
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            loadActive()
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            placeholder="Enter Ticker (e.g. AAPL)"
            aria-label="Options ticker"
            className="h-8 w-44 border border-border-strong bg-surface-raised px-2 text-2xs font-semibold tracking-wide text-text outline-none focus:border-accent"
          />
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? 'Loading...' : 'Load Current Tab'}
          </Button>
        </form>
        <Button variant="accent" onClick={() => void exportTopVolume()}>
          Export Options by Top Volume
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {TABS.map((entry) => (
            <Button
              key={entry.id}
              variant="toggle"
              active={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </div>

      {notice ? (
        <p className={`shrink-0 px-1 text-2xs ${toneClass[notice.tone]}`}>{notice.text}</p>
      ) : null}

      {tab === 'chain' ? (
        <ChainTab
          payload={chain}
          armed={armed.chain}
          loading={chainQuery.isFetching}
          warning={failureOf(chainQuery.data, 'Chain')}
          expiry={expiry}
          strategy={strategy}
          onExpiry={(value) => void loadChain(value)}
          onStrategy={setStrategy}
          onLoad={() => void loadChain()}
          onExport={() => void exportChain()}
        />
      ) : tab === 'top-volume' ? (
        <SummaryGrid
          title="Top Options by Volume"
          armed={armed.sweep}
          loading={sweepQuery.isFetching}
          payload={sweep}
          buckets={topVolumeBuckets}
          sort={summarySort}
          onSort={setSummarySort}
          envelope={sweepQuery.data}
          emptyHint="Enter a ticker above to view options by top volume across all available expirations."
          controls={
            <>
              <Button variant="accent" onClick={() => void loadSweep()}>
                Load Options by Top Volume
              </Button>
              <span className="ml-2 text-2xs font-semibold text-text">Type:</span>
              {OPTIONS_TYPE_FILTERS.map((entry) => (
                <Button
                  key={entry.key}
                  variant="toggle"
                  active={typeFilter === entry.key}
                  onClick={() => setTypeFilter(entry.key as OptionsTypeFilter)}
                >
                  {entry.label}
                </Button>
              ))}
              <Legend />
            </>
          }
        />
      ) : (
        <SummaryGrid
          title="Options by Strike"
          armed={armed.sweep}
          loading={sweepQuery.isFetching}
          payload={sweep}
          buckets={strikeBuckets}
          sort={summarySort}
          onSort={setSummarySort}
          envelope={sweepQuery.data}
          emptyHint="Enter a ticker above, load strikes, then choose a strike to view matching options across all available expirations."
          controls={
            <>
              <Button variant="accent" onClick={() => void loadSweep()}>
                Load Strikes
              </Button>
              <span className="ml-2 text-2xs font-semibold text-text">Strike:</span>
              <Select
                aria-label="Strike"
                className="w-28"
                value={selectedStrike === null ? '' : String(selectedStrike)}
                options={[
                  { value: '', label: 'Select strike' },
                  ...(sweep?.strikes ?? []).map((strike) => ({
                    value: String(strike),
                    label: formatStrikeOption(strike),
                  })),
                ]}
                onChange={(value) => setSelectedStrike(value === '' ? null : Number(value))}
              />
            </>
          }
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- chain */

function ChainTab({
  payload,
  armed,
  loading,
  warning,
  expiry,
  strategy,
  onExpiry,
  onStrategy,
  onLoad,
  onExport,
}: {
  payload: OptionsChainPayload | undefined
  armed: boolean
  loading: boolean
  warning?: string
  expiry: string
  strategy: OptionsStrategy
  onExpiry: (expiry: string) => void
  onStrategy: (strategy: OptionsStrategy) => void
  onLoad: () => void
  onExport: () => void
}) {
  const rows = payload?.rows ?? []
  const calls = useMemo(
    () => rows.filter((row) => row.type === 'Call').sort((a, b) => a.strike - b.strike),
    [rows],
  )
  const puts = useMemo(
    () => rows.filter((row) => row.type === 'Put').sort((a, b) => a.strike - b.strike),
    [rows],
  )
  const callRanks = useMemo(
    () => rankStrategyRows(calls, strategy, payload?.spotPrice ?? 0, payload?.expiry ?? ''),
    [calls, strategy, payload?.spotPrice, payload?.expiry],
  )
  const putRanks = useMemo(
    () => rankStrategyRows(puts, strategy, payload?.spotPrice ?? 0, payload?.expiry ?? ''),
    [puts, strategy, payload?.spotPrice, payload?.expiry],
  )

  // `_p5_populate_tables`' status line: the time, the two Greek inputs and their
  // sources, and — under a strategy — how many rows it highlighted and why the top one.
  const status = useMemo(() => {
    if (warning) return { text: warning, tone: 'negative' as Tone }
    if (!armed) return { text: 'Enter a ticker above to view the full options chain.', tone: 'muted' as Tone }
    if (loading && !rows.length) return { text: 'Loading chain...', tone: 'warning' as Tone }
    if (!rows.length) return { text: 'No chain data available.', tone: 'muted' as Tone }
    let text = `Chain updated at ${clockNow()}`
    text += ` | r ${((payload?.riskFreeRate ?? 0) * 100).toFixed(2)}% (${payload?.rateSource})`
    text += ` | q ${((payload?.dividendYield ?? 0) * 100).toFixed(2)}% (${payload?.dividendSource})`
    const ranked = strategy === 'Covered Call' ? callRanks : strategy === 'Cash Secured Put' ? putRanks : null
    if (ranked?.size) {
      const side = strategy === 'Covered Call' ? 'call' : 'put'
      text += ` | ${strategy}: highlighted top ${ranked.size} ${side} candidates`
      const best = bestStrategySummary(strategy, callRanks, putRanks)
      if (best) text += ` | #1: ${best}`
    }
    return { text, tone: 'positive' as Tone }
  }, [armed, callRanks, loading, payload, putRanks, rows.length, strategy, warning])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface px-2 py-1">
        <Button variant="accent" onClick={onLoad}>
          Load Chain
        </Button>
        <Button variant="accent" onClick={onExport}>
          Export Chain
        </Button>
        <span className="num ml-2 text-sm font-bold text-up">
          {payload?.spotPrice ? currency(payload.spotPrice) : ''}
        </span>
        <span className="ml-4 text-2xs font-semibold text-text">Expiry:</span>
        <Select
          aria-label="Expiry"
          className="w-40"
          value={payload?.expiry || expiry}
          options={
            payload?.expiries.length
              ? payload.expiries.map((entry) => ({ value: entry.expiry, label: entry.label }))
              : [{ value: expiry, label: expiry || 'No expirations' }]
          }
          onChange={onExpiry}
        />
        <span className="ml-2 text-2xs font-semibold text-text">Strategy:</span>
        <Select
          aria-label="Strategy"
          className="w-40"
          value={strategy}
          options={OPTIONS_STRATEGIES.map((entry) => ({ value: entry, label: entry }))}
          onChange={(value) => onStrategy(value as OptionsStrategy)}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-1">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-surface">
          <header className="shrink-0 border-b border-border bg-surface-raised px-2 py-1 text-2xs font-semibold text-text">
            CALLS
          </header>
          <OptionChainTable rows={calls} ranks={callRanks} empty="No calls loaded" />
        </section>
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-surface">
          <header className="shrink-0 border-b border-border bg-surface-raised px-2 py-1 text-2xs font-semibold text-text">
            PUTS
          </header>
          <OptionChainTable rows={puts} ranks={putRanks} empty="No puts loaded" />
        </section>
      </div>

      <p className={`shrink-0 px-1 text-2xs ${toneClass[status.tone]}`}>{status.text}</p>
    </div>
  )
}

/* ----------------------------------------------------------- summary grids */

function Legend() {
  return (
    <span className="ml-3 flex items-center gap-2">
      {HIGHLIGHT_LEGEND.map((entry) => (
        <span key={entry.label} className="flex items-center gap-1 text-2xs text-text-muted">
          <span
            className="size-3 border border-border-strong"
            style={{ background: entry.color }}
            aria-hidden
          />
          {entry.label}
        </span>
      ))}
    </span>
  )
}

function SummaryGrid({
  title,
  armed,
  loading,
  payload,
  buckets,
  sort,
  onSort,
  envelope,
  controls,
  emptyHint,
}: {
  title: string
  armed: boolean
  loading: boolean
  payload: OptionsExpirationsPayload | undefined
  buckets: Array<{ expiry: string; rows: OptionsRawRow[] }>
  sort: Parameters<typeof OptionSummaryTable>[0]['sort']
  onSort: Parameters<typeof OptionSummaryTable>[0]['onSortChange']
  envelope: Envelope<OptionsExpirationsPayload> | undefined
  controls: React.ReactNode
  emptyHint: string
}) {
  const columns = gridColumns(buckets.length)
  const total = buckets.reduce((sum, bucket) => sum + bucket.rows.length, 0)

  const status = !armed
    ? { text: emptyHint, tone: 'muted' as Tone }
    : loading && !buckets.length
      ? { text: `Loading ${title.toLowerCase()} for ${payload?.symbol ?? ''} across all available expirations...`, tone: 'warning' as Tone }
      : !buckets.length
        ? { text: failureOf(envelope, 'Expirations') ?? 'No expirations available.', tone: 'warning' as Tone }
        : {
            text: `${buckets.length} expiration(s), ${total} row(s) for ${payload?.symbol ?? ''}.`,
            tone: 'positive' as Tone,
          }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border border-border bg-surface px-2 py-1">
        {controls}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {buckets.map((bucket) => (
            <section
              key={bucket.expiry}
              className="flex min-h-[220px] flex-col overflow-hidden border border-border bg-surface"
            >
              <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2 py-1">
                <h2 className="truncate text-2xs font-semibold text-text uppercase">
                  {`${title} - ${formatExpiration(bucket.expiry) || bucket.expiry}`}
                </h2>
                {failureOf(envelope, bucket.expiry) ? (
                  <span
                    title={failureOf(envelope, bucket.expiry)}
                    className="size-1.5 shrink-0 rounded-full bg-down"
                    aria-label={failureOf(envelope, bucket.expiry)}
                  />
                ) : null}
              </header>
              <OptionSummaryTable rows={bucket.rows} sort={sort} onSortChange={onSort} />
            </section>
          ))}
        </div>
      </div>

      <p className={`shrink-0 px-1 text-2xs ${toneClass[status.tone]}`}>{status.text}</p>
    </div>
  )
}
