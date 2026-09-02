import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { LogicalRange } from 'lightweight-charts'

import { STOCKS_RANGE_PRESETS, type Candle, type Envelope, type StocksInstitutionalRow, type StocksInsiderRow, type StocksNewsRow, type StocksPayload } from '@shared/contract'
import { buildStocksLlmExport, selectStocksPayload, STOCKS_MFI_PERIOD } from '@shared/stocks'
import { api } from '@/api/client'
import { useRefreshStocks, useStocks } from '@/api/stocksQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { StocksChart } from '@/components/stocks/StocksChart'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { compactNumber, currency, decimals, signedCurrencyPrecise } from '@/lib/format'
import { useStocksPage } from '@/stores/stocks'

const OVERVIEW_ROWS: Array<[string, keyof StocksPayload['metrics']]> = [
  ['Market cap', 'marketCap'],
  ['Revenue', 'revenue'],
  ['Net income', 'netIncome'],
  ['EPS', 'eps'],
  ['Gross margin', 'grossMargin'],
  ['Operating margin', 'operatingMargin'],
  ['Net margin', 'netMargin'],
  ['Shares outstanding', 'sharesOutstanding'],
  ['P/E', 'pe'],
  ['Forward P/E', 'forwardPe'],
  ['Dividend', 'dividend'],
  ['Ex-dividend date', 'exDividendDate'],
  ['Volume', 'volume'],
  ['Beta', 'beta'],
  ['Earnings date', 'earningsDate'],
]

const TARGET_ROWS: Array<[string, keyof StocksPayload['targets']]> = [
  ['Low', 'low'],
  ['Mean', 'mean'],
  ['High', 'high'],
  ['Upside to mean', 'upsideToMean'],
  ['Analysts', 'analysts'],
]

type Tone = 'muted' | 'positive' | 'warning' | 'negative'
const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

function warningOf(envelope: Envelope<StocksPayload> | undefined, ...blocks: string[]): string | undefined {
  if (!envelope) return undefined
  const matched = envelope.errors.find((entry) => entry.symbol && blocks.includes(entry.symbol))
  if (matched) return matched.reason
  return envelope.meta.freshness === 'failed' ? envelope.meta.failureReason : undefined
}

export function StocksPage({
  onStatusChange,
  onNavigate,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const {
    symbol,
    autoFollow,
    mfiEnabled,
    rangePreset,
    mainSizes,
    leftSizes,
    middleSizes,
    snapshot,
    logicalRange,
    setSymbol,
    toggleAutoFollow,
    toggleMfi,
    setRangePreset,
    setMainSizes,
    setLeftSizes,
    setMiddleSizes,
    setSnapshot,
    setLogicalRange,
  } = useStocksPage()
  const [draft, setDraft] = useState(symbol)
  const [manualLoading, setManualLoading] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)
  const [hovered, setHovered] = useState<Candle | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const middleRef = useRef<HTMLDivElement>(null)

  const query = useStocks(symbol, snapshot)
  const refresh = useRefreshStocks()
  const fetchedPayload = query.data?.data.chart.candles.length ? query.data.data : null
  const payload = selectStocksPayload(fetchedPayload, snapshot)

  useEffect(() => setDraft(symbol), [symbol])
  useEffect(() => {
    if (fetchedPayload && fetchedPayload.generatedAt > 0) setSnapshot(fetchedPayload)
  }, [fetchedPayload, setSnapshot])
  useEffect(() => {
    onStatusChange(
      [{ label: 'Stocks', envelope: query.data, loading: query.isFetching }],
      '',
    )
  }, [onStatusChange, query.data, query.isFetching])

  const load = useCallback(async () => {
    const next = draft.trim().toUpperCase() || 'SPY'
    setDraft(next)
    setSymbol(next)
    setNotice(null)
    setManualLoading(true)
    try {
      await refresh(next)
    } finally {
      setManualLoading(false)
    }
  }, [draft, refresh, setSymbol])

  const exportForLlm = useCallback(async () => {
    if (!payload?.chart.candles.length) {
      setNotice({ text: 'Export failed: no Stocks data is currently loaded.', tone: 'warning' })
      return
    }
    try {
      await api.writeClipboard(buildStocksLlmExport(payload, { autoFollow, mfiEnabled }))
      setNotice({ text: `Stocks export copied to clipboard for ${payload.symbol}.`, tone: 'positive' })
    } catch (error) {
      setNotice({ text: `Export failed: ${error instanceof Error ? error.message : String(error)}`, tone: 'negative' })
    }
  }, [payload, autoFollow, mfiEnabled])

  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (notice) return notice
    if (query.isFetching || manualLoading) return { text: `Loading ${symbol}...`, tone: 'muted' }
    if (query.data?.meta.freshness === 'failed') {
      return { text: `Stocks load failed: ${query.data.meta.failureReason ?? 'unknown error'}`, tone: 'negative' }
    }
    if (!payload) return { text: 'Ready', tone: 'muted' }
    if (query.data?.errors.length) {
      return { text: `Loaded ${payload.symbol} with ${query.data.errors.length} unavailable block(s).`, tone: 'warning' }
    }
    return { text: query.isPlaceholderData ? `Restored last session for ${payload.symbol}.` : `Loaded ${payload.symbol}.`, tone: 'positive' }
  }, [notice, query.isFetching, query.isPlaceholderData, query.data, manualLoading, payload, symbol])

  const activeCandle = hovered ?? payload?.chart.candles.at(-1) ?? null
  const stats = payload?.chart.stats ?? null
  const up = (stats?.absChange ?? 0) >= 0
  const busy = manualLoading || query.isFetching

  const resizeMain = useCallback((divider: 0 | 1, clientX: number) => {
    const bounds = mainRef.current?.getBoundingClientRect()
    if (!bounds) return
    setMainSizes(resizeTriplet(mainSizes, divider, clientX - bounds.left, bounds.width - 8, [300, 300, 360]))
  }, [mainSizes, setMainSizes])
  const resizeLeft = useCallback((divider: 0 | 1, clientY: number) => {
    const bounds = leftRef.current?.getBoundingClientRect()
    if (!bounds) return
    setLeftSizes(resizeTriplet(leftSizes, divider, clientY - bounds.top, bounds.height - 8, [170, 100, 100]))
  }, [leftSizes, setLeftSizes])
  const resizeMiddle = useCallback((divider: 0 | 1, clientY: number) => {
    const bounds = middleRef.current?.getBoundingClientRect()
    if (!bounds) return
    setMiddleSizes(resizeTriplet(middleSizes, divider, clientY - bounds.top, bounds.height - 8, [100, 100, 100]))
  }, [middleSizes, setMiddleSizes])

  return (
    <div ref={mainRef} className="flex min-h-0 flex-1 gap-0 p-1">
      <div className="flex min-h-0 min-w-[300px] flex-col gap-1" style={{ flexGrow: mainSizes[0], flexBasis: 0 }}>
        <TickerPanel
          draft={draft}
          busy={busy}
          onDraft={setDraft}
          onLoad={() => void load()}
          onNavigate={onNavigate}
          onExport={() => void exportForLlm()}
        />
        <div ref={leftRef} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-col" style={{ flexGrow: leftSizes[0], flexBasis: 0 }}>
            <OverviewPanel payload={payload} loading={query.isLoading} warning={warningOf(query.data, 'Overview')} />
          </div>
          <ResizeHandle orientation="horizontal" onDrag={(position) => resizeLeft(0, position)} />
          <div className="flex min-h-0 flex-col" style={{ flexGrow: leftSizes[1], flexBasis: 0 }}>
            <TargetsPanel payload={payload} warning={warningOf(query.data, 'Price targets')} />
          </div>
          <ResizeHandle orientation="horizontal" onDrag={(position) => resizeLeft(1, position)} />
          <div className="flex min-h-0 flex-col" style={{ flexGrow: leftSizes[2], flexBasis: 0 }}>
            <DescriptionPanel payload={payload} warning={warningOf(query.data, 'Description')} />
          </div>
        </div>
      </div>

      <ResizeHandle orientation="vertical" onDrag={(position) => resizeMain(0, position)} />

      <div className="flex min-h-0 min-w-[300px] flex-col" style={{ flexGrow: mainSizes[1], flexBasis: 0 }}>
        <div ref={middleRef} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-col" style={{ flexGrow: middleSizes[0], flexBasis: 0 }}>
            <NewsPanel rows={payload?.news ?? []} loading={query.isLoading} warning={warningOf(query.data, 'News')} />
          </div>
          <ResizeHandle orientation="horizontal" onDrag={(position) => resizeMiddle(0, position)} />
          <div className="flex min-h-0 flex-col" style={{ flexGrow: middleSizes[1], flexBasis: 0 }}>
            <InstitutionalPanel rows={payload?.institutional ?? []} loading={query.isLoading} warning={warningOf(query.data, 'Institutional holders')} />
          </div>
          <ResizeHandle orientation="horizontal" onDrag={(position) => resizeMiddle(1, position)} />
          <div className="flex min-h-0 flex-col" style={{ flexGrow: middleSizes[2], flexBasis: 0 }}>
            <InsiderPanel rows={payload?.insiders ?? []} loading={query.isLoading} warning={warningOf(query.data, 'Insider transactions')} />
          </div>
        </div>
      </div>

      <ResizeHandle orientation="vertical" onDrag={(position) => resizeMain(1, position)} />

      <section className="flex min-h-0 min-w-[360px] flex-col overflow-hidden border border-border bg-surface" style={{ flexGrow: mainSizes[2], flexBasis: 0 }}>
        <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1">
          <span className="text-sm font-semibold text-text">{payload?.symbol ?? symbol}</span>
          <span className="num text-sm font-semibold text-text">{currency(stats?.price)}</span>
          <span className={`num text-2xs ${up ? 'text-up' : 'text-down'}`}>
            {signedCurrencyPrecise(stats?.absChange)} ({stats ? `${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(2)}%` : '--'})
          </span>
          <div className="ml-auto flex items-center gap-1">
            {STOCKS_RANGE_PRESETS.map((range) => (
              <Button key={range} variant="toggle" active={rangePreset === range} className="w-10 px-1" onClick={() => setRangePreset(range)}>{range}</Button>
            ))}
            <Button variant="toggle" active={autoFollow} onClick={toggleAutoFollow}>Auto</Button>
            <Button variant="toggle" active={mfiEnabled} onClick={toggleMfi}>MFI</Button>
          </div>
        </header>
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 text-2xs">
          <span className="num text-text-muted">
            O {decimals(activeCandle?.open, 2)} H {decimals(activeCandle?.high, 2)} L {decimals(activeCandle?.low, 2)} C {decimals(activeCandle?.close, 2)} Vol {compactNumber(activeCandle?.volume)}
          </span>
          {mfiEnabled ? <span className="num text-[#9d7ce0]">MFI({STOCKS_MFI_PERIOD}) {decimals(payload?.chart.mfi.at(-1)?.value, 2)}</span> : null}
          <span className={`ml-auto truncate ${toneClass[status.tone]}`} title={status.text}>{status.text}</span>
        </div>
        {warningOf(query.data, 'Chart') && !payload?.chart.candles.length ? (
          <PanelMessage>{warningOf(query.data, 'Chart')}</PanelMessage>
        ) : (
          <StocksChart
            payload={payload?.chart ?? null}
            mfiEnabled={mfiEnabled}
            autoFollow={autoFollow}
            rangePreset={rangePreset}
            logicalRange={logicalRange as LogicalRange | null}
            onLogicalRangeChange={(range) => setLogicalRange(range ? { from: Number(range.from), to: Number(range.to) } : null)}
            onManualRange={() => {
              if (rangePreset) setRangePreset('')
            }}
            onHoverCandle={setHovered}
          />
        )}
      </section>
    </div>
  )
}

function TickerPanel({ draft, busy, onDraft, onLoad, onNavigate, onExport }: {
  draft: string
  busy: boolean
  onDraft: (value: string) => void
  onLoad: () => void
  onNavigate: (tabId: string, symbol?: string) => void
  onExport: () => void
}) {
  return (
    <div className="shrink-0 border border-border bg-surface p-2">
      <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); onLoad() }}>
        <input
          value={draft}
          onChange={(event) => onDraft(event.target.value.toUpperCase())}
          placeholder="Ticker"
          aria-label="Stock ticker"
          className="h-10 min-w-0 flex-1 border border-border-strong bg-surface-raised px-2 text-center text-sm font-semibold tracking-wide text-text outline-none focus:border-accent"
        />
        <Button type="submit" variant="accent" className="h-10" disabled={busy}>{busy ? 'Loading...' : 'Load'}</Button>
      </form>
      <p className="mt-2 text-2xs font-semibold text-text-muted">Open this ticker in</p>
      <div className="mt-1 grid grid-cols-2 gap-1">
        {(['charts', 'fundamentals', 'options', 'valuation'] as const).map((id) => (
          <Button key={id} onClick={() => onNavigate(id, draft.trim().toUpperCase())} className="capitalize">{id}</Button>
        ))}
      </div>
      <Button variant="positive" className="mt-1 w-full" onClick={onExport}>Export for LLM</Button>
    </div>
  )
}

function OverviewPanel({ payload, loading, warning }: { payload: StocksPayload | null; loading: boolean; warning?: string }) {
  const subtitle = [payload?.company.exchange, payload?.company.sector, payload?.company.industry].filter(Boolean).join('  ·  ')
  return (
    <Panel title={payload?.company.name ?? 'Overview'} warning={warning}>
      {!payload && loading ? <PanelMessage>Loading company overview...</PanelMessage> : (
        <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
          {subtitle ? <p className="border-b border-border pb-1 text-2xs text-text-muted">{subtitle}</p> : null}
          <dl>
            {OVERVIEW_ROWS.map(([label, key]) => (
              <div key={key} className="flex items-center gap-2 border-b border-border/50 py-[3px] text-2xs">
                <dt className="text-text-muted">{label}</dt>
                <dd className="num ml-auto text-right text-text">{payload?.metrics[key] ?? 'N/A'}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Panel>
  )
}

function TargetsPanel({ payload, warning }: { payload: StocksPayload | null; warning?: string }) {
  return (
    <Panel title="Price targets" warning={warning}>
      <dl className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {TARGET_ROWS.map(([label, key]) => {
          const upside = key === 'upsideToMean' ? payload?.targets.upsidePct : null
          return (
            <div key={key} className="flex gap-2 py-[2px] text-2xs">
              <dt className="text-text-muted">{label}</dt>
              <dd className={`num ml-auto ${upside === null || upside === undefined ? 'text-text' : upside >= 0 ? 'font-semibold text-up' : 'font-semibold text-down'}`}>{String(payload?.targets[key] ?? 'N/A')}</dd>
            </div>
          )
        })}
      </dl>
    </Panel>
  )
}

function DescriptionPanel({ payload, warning }: { payload: StocksPayload | null; warning?: string }) {
  return <Panel title="Description" warning={warning}><p className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 text-2xs leading-relaxed text-text-muted">{payload?.company.description ?? 'Load a ticker to read its company description.'}</p></Panel>
}

const newsColumns: Array<Column<StocksNewsRow>> = [
  { key: 'headline', header: 'Headline', width: '55%', wrap: true, cell: (row) => row.title },
  { key: 'ticker', header: 'Ticker', width: '13%', align: 'center', cell: (row) => row.ticker },
  { key: 'source', header: 'Source', width: '20%', align: 'center', cell: (row) => row.source },
  { key: 'time', header: 'Time', width: '12%', align: 'center', numeric: true, cell: (row) => row.publishedAt ? new Date(row.publishedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--' },
]

function NewsPanel({ rows, loading, warning }: { rows: StocksNewsRow[]; loading: boolean; warning?: string }) {
  return <Panel title={`News${rows.length ? ` · ${rows.length}` : ''}`} warning={warning}><DataTable columns={newsColumns} rows={rows} rowKey={(row) => row.id || row.url} layout="fixed" empty={loading ? 'Loading recent headlines...' : 'No recent headlines were available for this ticker.'} onRowClick={(row) => { if (row.url) void api.openExternal(row.url) }} /></Panel>
}

const institutionalColumns: Array<Column<StocksInstitutionalRow>> = [
  { key: 'holder', header: 'Holder', width: '32%', cell: (row) => row.holder },
  { key: 'pctHeld', header: '% Held', align: 'right', numeric: true, cell: (row) => row.pctHeld },
  { key: 'shares', header: 'Shares', align: 'right', numeric: true, cell: (row) => row.shares },
  { key: 'value', header: 'Value', align: 'right', numeric: true, cell: (row) => row.value },
  { key: 'change', header: 'Change', align: 'right', numeric: true, cell: (row) => row.pctChange },
  { key: 'reported', header: 'Reported', align: 'right', cell: (row) => row.reported },
]

function InstitutionalPanel({ rows, loading, warning }: { rows: StocksInstitutionalRow[]; loading: boolean; warning?: string }) {
  return <Panel title={`Top institutional holders${rows.length ? ` · ${rows.length}` : ''}`} warning={warning}><DataTable columns={institutionalColumns} rows={rows} rowKey={(row, index) => `${row.holder}:${row.reported}:${index}`} empty={loading ? 'Loading institutional holders...' : 'No institutional holder rows were available for this ticker.'} /></Panel>
}

const insiderColumns: Array<Column<StocksInsiderRow>> = [
  { key: 'date', header: 'Date', cell: (row) => row.date },
  { key: 'insider', header: 'Insider', cell: (row) => row.insider },
  { key: 'title', header: 'Title/Relation', cell: (row) => row.title },
  { key: 'transaction', header: 'Transaction', cell: (row) => row.transaction },
  { key: 'shares', header: 'Shares', align: 'right', numeric: true, cell: (row) => row.shares },
  { key: 'value', header: 'Value', align: 'right', numeric: true, cell: (row) => row.value },
]

function InsiderPanel({ rows, loading, warning }: { rows: StocksInsiderRow[]; loading: boolean; warning?: string }) {
  return <Panel title={`Insider transactions${rows.length ? ` · ${rows.length}` : ''}`} warning={warning}><DataTable columns={insiderColumns} rows={rows} rowKey={(row, index) => `${row.date}:${row.insider}:${index}`} empty={loading ? 'Loading insider transactions...' : 'No insider transaction rows were available for this ticker.'} /></Panel>
}

function resizeTriplet(
  sizes: [number, number, number],
  divider: 0 | 1,
  position: number,
  total: number,
  minimums: [number, number, number],
): [number, number, number] {
  const scale = total / sizes.reduce((sum, value) => sum + value, 0)
  let [first, second, third] = sizes.map((value) => value * scale) as [number, number, number]
  if (divider === 0) {
    first = Math.min(Math.max(position, minimums[0]), total - third - minimums[1])
    second = total - first - third
  } else {
    second = Math.min(Math.max(position - first, minimums[1]), total - first - minimums[2])
    third = total - first - second
  }
  return [Math.max(first, 1), Math.max(second, 1), Math.max(third, 1)]
}

function ResizeHandle({ orientation, onDrag }: { orientation: 'vertical' | 'horizontal'; onDrag: (position: number) => void }) {
  const dragging = useRef(false)
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return
      event.preventDefault()
      onDrag(orientation === 'vertical' ? event.clientX : event.clientY)
    }
    const stop = () => {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
  }, [onDrag, orientation])
  const start = (event: ReactPointerEvent) => {
    event.preventDefault()
    dragging.current = true
    document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize'
  }
  return <div role="separator" aria-orientation={orientation} onPointerDown={start} className={`${orientation === 'vertical' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'} shrink-0 bg-transparent transition-colors hover:bg-accent-dim`} />
}
