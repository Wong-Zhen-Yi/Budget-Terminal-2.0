import type { EconomicRow } from '@shared/contract'
import { formatEconomicValue, historySeries } from '@shared/economic'
import { LineChart } from '@/components/charts/LineChart'
import { PanelMessage } from '@/components/ui/Panel'

/**
 * The history plot under each group tab's table, ported from `_p42_render_group_chart`.
 *
 * A macro level — an unemployment rate near 4%, a 10Y yield near 4.5% — is unreadable
 * against a forced zero line, so this asks for `auto`. The reference draws its own zero
 * reference line only when the series actually straddles zero, which `auto` reproduces for
 * free: the fitted domain includes zero exactly when the data does, and `LineChart` draws
 * the baseline it fits.
 */
export function SeriesChart({ row, years }: { row: EconomicRow | null; years: number }) {
  if (!row) {
    return <PanelMessage>Select an indicator</PanelMessage>
  }
  const { dates, values } = historySeries(row, years)
  if (!values.length) {
    return <PanelMessage>{`${row.label} returned no history.`}</PanelMessage>
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <p className="shrink-0 truncate text-2xs text-text-muted">
        {`${row.label} · ${row.source || row.seriesId}`}
      </p>
      <div className="flex min-h-0 flex-1 flex-col">
        <LineChart
          labels={dates}
          series={[{ values, color: 'var(--color-accent)', label: row.label }]}
          baseline="auto"
          format={(value) => formatEconomicValue(value, row.units, row.decimals)}
        />
      </div>
    </div>
  )
}
