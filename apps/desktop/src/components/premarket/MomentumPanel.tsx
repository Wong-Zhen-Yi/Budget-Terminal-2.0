import type { SpyMomentumPayload } from '@shared/contract'
import { LineChart } from '@/components/charts/LineChart'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { decimals } from '@/lib/format'

/** `%m/%d/%y`, the format the reference's `DateAxisItem` prints for daily bars. */
function axisLabel(date: string): string {
  const [year, month, day] = date.split('-')
  return `${month}/${day}/${year.slice(2)}`
}

export function MomentumPanel({
  data,
  loading,
  warning,
  className = '',
}: {
  data: SpyMomentumPayload | null
  loading: boolean
  warning?: string
  className?: string
}) {
  const hasSeries = Boolean(data?.dates.length)
  const lastClose = data?.lastClose ?? null
  const lastMa = data?.lastMa ?? null
  // A tie counts as Above, matching the reference's `>=`.
  const above = lastClose !== null && lastMa !== null ? lastClose >= lastMa : null

  return (
    <Panel title="Market Momentum" warning={warning} className={className}>
      {hasSeries && data ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
          <div className="flex min-h-0 flex-1 flex-col">
            <LineChart
              labels={data.dates.map(axisLabel)}
              series={[
                { values: data.closes, color: '#42a5f5', label: 'SPY' },
                { values: data.ma125, color: '#ffa726', dashed: true, label: '125-day MA' },
              ]}
              format={(value) => `$${value.toFixed(0)}`}
              baseline="auto"
            />
          </div>
          {/* Without an MA the reference drops the `$` too, printing a bare `--`. */}
          <p className="num shrink-0 text-2xs text-text">
            {`SPY: $${decimals(lastClose, 2)} | 125-day MA: ${lastMa === null ? '--' : `$${decimals(lastMa, 2)}`} | `}
            {above === null ? (
              '--'
            ) : (
              <span className={above ? 'text-up' : 'text-down'}>
                {above ? 'Above MA' : 'Below MA'}
              </span>
            )}
          </p>
        </div>
      ) : (
        <PanelMessage>
          {loading ? 'Loading SPY momentum...' : 'No momentum data available'}
        </PanelMessage>
      )}
    </Panel>
  )
}
