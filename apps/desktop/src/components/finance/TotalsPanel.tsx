import type { FinanceCurrency, FxPayload } from '@shared/contract'
import type { TotalsSlice } from '@shared/financeMath'
import { Donut } from '@/components/charts/Donut'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { Select } from '@/components/ui/Select'
import { useNumberPrivacy } from '@/components/ui/NumberPrivacy'
import { moneyRounded } from '@/lib/format'

const CURRENCIES: ReadonlyArray<{ value: FinanceCurrency; label: string }> = [
  { value: 'SGD', label: 'SGD' },
  { value: 'USD', label: 'USD' },
]

interface TotalsPanelProps {
  slices: TotalsSlice[]
  /** Net worth: assets less debts, before the animation scales it. */
  total: number
  complete?: boolean
  incompleteReason?: string
  display: FinanceCurrency
  fx: FxPayload | undefined
  fxLoading: boolean
  fxError: string
  onSetCurrency: (currency: FinanceCurrency) => void
  onReplay: () => void
  /** 0..1 sweep shared by the ring and the counting centre number. */
  animationProgress: number
  className?: string
}

/** `FX: 1 USD = 1.2693 SGD at 03:22:03`, four decimals and a local clock time. */
function fxLabel(fx: FxPayload | undefined, loading: boolean, error: string, maskNumbers: boolean): string {
  if (loading && !fx?.usdSgd) return 'FX: loading USD/SGD; converted values pending'
  if (!fx?.usdSgd) {
    return `FX: USD/SGD unavailable; converted values hidden${error ? ` (${error})` : ''}`
  }
  const collected = fx.collectedAt
    ? new Date(fx.collectedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : ''
  return `FX: 1 USD = ${maskNumbers ? '****' : fx.usdSgd.toFixed(4)} SGD${collected ? ` at ${collected}` : ''}`
}

export function TotalsPanel({
  slices,
  total,
  complete = true,
  incompleteReason,
  display,
  fx,
  fxLoading,
  fxError,
  onSetCurrency,
  onReplay,
  animationProgress,
  className = '',
}: TotalsPanelProps) {
  const maskNumbers = useNumberPrivacy()
  return (
    <Panel title="Totals" className={className}>
      {/* The controls sit in the body rather than the header strip, as the reference
          has them, so the title has the whole strip to itself. */}
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1">
        <span className="text-2xs text-text-muted">Currency</span>
        <Select
          aria-label="Totals currency"
          value={display}
          options={CURRENCIES}
          onChange={onSetCurrency}
          className="w-16"
        />
        <Button variant="accent" className="ml-auto" onClick={onReplay}>
          Show Animation
        </Button>
      </div>
      <div className="shrink-0 px-2 pt-1 text-2xs text-text-muted">
        {fxLabel(fx, fxLoading, fxError, maskNumbers)}
      </div>
      <p className="shrink-0 px-2 pt-1 text-2xs text-text-muted">
        Cash and debt are SGD. Investments and brokerage accounts are USD.
      </p>
      <Donut
        slices={slices}
        empty="Nothing to total yet"
        // The centre counts up with the sweep, as the reference's does.
        centerText={moneyRounded(total * animationProgress, display)}
        centerSubtext={`${complete ? 'Total' : 'Known subtotal'} ${display}`}
        animationProgress={animationProgress}
      />
      {!complete && <p className="px-2 pb-2 text-2xs text-warn">{incompleteReason ?? 'Market marks unavailable; valuation is incomplete.'}</p>}
    </Panel>
  )
}
