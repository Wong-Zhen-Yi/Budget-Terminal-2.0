import { useEffect, useMemo } from 'react'

import type { Portfolio, Quote } from '@shared/contract'
import { buildPositionRows } from '@shared/portfolioMath'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { HeatmapTab } from '@/components/portfolio/HeatmapTab'
import { Panel, PanelMessage } from '@/components/ui/Panel'

export function PortfolioHeatmapPanel({
  portfolio,
  quotes,
  loading,
  warning,
  onStatusChange,
}: {
  portfolio: Portfolio | null
  quotes: Record<string, Quote>
  loading: boolean
  warning?: string
  onStatusChange: (panels: PanelStatus[], path: string) => void
}) {
  const rows = useMemo(() => portfolio ? buildPositionRows(portfolio, quotes) : [], [portfolio, quotes])

  useEffect(() => {
    if (loading || !portfolio) onStatusChange([], '')
  }, [loading, portfolio, onStatusChange])

  return (
    <Panel title="Portfolio Heatmap" className="dashboard-portfolio-heatmap min-h-0 flex-1" warning={warning}>
      {loading ? <PanelMessage>Loading portfolio heatmap...</PanelMessage>
        : !portfolio ? <PanelMessage>{warning ? 'Portfolio unavailable.' : 'Select a portfolio to see its heatmap.'}</PanelMessage>
        : (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-2">
            <HeatmapTab portfolio={portfolio} rows={rows} visible compact onStatusChange={onStatusChange} />
          </div>
        )}
    </Panel>
  )
}
