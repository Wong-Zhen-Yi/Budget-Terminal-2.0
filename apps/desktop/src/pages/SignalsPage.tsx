import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  SignalCandidate,
  SignalResult,
  SignalsFilter,
  SignalsPayload,
} from '@shared/contract'
import {
  describeSignalsFreshness,
  formatSignalAge,
  formatSignalMoney,
  formatSignalPrice,
  formatSignalScore,
  SIGNAL_FILTERS,
  SIGNAL_INDICATOR_FIELDS,
  SIGNAL_ROLE_LABELS,
  SIGNAL_SCORE_COMPONENTS,
  signalScoreFraction,
  signalVisible,
  summarizeSignals,
} from '@shared/signals'
import { useSignalsLatest, useSignalsScan } from '@/api/signalsQueries'
import { useSettings, useSettingsMutation } from '@/api/settingsQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'
import { Splitter } from '@/components/ui/Splitter'

type Tone = 'muted' | 'positive' | 'warning' | 'negative'

const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

function resultTone(result: SignalResult): Tone {
  if (result.tradeStatus === 'DATA_ERROR') return 'negative'
  if (result.tradeStatus === 'TOO_EXTENDED' || result.tradeStatus === 'WATCH') return 'warning'
  if (result.tradeStatus === 'VALID_LONG') return 'positive'
  return 'muted'
}

function label(value: string): string {
  return value.replaceAll('_', ' ')
}

function marketOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? ''
  if (['Sat', 'Sun'].includes(part('weekday'))) return false
  const minutes = Number(part('hour')) * 60 + Number(part('minute'))
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}

function describeUniverse(payload: SignalsPayload | null): string {
  if (!payload) return 'Universe has not been sourced yet. Click Refresh now to run a scan.'
  const cacheLabel = payload.universeFromCache ? 'cached universe' : 'live universe refresh'
  return (
    `Universe sourced ${new Date(payload.sourcedAt).toLocaleString()} (${formatSignalAge(payload.sourcedAt)}) · ` +
    `${payload.sourceCandidateCount} screened · ${payload.passedFilterCount || payload.candidates.length} passed filters · ` +
    `${payload.candidates.length} shortlisted · ${payload.rejectedCandidateCount} rejected · ${cacheLabel}`
  )
}

function detailWarnings(result: SignalResult): string[] {
  const warnings = result.warnings.map((warning) => `⚠ ${warning}`)
  const frames = Object.entries(SIGNAL_ROLE_LABELS).flatMap(([role, roleLabel]) => {
    const status = result.timeframeStatus[role]
    if (!status) return []
    const bar = result.timeframeBars[role]
    const parts = [status]
    if (bar?.asOf) parts.push(`bar ${bar.asOf.replace('T', ' ').replace('.000Z', ' UTC')}`)
    if (bar?.dropped) parts.push('live bar excluded')
    else if (bar?.partial) parts.push('bar still forming')
    return [`${roleLabel}: ${parts.join(' · ')}`]
  })
  return warnings.length || frames.length
    ? [...warnings, ...(warnings.length && frames.length ? [''] : []), ...frames]
    : ['No warnings.']
}

export function SignalsPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const latest = useSignalsLatest()
  const scan = useSignalsScan()
  const settings = useSettings()
  const saveSettings = useSettingsMutation()
  const hydrated = useRef(false)
  const [filter, setFilter] = useState<SignalsFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedTicker, setSelectedTicker] = useState('')
  const [tableWidth, setTableWidth] = useState(820)
  const [now, setNow] = useState(() => new Date())

  const envelope = scan.data ?? latest.data
  const payload = envelope?.data ?? null

  useEffect(() => {
    onStatusChange(
      [{ label: 'Signals', envelope, loading: latest.isPending || scan.isPending }],
      '',
    )
  }, [onStatusChange, envelope, latest.isPending, scan.isPending])

  useEffect(() => {
    const saved = settings.data?.data.signalsPage
    if (!saved || hydrated.current) return
    hydrated.current = true
    setFilter(saved.filter)
    setSearch(saved.search)
  }, [settings.data])

  useEffect(() => {
    if (!hydrated.current) return
    const timer = setTimeout(() => {
      void saveSettings({ type: 'setSignalsPage', value: { filter, search } })
    }, 150)
    return () => clearTimeout(timer)
  }, [filter, search, saveSettings])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const visibleResults = useMemo(
    () => (payload?.results ?? []).filter((result) => signalVisible(result, filter, search)),
    [payload, filter, search],
  )
  const candidates = useMemo(
    () => new Map((payload?.candidates ?? []).map((candidate) => [candidate.ticker, candidate])),
    [payload],
  )

  useEffect(() => {
    if (selectedTicker && visibleResults.some((result) => result.ticker === selectedTicker)) return
    setSelectedTicker(visibleResults[0]?.ticker ?? '')
  }, [selectedTicker, visibleResults])

  const selectedResult = payload?.results.find((result) => result.ticker === selectedTicker) ?? null
  const selectedCandidate = candidates.get(selectedTicker) ?? null
  const counts = summarizeSignals(payload?.results ?? [])
  const freshness = describeSignalsFreshness(payload)

  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (scan.isPending) return { text: 'Sourcing and ranking liquid US equities…', tone: 'warning' }
    if (scan.data?.meta.freshness === 'failed') {
      return { text: `Scan failed: ${scan.data.meta.failureReason ?? 'Signals unavailable'}`, tone: 'negative' }
    }
    if (latest.data?.meta.freshness === 'failed' && !payload) {
      return { text: `Signals unavailable: ${latest.data.meta.failureReason ?? 'Unknown error'}`, tone: 'negative' }
    }
    return freshness
  }, [scan.isPending, scan.data, latest.data, payload, freshness])

  const runScan = useCallback((force: boolean) => {
    scan.mutate({
      forceMarketRefresh: force,
      forceUniverseRefresh: force,
    })
  }, [scan])

  const columns = useMemo<Array<Column<SignalResult>>>(() => [
    {
      key: 'rank',
      header: 'Rank',
      cell: (result) => candidates.get(result.ticker)?.qualityRank ?? '—',
      sortValue: (result) => candidates.get(result.ticker)?.qualityRank ?? null,
      align: 'right',
      numeric: true,
      width: '54px',
    },
    {
      key: 'ticker',
      header: 'Ticker',
      cell: (result) => <span className={toneClass[resultTone(result)]}>{result.ticker}</span>,
      sortValue: (result) => result.ticker,
      width: '72px',
    },
    {
      key: 'price',
      header: 'Price',
      cell: (result) => <span className={toneClass[resultTone(result)]}>{formatSignalPrice(result.price ?? candidates.get(result.ticker)?.price)}</span>,
      sortValue: (result) => result.price ?? candidates.get(result.ticker)?.price ?? null,
      align: 'right',
      numeric: true,
      width: '84px',
    },
    {
      key: 'marketCap',
      header: 'Market Cap',
      cell: (result) => formatSignalMoney(candidates.get(result.ticker)?.marketCap),
      sortValue: (result) => candidates.get(result.ticker)?.marketCap ?? null,
      align: 'right',
      numeric: true,
      width: '104px',
    },
    {
      key: 'dollarVolume',
      header: '20D $ Volume',
      cell: (result) => formatSignalMoney(candidates.get(result.ticker)?.medianDollarVolume),
      sortValue: (result) => candidates.get(result.ticker)?.medianDollarVolume ?? null,
      align: 'right',
      numeric: true,
      width: '116px',
    },
    {
      key: 'score',
      header: 'Score',
      cell: (result) => <span className={toneClass[resultTone(result)]}>{formatSignalScore(result.rawScore, result.maxScore)}</span>,
      sortValue: signalScoreFraction,
      align: 'right',
      numeric: true,
      width: '70px',
    },
    {
      key: 'signal',
      header: 'Signal',
      cell: (result) => <span className={toneClass[resultTone(result)]}>{label(result.signal)}</span>,
      sortValue: (result) => ({ NONE: 0, WATCH: 1, LONG: 2, STRONG_LONG: 3 })[result.signal],
      width: '112px',
    },
    {
      key: 'tradeStatus',
      header: 'Trade Status',
      cell: (result) => <span title={result.error || result.warnings.join('\n')} className={toneClass[resultTone(result)]}>{label(result.tradeStatus)}</span>,
      sortValue: (result) => result.tradeStatus,
    },
  ], [candidates])

  const metricValues = [
    ['Shortlisted', payload ? payload.candidates.length : '—'],
    ['Valid longs', payload ? counts.validLong : '—'],
    ['Blocked', payload ? counts.blocked : '—'],
    ['Watch', payload ? counts.watch : '—'],
    ['Too new', payload ? counts.tooNew : '—'],
    ['Data errors', payload ? counts.errors : '—'],
    ['Last scan', payload ? formatSignalAge(payload.completedAt) : '—'],
  ]

  const empty = !payload
    ? 'No scan yet. Click Refresh now to source and score liquid US leaders.'
    : payload.results.length && !visibleResults.length
      ? 'No results match this filter.'
      : 'The last scan produced no results. Try Force full re-download.'

  const maximumTableWidth = Math.max(420, window.innerWidth - 380)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-baseline gap-3">
        <h1 className="text-sm font-semibold text-text">Signals</h1>
        <p className="text-2xs text-text-muted">
          Sources liquid US leaders on demand, then scores Daily → Hourly → 5-minute → 1-minute analysis out of 100. Decision support only.
        </p>
      </div>

      <section className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface p-2">
        <span className={`text-2xs font-medium ${marketOpen(now) ? 'text-up' : 'text-text-muted'}`}>
          US MARKET {marketOpen(now) ? 'OPEN' : 'CLOSED'}
        </span>
        <Button variant="accent" disabled={scan.isPending} onClick={() => runScan(false)}>
          {scan.isPending ? 'Refreshing…' : 'Refresh now'}
        </Button>
        <Button disabled={scan.isPending} onClick={() => runScan(true)} title="Re-source the universe and re-download every timeframe, ignoring caches.">
          Force full re-download
        </Button>
        <Select value={filter} options={SIGNAL_FILTERS} onChange={setFilter} className="w-40" aria-label="Signal filter" />
        <SearchInput value={search} onChange={setSearch} placeholder="Search ticker" className="w-36" aria-label="Search ticker" />
        <span className={`ml-auto text-right text-2xs ${toneClass[status.tone]}`}>{status.text}</span>
      </section>

      <section className="flex shrink-0 gap-6 border border-border bg-surface px-3 py-2">
        {metricValues.map(([caption, value]) => (
          <div key={caption} className="min-w-16">
            <div className="text-[10px] text-text-dim">{caption}</div>
            <div className="num text-xs font-semibold text-text">{value}</div>
          </div>
        ))}
      </section>

      <div className="shrink-0 space-y-1 text-[10px] leading-4 text-text-dim">
        <p>
          Universe: US common stocks · price ≥ $5 · market cap ≥ $2B · 20-session median dollar volume ≥ $20M · top 25 by liquidity. Context timeframes score the last closed bar; entry uses the live bar. Every check awards partial credit, with distances measured in ATR of the timeframe being scored. Relative strength is daily excess return against SPY; a scan without a usable benchmark is scored out of 84 instead of 100.
        </p>
        <p>{describeUniverse(payload)}</p>
      </div>

      {scan.isPending ? <div className="h-1 shrink-0 animate-pulse bg-accent" /> : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 shrink-0 flex-col overflow-hidden border border-border" style={{ width: tableWidth }}>
          <DataTable
            columns={columns}
            rows={visibleResults}
            rowKey={(result) => result.ticker}
            layout="fixed"
            defaultSort={{ key: 'rank', direction: 'asc' }}
            onRowClick={(result) => setSelectedTicker(result.ticker)}
            rowClassName={(result) => result.ticker === selectedTicker ? 'bg-accent-dim/60' : ''}
            empty={empty}
          />
        </div>
        <Splitter onDrag={(clientX) => setTableWidth(Math.min(Math.max(clientX, 420), maximumTableWidth))} />
        <SignalDetail candidate={selectedCandidate} result={selectedResult} />
      </div>
    </div>
  )
}

function SignalDetail({
  candidate,
  result,
}: {
  candidate: SignalCandidate | null
  result: SignalResult | null
}) {
  if (!result) {
    return (
      <aside className="min-h-0 min-w-0 flex-1 overflow-auto border border-border p-3">
        <h2 className="text-sm font-semibold text-text">Select a signal result</h2>
        <p className="pt-2 text-2xs text-text-muted">Click Refresh now to scan, then select a result.</p>
      </aside>
    )
  }

  const tone = resultTone(result)
  const indicatorLines = SIGNAL_INDICATOR_FIELDS.map(([name, key, unit]) => {
    const value = result.indicators[key]
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null
    return `${name}: ${numeric === null ? 'Unavailable' : `${unit === '$' ? '$' : ''}${numeric.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit === '$' ? '' : unit}`}`
  })
  const qualityReasons = (candidate?.reasons ?? []).map((reason) => `✓ ${reason}`)
  const scoredReasons = result.reasons.flatMap((reason) => {
    const glyph = reason.points >= reason.weight - 1e-9 ? '✓' : reason.points > 0 ? '◐' : '○'
    const awarded = `+${Number(reason.points.toFixed(2))} of ${Number(reason.weight.toFixed(2))}`
    return [`${glyph} ${reason.name} (${awarded})`, `   ${reason.description}`]
  })

  return (
    <aside className="min-h-0 min-w-0 flex-1 overflow-auto border border-border p-3">
      <h2 className="text-sm font-semibold text-text">{result.ticker} · {formatSignalPrice(result.price)}</h2>
      <p className={`whitespace-pre-line py-1 text-2xs ${toneClass[tone]}`}>
        {candidate ? `Quality rank #${candidate.qualityRank}` : 'Quality rank unavailable'} · Technical signal {label(result.signal)} · Score {formatSignalScore(result.rawScore, result.maxScore)}{`\n`}Final trade status: {label(result.tradeStatus)}
      </p>

      <table className="my-2 w-full border-collapse text-2xs">
        <thead><tr className="bg-surface-raised text-text-muted"><th className="px-2 py-1 text-left">Component</th><th className="px-2 py-1 text-right">Score</th><th className="px-2 py-1 text-left">Evidence</th></tr></thead>
        <tbody>
          {SIGNAL_SCORE_COMPONENTS.map(([name, scoreKey, maxKey, evidence]) => (
            <tr key={name} className="border-b border-border/40">
              <td className="px-2 py-1 text-text">{name}</td>
              <td className="num px-2 py-1 text-right text-text">{formatSignalScore(result[scoreKey], result[maxKey])}</td>
              <td className="px-2 py-1 text-text-muted">{evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <DetailBlock title="Indicator values" lines={indicatorLines} />
      <DetailBlock title="Why this ticker was selected" lines={[...qualityReasons, ...(qualityReasons.length && scoredReasons.length ? [''] : []), ...scoredReasons]} />
      <DetailBlock title="Bar freshness, warnings and data health" lines={detailWarnings(result)} />
    </aside>
  )
}

function DetailBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="mt-3">
      <h3 className="pb-1 text-2xs font-semibold text-text">{title}</h3>
      <pre className="whitespace-pre-wrap border border-border bg-bg p-2 font-mono text-[10px] leading-4 text-text-muted">{lines.join('\n')}</pre>
    </section>
  )
}
