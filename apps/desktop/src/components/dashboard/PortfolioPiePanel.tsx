import { useMemo } from 'react'

import type { Portfolio, Quote } from '@shared/contract'
import { buildPortfolioAllocation } from '@shared/portfolioMath'
import { Donut } from '@/components/charts/Donut'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { currency } from '@/lib/format'

export function PortfolioPiePanel({
  portfolio,
  quotes,
  loading,
  warning,
  className,
}: {
  portfolio: Portfolio | null
  quotes: Record<string, Quote>
  loading: boolean
  warning?: string
  className?: string
}) {
  const allocation = useMemo(() => portfolio ? buildPortfolioAllocation(portfolio, quotes) : null,
    [portfolio, quotes])
  const missing = !loading ? allocation?.missingReasons.join(' ') : undefined

  return (
    <Panel
      title="Portfolio Pie"
      className={`dashboard-portfolio-pie ${className ?? ''}`}
      warning={warning ?? missing}
      actions={allocation && !loading ? (
        <span className="num text-2xs text-text-muted" title="Positive, weight-included holdings and counted cash, in USD">
          {allocation.complete ? 'Included' : 'Known'}: {currency(allocation.total)}
        </span>
      ) : undefined}
    >
      {loading ? <PanelMessage>Loading portfolio allocation...</PanelMessage>
        : !portfolio ? <PanelMessage>{warning ? 'Portfolio unavailable.' : 'Select a portfolio to see its allocation.'}</PanelMessage>
        : missing ? <PanelMessage>Allocation unavailable. {missing}</PanelMessage>
        : allocation ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex min-h-full flex-col">
              <Donut compact slices={allocation.slices} empty="No weighted holdings or counted cash to show" />
              <p className="shrink-0 px-2 pb-2 text-2xs text-text-dim">
                Included holdings{portfolio.includeCashInWeight ? ' + cash' : ' · Cash excluded'} · USD
              </p>
            </div>
          </div>
        ) : null}
    </Panel>
  )
}
