import { useState } from 'react'

import type { MetricsLookback, PositionInput, RiskMetricsPayload } from '@shared/contract'
import { METRICS_LOOKBACKS } from '@shared/contract'
import { useAnalytics } from '@/api/portfolioQueries'
import { Button } from '@/components/ui/Button'
import { DataFreshness } from '@/components/ui/DataFreshness'
import { FRESHNESS } from '@shared/freshness'
import { PrivateNumber, useNumberPrivacy } from '@/components/ui/NumberPrivacy'
import { currency, decimals, integer, percent, plainPercent } from '@/lib/format'

interface MetricsTabProps {
  positions: PositionInput[]
  cashAmount: number
  currentValues: Record<string, number>
  visible: boolean
  valuationComplete: boolean
}

/** Card copy, ported verbatim from `_P4_METRICS_CARD_SPECS`. */
const CARDS: Array<{
  key: keyof RiskMetricsPayload
  title: string
  description: string
  format: (value: number) => string
  tone?: 'signed' | 'neutral'
}> = [
  {
    key: 'beta',
    title: 'Portfolio Beta',
    description: 'Shows how strongly the portfolio tends to move relative to the benchmark.',
    format: (value) => `${decimals(value, 2)}x`,
    tone: 'neutral',
  },
  {
    key: 'alpha',
    title: 'Alpha',
    description: 'Measures performance above or below what beta alone would imply.',
    format: (value) => `${percent(value, 1)} / yr`,
  },
  {
    key: 'volatility',
    title: 'Volatility',
    description: 'Annualized day-to-day return variability. Higher values mean a bumpier ride.',
    format: (value) => `${plainPercent(value, 1)} / yr`,
    tone: 'neutral',
  },
  {
    key: 'maxDrawdown',
    title: 'Max Drawdown',
    description: 'Largest peak-to-trough loss seen during the selected lookback window.',
    format: (value) => plainPercent(value, 1),
  },
  {
    key: 'sharpe',
    title: 'Sharpe Ratio',
    description: 'Excess return earned for each unit of total portfolio volatility.',
    format: (value) => decimals(value, 2),
  },
  {
    key: 'sortino',
    title: 'Sortino Ratio',
    description: 'Excess return earned for each unit of downside volatility only.',
    format: (value) => decimals(value, 2),
  },
  {
    key: 'cagr',
    title: 'CAGR',
    description: 'Smoothed annual growth rate from the start to the end of the period.',
    format: (value) => `${percent(value, 1)} / yr`,
  },
  {
    key: 'tailRisk',
    title: 'Tail Risk',
    description: 'Average return during the worst 5% of days, shown as CVaR.',
    format: (value) => `${plainPercent(value, 2)} CVaR`,
  },
  {
    key: 'skewness',
    title: 'Skewness',
    description: 'Indicates whether returns tend to have larger upside or downside surprises.',
    format: (value) => decimals(value, 2),
  },
]

export function MetricsTab({ positions, cashAmount, currentValues, visible, valuationComplete }: MetricsTabProps) {
  const maskNumbers = useNumberPrivacy()
  const [benchmark, setBenchmark] = useState('SPY')
  const [benchmarkDraft, setBenchmarkDraft] = useState('SPY')
  const [lookback, setLookback] = useState<MetricsLookback>('1y')

  const query = useAnalytics(positions, cashAmount, currentValues, benchmark, lookback, visible)
  const data = query.data?.data
  const includedHoldings = data?.includedTickers.filter(ticker => ticker !== 'CASH').length ?? 0
  const countsCash = cashAmount > 0
  const historyComplete = Boolean(data && !data.excludedTickers.length)
  const metrics = historyComplete && valuationComplete ? data?.metrics : undefined
  const exposure = valuationComplete ? data?.exposure : data?.exposure ? { ...data.exposure,
    largestPositionTicker: null, largestPositionValue: null, topPositionWeight: null, top3Weight: null,
    top5Weight: null, concentrationScore: null, effectiveHoldings: null, topPositions: [] } : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
      <section className="shrink-0 border border-border bg-surface p-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold text-text">Risk &amp; Return Analytics</h3>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-2xs text-text-muted">Benchmark</span>
            <input
              aria-label="Benchmark symbol"
              value={benchmarkDraft}
              spellCheck={false}
              onChange={(event) => setBenchmarkDraft(event.target.value)}
              onBlur={() => setBenchmark(benchmarkDraft.trim().toUpperCase() || 'SPY')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              className="h-7 w-24 border border-border-strong bg-surface-raised px-2 text-2xs text-text uppercase outline-none focus:border-accent"
            />
            <span className="text-2xs text-text-muted">Lookback</span>
            {METRICS_LOOKBACKS.map((entry) => (
              <Button
                key={entry.key}
                variant="toggle"
                active={entry.key === lookback}
                onClick={() => setLookback(entry.key)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </div>

        <p className="pt-1 text-2xs text-text-muted">
          {query.isFetching
            ? 'Loading portfolio metrics...'
            : data?.reason
              ? data.reason
              : data
                ? `${maskNumbers ? '****' : includedHoldings} included holdings${countsCash ? ' · cash included' : ''} | ${integer(data.historyPoints)} daily points | ` +
                  `${data.startDate} to ${data.endDate} | Benchmark ${data.benchmarkSymbol} | ${lookback.toUpperCase()}`
                : 'No metrics yet'}
        </p>
        {data?.note ? <p className="text-2xs text-down">{data.note}</p> : null}
        {countsCash ? <p className="text-2xs text-text-muted">Cash is a constant balance with 0% modeled return; it is included in portfolio returns and allocation weights.</p> : null}
      </section>

      <DataFreshness envelope={query.data} loading={query.isFetching} error={query.error} freshnessMs={FRESHNESS.chartDaily}
        coverage={data ? `${maskNumbers ? '****' : `${includedHoldings}/${positions.length}`} holdings in history` : undefined} />
      {(!valuationComplete || data?.excludedTickers.length) ? <p className="text-2xs text-warn">
        Portfolio metrics unavailable: {!valuationComplete ? 'market marks are incomplete.' : `history missing for ${data?.excludedTickers.join(', ')}.`}
      </p> : null}
      <div className="grid shrink-0 gap-2 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
        {CARDS.map((card) => {
          const value = metrics?.[card.key] ?? null
          const signed = card.tone !== 'neutral'
          const tone =
            value === null ? 'text-text-dim' : !signed ? 'text-accent-hover' : value >= 0 ? 'text-up' : 'text-down'
          return (
            <article key={card.key} className="border border-border bg-surface p-2">
              <h4 className="text-2xs font-semibold text-text">{card.title}</h4>
              <p className={`num py-1 text-sm font-semibold ${tone}`}>
                <PrivateNumber>{value === null ? '--' : card.format(value)}</PrivateNumber>
              </p>
              <p className="text-2xs text-text-dim">{card.description}</p>
            </article>
          )
        })}
      </div>

      <section className="shrink-0 border border-border bg-surface p-2">
        <h3 className="pb-2 text-xs font-semibold text-text">Exposure Metrics</h3>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <Group title="Coverage">
            <Row label="Holdings" value={integer(exposure?.holdingsCount)} />
            <Row label="Valued Holdings" value={integer(exposure?.valuedHoldingsCount)} />
            <Row label="Unpriced Holdings" value={integer(exposure?.unvaluedHoldingsCount)} />
            <Row label="Coverage" value={plainPercent(exposure?.coveragePct)} />
            <Row label={valuationComplete ? countsCash ? 'Included Value (with cash)' : 'Invested Value' : 'Known Invested Subtotal'} value={currency(exposure?.investedValue)} />
          </Group>

          <Group title="Concentration">
            <Row label="Largest Position" value={exposure?.largestPositionTicker ?? '--'} numeric={false} />
            <Row label="Largest Value" value={currency(exposure?.largestPositionValue)} />
            <Row label="Largest Weight" value={plainPercent(exposure?.topPositionWeight)} />
            <Row label="Top 3 Weight" value={plainPercent(exposure?.top3Weight)} />
            <Row label="Top 5 Weight" value={plainPercent(exposure?.top5Weight)} />
          </Group>

          <Group title="Diversification">
            <Row label={countsCash ? 'Effective Allocations (with cash)' : 'Effective Holdings'} value={decimals(exposure?.effectiveHoldings, 1)} />
            <Row label="HHI" value={decimals(exposure?.concentrationScore, 3)} />
          </Group>

          <Group title={countsCash ? 'Top Allocations' : 'Top Holdings'} note={countsCash ? 'Largest allocations, including cash, by current value.' : 'Largest priced positions by current market value.'}>
            {Array.from({ length: 5 }, (_, index) => {
              const position = exposure?.topPositions[index]
              return (
                <Row
                  key={index}
                  label={`${index + 1}.  ${position?.ticker ?? '--'}`}
                  value={
                    position
                      ? `${plainPercent(position.weightPct)}   ${currency(position.value)}`
                      : '--'
                  }
                />
              )
            })}
          </Group>
        </div>
      </section>
    </div>
  )
}

function Group({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <div className="border border-border bg-surface-raised p-2">
      <h4 className="text-2xs font-semibold text-text">{title}</h4>
      {note ? <p className="pb-1 text-2xs text-text-dim">{note}</p> : null}
      <dl className="flex flex-col">{children}</dl>
    </div>
  )
}

function Row({ label, value, numeric = true }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[2px]">
      <dt className="text-2xs text-text-muted">{label}</dt>
      <dd className="num text-2xs text-text">{numeric ? <PrivateNumber>{value}</PrivateNumber> : value}</dd>
    </div>
  )
}
