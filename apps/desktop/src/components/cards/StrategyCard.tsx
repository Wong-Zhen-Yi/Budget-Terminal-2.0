import { useMemo, type PointerEvent } from 'react'

import type { CardInterval, CardPerformance } from '@shared/contract'
import type { CardDropSide, CardModel } from '@shared/cards'
import { Button } from '@/components/ui/Button'

interface StrategyCardProps {
  model: CardModel
  interval: CardInterval
  performance?: CardPerformance
  loading: boolean
  error?: string
  onInterval: (interval: CardInterval) => void
  onAction: () => void
  onHide?: () => void
  onRemove?: () => void
  dragging: boolean
  dropSide: CardDropSide | null
  onDragStart: (event: PointerEvent<HTMLButtonElement>) => void
  onDragMove: (event: PointerEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
  onDrop: (event: PointerEvent<HTMLButtonElement>) => void
}

export function StrategyCard({
  model,
  interval,
  performance,
  loading,
  error,
  onInterval,
  onAction,
  onHide,
  onRemove,
  dragging,
  dropSide,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDrop,
}: StrategyCardProps) {
  const preview = model.symbols.slice(0, 6).map((symbol) => {
    const weight = model.weights[symbol]
    return Number.isFinite(weight) ? `${symbol} ${weight.toFixed(0)}%` : symbol
  }).join(', ') + (model.symbols.length > 6 ? ` +${model.symbols.length - 6}` : '')
  const returnPct = performance?.returnPct
  const returnText = error
    ? 'Performance unavailable'
    : returnPct === undefined
      ? 'Performance --'
      : `Performance ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%`
  const source = error
    ? 'No data'
    : loading && !performance
      ? 'Loading...'
      : performance?.missingSymbols.length
        ? 'Partial'
        : performance?.source ?? 'Loading...'
  const meta = performance?.weightingLabel
    ? `${model.metaPrefix} | ${performance.weightingLabel}`
    : model.meta

  return (
    <article
      data-card-id={model.id}
      className={`relative flex h-[330px] min-w-[250px] flex-col gap-1.5 rounded-lg border bg-surface p-3 transition-[border-color,box-shadow,opacity,transform] duration-150 ${
        dragging
          ? 'scale-[0.98] border-border opacity-40'
          : dropSide
            ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]'
            : 'border-border'
      }`}
    >
      {dropSide ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-2 z-10 w-1 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)] ${
            dropSide === 'before' ? 'left-0' : 'right-0'
          }`}
        />
      ) : null}
      <div className="flex min-w-0 items-center gap-1">
        <h2 className="truncate text-2xs font-semibold text-text">{model.name}</h2>
        <button
          type="button"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            onDragStart(event)
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            event.preventDefault()
            onDragMove(event)
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            onDrop(event)
          }}
          onPointerCancel={onDragEnd}
          onLostPointerCapture={onDragEnd}
          title="Drag to reorder this card"
          aria-label={`Drag ${model.name} to reorder`}
          className="ml-auto flex h-6 w-7 touch-none select-none shrink-0 cursor-grab items-center justify-center rounded border border-transparent text-sm leading-none text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-accent focus-visible:border-accent focus-visible:outline-none active:cursor-grabbing"
        >
          ⋮⋮
        </button>
      </div>
      <p className="truncate text-2xs text-text-muted" title={meta}>{meta}</p>
      <p className="truncate text-2xs text-text-muted" title={model.symbols.join(', ')}>
        {preview || 'No holdings'}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <span className={`text-2xs font-semibold ${
          error ? 'text-down' : returnPct === undefined ? 'text-text' : returnPct >= 0 ? 'text-up' : 'text-down'
        }`}>
          {returnText}
        </span>
        <span className="ml-auto truncate text-2xs text-text-muted" title={error}>
          {source}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <StrategySparkline values={performance?.values ?? []} negative={(returnPct ?? 0) < 0} />
      </div>

      <div className="grid grid-cols-3 gap-1">
        {([['1d', '1 Day'], ['30d', '30D'], ['1y', '1Y']] as const).map(([key, label]) => (
          <Button key={key} variant="toggle" active={interval === key} onClick={() => onInterval(key)}>
            {label}
          </Button>
        ))}
      </div>
      <div className="flex gap-1">
        <Button variant="accent" className="min-w-0 flex-1" onClick={onAction}>
          {model.actionLabel}
        </Button>
        {onHide ? <Button onClick={onHide}>Hide</Button> : null}
        {onRemove ? <Button variant="danger" onClick={onRemove}>Remove</Button> : null}
      </div>
    </article>
  )
}

function StrategySparkline({ values, negative }: { values: number[]; negative: boolean }) {
  const plot = useMemo(() => {
    const finite = values.filter(Number.isFinite)
    if (finite.length < 2) return null
    const width = 600
    const height = 130
    const min = Math.min(...finite)
    const max = Math.max(...finite)
    const padding = Math.max((max - min) * 0.12, 0.15)
    const low = min - padding
    const high = max + padding
    const span = high - low || 1
    const x = (index: number) => (index / (values.length - 1)) * width
    const y = (value: number) => ((high - value) / span) * height
    const line = values.map((value, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(value)}`).join(' ')
    const zero = Math.max(0, Math.min(height, y(0)))
    return { line, area: `${line} L ${width} ${zero} L 0 ${zero} Z`, width, height, zero }
  }, [values])
  if (!plot) return <div className="flex h-full items-center justify-center text-2xs text-text-dim">No data</div>
  const color = negative ? 'var(--color-down)' : 'var(--color-up)'
  return (
    <svg viewBox={`0 0 ${plot.width} ${plot.height}`} preserveAspectRatio="none" className="h-full w-full">
      <line x1="0" x2={plot.width} y1={plot.zero} y2={plot.zero} stroke="var(--color-border-strong)" strokeDasharray="5 5" />
      <path d={plot.area} fill={color} opacity="0.16" />
      <path d={plot.line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
