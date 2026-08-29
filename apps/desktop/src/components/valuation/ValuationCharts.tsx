import type { ValuationPricePoint, ValuationScenarios, ValuationTrends } from '@shared/contract'
import { LineChart, type LineSeries } from '@/components/charts/LineChart'

/**
 * The Valuation page's three plots, ported from `_valuation_render_fair_value_chart`,
 * `_valuation_render_historical_pe_chart` and `_valuation_render_trend_chart`.
 *
 * One documented departure: the reference shades the bear-to-bull band with a
 * `LinearRegionItem` behind the lines. `LineChart` draws paths, not regions, so the band
 * is carried by its two dashed edges instead. Nothing else changes — the same five levels
 * are drawn against the same five-year monthly close series.
 */

const COLOR = {
  price: '#42a5f5',
  bear: '#ef5350',
  base: '#ffa726',
  bull: '#26c281',
} as const

function axisLabel(date: string): string {
  return date.slice(0, 7)
}

/** A horizontal level, drawn as a constant series so it shares the price chart's scale. */
function level(value: number | null, length: number, color: string, label: string): LineSeries | null {
  return value === null || !Number.isFinite(value)
    ? null
    : { values: new Array(length).fill(value), color, dashed: true, label }
}

export function FairValueBandChart({
  priceHistory,
  scenarios,
}: {
  priceHistory: ValuationPricePoint[]
  scenarios: ValuationScenarios | null
}) {
  const closes = priceHistory.map((point) => point.close)
  const labels = priceHistory.map((point) => axisLabel(point.date))
  const series: LineSeries[] = [{ values: closes, color: COLOR.price, label: 'Current price' }]
  // The band is in the reporting currency and the price line is in the quote currency;
  // sharing one axis between them is the whole defect the blocking guard exists to avoid.
  if (scenarios && scenarios.priceComparisonValid && closes.length) {
    const byName = new Map(scenarios.scenarios.map((row) => [row.name, row.fairValue]))
    const levels = [
      level(byName.get('Bear Case') ?? null, closes.length, COLOR.bear, 'Bear'),
      level(byName.get('Base Case') ?? null, closes.length, COLOR.base, 'Base'),
      level(byName.get('Bull Case') ?? null, closes.length, COLOR.bull, 'Bull'),
      level(scenarios.buyBelow, closes.length, COLOR.bull, 'Buy below'),
      level(scenarios.upperScenario, closes.length, COLOR.bear, 'Upper scenario'),
    ]
    for (const entry of levels) if (entry) series.push(entry)
  }
  return (
    <LineChart
      labels={labels}
      series={closes.length ? series : []}
      format={(value) => `$${value.toFixed(2)}`}
      baseline="auto"
      empty="No price history"
      ticks={6}
    />
  )
}

export function HistoricalPeChart({
  priceHistory,
  eps,
  currentPe,
  currencyMismatch,
}: {
  priceHistory: ValuationPricePoint[]
  eps: number | null
  currentPe: number | null
  currencyMismatch: boolean
}) {
  // Every point on this curve is a quote-currency close over a reporting-currency EPS.
  const usable = !currencyMismatch && eps !== null && eps > 0 && priceHistory.length > 0
  const values = usable ? priceHistory.map((point) => point.close / (eps as number)) : []
  const series: LineSeries[] = usable
    ? [{ values, color: COLOR.price, label: 'P/E' }]
    : []
  if (usable && currentPe !== null) {
    series.push({
      values: new Array(values.length).fill(currentPe),
      color: COLOR.base,
      dashed: true,
      label: 'Current P/E',
    })
  }
  return (
    <LineChart
      labels={priceHistory.map((point) => axisLabel(point.date))}
      series={series}
      format={(value) => `${value.toFixed(1)}x`}
      baseline="auto"
      empty={currencyMismatch ? 'Withheld: quote and statements use different currencies' : 'No usable EPS'}
      ticks={6}
    />
  )
}

/**
 * Revenue and FCF are plotted in billions and EPS raw, exactly as the reference scales
 * them — three series with different units on one axis is what makes the shape readable
 * at all, and the legend names the scale.
 */
export function TrendChart({ trends }: { trends: ValuationTrends }) {
  const billions = (values: Array<number | null>) =>
    trends.labels.map((_, index) => {
      const value = values[index]
      return value === null || value === undefined ? null : value / 1_000_000_000
    })
  const series: LineSeries[] = [
    { values: billions(trends.revenue), color: COLOR.bull, label: 'Revenue B' },
    { values: billions(trends.fcf), color: COLOR.base, label: 'FCF B' },
    { values: trends.labels.map((_, index) => trends.eps[index] ?? null), color: COLOR.price, label: 'EPS' },
  ].filter((entry) => entry.values.some((value) => value !== null))
  return (
    <LineChart
      labels={trends.labels}
      series={trends.labels.length ? series : []}
      format={(value) => value.toFixed(2)}
      baseline="auto"
      empty="No annual history"
      ticks={5}
    />
  )
}
