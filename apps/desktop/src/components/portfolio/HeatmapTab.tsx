import { useMemo, useState } from 'react'

import type { HeatmapInterval, Portfolio } from '@shared/contract'
import { HEATMAP_INTERVALS } from '@shared/contract'
import { weightedMove } from '@shared/analytics'
import { sectorFor } from '@shared/sectors'
import type { PositionRow } from '@shared/portfolioMath'
import { useReturns } from '@/api/portfolioQueries'
import { Treemap, type TreemapTile } from '@/components/charts/Treemap'
import { Button } from '@/components/ui/Button'
import { DataFreshness } from '@/components/ui/DataFreshness'
import { FRESHNESS } from '@shared/freshness'
import { currency, percent, plainPercent } from '@/lib/format'

interface HeatmapTabProps {
  portfolio: Portfolio
  rows: PositionRow[]
  visible: boolean
}

export function HeatmapTab({ portfolio, rows, visible }: HeatmapTabProps) {
  const [interval, setInterval] = useState<HeatmapInterval>('live')
  const [hovered, setHovered] = useState<TreemapTile | null>(null)

  // Only weight-included positions with real shares appear on the map, matching
  // `_p4_heatmap_stock_symbols`.
  const included = useMemo(
    () => rows.filter((row) => row.includeInWeight && row.shares > 0 && row.marketValue !== null && row.marketValue > 0),
    [rows],
  )
  const cash = portfolio.includeCashInWeight ? Math.max(portfolio.cashBalance, 0) : 0
  const holdings = rows.filter(row => row.includeInWeight && row.shares > 0)
  const complete = holdings.every(row => row.marketValue !== null)
  const totalValue = included.reduce((sum, row) => sum + (row.marketValue ?? 0), 0) + cash

  // 'live' is today's quote change, which is already on the row; every other interval
  // needs its own history fetch.
  const historical = interval !== 'live'
  const returnsQuery = useReturns(
    included.map((row) => row.ticker),
    interval,
    visible && historical,
  )

  const tiles: TreemapTile[] = useMemo(
    () =>
      rows.some(row => row.includeInWeight && row.marketValue === null) ? [] : included.map((row) => {
        const change = historical
          ? (returnsQuery.data?.data.returns[row.ticker] ?? null)
          : row.changePercent
        const weight = totalValue > 0 ? ((row.marketValue ?? 0) / totalValue) * 100 : 0
        return {
          key: row.ticker,
          label: row.ticker,
          weight,
          changePct: change,
          group: sectorFor(row.ticker),
          subtitle: `${HEATMAP_INTERVALS.find((entry) => entry.key === interval)?.label ?? ''} ${percent(change)}`,
        }
      }),
    [rows, included, historical, returnsQuery.data, totalValue, interval],
  )

  const move = weightedMove(tiles)
  const ranked = [...tiles]
    .filter((tile) => tile.changePct !== null)
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))
  const largest = [...tiles].sort((a, b) => b.weight - a.weight)[0]
  const detail = complete ? hovered ?? largest ?? null : null
  const detailRow = detail ? included.find((row) => row.ticker === detail.key) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {rows.some(row => row.includeInWeight && row.marketValue === null) && <p className="px-2 text-2xs text-warn">Market marks missing; allocation unavailable.</p>}
      {historical && included.length > 0 && <DataFreshness envelope={returnsQuery.data} loading={returnsQuery.isFetching}
        error={returnsQuery.error} freshnessMs={FRESHNESS.chartDaily}
        coverage={`${Object.keys(returnsQuery.data?.data.returns ?? {}).length}/${included.length} holdings`} />}
      <div className="flex shrink-0 flex-wrap border border-border bg-surface">
        <Stat label="Holdings" value={String(holdings.length)} />
        <Stat label="Priced holdings" value={`${included.length}/${holdings.length}`} />
        <Stat
          label="Cash"
          value={`${currency(cash, 0)} / ${!complete ? 'N/A' : totalValue > 0 ? plainPercent((cash / totalValue) * 100) : '--'}`}
        />
        <Stat label="Return coverage" value={`${tiles.filter((t) => t.changePct !== null).length}/${holdings.length}`} />
        <Stat label="Weighted Move" value={percent(move)} tone={(move ?? 0) >= 0 ? 'text-up' : 'text-down'} />
        <Stat label="Largest" value={largest ? `${largest.label} ${plainPercent(largest.weight)}` : '--'} />
        <Stat
          label="Strongest"
          value={ranked[0] ? `${ranked[0].label} ${percent(ranked[0].changePct)}` : '--'}
          tone="text-up"
        />
        <Stat
          label="Weakest"
          value={
            ranked.length ? `${ranked[ranked.length - 1].label} ${percent(ranked[ranked.length - 1].changePct)}` : '--'
          }
          tone="text-down"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="pr-1 text-2xs text-text-muted">Interval</span>
        {HEATMAP_INTERVALS.map((entry) => (
          <Button
            key={entry.key}
            variant="toggle"
            active={entry.key === interval}
            onClick={() => setInterval(entry.key)}
          >
            {entry.label}
          </Button>
        ))}
        {historical && returnsQuery.isFetching ? (
          <span className="pl-2 text-2xs text-text-dim">Loading {interval} returns...</span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border border-border bg-surface p-1">
        <Treemap tiles={tiles} onHover={setHovered} format={(value) => percent(value)} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-4 border border-border bg-surface px-2 py-1 text-2xs">
        {detail && detailRow ? (
          <>
            <span className="font-semibold text-text">{detail.label}</span>
            <span className="text-text-muted">Sector: {detail.group}</span>
            <span className="text-text-muted">
              Weight: <span className="num text-text">{plainPercent(detail.weight, 2)}</span>
            </span>
            <span className="text-text-muted">
              Price: <span className="num text-text">{currency(detailRow.price)}</span>
            </span>
            <span className="text-text-muted">
              Market Value: <span className="num text-text">{currency(detailRow.marketValue)}</span>
            </span>
            <span className={(detail.changePct ?? 0) >= 0 ? 'text-up' : 'text-down'}>
              Change: {percent(detail.changePct)}
            </span>
          </>
        ) : (
          <span className="text-text-dim">Hover a tile for detail</span>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone = 'text-text' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex min-w-32 flex-1 flex-col items-center border-r border-border px-3 py-1 last:border-r-0">
      <span className="text-2xs text-text-muted">{label}</span>
      <span className={`num text-2xs font-semibold ${tone}`}>{value}</span>
    </div>
  )
}
