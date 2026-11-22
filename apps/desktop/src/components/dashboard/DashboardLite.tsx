import { useState, type ReactNode } from 'react'
import type { NewsItem } from '@shared/contract'
import { api } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { newsTime, timestampLabel } from '@/lib/format'
import './DashboardLite.css'

export function DashboardLite({ market, chart, options, holdings, targets, news, autoFollow, onToggleAutoFollow }: {
  market: ReactNode
  chart: ReactNode
  options: ReactNode
  holdings: ReactNode
  targets: ReactNode
  news: ReactNode
  autoFollow: boolean
  onToggleAutoFollow: () => void
}) {
  const [showTargets, setShowTargets] = useState(false)
  return (
    <section className="dashboard-lite" aria-label="Dashboard Lite">
      {market}
      <div className="dashboard-lite-grid">
        {chart}
        {options}
        <section className="dashboard-lite-portfolio" aria-label="Portfolio">
          <div className="dashboard-lite-portfolio-toolbar">
            <div className="dashboard-lite-controls" role="group" aria-label="Portfolio view">
              <Button variant="toggle" active={!showTargets} onClick={() => setShowTargets(false)}>Holdings</Button>
              <Button variant="toggle" active={showTargets} onClick={() => setShowTargets(true)}>Price targets</Button>
            </div>
            <Button variant="toggle" active={autoFollow} onClick={onToggleAutoFollow}
              title="Load the selected holding or price target in the chart">
              Auto-follow
            </Button>
          </div>
          <div className="dashboard-lite-portfolio-content">{showTargets ? targets : holdings}</div>
        </section>
        {news}
      </div>
    </section>
  )
}

export function DashboardLiteNews({ items, loading }: { items: NewsItem[]; loading: boolean }) {
  return (
    <Panel title="Portfolio news" className="dashboard-lite-news">
      {items.length ? <ul>
        {items.map(item => <li key={item.id}>
          <button type="button" onClick={() => void api.openExternal(item.url)} title={`${item.title} · ${item.source}`}>
            <strong>{item.ticker}</strong>
            <span>{item.title}</span>
            <span className="num" title={timestampLabel(item.publishedAt)}>{newsTime(item.publishedAt)}</span>
          </button>
        </li>)}
      </ul> : <PanelMessage>{loading ? 'Loading news…' : 'No recent portfolio headlines.'}</PanelMessage>}
    </Panel>
  )
}
