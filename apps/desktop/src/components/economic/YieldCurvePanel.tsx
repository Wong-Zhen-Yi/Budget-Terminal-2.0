import { useMemo } from 'react'

import type { EconomicCurveTenor, EconomicYieldCurve } from '@shared/contract'
import { describeCurve } from '@shared/economic'
import { LineChart } from '@/components/charts/LineChart'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel, PanelMessage } from '@/components/ui/Panel'

/**
 * The treasury curve, ported from `_p42_build_curve_panel` and `build_curve_rows`.
 *
 * The x axis is tenor, not time, so the points sit at even positions with the tenor labels
 * as the ticks — the same thing the reference does with `range(len(tenors))` and an
 * explicit `setTicks`. The table's sort is left off deliberately: catalog order *is*
 * maturity order, and sorting the tenors any other way makes the shape unreadable.
 */

function signed(value: number | null): string {
  return value === null ? '—' : `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`
}

export function YieldCurvePanel({
  curve,
  className = '',
}: {
  curve: EconomicYieldCurve | null | undefined
  className?: string
}) {
  const tenors = curve?.tenors ?? []
  const front = tenors.find((item) => item.seriesId === 'DGS3MO')?.yieldPct ?? null
  const tenYear = tenors.find((item) => item.seriesId === 'DGS10')?.yieldPct ?? null

  const columns = useMemo<Array<Column<EconomicCurveTenor>>>(
    () => [
      { key: 'label', header: 'Tenor', width: '70px', cell: (row) => row.label },
      {
        key: 'yield',
        header: 'Yield',
        align: 'right',
        numeric: true,
        width: '76px',
        cell: (row) => `${row.yieldPct.toFixed(2)}%`,
      },
      {
        key: 'vsFront',
        header: 'vs 3M',
        align: 'right',
        numeric: true,
        width: '76px',
        cell: (row) => {
          const value = front === null ? null : row.yieldPct - front
          return (
            <span className={value !== null && value < 0 ? 'text-down' : 'text-text'}>
              {signed(value)}
            </span>
          )
        },
      },
      {
        key: 'vsTen',
        header: 'vs 10Y',
        align: 'right',
        numeric: true,
        cell: (row) => signed(tenYear === null ? null : row.yieldPct - tenYear),
      },
    ],
    [front, tenYear],
  )

  const summary = describeCurve(curve)

  return (
    <Panel title="Treasury curve" className={className}>
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="flex min-h-0 w-[320px] shrink-0 border border-border bg-surface">
          <DataTable
            columns={columns}
            rows={tenors}
            rowKey={(row) => row.seriesId}
            layout="fixed"
            empty="Treasury curve unavailable"
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <p className={`shrink-0 text-2xs ${curve?.inverted2s10s ? 'text-down' : 'text-text-muted'}`}>
            {summary}
          </p>
          {tenors.length ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <LineChart
                labels={tenors.map((item) => item.label)}
                series={[
                  {
                    values: tenors.map((item) => item.yieldPct),
                    color: 'var(--color-accent)',
                    label: 'Par yield',
                  },
                ]}
                // A curve between 3.8% and 4.6% against a forced zero line is a flat
                // smear at the top of the frame.
                baseline="auto"
                format={(value) => `${value.toFixed(2)}%`}
                ticks={tenors.length}
              />
            </div>
          ) : (
            <PanelMessage>No treasury tenors returned.</PanelMessage>
          )}
        </div>
      </div>
    </Panel>
  )
}
