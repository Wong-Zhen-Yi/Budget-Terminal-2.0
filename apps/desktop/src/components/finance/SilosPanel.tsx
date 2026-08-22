import { useState } from 'react'

import type { FinanceCurrency } from '@shared/contract'
import type { SiloBar } from '@shared/financeMath'
import { BarChart } from '@/components/charts/BarChart'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { moneyRounded } from '@/lib/format'

interface SilosPanelProps {
  bars: SiloBar[]
  display: FinanceCurrency
  className?: string
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
export function SilosPanel({ bars, display, className = '' }: SilosPanelProps) {
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
      <BarChart
        bars={bars}
        signed={false}
        logScale={logScale}
        sortByMagnitude
        format={(value) => moneyRounded(Math.abs(value), display)}
        empty="No accounts to show"
      />
    </Panel>
  )
}
