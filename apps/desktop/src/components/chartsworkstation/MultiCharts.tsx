import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ChartsHistoryPayload, Envelope, EnvelopeMeta } from '@shared/contract'
import { useChartsHistory } from '@/api/chartsQueries'
import { usePortfolio } from '@/api/queries'
import { MiniChart } from '@/components/chartsworkstation/MiniChart'
import { Button } from '@/components/ui/Button'
import { quotePrice } from '@/lib/format'
import { useChartsStore } from '@/stores/charts'

const REQUESTS = {
  '1D': { interval: '1 Day', range: '1Y' },
  '1W': { interval: '1 Week', range: '5Y' },
  '1M': { interval: '1 Month', range: '5Y' },
} as const

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
  }, [cardHealth, onStatus, portfolio.data?.meta, portfolio.isFetching, symbols])

  const add = () => {
    const symbol = draft.trim().toUpperCase()
    if (!symbol || protectedSymbols.includes(symbol) || custom.includes(symbol)) return
    setCustom([...custom, symbol])
    setOrder([...symbols, symbol])
    setDraft('')
  }
  const remove = (symbol: string) => {
    if (protectedSymbols.includes(symbol)) return
    setCustom(custom.filter((entry) => entry !== symbol))
    setOrder(order.filter((entry) => entry !== symbol))
  }
  const dropBefore = (target: string) => {
    if (!dragged || dragged === target) return
    const next = symbols.filter((entry) => entry !== dragged)
    next.splice(next.indexOf(target), 0, dragged)
    setOrder(next)
    setDragged(null)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border border-border bg-surface px-2 py-1">
        <h2 className="mr-2 text-xs font-semibold text-text">Multi Charts</h2>
        <Button variant={mode === 'portfolio' ? 'accent' : 'default'} onClick={() => setMode('portfolio')}>Portfolio</Button>
        <Button variant={mode === 'watchlist' ? 'accent' : 'default'} onClick={() => setMode('watchlist')}>Charts watchlist</Button>
        {mode === 'portfolio' ? <><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add() }} placeholder="Add ticker" className="h-8 w-24 border border-border-strong bg-surface-raised px-2 text-2xs uppercase text-text" /><Button onClick={add}>Add</Button></> : null}
        <select value={interval} onChange={(event) => setInterval(event.target.value as '1D' | '1W' | '1M')} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text">{(['1D', '1W', '1M'] as const).map((value) => <option key={value}>{value}</option>)}</select>
        <select value={style} onChange={(event) => setStyle(event.target.value as 'candles' | 'line')} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text"><option value="candles">Candlestick</option><option value="line">Line</option></select>
        <Button onClick={() => setOrderOpen(true)}>Drag order</Button>
        <span className="ml-auto text-2xs text-text-muted">Click a chart before using its wheel zoom.</span>
      </div>
      {symbols.length ? <div className="grid min-h-0 flex-1 auto-rows-[minmax(260px,1fr)] grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-2 overflow-auto">{symbols.map((symbol) => <MultiCard key={`${symbol}:${interval}`} symbol={symbol} request={REQUESTS[interval]} style={style} active={active === symbol} protectedSymbol={protectedSymbols.includes(symbol) || mode === 'watchlist'} onActivate={() => setActive(symbol)} onRemove={() => remove(symbol)} onStatus={reportCard} />)}</div> : <div className="flex flex-1 items-center justify-center border border-dashed border-border text-2xs text-text-dim">{mode === 'portfolio' ? 'The active portfolio has no symbols. Add a custom ticker above.' : 'Add symbols from the Main chart sidebar to populate the Charts watchlist.'}</div>}
      {orderOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={() => setOrderOpen(false)}><section className="w-80 border border-border-strong bg-surface p-3 shadow-xl" onMouseDown={(event) => event.stopPropagation()}><header className="mb-2 flex items-center"><h3 className="text-xs font-semibold text-text">Drag chart order</h3><Button className="ml-auto" onClick={() => setOrderOpen(false)}>Done</Button></header><div className="space-y-1">{symbols.map((symbol) => <button key={symbol} type="button" draggable onDragStart={() => setDragged(symbol)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropBefore(symbol)} className="flex h-9 w-full cursor-grab items-center border border-border bg-surface-raised px-3 text-left text-2xs text-text"><span className="mr-2 text-text-dim">⠿</span>{symbol}<span className="ml-auto text-text-dim">{protectedSymbols.includes(symbol) ? 'portfolio' : mode}</span></button>)}</div></section></div> : null}
    </div>
  )
}

function MultiCard({ symbol, request, style, active, protectedSymbol, onActivate, onRemove, onStatus }: { symbol: string; request: { interval: '1 Day' | '1 Week' | '1 Month'; range: '1Y' | '5Y' }; style: 'candles' | 'line'; active: boolean; protectedSymbol: boolean; onActivate: () => void; onRemove: () => void; onStatus: (symbol: string, meta: EnvelopeMeta | undefined, loading: boolean, error?: unknown) => void }) {
  const query = useChartsHistory({ symbol, ...request })
  const now = useSnapshotClock()
  const [snapshot, setSnapshot] = useState<Envelope<ChartsHistoryPayload> | null>(null)
  useEffect(() => { if (query.data?.data.candles.length) setSnapshot(query.data) }, [query.data])
  useEffect(() => onStatus(symbol, query.data?.meta, query.isFetching, query.error), [onStatus, query.data?.meta, query.isFetching, query.error, symbol])
  const envelope = query.data?.data.candles.length ? query.data : snapshot
  const last = envelope?.data.candles.at(-1)
  const freshness = envelope ? effectiveFreshness(envelope, now, FRESHNESS.chartDaily) : 'waiting'
  return <section className={`flex min-h-0 flex-col border bg-surface ${active ? 'border-accent' : 'border-border'}`} onMouseDown={onActivate}><header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 text-2xs"><strong className="text-text">{symbol}</strong><span className="text-text-muted">{last ? quotePrice(last.close, envelope?.data.stats?.currency, last.close >= 100 ? 2 : 4) : '--'}</span><span className="ml-auto text-text-dim">{query.isFetching ? 'loading…' : freshness}</span>{!protectedSymbol ? <button type="button" onClick={(event) => { event.stopPropagation(); onRemove() }} className="text-text-muted hover:text-down" aria-label={`Remove ${symbol}`}>×</button> : null}</header>{envelope?.data.candles.length ? <MiniChart payload={envelope.data} style={style} active={active} /> : <div className="flex flex-1 items-center justify-center text-2xs text-text-dim">{query.data?.meta.failureReason ?? 'Loading chart…'}</div>}</section>
}
