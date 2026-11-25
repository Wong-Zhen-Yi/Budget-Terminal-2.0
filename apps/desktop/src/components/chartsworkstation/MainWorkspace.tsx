import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { Candle, ChartsHistoryPayload, ChartsInterval, Envelope, EnvelopeMeta } from '@shared/contract'
import { CHARTS_INTERVALS } from '@shared/contract'
import { calculateFibonacci, calculateSupportResistance, CHARTS_RANGE_OPTIONS } from '@shared/charts'
import { api, queryKeys } from '@/api/client'
import { useChartsHistory } from '@/api/chartsQueries'
import { usePortfolio } from '@/api/queries'
import { BarReadout, type BarReadoutHandle } from '@/components/chartsworkstation/BarReadout'
import { MainChart } from '@/components/chartsworkstation/MainChart'
import { Button } from '@/components/ui/Button'
import { MobileDisclosure } from '@/components/ui/MobileDisclosure'
import { quotePrice, signedQuotePrice } from '@/lib/format'
import { useChartsStore, type ChartDrawing, type ChartsIndicator, type DrawingType } from '@/stores/charts'

const INDICATORS: Array<[ChartsIndicator, string]> = [
  ['volume', 'Volume'], ['rsi', 'RSI'], ['ma50', '50-day SMA'], ['ma200', '200 MA'], ['avgPrice', 'Avg Price'],
  ['supportResistance', 'Support / Resistance'], ['fibonacci', 'Fibonacci'], ['cursor', 'Cursor'],
]
const TOOLS: Array<[DrawingType, string]> = [
  ['trend', 'Trend'], ['horizontal', 'H Line'], ['ray', 'H Ray'], ['rectangle', 'Box'], ['text', 'Text'], ['fib', 'Fib'],
]
const REPLAY = { '1x': { step: 1, delay: 180 }, '2x': { step: 2, delay: 120 }, '5x': { step: 5, delay: 80 }, '10x': { step: 10, delay: 50 } } as const
const EMPTY_CANDLES: Candle[] = []
const EMPTY_DRAWINGS: ChartDrawing[] = []
const FIELD = 'h-8 rounded border border-border-strong bg-surface-raised px-2 text-[12px] text-text focus-visible:outline-accent'
const CONTROL = 'rounded text-[12px]'

export function MainWorkspace({ onStatus }: { onStatus: (meta: EnvelopeMeta | undefined, loading: boolean, error?: unknown) => void }) {
  const store = useChartsStore()
  const [draft, setDraft] = useState(store.symbol)
  const [snapshot, setSnapshot] = useState<Envelope<ChartsHistoryPayload> | null>(null)
  const [focus, setFocus] = useState(false)
  const [tool, setTool] = useState<DrawingType | null>(null)
  const [replayOpen, setReplayOpen] = useState(false)
  const [replayLimit, setReplayLimit] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const readout = useRef<BarReadoutHandle>(null)
  const drawingsMenu = useRef<HTMLDetailsElement>(null)
  const updateReadout = useCallback((time: number | null) => readout.current?.setHoveredTime(time), [])
  const finishTool = useCallback(() => setTool(null), [])
  const queryClient = useQueryClient()
  const query = useChartsHistory({ symbol: store.symbol, interval: store.interval, range: store.range }, store.pollSeconds)
  const portfolio = usePortfolio()
  useEffect(() => setDraft(store.symbol), [store.symbol])
  useEffect(() => { if (query.data?.data.candles.length) setSnapshot(query.data) }, [query.data])
  useEffect(() => onStatus(query.data?.meta, query.isFetching, query.error), [onStatus, query.data?.meta, query.isFetching, query.error])
  const envelope = query.data?.data.candles.length ? query.data : snapshot
  const payload = envelope?.data ?? null
  const effectiveSymbol = payload?.symbol ?? store.symbol
  const effectiveInterval = payload?.intervalLabel ?? store.interval
  const context = `${effectiveSymbol}|${effectiveInterval}`
  const history = useMemo(() => ({ undo: [] as ChartDrawing[][], redo: [] as ChartDrawing[][] }), [context])
  const candles = payload?.candles ?? EMPTY_CANDLES
  const shown = useMemo(() => replayLimit === null ? candles : candles.slice(0, replayLimit), [candles, replayLimit])
  const drawings = store.drawingsByContext[context] ?? EMPTY_DRAWINGS
  const supportResistance = useMemo(() => store.indicators.supportResistance ? calculateSupportResistance(shown) : null, [shown, store.indicators.supportResistance])
  const manualFib = store.indicators.fibonacci && store.fibMode === 'manual'
    ? drawings.findLast((drawing) => drawing.type === 'fib' && drawing.anchors.length === 2)
    : undefined
  const fibonacci = useMemo(() => store.indicators.fibonacci ? calculateFibonacci(
    shown,
    store.fibLookback,
    manualFib ? { start: manualFib.anchors[0], end: manualFib.anchors[1] } : null,
  ) : null, [shown, store.fibLookback, store.indicators.fibonacci, manualFib])
  const portfolioData = portfolio.data?.data
  const activePortfolio = portfolioData?.portfolios.find((entry) => entry.id === portfolioData.activeId)
    ?? portfolioData?.portfolios.find((entry) => entry.id === portfolioData.mainId)
  const quoteUnit = payload?.stats?.currency
  const averagePrice = (quoteUnit ?? 'USD') === 'USD' ? activePortfolio?.holdings[effectiveSymbol]?.avgPrice ?? null : null
  const portfolioSymbols = activePortfolio?.tickers ?? []
  const replaying = replayLimit !== null
  const replayEnded = replaying && replayLimit >= candles.length

  useEffect(() => {
    if (!playing || !replaying || replayEnded) return
    const speed = REPLAY[store.playbackSpeed]
    const timer = window.setInterval(() => setReplayLimit((value) => value === null ? null : Math.min(candles.length, value + speed.step)), speed.delay)
    return () => window.clearInterval(timer)
  }, [candles.length, playing, replayEnded, replaying, store.playbackSpeed])

  const exitReplay = () => {
    setReplayOpen(false)
    setReplayLimit(null)
    setPlaying(false)
  }
  const selectSymbol = (symbol: string) => {
    store.setSymbol(symbol)
    exitReplay()
  }

  const load = () => {
    const symbol = draft.trim().toUpperCase() || 'SPY'
    selectSymbol(symbol)
    if (symbol === store.symbol) void refresh()
  }
  const refresh = async () => {
    try {
      await queryClient.fetchQuery({
        queryKey: queryKeys.chartsHistory(store.symbol, store.interval, store.range),
        queryFn: () => api.chartsHistory({ symbol: store.symbol, interval: store.interval, range: store.range, force: true }),
        staleTime: 0,
      })
    } catch {
      // Settings reports the query failure. The workspace can keep the last usable chart.
    }
  }
  const { setDrawings } = store
  const commitDrawings = useCallback((next: ChartDrawing[]) => {
    history.undo.push(drawings)
    history.redo.length = 0
    setDrawings(context, next)
  }, [context, drawings, history, setDrawings])
  const undoDrawing = () => {
    const previous = history.undo.pop()
    if (!previous) return
    history.redo.push(drawings)
    setDrawings(context, previous)
  }
  const redoDrawing = () => {
    const next = history.redo.pop()
    if (!next) return
    history.undo.push(drawings)
    setDrawings(context, next)
  }
  const clearDrawings = () => {
    if (!drawings.length || !window.confirm(`Clear all drawings for ${context}?`)) return
    commitDrawings([])
  }
  const enterReplay = () => {
    if (!payload?.candles.length) return
    setReplayOpen(true)
    setReplayLimit(Math.min(40, payload.candles.length))
    setPlaying(false)
  }
  const last = shown.at(-1)
  const previous = shown.at(-2)
  const change = last && previous ? last.close - previous.close : null
  const changePct = change !== null && previous?.close ? change / previous.close * 100 : null
  const gain = averagePrice && last ? (last.close / averagePrice - 1) * 100 : null
  const canPlay = replaying && !replayEnded
  const intraday = CHARTS_INTERVALS.indexOf(effectiveInterval) < CHARTS_INTERVALS.indexOf('1 Day')
  const stats = payload?.stats
  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-2 ${focus ? 'fixed inset-0 z-40 bg-bg p-3' : 'charts-main-workspace px-3 pt-2 pb-3'}`}>
      {!focus ? (
        <div className="charts-toolbar flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-border bg-surface px-2 pt-1.5">
          <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); load() }}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Chart ticker" className={`${FIELD} w-20 font-semibold uppercase`} />
            <Button type="submit" variant="accent" className={CONTROL}>Load</Button>
          </form>
          <div className="charts-timeframe flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Chart timeframe">
            <select value={store.interval} aria-label="Bar interval" onChange={(event) => { store.setInterval(event.target.value as ChartsInterval); exitReplay() }} className={FIELD}>
              {CHARTS_INTERVALS.map((value) => <option key={value}>{value}</option>)}
            </select>
            <div className="mobile-tab-strip flex flex-wrap gap-px rounded border border-border bg-bg p-0.5">
              {CHARTS_RANGE_OPTIONS[store.interval].map((value) => (
                <button key={value} type="button" aria-pressed={store.range === value} onClick={() => { store.setRange(value); exitReplay() }} className={`h-6 rounded px-2 text-[12px] font-medium focus-visible:outline-accent ${store.range === value ? 'bg-accent-dim text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'}`}>{value}</button>
              ))}
            </div>
          </div>
          <MobileDisclosure label="Chart tools" className="charts-toolbar-tools">
            <div className="ml-auto flex flex-wrap gap-1.5">
              <select value={store.chartType} aria-label="Chart style" onChange={(event) => store.setChartType(event.target.value as typeof store.chartType)} className={FIELD}>
                <option value="candles">Candles</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
              </select>
              <Button variant="toggle" active={store.autoFollow} className={CONTROL} title="Automatically fit updated history" onClick={() => store.setAutoFollow(!store.autoFollow)}>Auto</Button>
              <select value={store.pollSeconds} aria-label="Polling interval" onChange={(event) => store.setPollSeconds(Number(event.target.value) as 0 | 15 | 30 | 60)} className={FIELD}>
                <option value="0">Polling off</option>
                <option value="15">15 sec</option>
                <option value="30">30 sec</option>
                <option value="60">60 sec</option>
              </select>
              <Button className={CONTROL} onClick={() => setFocus(true)}>Focus</Button>
              <Button variant="toggle" active={store.sidebarVisible} className={CONTROL} onClick={() => store.setSidebarVisible(!store.sidebarVisible)}>Sidebar</Button>
            </div>
            <div className="charts-toolbar-indicators -mx-2 flex basis-[calc(100%+1rem)] flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Indicators">
                {INDICATORS.map(([key, label]) => <Button key={key} variant="toggle" active={store.indicators[key]} className={CONTROL} onClick={() => store.toggleIndicator(key)}>{label}</Button>)}
                {store.indicators.fibonacci ? (
                  <>
                    <select value={store.fibMode} aria-label="Fibonacci mode" onChange={(event) => store.setFibMode(event.target.value as 'auto' | 'manual')} className={FIELD}>
                      <option value="auto">Fib auto</option>
                      <option value="manual">Fib drawing</option>
                    </select>
                    {store.fibMode === 'auto' ? <input type="number" min="20" max="500" value={store.fibLookback} onChange={(event) => store.setFibLookback(Number(event.target.value))} aria-label="Fibonacci lookback" className={`${FIELD} w-16`} /> : null}
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Drawings and replay">
                <details ref={drawingsMenu} className="relative" onBlur={(event) => {
                  if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
                }}>
                  <summary aria-label="Drawings" className={`flex h-8 cursor-pointer list-none items-center gap-1.5 rounded border px-2 text-[12px] hover:bg-surface-hover focus-visible:outline-accent ${tool ? 'border-accent bg-accent-dim text-text' : 'border-border-strong bg-surface-raised text-text'}`}>
                    {TOOLS.find(([key]) => key === tool)?.[1] ?? 'Drawings'} <span aria-hidden="true" className="text-text-muted">▾</span>
                  </summary>
                  <div className="absolute top-full right-0 z-20 mt-1 grid w-52 grid-cols-3 gap-1 rounded-md border border-border-strong bg-surface p-1.5 shadow-xl max-sm:right-auto">
                    {TOOLS.map(([key, label]) => <Button key={key} variant="toggle" active={tool === key} className={CONTROL} onClick={() => {
                      const menu = drawingsMenu.current
                      menu?.querySelector('summary')?.focus()
                      if (menu) menu.open = false
                      setTool(tool === key ? null : key)
                    }}>{label}</Button>)}
                    <Button className={`${CONTROL} col-span-3`} disabled={!drawings.length} onClick={clearDrawings}>Clear</Button>
                  </div>
                </details>
                <Button className={CONTROL} disabled={!history.undo.length} onClick={undoDrawing}>Undo</Button>
                <Button className={CONTROL} disabled={!history.redo.length} onClick={redoDrawing}>Redo</Button>
                <Button className={CONTROL} disabled={!candles.length} onClick={enterReplay}>Replay</Button>
              </div>
            </div>
          </MobileDisclosure>
        </div>
      ) : null}
      <div
        className="charts-main-grid grid min-h-0 flex-1 gap-2"
        style={{ gridTemplateColumns: focus || !store.sidebarVisible ? 'minmax(0, 1fr)' : `minmax(0, 1fr) clamp(165px, ${(1 - store.splitterRatio) * 100}%, 46%)` }}
      >
        <section aria-label="Price chart" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
          <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface-raised px-3 py-1.5 tabular-nums">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold text-text">{effectiveSymbol}</h2>
              <span className="text-[19px] font-semibold text-text">{last ? quotePrice(last.close, quoteUnit, last.close >= 100 ? 2 : 4) : '—'}</span>
              {change !== null ? <span className={`text-[12px] font-medium ${change >= 0 ? 'text-up' : 'text-down'}`}>{signedQuotePrice(change, quoteUnit)}{changePct !== null ? ` (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)` : ''}</span> : null}
            </div>
            <span className="text-[11px] font-medium text-text-muted">{effectiveInterval} · {payload?.rangeLabel ?? store.range}</span>
            {averagePrice !== null ? (
              <span className="text-[11px] text-text-muted">Portfolio avg <span className="font-medium text-text">{quotePrice(averagePrice, quoteUnit)}</span>
                {gain !== null ? <> · <span className={gain >= 0 ? 'text-up' : 'text-down'}>{gain >= 0 ? '+' : ''}{gain.toFixed(2)}%</span></> : null}
              </span>
            ) : null}
            {focus ? <Button className={`${CONTROL} ml-auto`} onClick={() => setFocus(false)}>Exit Focus</Button> : null}
          </header>
          <BarReadout key={`${context}|${payload?.rangeLabel ?? store.range}`} ref={readout} candles={shown} indicators={payload?.indicators} intraday={intraday} />
          <MainChart payload={payload} candles={shown} chartType={store.chartType} indicators={store.indicators} averagePrice={averagePrice} supportResistance={supportResistance} fibonacci={fibonacci} drawings={drawings} drawingTool={tool} replaying={replaying} autoFollow={store.autoFollow} onHover={updateReadout} onDrawingsChange={commitDrawings} onDrawingToolComplete={finishTool} emptyMessage={query.isFetching ? 'Loading chart…' : 'Chart unavailable. Use Load to retry.'} />
          {replayOpen ? (
            <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-1.5">
              <Button className={CONTROL} disabled={!canPlay} onClick={() => setPlaying(!playing)}>{playing && canPlay ? 'Pause' : 'Play'}</Button>
              <Button className={CONTROL} onClick={enterReplay}>Restart</Button>
              <select value={store.playbackSpeed} aria-label="Replay speed" onChange={(event) => store.setPlaybackSpeed(event.target.value as typeof store.playbackSpeed)} className={FIELD}>
                {(['1x', '2x', '5x', '10x'] as const).map((value) => <option key={value}>{value}</option>)}
              </select>
              <input type="range" aria-label="Replay position" min="1" max={candles.length || 1} value={replayLimit ?? candles.length} onChange={(event) => { setReplayLimit(Number(event.target.value)); setPlaying(false) }} className="min-w-0 flex-1 accent-accent" />
              <span className="text-[11px] tabular-nums text-text-muted">{replayLimit ?? candles.length}/{candles.length}</span>
              <Button className={CONTROL} onClick={exitReplay}>Close</Button>
            </div>
          ) : null}
          <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-text-muted">
            {stats?.source ? <span className="min-w-0 truncate" title={stats.source}>Chart · {stats.source}</span> : null}
            {stats?.priceSource ? <span className="min-w-0 truncate" title={stats.priceSource}>Mark <strong className="font-medium text-text">{quotePrice(stats.price, quoteUnit)}</strong> · {stats.priceSource}</span> : null}
          </div>
        </section>
        {!focus && store.sidebarVisible ? (
          <aside aria-label="Chart symbols" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
              <SymbolList title={activePortfolio?.name ? `Portfolio · ${activePortfolio.name}` : 'Active portfolio'} symbols={portfolioSymbols} active={effectiveSymbol} onSelect={selectSymbol} />
              <SymbolList title="Charts watchlist" symbols={store.watchlist} active={effectiveSymbol} onSelect={selectSymbol} onRemove={(symbol) => store.setWatchlist(store.watchlist.filter((entry) => entry !== symbol))} addButton={<Button className={CONTROL} disabled={store.watchlist.includes(store.symbol)} onClick={() => store.setWatchlist([...store.watchlist, store.symbol])}>+ Current</Button>} />
            </div>
            <label className="flex shrink-0 items-center gap-2 border-t border-border px-2.5 py-2 text-[11px] text-text-muted">
              Chart width
              <input type="range" min="50" max="85" value={Math.round(store.splitterRatio * 100)} onChange={(event) => store.setSplitterRatio(Number(event.target.value) / 100)} className="min-w-0 flex-1 accent-accent" />
            </label>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

function SymbolList({ title, symbols, active, onSelect, onRemove, addButton }: {
  title: string
  symbols: string[]
  active: string
  onSelect: (symbol: string) => void
  onRemove?: (symbol: string) => void
  addButton?: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded border border-border">
      <header className="flex min-h-10 items-center gap-2 border-b border-border bg-surface-raised px-2">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text" title={title}>{title}</h3>
        {addButton}
      </header>
      {symbols.length ? (
        <ul className="divide-y divide-border">
          {symbols.map((symbol) => (
            <li key={symbol} className={`flex h-8 items-stretch ${active === symbol ? 'bg-accent-dim' : 'hover:bg-surface-hover'}`}>
              <button type="button" data-symbol={symbol} aria-current={active === symbol ? 'true' : undefined} className={`min-w-0 flex-1 truncate border-l-2 px-2 text-left text-[12px] font-semibold focus-visible:outline-accent ${active === symbol ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text'}`} onClick={() => onSelect(symbol)}>{symbol}</button>
              {onRemove ? <button type="button" aria-label={`Remove ${symbol}`} className="w-8 text-text-muted hover:text-down" onClick={() => onRemove(symbol)}>×</button> : null}
            </li>
          ))}
        </ul>
      ) : <p className="px-2 py-2 text-[12px] text-text-muted">No symbols</p>}
    </section>
  )
}
