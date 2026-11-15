import type { AnthropicPayload } from './anthropic.js'

/** Ratios of rounded quarterly flows, not gross margins or company-defined compute efficiency. */
export function anthropicComputeSeries(quarters: AnthropicPayload['quarters']) {
  return quarters.map(row => ({ period: row.period,
    spendPerRevenue: Number.isFinite(row.compute) && Number.isFinite(row.revenue) && row.revenue > 0 && row.compute >= 0 ? row.compute / row.revenue : null,
    revenuePerSpend: Number.isFinite(row.compute) && Number.isFinite(row.revenue) && row.compute > 0 && row.revenue >= 0 ? row.revenue / row.compute : null,
  }))
}

/** Partition obligations into non-overlapping horizons; do not add the subtotal twice. */
export function anthropicCommitmentBuckets(snapshot: AnthropicPayload['capitalSnapshot']) {
  const { computeCommitments: total, commitmentsThrough2030: through2030, commitmentsNext12Months: near } = snapshot
  if (![total, through2030, near].every(value => Number.isFinite(value) && value >= 0) || total <= 0 || near > through2030 || through2030 > total) return []
  return [
    { label: 'Next 12 months', value: near },
    { label: 'Later through 2030', value: through2030 - near },
    { label: 'After 2030', value: total - through2030 },
  ]
}
