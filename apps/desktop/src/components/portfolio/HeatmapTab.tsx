import { useEffect, useMemo, useState } from 'react'

import type { HeatmapInterval, Portfolio } from '@shared/contract'
import { HEATMAP_INTERVALS } from '@shared/contract'
import { weightedMove } from '@shared/analytics'
import { sectorFor } from '@shared/sectors'
import { FRESHNESS } from '@shared/freshness'
import type { PositionRow } from '@shared/portfolioMath'
import { useReturns } from '@/api/portfolioQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Treemap, type TreemapTile } from '@/components/charts/Treemap'
import { Button } from '@/components/ui/Button'
import { PrivateNumber } from '@/components/ui/NumberPrivacy'
import { currency, percent, plainPercent } from '@/lib/format'

interface HeatmapTabProps {
  portfolio: Portfolio
  rows: PositionRow[]
  visible: boolean
  compact?: boolean
  onStatusChange?: (panels: PanelStatus[], path: string) => void
}

export function HeatmapTab({ portfolio, rows, visible, compact = false, onStatusChange }: HeatmapTabProps) {
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

  useEffect(() => {
    onStatusChange?.([{ label: 'Heatmap returns', envelope: returnsQuery.data,
      error: returnsQuery.error, loading: returnsQuery.isFetching, enabled: returnsQuery.isEnabled, freshnessMs: FRESHNESS.chartDaily }], '')
  }, [onStatusChange, returnsQuery.data, returnsQuery.error, returnsQuery.isFetching, returnsQuery.isEnabled])

  const tiles: TreemapTile[] = useMemo(
    () =>
      !complete ? [] : included.map((row) => {
        const change = historical
          ? (returnsQuery.data?.data.returns[row.ticker] ?? null)
          : row.changePercent
        const weight = totalValue > 0 ? ((row.marketValue ?? 0) / totalValue) * 100 : 0
        return {
          key: row.ticker,
          label: row.ticker,
          weight,
          changePct: change,
          group: sectorFor(row.ticker, row.sector),
          subtitle: `${HEATMAP_INTERVALS.find((entry) => entry.key === interval)?.label ?? ''} ${percent(change)}`,
        }
      }),
    [complete, included, historical, returnsQuery.data, totalValue, interval],
  )

  const move = weightedMove(tiles)
  const ranked = [...tiles]
    .filter((tile) => tile.changePct !== null)
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))
  const largest = [...tiles].sort((a, b) => b.weight - a.weight)[0]
  const detail = complete ? tiles.find(tile => tile.key === hovered?.key) ?? largest ?? null : null
  const detailRow = detail ? included.find((row) => row.ticker === detail.key) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className={`${compact ? 'grid grid-cols-2' : 'flex flex-wrap'} shrink-0 border border-border bg-surface`}>
        <Stat label="Holdings" value={String(holdings.length)} />
        {!compact ? <Stat label="Priced holdings" value={`${included.length}/${holdings.length}`} /> : null}
        <Stat
          label="Cash"
          value={`${currency(cash, 0)} / ${!complete ? 'N/A' : totalValue > 0 ? plainPercent((cash / totalValue) * 100) : '--'}`}
        />
        <Stat label="Return coverage" value={`${tiles.filter((t) => t.changePct !== null).length}/${holdings.length}`} />
        <Stat label="Weighted Move" value={percent(move)} tone={(move ?? 0) >= 0 ? 'text-up' : 'text-down'} />
        {!compact ? (
          <>
            <Stat label="Largest" prefix={largest?.label} value={largest ? plainPercent(largest.weight) : '--'} />
            <Stat
              label="Strongest"
              prefix={ranked[0]?.label}
              value={ranked[0] ? percent(ranked[0].changePct) : '--'}
              tone="text-up"
            />
            <Stat
              label="Weakest"
              prefix={ranked.at(-1)?.label}
              value={
                ranked.length ? percent(ranked[ranked.length - 1].changePct) : '--'
              }
              tone="text-down"
            />
          </>
        ) : null}
      </div>

      <div className={`flex shrink-0 items-center gap-1${compact ? ' flex-wrap' : ''}`} aria-busy={historical && returnsQuery.isFetching}>
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
      </div>

      <div className={`portfolio-heatmap-map flex flex-1 flex-col border border-border bg-surface p-1 ${compact ? 'min-h-48 overflow-hidden' : 'min-h-0'}`}>
        <Treemap tiles={tiles} onHover={setHovered} format={(value) => percent(value)}
          empty={complete ? undefined : 'Market marks missing. Allocation unavailable.'} />
      </div>

      <div className={`shrink-0 border border-border bg-surface px-2 py-1 text-2xs ${compact ? 'grid grid-rows-[repeat(3,1.25rem)] gap-y-1' : 'flex items-center gap-4'}`}>
        {detail && detailRow ? (
          <>
            <div className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 font-semibold text-text">{detail.label}</span>
              <span className="truncate text-text-muted" title={detail.group}>Sector: {detail.group}</span>
            </div>
            <div className="flex min-w-0 items-center gap-3 text-text-muted">
              <span className="truncate">Weight: <span className="num text-text"><PrivateNumber>{plainPercent(detail.weight, 2)}</PrivateNumber></span></span>
              <span className="truncate">Price: <span className="num text-text"><PrivateNumber>{currency(detailRow.price)}</PrivateNumber></span></span>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <span className="truncate text-text-muted">Market Value: <span className="num text-text"><PrivateNumber>{currency(detailRow.marketValue)}</PrivateNumber></span></span>
              <span className={`truncate ${(detail.changePct ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>Change: <PrivateNumber>{percent(detail.changePct)}</PrivateNumber></span>
            </div>
          </>
        ) : (
          <span className="text-text-dim">Hover a tile for detail</span>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, prefix, tone = 'text-text' }: { label: string; value: string; prefix?: string; tone?: string }) {
  return (
    <div className="flex min-w-32 flex-1 flex-col items-center border-r border-border px-3 py-1 last:border-r-0">
      <span className="text-2xs text-text-muted">{label}</span>
      <span className={`num text-2xs font-semibold ${tone}`}>{prefix ? `${prefix} ` : ''}<PrivateNumber>{value}</PrivateNumber></span>
    </div>
  )
}
