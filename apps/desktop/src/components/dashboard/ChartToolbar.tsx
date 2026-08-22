import { useEffect, useState } from 'react'

import type { TimeframeLabel } from '@shared/contract'
import { TIMEFRAMES } from '@shared/contract'
import { Button } from '@/components/ui/Button'
import type { IndicatorKey } from '@/stores/dashboard'

const INDICATORS: Array<{ key: IndicatorKey; label: string }> = [
  { key: 'volume', label: 'Volume' },
  { key: 'rsi', label: 'RSI' },
  { key: 'ma200', label: '200 MA' },
]

interface ChartToolbarProps {
  symbol: string
  timeframe: TimeframeLabel
  indicators: Record<IndicatorKey, boolean>
  autoFollow: boolean
  canExport: boolean
  onLoadSymbol: (symbol: string) => void
  onSetTimeframe: (timeframe: TimeframeLabel) => void
  onToggleIndicator: (key: IndicatorKey) => void
  onToggleAutoFollow: () => void
  onExportOptions: () => void
}

export function ChartToolbar({
  symbol,
  timeframe,
  indicators,
  autoFollow,
  canExport,
  onLoadSymbol,
  onSetTimeframe,
  onToggleIndicator,
  onToggleAutoFollow,
  onExportOptions,
}: ChartToolbarProps) {
  const [draft, setDraft] = useState(symbol)

  // Keep the box in step when the symbol changes from a portfolio click.
  useEffect(() => setDraft(symbol), [symbol])

  const submit = () => {
    const next = draft.trim().toUpperCase()
    if (next) onLoadSymbol(next)
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border border-border bg-surface px-2 py-1">
      <h2 className="pr-1 text-xs font-semibold text-text">Dashboard Chart</h2>

      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
        }}
        spellCheck={false}
        aria-label="Chart ticker"
        className="h-8 w-28 border border-border-strong bg-surface-raised px-2 text-2xs text-text uppercase outline-none focus:border-accent"
      />
      <Button variant="accent" onClick={submit}>
        Load
      </Button>
      <Button variant="accent" onClick={onExportOptions} disabled={!canExport}>
        Export Top Options
      </Button>

      <div className="mx-2 h-5 w-px bg-border-strong" />

      {TIMEFRAMES.map((spec) => (
        <Button
          key={spec.label}
          variant="toggle"
          active={spec.label === timeframe}
          onClick={() => onSetTimeframe(spec.label)}
          title={spec.label}
          aria-label={spec.label}
        >
          {spec.short}
        </Button>
      ))}

      <div className="mx-2 h-5 w-px bg-border-strong" />

      <span className="pr-1 text-2xs text-text-muted">Indicators</span>
      {INDICATORS.map((indicator) => (
        <Button
          key={indicator.key}
          variant="toggle"
          active={indicators[indicator.key]}
          onClick={() => onToggleIndicator(indicator.key)}
        >
          {indicator.label}
        </Button>
      ))}

      <Button
        variant="toggle"
        active={autoFollow}
        onClick={onToggleAutoFollow}
        className="ml-auto"
        title="Follow the holding selected in the portfolio table"
      >
        Auto
      </Button>
    </div>
  )
}
