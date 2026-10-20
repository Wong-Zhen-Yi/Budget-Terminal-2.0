import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { queryFreshness } from '@/api/queryPersistence'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { Candle, ChartsHistoryPayload, ChartsInterval, Envelope, EnvelopeMeta } from '@shared/contract'
import { CHARTS_INTERVALS } from '@shared/contract'
import { calculateFibonacci, calculateSupportResistance, CHARTS_RANGE_OPTIONS } from '@shared/charts'
import { api, queryKeys } from '@/api/client'
import { useChartsHistory } from '@/api/chartsQueries'
import { usePortfolio } from '@/api/queries'
import { MainChart } from '@/components/chartsworkstation/MainChart'
import { Button } from '@/components/ui/Button'
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

export function MainWorkspace({ onStatus }: { onStatus: (meta: EnvelopeMeta | undefined, loading: boolean, error?: unknown) => void }) {
  const store = useChartsStore()
  const now = useSnapshotClock()
  const [draft, setDraft] = useState(store.symbol)
  const [snapshot, setSnapshot] = useState<Envelope<ChartsHistoryPayload> | null>(null)
  const [hovered, setHovered] = useState<Candle | null>(null)
  const [focus, setFocus] = useState(false)
  const [tool, setTool] = useState<DrawingType | null>(null)
  const [replayOpen, setReplayOpen] = useState(false)
  const [replayLimit, setReplayLimit] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const undo = useRef<ChartDrawing[][]>([])
  const redo = useRef<ChartDrawing[][]>([])
  const queryClient = useQueryClient()
  const query = useChartsHistory({ symbol: store.symbol, interval: store.interval, range: store.range }, store.pollSeconds)
  const portfolio = usePortfolio()
  useEffect(() => setDraft(store.symbol), [store.symbol])
  useEffect(() => { if (query.data?.data.candles.length) setSnapshot(query.data) }, [query.data])
  useEffect(() => onStatus(query.data?.meta, query.isFetching, query.error), [onStatus, query.data?.meta, query.isFetching, query.error])
  const envelope = query.data?.data.candles.length ? query.data : snapshot
  const payload = envelope?.data ?? null
  const freshness = envelope ? effectiveFreshness(envelope, now, queryFreshness(queryKeys.chartsHistory(payload?.symbol ?? store.symbol, payload?.intervalLabel ?? store.interval, payload?.rangeLabel ?? store.range))) : 'waiting'
  const failureReason = query.error?.message ?? query.data?.meta.failureReason
  const loadStatus = query.isFetching
    ? `Loading ${store.symbol}…`
    : failureReason
      ? `${store.symbol}: ${failureReason} · Press Load or Refresh to retry.`
      : `${freshness} · ${query.data?.meta.source ?? 'Yahoo Finance'}`
  const effectiveSymbol = payload?.symbol ?? store.symbol
  const effectiveInterval = payload?.intervalLabel ?? store.interval
  const context = `${effectiveSymbol}|${effectiveInterval}`
  const shown = useMemo(() => payload?.candles.slice(0, replayLimit ?? undefined) ?? [], [payload, replayLimit])
  const supportResistance = useMemo(() => calculateSupportResistance(shown), [shown])
  const manualFib = [...(store.drawingsByContext[context] ?? [])].reverse().find((drawing) => drawing.type === 'fib' && drawing.anchors.length === 2)
  const fibonacci = useMemo(() => calculateFibonacci(
    shown,
    store.fibLookback,
    store.fibMode === 'manual' && manualFib
      ? { start: manualFib.anchors[0], end: manualFib.anchors[1] }
      : null,
  ), [shown, store.fibLookback, store.fibMode, manualFib])
  const portfolioData = portfolio.data?.data
  const activePortfolio = portfolioData?.portfolios.find((entry) => entry.id === portfolioData.activeId)
    ?? portfolioData?.portfolios.find((entry) => entry.id === portfolioData.mainId)
  const quoteUnit = payload?.stats?.currency
  const averagePrice = (quoteUnit ?? 'USD') === 'USD' ? activePortfolio?.holdings[effectiveSymbol]?.avgPrice ?? null : null
  const portfolioSymbols = activePortfolio?.tickers ?? []
  const drawings = store.drawingsByContext[context] ?? []
  const current = hovered ?? shown.at(-1) ?? null
  const currentRsi = current ? payload?.indicators.rsi.find((point) => point.time === current.time)?.value : null
  const currentMa50 = current ? payload?.indicators.ma50?.find((point) => point.time === current.time)?.value : null
  const currentMa200 = current ? payload?.indicators.ma200.find((point) => point.time === current.time)?.value : null

  useEffect(() => {
    if (!playing || replayLimit === null || !payload) return
    const speed = REPLAY[store.playbackSpeed]
    const timer = window.setInterval(() => setReplayLimit((value) => {
      if (value === null) return null
      const next = Math.min(payload.candles.length, value + speed.step)
      if (next >= payload.candles.length) setPlaying(false)
      return next
    }), speed.delay)
    return () => window.clearInterval(timer)
  }, [payload, playing, replayLimit, store.playbackSpeed])

  const load = () => {
    const symbol = draft.trim().toUpperCase() || 'SPY'
    store.setSymbol(symbol)
    setReplayLimit(null)
    setPlaying(false)
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
      // The query exposes the failure above and keeps any last successful chart.
    }
  }
  const commitDrawings = useCallback((next: ChartDrawing[]) => {
    undo.current.push(drawings)
    redo.current = []
    store.setDrawings(context, next)
  }, [context, drawings, store])
  const undoDrawing = () => {
    const previous = undo.current.pop()
    if (!previous) return
    redo.current.push(drawings)
    store.setDrawings(context, previous)
  }
  const redoDrawing = () => {
    const next = redo.current.pop()
    if (!next) return
    undo.current.push(drawings)
    store.setDrawings(context, next)
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
  const gain = averagePrice && last ? (last.close / averagePrice - 1) * 100 : null
  return (
    <div className={`relative flex min-h-0 flex-1 flex-col gap-1 ${focus ? 'fixed inset-0 z-40 bg-bg p-2' : 'p-2'}`}>
      {!focus ? <>
        <div className="flex shrink-0 flex-wrap items-center gap-1 border border-border bg-surface px-2 py-1">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') load() }} aria-label="Chart ticker" className="h-8 w-24 border border-border-strong bg-surface-raised px-2 text-xs font-semibold uppercase text-text" />
          <Button variant="accent" onClick={load}>Load</Button>
          <select value={store.interval} onChange={(event) => { store.setInterval(event.target.value as ChartsInterval); setReplayLimit(null) }} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text">{CHARTS_INTERVALS.map((value) => <option key={value}>{value}</option>)}</select>
          <div className="flex gap-px">{CHARTS_RANGE_OPTIONS[store.interval].map((value) => <Button key={value} variant="toggle" active={store.range === value} onClick={() => { store.setRange(value); setReplayLimit(null) }}>{value}</Button>)}</div>
          <select value={store.chartType} onChange={(event) => store.setChartType(event.target.value as typeof store.chartType)} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text"><option value="candles">Candles</option><option value="line">Line</option><option value="area">Area</option></select>
          <Button onClick={() => void refresh()} disabled={query.isFetching}>Refresh</Button>
          <Button variant="toggle" active={store.autoFollow} onClick={() => store.setAutoFollow(!store.autoFollow)}>Auto</Button>
          <select value={store.pollSeconds} onChange={(event) => store.setPollSeconds(Number(event.target.value) as 0 | 15 | 30 | 60)} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text"><option value="0">Polling off</option><option value="15">15 sec</option><option value="30">30 sec</option><option value="60">60 sec</option></select>
          <Button onClick={() => setFocus(true)}>Focus</Button><Button variant="toggle" active={store.sidebarVisible} onClick={() => store.setSidebarVisible(!store.sidebarVisible)}>Sidebar</Button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 border border-border bg-surface px-2 py-1">{INDICATORS.map(([key, label]) => <Button key={key} variant="toggle" active={store.indicators[key]} onClick={() => store.toggleIndicator(key)}>{label}</Button>)}{store.indicators.fibonacci ? <><select value={store.fibMode} onChange={(event) => store.setFibMode(event.target.value as 'auto' | 'manual')} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text"><option value="auto">Fib auto</option><option value="manual">Fib drawing</option></select>{store.fibMode === 'auto' ? <input type="number" min="20" max="500" value={store.fibLookback} onChange={(event) => store.setFibLookback(Number(event.target.value))} title="Fibonacci lookback" className="h-8 w-16 border border-border-strong bg-surface-raised px-2 text-2xs text-text" /> : null}</> : null}<span className="mx-1 h-5 border-l border-border" />{TOOLS.map(([key, label]) => <Button key={key} variant="toggle" active={tool === key} onClick={() => setTool(tool === key ? null : key)}>{label}</Button>)}<Button disabled={!undo.current.length} onClick={undoDrawing}>Undo</Button><Button disabled={!redo.current.length} onClick={redoDrawing}>Redo</Button><Button variant="danger" disabled={!drawings.length} onClick={clearDrawings}>Clear</Button><Button onClick={enterReplay}>Replay</Button></div>
      </> : <Button className="absolute right-4 top-4 z-50" onClick={() => setFocus(false)}>Exit Focus</Button>}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border border-border bg-surface px-2 py-1 text-2xs"><strong className="text-text">{effectiveSymbol} {last ? quotePrice(last.close, quoteUnit, last.close >= 100 ? 2 : 4) : '--'}</strong><span className={change == null ? 'text-text-muted' : change >= 0 ? 'text-up' : 'text-down'}>{change == null ? '--' : `${signedQuotePrice(change, quoteUnit)} (${previous ? (change / previous.close * 100).toFixed(2) : '--'}%)`}</span><span className="text-text-muted">Portfolio avg {averagePrice == null ? '--' : averagePrice.toFixed(2)} {gain == null ? '' : `· ${gain >= 0 ? '+' : ''}${gain.toFixed(2)}%`}</span><span className="text-text-muted">{current ? `${new Date(current.time * 1000).toISOString().replace('T', ' ').slice(0, 16)} · O ${current.open.toFixed(2)} H ${current.high.toFixed(2)} L ${current.low.toFixed(2)} C ${current.close.toFixed(2)} · Vol ${Math.round(current.volume).toLocaleString()} · RSI ${currentRsi?.toFixed(1) ?? '--'} · MA50 ${currentMa50?.toFixed(2) ?? '--'} · MA200 ${currentMa200?.toFixed(2) ?? '--'}` : 'No bar selected'}</span><span className="ml-auto text-text-dim">{loadStatus}</span></div>
      <div className="grid min-h-0 flex-1 gap-1" style={{ gridTemplateColumns: focus || !store.sidebarVisible ? '1fr' : `${store.splitterRatio * 100}% minmax(180px, 1fr)` }}>
        <section className="flex min-h-0 flex-col border border-border bg-surface"><MainChart payload={payload} chartType={store.chartType} indicators={store.indicators} averagePrice={averagePrice} supportResistance={supportResistance} fibonacci={fibonacci} drawings={drawings} drawingTool={tool} replayLimit={replayLimit} autoFollow={store.autoFollow} onHover={setHovered} onDrawingsChange={commitDrawings} onDrawingToolComplete={() => setTool(null)} />{replayOpen ? <div className="flex h-9 shrink-0 items-center gap-1 border-t border-border px-2"><Button onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</Button><Button onClick={() => { setReplayLimit(Math.min(40, payload?.candles.length ?? 1)); setPlaying(false) }}>Restart</Button><select value={store.playbackSpeed} onChange={(event) => store.setPlaybackSpeed(event.target.value as typeof store.playbackSpeed)} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text">{(['1x', '2x', '5x', '10x'] as const).map((value) => <option key={value}>{value}</option>)}</select><input type="range" min="1" max={payload?.candles.length ?? 1} value={replayLimit ?? payload?.candles.length ?? 1} onChange={(event) => { setReplayLimit(Number(event.target.value)); setPlaying(false) }} className="min-w-0 flex-1" /><span className="text-2xs text-text-muted">{replayLimit ?? payload?.candles.length ?? 0}/{payload?.candles.length ?? 0}</span><Button onClick={() => { setReplayOpen(false); setReplayLimit(null); setPlaying(false) }}>Close</Button></div> : null}</section>
        {!focus && store.sidebarVisible ? <aside className="flex min-h-0 flex-col gap-2 overflow-auto border border-border bg-surface p-2"><label className="text-[10px] uppercase text-text-dim">Chart / sidebar split<input type="range" min="50" max="85" value={Math.round(store.splitterRatio * 100)} onChange={(event) => store.setSplitterRatio(Number(event.target.value) / 100)} className="mt-1 w-full" /></label><SymbolList title={`Active portfolio · ${activePortfolio?.name ?? 'none'}`} symbols={portfolioSymbols} active={store.symbol} onSelect={store.setSymbol} /><div className="border-t border-border pt-2"><div className="mb-1 flex items-center"><h3 className="text-[10px] font-semibold uppercase text-text-muted">Charts watchlist</h3><Button className="ml-auto h-6" onClick={() => store.setWatchlist([...store.watchlist, store.symbol])}>+ Current</Button></div><SymbolList title="" symbols={store.watchlist} active={store.symbol} onSelect={store.setSymbol} onRemove={(symbol) => store.setWatchlist(store.watchlist.filter((entry) => entry !== symbol))} /></div></aside> : null}
      </div>
    </div>
  )
}

function SymbolList({ title, symbols, active, onSelect, onRemove }: { title: string; symbols: string[]; active: string; onSelect: (symbol: string) => void; onRemove?: (symbol: string) => void }) {
  return <section><h3 className="mb-1 text-[10px] font-semibold uppercase text-text-muted">{title}</h3><div className="space-y-px">{symbols.map((symbol) => <div key={symbol} className={`flex h-8 items-center border px-2 ${active === symbol ? 'border-accent bg-accent-dim' : 'border-border bg-surface-raised'}`}><button type="button" className="flex-1 text-left text-2xs font-semibold text-text" onClick={() => onSelect(symbol)}>{symbol}</button>{onRemove ? <button type="button" className="text-text-muted hover:text-down" onClick={() => onRemove(symbol)}>×</button> : null}</div>)}{!symbols.length ? <p className="py-2 text-2xs text-text-dim">No symbols</p> : null}</div></section>
}
