import type { RollPayload } from '@shared/contract'
import { ROLL_WHY_METRICS, rollWhyMetrics, rollWhySummary } from '@shared/roll'
import { compactNumber, decimals, EM_DASH, integer } from '@/lib/format'

/** `_p18_format_currency`: compact past a thousand, two places below it. */
function currency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  return Math.abs(value) >= 1000
    ? `$${compactNumber(value)}`
    : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** `_p18_format_ratio`. */
function ratio(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'N/A' : `${value.toFixed(2)}x`
}

/** `_p18_format_percent`: a decimal fraction, printed as a percentage. */
function fractionPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'N/A'
    : `${(value * 100).toFixed(2)}%`
}

/**
 * `_p18_format_dividend_yield`.
 *
 * Yahoo has published this field both ways over the years — 0.0052 and 0.52 for the same
 * half a percent — so anything above 1.0 is taken as already being in percent. The
 * reference does the same, and without it a 2% yielder reads as 200%.
 */
function dividendYield(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  return value > 1 ? `${value.toFixed(2)}%` : `${(value * 100).toFixed(2)}%`
}

/** `_p18_target_upside`. */
function targetUpside(price: number | null, target: number | null): string {
  if (price === null || target === null || !Number.isFinite(price) || !Number.isFinite(target) || !price) {
    return 'N/A'
  }
  return `${(((target - price) / price) * 100).toFixed(2)}%`
}

/**
 * One documented departure from `P18_METRICS`' layout.
 *
 * The reference lays its metrics out two label/value pairs per row (`index // 2`), which
 * works because its left panel is a resizable splitter pane the user can widen. This rail
 * is a fixed grid fraction, and four columns inside it leave neither half legible — either
 * the values truncate to "8..." or the labels collapse to nothing. One pair per row keeps
 * every number readable at the width the rail actually gets; the rail already scrolls, so
 * the extra height costs nothing.
 */
function MetricGrid({ entries }: { entries: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
      {entries.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="truncate text-2xs text-text-muted" title={label}>
            {label}
          </dt>
          <dd className="text-right font-mono text-2xs whitespace-nowrap text-text">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The left rail: the company, its price, Why This Rolled, the twelve headline metrics and
 * the research actions.
 */
export function RollSummary({
  payload,
  onOpenUrl,
  onNavigate,
  onSaveToCharts,
}: {
  payload: RollPayload | null
  onOpenUrl: (url: string) => void
  onNavigate: (tab: string, symbol: string) => void
  onSaveToCharts: () => void
}) {
  const info = payload?.info
  const change = info?.change ?? null
  const changePercent = info?.changePercent ?? null
  const changeTone =
    change === null || !Number.isFinite(change) ? 'text-text-muted' : change >= 0 ? 'text-up' : 'text-down'
  // `_p18_set_change_label` signs both halves off the *change*, so a down day reads
  // "-$3.85 (-2.44%)". Taking the absolute value without restoring the minus prints a
  // loss as a gain.
  const sign = change !== null && change < 0 ? '-' : '+'
  const changeText =
    change === null || changePercent === null || !Number.isFinite(change) || !Number.isFinite(changePercent)
      ? EM_DASH
      : `${sign}$${Math.abs(change).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} (${sign}${Math.abs(changePercent).toFixed(2)}%)`

  const why = payload ? rollWhySummary(payload) : null
  const whyValues = payload ? rollWhyMetrics(payload) : null

  const metrics: Array<[string, string]> = [
    ['Market cap', info ? `$${compactNumber(info.marketCap)}` : 'N/A'],
    ['Revenue', info ? `$${compactNumber(info.revenue)}` : 'N/A'],
    ['Profit margin', fractionPercent(info?.profitMargin)],
    ['Trailing P/E', ratio(info?.trailingPe)],
    ['Forward P/E', ratio(info?.forwardPe)],
    ['Price/Sales', ratio(info?.priceToSales)],
    ['Beta', decimals(info?.beta ?? null, 2)],
    ['Dividend yield', dividendYield(info?.dividendYield)],
    [
      '52-week range',
      info && (info.fiftyTwoWeekLow !== null || info.fiftyTwoWeekHigh !== null)
        ? `${currency(info.fiftyTwoWeekLow)} - ${currency(info.fiftyTwoWeekHigh)}`
        : 'N/A',
    ],
    ['Avg volume', integer(info?.averageVolume ?? null)],
    ['Mean target', currency(info?.meanTarget)],
    ['Target upside', targetUpside(info?.price ?? null, info?.meanTarget ?? null)],
  ]

  const symbol = payload?.symbol ?? ''
  const actions: Array<{ label: string; onClick: () => void; disabled: boolean; wide?: boolean }> = [
    { label: 'Website', onClick: () => info && onOpenUrl(info.website), disabled: !info?.website },
    { label: 'Investor Relations', onClick: () => info && onOpenUrl(info.irUrl), disabled: !info?.irUrl },
    { label: 'Load in Stocks', onClick: () => onNavigate('stocks', symbol), disabled: !symbol },
    { label: 'Load in Charts', onClick: () => onNavigate('charts', symbol), disabled: !symbol },
    { label: 'Load in Fundamentals', onClick: () => onNavigate('fundamentals', symbol), disabled: !symbol },
    { label: 'Load in Options', onClick: () => onNavigate('options', symbol), disabled: !symbol },
    { label: 'Save to Charts', onClick: onSaveToCharts, disabled: !symbol, wide: true },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
      <div>
        <div className="font-mono text-lg font-semibold text-text">{symbol || EM_DASH}</div>
        <div className="text-xs text-text">
          {info?.name ?? 'Roll to reveal a research candidate.'}
        </div>
        {info ? (
          <div className="text-2xs text-text-muted">
            {`${info.exchange}  |  ${info.sector}  |  ${info.industry}  |  ${info.currency}`}
          </div>
        ) : null}
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-base text-text">{currency(info?.price)}</span>
          <span className={`font-mono text-xs font-semibold ${changeTone}`}>{changeText}</span>
        </div>
      </div>

      <section className="border border-border bg-surface-raised p-2">
        <h3 className="mb-1 text-2xs font-semibold tracking-wide text-text uppercase">
          Why This Rolled
        </h3>
        <p className="mb-2 text-2xs text-text-muted">
          {why?.summary ?? 'Rolls use liquid US equities from the Yahoo screener.'}
        </p>
        <MetricGrid
          entries={ROLL_WHY_METRICS.map(({ label, key }) => [label, whyValues?.[key] ?? EM_DASH])}
        />
        <div className="mt-2 grid grid-cols-2 gap-1">
          {(why?.badges ?? Array.from({ length: 6 }, () => EM_DASH)).map((badge, index) => (
            <span
              key={`${badge}:${index}`}
              title={badge}
              className="truncate border border-border bg-surface px-1 py-0.5 text-center text-2xs text-text-muted"
            >
              {badge}
            </span>
          ))}
        </div>
      </section>

      <MetricGrid entries={metrics} />

      <section className="border border-border bg-surface-raised p-2">
        <h3 className="mb-1 text-2xs font-semibold tracking-wide text-text uppercase">
          Research Actions
        </h3>
        <div className="grid grid-cols-2 gap-1">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`no-drag inline-flex h-8 items-center justify-center border border-border-strong bg-surface px-2 text-2xs text-text transition-colors hover:border-accent-dim hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40 ${
                action.wide ? 'col-span-2' : ''
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
