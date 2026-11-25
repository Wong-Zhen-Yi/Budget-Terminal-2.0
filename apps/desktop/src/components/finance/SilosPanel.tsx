import { useState } from 'react'

import type { FinanceCurrency } from '@shared/contract'
import type { SiloBar } from '@shared/financeMath'
import { BarChart } from '@/components/charts/BarChart'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { CURRENCY_PREFIX, moneyRounded } from '@/lib/format'

/** `S$21K`, `S$8.4K`, `S$486`: short enough for a narrow column. */
function shortMoney(value: number, display: FinanceCurrency): string {
  const abs = Math.abs(value)
  const text = abs >= 1e6 ? `${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M` : abs >= 1e3 ? `${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K` : abs.toFixed(0)
  return `${CURRENCY_PREFIX[display]}${text}`
}

interface SilosPanelProps {
  bars: SiloBar[]
  display: FinanceCurrency
  className?: string
  complete?: boolean
}

/**
 * Every account as its own column: cash accounts, then each brokerage book split into
 * stocks, cash and options, then the debts.
 *
 * The log scale is on by default, as in the reference. A book with one large brokerage
 * account and several small savings accounts is otherwise a single tall bar beside a
 * row of invisible ones. The toggle is session state — the reference does not persist
 * it either.
 */
export function SilosPanel({ bars, display, className = '', complete = true }: SilosPanelProps) {
  const [logScale, setLogScale] = useState(true)

  return (
    <Panel
      title={`Personal Finance Silos (${display})`}
      className={className}
      actions={
        <Button variant="toggle" active={logScale} onClick={() => setLogScale((on) => !on)}>
          {logScale ? 'Log' : 'Linear'}
        </Button>
      }
    >
      {!complete && <p className="px-2 py-1 text-2xs text-warn">Partial account values; market marks or FX unavailable.</p>}
      <BarChart
        bars={bars}
        signed={false}
        logScale={logScale}
        sortByMagnitude
        format={(value) => moneyRounded(Math.abs(value), display)}
        compactFormat={(value) => shortMoney(value, display)}
        empty="No accounts to show"
      />
    </Panel>
  )
}
