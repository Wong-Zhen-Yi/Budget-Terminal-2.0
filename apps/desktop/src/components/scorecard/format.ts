import { SCORECARD_METRICS, type ScorecardMetricKey } from '@shared/scorecard'
import { compactCurrency, decimals } from '@/lib/format'

export function scorecardMetricValue(key: ScorecardMetricKey, value: number | null): string {
  if (value === null) return 'N/A'
  const metric = SCORECARD_METRICS.find(entry => entry.key === key)!
  if (metric.format === 'money') return compactCurrency(value)
  if (metric.format === 'percent') return `${decimals(value, 1)}%`
  return `${decimals(value, 2)}${key === 'beta' ? '' : 'x'}`
}
