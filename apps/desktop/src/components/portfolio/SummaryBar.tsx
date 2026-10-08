import type { Portfolio } from '@shared/contract'
import type { PortfolioSummary } from '@shared/portfolioMath'
import { NumberInput } from '@/components/ui/NumberInput'
import { currency, integer, plainPercent, signedCurrency } from '@/lib/format'

interface SummaryBarProps {
  portfolio: Portfolio
  summary: PortfolioSummary
  /** Total across the option tracker, shown beside the stock P&L. */
  optionsPnl: number | null
  onSetCash: (value: number) => void
  onSetMargin: (value: number) => void
  onToggleIncludeCash: (value: boolean) => void
}

/**
 * The figures across the top of the Portfolio page. Cash and margin are editable in
 * place here, as they are in the reference app — they are portfolio-level facts, not
 * positions, so they have nowhere else to live.
 */
export function SummaryBar({
  portfolio,
  summary,
  optionsPnl,
  onSetCash,
  onSetMargin,
  onToggleIncludeCash,
}: SummaryBarProps) {
  const readOnly = portfolio.readOnly

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h1 className="pr-2 text-sm font-semibold text-text">Portfolio</h1>

      <Chip>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={portfolio.includeCashInWeight}
            disabled={readOnly}
            onChange={(event) => onToggleIncludeCash(event.target.checked)}
            className="accent-accent"
          />
          <span
            className="text-2xs tracking-wide text-text-muted uppercase"
            title="Include cash in portfolio weight and the total"
          >
            Brokerage Cash
          </span>
        </label>
        <NumberInput
          aria-label="Brokerage cash"
          value={portfolio.cashBalance}
          decimals={2}
          prefix="$"
          onCommit={onSetCash}
          className="w-32"
        />
      </Chip>

      <Chip>
        <span
          className="text-2xs tracking-wide text-text-muted uppercase"
          title="Margin debt is deducted from the portfolio total"
        >
          Margin
        </span>
        <NumberInput
          aria-label="Margin debt"
          value={portfolio.marginDebt}
          decimals={2}
          prefix="$"
          onCommit={onSetMargin}
          className="w-32"
        />
        {summary.marginUtilization !== null ? (
          <span
            className={`num text-2xs ${marginTone(summary.marginUtilization)}`}
            title="Margin used = margin debt / (stock market value + cash)"
          >
            {plainPercent(summary.marginUtilization)}
          </span>
        ) : null}
      </Chip>

      <Metric label="Stock P&L" tone={!summary.complete ? 'text-text-muted' : summary.stockPnl >= 0 ? 'text-up' : 'text-down'}>
        {summary.complete ? signedCurrency(summary.stockPnl) : 'N/A'}
      </Metric>
      <Metric label="Options P&L" tone={optionsPnl === null ? 'text-text-muted' : optionsPnl >= 0 ? 'text-up' : 'text-down'}>
        {optionsPnl === null ? 'N/A' : signedCurrency(optionsPnl)}
      </Metric>
      <Metric label="Positions">{integer(summary.positionCount)}</Metric>
      <Metric label={summary.complete ? 'Included stocks + cash − margin' : 'Known stocks + cash − margin'}>{currency(summary.total)} USD</Metric>
      {portfolio.options.some(option => option.ticker && option.contracts) && <span className="text-2xs text-text-muted">Options equity is included in Personal Finance net worth.</span>}
      {!summary.complete && <span className="text-2xs text-warn">Incomplete: {summary.missingReasons.join(' ')}</span>}
    </div>
  )
}

/** Thresholds from the reference app's margin tooltip: <15 green, <25 amber, <=40, else red. */
function marginTone(percent: number): string {
  if (percent < 15) return 'text-up'
  if (percent < 25) return 'text-yellow-400'
  if (percent <= 40) return 'text-orange-400'
  return 'text-down'
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border border-border bg-surface px-2 py-1">
      {children}
    </div>
  )
}

function Metric({
  label,
  children,
  tone = 'text-text',
}: {
  label: string
  children: React.ReactNode
  tone?: string
}) {
  return (
    <div className="flex items-center gap-2 border border-border bg-surface px-2 py-1">
      <span className="text-2xs tracking-wide text-text-muted uppercase">{label}</span>
      <span className={`num text-2xs font-semibold ${tone}`}>{children}</span>
    </div>
  )
}
