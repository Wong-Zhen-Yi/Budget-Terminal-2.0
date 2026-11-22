import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ChartsHistoryPayload, Envelope, EnvelopeMeta } from '@shared/contract'
import { useChartsHistory } from '@/api/chartsQueries'
import { MULTI_CHART_REQUESTS as REQUESTS } from '@/api/portfolioCharts'
import { usePortfolio } from '@/api/queries'
import { MiniChart } from '@/components/chartsworkstation/MiniChart'
import { Button } from '@/components/ui/Button'
import { quotePrice } from '@/lib/format'
import { useChartsStore } from '@/stores/charts'

export function MultiCharts({ onStatus }: { onStatus: (meta: EnvelopeMeta | undefined, loading: boolean, error?: unknown) => void }) {
  const mode = useChartsStore((state) => state.multiMode)
  const interval = useChartsStore((state) => state.multiInterval)
  const style = useChartsStore((state) => state.multiStyle)
  const custom = useChartsStore((state) => state.multiCustomSymbols)
  const order = useChartsStore((state) => state.multiOrder)
  const watchlist = useChartsStore((state) => state.watchlist)
  const setMode = useChartsStore((state) => state.setMultiMode)
  const setInterval = useChartsStore((state) => state.setMultiInterval)
  const setStyle = useChartsStore((state) => state.setMultiStyle)
  const setCustom = useChartsStore((state) => state.setMultiCustomSymbols)
  const setOrder = useChartsStore((state) => state.setMultiOrder)
  const portfolio = usePortfolio()
  const [draft, setDraft] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [orderOpen, setOrderOpen] = useState(false)
  const [dragged, setDragged] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(() => new Set<string>())
  const [cardHealth, setCardHealth] = useState<Record<string, { meta?: EnvelopeMeta; loading: boolean; error?: unknown }>>({})
  const portfolioData = portfolio.data?.data
  const activePortfolio = portfolioData?.portfolios.find((entry) => entry.id === portfolioData.activeId)
    ?? portfolioData?.portfolios.find((entry) => entry.id === portfolioData.mainId)
  const protectedSymbols = useMemo(() => activePortfolio?.tickers ?? [], [activePortfolio?.tickers])
  const symbols = useMemo(() => {
    const baseSymbols = mode === 'portfolio' ? [...protectedSymbols, ...custom] : watchlist
    const unique = [...new Set(baseSymbols)]
    const rank = new Map(order.map((symbol, index) => [symbol, index]))
    return [...unique].sort((left, right) => (rank.get(left) ?? 9999) - (rank.get(right) ?? 9999))
  }, [mode, protectedSymbols, custom, watchlist, order])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const prepareVisibleCards = () => {
      const viewport = grid.getBoundingClientRect()
      if (!viewport.height) return
      const nearby: string[] = []
      for (let index = 0; index < grid.children.length; index++) {
        const card = grid.children[index].getBoundingClientRect()
        if (card.top >= viewport.bottom + 96) break
        if (card.bottom > viewport.top - 96) nearby.push(`${interval}:${symbols[index]}`)
      }
      // Preserve zoom once a canvas has rendered. Offscreen cards still load history.
      setRendered(current => nearby.every(key => current.has(key)) ? current : new Set([...current, ...nearby]))
    }
    prepareVisibleCards()
    grid.addEventListener('scroll', prepareVisibleCards, { passive: true })
    const observer = new ResizeObserver(prepareVisibleCards)
    observer.observe(grid)
    return () => {
      grid.removeEventListener('scroll', prepareVisibleCards)
      observer.disconnect()
    }
  }, [interval, symbols])

  const reportCard = useCallback((symbol: string, meta: EnvelopeMeta | undefined, loading: boolean, error?: unknown) => {
    setCardHealth((current) => {
      const previous = current[symbol]
      if (previous && previous.meta === meta && previous.loading === loading && previous.error === error) return current
      return { ...current, [symbol]: { meta, loading, error } }
    })
  }, [])
  useEffect(() => {
    const severity = { failed: 3, partial: 2, stale: 1, cached: 0, fresh: 0 }
    const rows = symbols.map((symbol) => cardHealth[symbol]).filter(Boolean)
    const worst = rows.map((row) => row.meta).filter((meta): meta is EnvelopeMeta => Boolean(meta)).sort((left, right) => severity[right.freshness] - severity[left.freshness])[0]
      ?? portfolio.data?.meta
    onStatus(worst, portfolio.isFetching || rows.some((row) => row.loading), rows.find((row) => row.error)?.error ?? portfolio.error)
  }, [cardHealth, onStatus, portfolio.data?.meta, portfolio.error, portfolio.isFetching, symbols])

  const add = () => {
    const symbol = draft.trim().toUpperCase()
    if (!symbol || protectedSymbols.includes(symbol) || custom.includes(symbol)) return
    setCustom([...custom, symbol])
    setOrder([...symbols, symbol])
    setDraft('')
  }
  const remove = useCallback((symbol: string) => {
    if (protectedSymbols.includes(symbol)) return
    setCustom(custom.filter((entry) => entry !== symbol))
    setOrder(order.filter((entry) => entry !== symbol))
  }, [custom, order, protectedSymbols, setCustom, setOrder])
  const dropBefore = (target: string) => {
    if (!dragged || dragged === target) return
    const next = symbols.filter((entry) => entry !== dragged)
    next.splice(next.indexOf(target), 0, dragged)
    setOrder(next)
    setDragged(null)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-2 pb-3">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5">
        <Button className="rounded text-[12px]" variant="toggle" active={mode === 'portfolio'} onClick={() => setMode('portfolio')}>Portfolio</Button>
        <Button className="rounded text-[12px]" variant="toggle" active={mode === 'watchlist'} onClick={() => setMode('watchlist')}>Charts watchlist</Button>
        {mode === 'portfolio' ? (
          <form className="ml-2 flex gap-1" onSubmit={(event) => { event.preventDefault(); add() }}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Add ticker" placeholder="Ticker" className="h-8 w-24 rounded border border-border-strong bg-surface-raised px-2 text-[12px] uppercase text-text" />
            <Button className="rounded text-[12px]" type="submit">Add</Button>
          </form>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <select value={interval} aria-label="Multi chart interval" onChange={(event) => setInterval(event.target.value as '1D' | '1W' | '1M')} className="h-8 rounded border border-border-strong bg-surface-raised px-2 text-[12px] text-text">{(['1D', '1W', '1M'] as const).map((value) => <option key={value}>{value}</option>)}</select>
          <select value={style} aria-label="Multi chart style" onChange={(event) => setStyle(event.target.value as 'candles' | 'line')} className="h-8 rounded border border-border-strong bg-surface-raised px-2 text-[12px] text-text"><option value="candles">Candlestick</option><option value="line">Line</option></select>
          <Button className="rounded text-[12px]" disabled={symbols.length < 2} onClick={() => setOrderOpen(true)}>Drag order</Button>
        </div>
      </div>
      {symbols.length ? (
        <div ref={gridRef} className="grid min-h-0 flex-1 auto-rows-[minmax(256px,1fr)] grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-2 overflow-y-auto">
          {symbols.map((symbol) => <MultiCard key={`${symbol}:${interval}`} symbol={symbol} request={REQUESTS[interval]} style={style} active={active === symbol} renderChart={rendered.has(`${interval}:${symbol}`)} protectedSymbol={protectedSymbols.includes(symbol) || mode === 'watchlist'} onActivate={setActive} onRemove={remove} onStatus={reportCard} />)}
        </div>
      ) : <div className="grid flex-1 place-items-center rounded-md border border-dashed border-border px-3 text-center text-[13px] text-text-muted">{mode === 'portfolio' ? 'The active portfolio has no symbols. Add a ticker above.' : 'Add symbols from the Main chart sidebar to populate the Charts watchlist.'}</div>}
      {orderOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={() => setOrderOpen(false)}><section className="w-80 border border-border-strong bg-surface p-3 shadow-xl" onMouseDown={(event) => event.stopPropagation()}><header className="mb-2 flex items-center"><h3 className="text-xs font-semibold text-text">Drag chart order</h3><Button className="ml-auto" onClick={() => setOrderOpen(false)}>Done</Button></header><div className="space-y-1">{symbols.map((symbol) => <button key={symbol} type="button" draggable onDragStart={() => setDragged(symbol)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropBefore(symbol)} className="flex h-9 w-full cursor-grab items-center border border-border bg-surface-raised px-3 text-left text-2xs text-text"><span className="mr-2 text-text-dim">⠿</span>{symbol}<span className="ml-auto text-text-dim">{protectedSymbols.includes(symbol) ? 'portfolio' : mode}</span></button>)}</div></section></div> : null}
    </div>
  )
}

const MultiCard = memo(function MultiCard({ symbol, request, style, active, renderChart, protectedSymbol, onActivate, onRemove, onStatus }: { symbol: string; request: { interval: '1 Day' | '1 Week' | '1 Month'; range: '1Y' | '5Y' }; style: 'candles' | 'line'; active: boolean; renderChart: boolean; protectedSymbol: boolean; onActivate: (symbol: string) => void; onRemove: (symbol: string) => void; onStatus: (symbol: string, meta: EnvelopeMeta | undefined, loading: boolean, error?: unknown) => void }) {
  const query = useChartsHistory({ symbol, ...request })
  const [snapshot, setSnapshot] = useState<Envelope<ChartsHistoryPayload> | null>(null)
  useEffect(() => { if (query.data?.data.candles.length) setSnapshot(query.data) }, [query.data])
  useEffect(() => onStatus(symbol, query.data?.meta, query.isFetching, query.error), [onStatus, query.data?.meta, query.isFetching, query.error, symbol])
  const envelope = query.data?.data.candles.length ? query.data : snapshot
  const rows = envelope?.data.candles
  const last = rows?.at(-1)
  const previous = rows?.at(-2)
  const change = last && previous?.close ? (last.close / previous.close - 1) * 100 : null
  return (
    <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-surface ${active ? 'border-accent' : 'border-border'}`} onMouseDown={() => onActivate(symbol)}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2.5 tabular-nums">
        <button type="button" title="Activate wheel zoom" aria-pressed={active} className="text-[14px] font-semibold text-text hover:underline" onClick={() => onActivate(symbol)}>{symbol}</button>
        <span className="text-[13px] text-text-muted">{last ? quotePrice(last.close, envelope?.data.stats?.currency, last.close >= 100 ? 2 : 4) : '—'}</span>
        {change !== null ? <span className={`text-[11px] ${change >= 0 ? 'text-up' : 'text-down'}`}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span> : null}
        {!protectedSymbol ? <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={() => onRemove(symbol)} className="ml-auto px-2 text-text-muted hover:text-down" aria-label={`Remove ${symbol}`}>×</button> : null}
      </header>
      {last && envelope ? (renderChart ? <MiniChart payload={envelope.data} style={style} active={active} /> : null) : (
        <div className="grid flex-1 place-items-center text-[13px] text-text-muted">{query.isFetching ? 'Loading chart…' : 'Chart unavailable.'}</div>
      )}
    </section>
  )
})
