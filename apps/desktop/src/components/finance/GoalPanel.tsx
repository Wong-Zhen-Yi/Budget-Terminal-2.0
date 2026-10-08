import type { FinanceCurrency, FinanceGoal } from '@shared/contract'
import { MAX_GOAL_TITLE } from '@shared/contract'
import { goalProgress } from '@shared/financeMath'
import { GoalRing } from '@/components/finance/GoalRing'
import { NumberInput } from '@/components/ui/NumberInput'
import { Panel } from '@/components/ui/Panel'
import { Select } from '@/components/ui/Select'
import { TextInput } from '@/components/ui/TextInput'
import { CURRENCY_PREFIX, moneyRounded } from '@/lib/format'

const CURRENCIES: ReadonlyArray<{ value: FinanceCurrency; label: string }> = [
  { value: 'SGD', label: 'SGD' },
  { value: 'USD', label: 'USD' },
]

interface GoalPanelProps {
  goal: FinanceGoal
  /** Net worth in the goal's own currency, which is not the Totals selector's. */
  current: number
  available: boolean
  unavailableReason?: string
  onSetTitle: (title: string) => void
  onSetTarget: (target: number) => void
  onSetCurrency: (currency: FinanceCurrency) => void
  animationProgress: number
  className?: string
}

/** `_p6_goal_status_text`. */
function statusText(
  current: number,
  target: number,
  currency: FinanceCurrency,
  available: boolean,
): string {
  if (!available) return 'FX required to value mixed currencies'
  if (target <= 0) return 'Set a target to start tracking'
  const remaining = target - current
  if (remaining <= 0) return 'Goal reached'
  const progress = Math.max(0, Math.min(100, (current / target) * 100))
  return `${moneyRounded(remaining, currency)} remaining | ${progress.toFixed(1)}% complete`
}

export function GoalPanel({
  goal,
  current,
  available,
  unavailableReason,
  onSetTitle,
  onSetTarget,
  onSetCurrency,
  animationProgress,
  className = '',
}: GoalPanelProps) {
  const progress = goalProgress(current, goal.targetAmount, available)

  return (
    <Panel title="Goal" className={className}>
      <div className="shrink-0 border-b border-border px-2 py-1">
        <TextInput
          aria-label="Goal name"
          value={goal.title}
          maxLength={MAX_GOAL_TITLE}
          onCommit={onSetTitle}
          className="border-border-strong"
        />
      </div>
      {/* Target and Currency each get a row: side by side, the amount is squeezed to
          nothing in a panel this narrow. */}
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1">
        <span className="w-14 shrink-0 text-2xs text-text-muted">Target</span>
        <NumberInput
          aria-label="Goal target"
          value={goal.targetAmount}
          decimals={2}
          prefix={CURRENCY_PREFIX[goal.currency]}
          onCommit={onSetTarget}
          className="flex-1 border border-border-strong"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1 pb-1">
        <span className="w-14 shrink-0 text-2xs text-text-muted">Currency</span>
        <Select
          aria-label="Goal currency"
          value={goal.currency}
          options={CURRENCIES}
          onChange={onSetCurrency}
          className="flex-1"
        />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        <GoalRing
          progress={progress}
          animationProgress={animationProgress}
          available={available}
          centerText={available ? moneyRounded(current, goal.currency) : 'Unavailable'}
          subtext={
            goal.targetAmount > 0
              ? `of ${moneyRounded(goal.targetAmount, goal.currency)} ${goal.currency}`
              : `${goal.currency} target`
          }
        />
      </div>

      {/* The status line is a whole sentence, so it wraps rather than clipping in a
          panel this narrow. */}
      <div className="flex min-h-8 shrink-0 items-center justify-center border-t border-border px-2 py-1 text-center text-2xs leading-tight text-text-muted">
        {!available && unavailableReason ? unavailableReason : statusText(current, goal.targetAmount, goal.currency, available)}
      </div>
    </Panel>
  )
}
