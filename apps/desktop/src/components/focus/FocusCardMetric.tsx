import { useCallback, useSyncExternalStore } from 'react'
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query'

import type { AmznPayload } from '@shared/amzn'
import type { AnthropicPayload } from '@shared/anthropic'
import type { AvgoPayload } from '@shared/avgo'
import type { BitcoinPayload } from '@shared/bitcoin'
import type { BmnrPayload, EconomicPayload, Envelope, FundamentalsPagePayload, GoldPayload, OilPayload } from '@shared/contract'
import type { EthPayload } from '@shared/eth'
import type { GooglPayload } from '@shared/googl'
import type { HimsPayload } from '@shared/hims'
import type { HomebuildersPayload } from '@shared/homebuilders'
import type { HoodPayload } from '@shared/hood'
import type { MuPayload } from '@shared/mu'
import type { NvdaPayload } from '@shared/nvda'
import { pltrHistory } from '@shared/pltr'
import { semiconductorOverview, type SemiconductorsPayload } from '@shared/semiconductors'
import type { SofiPayload } from '@shared/sofi'
import type { VstPayload } from '@shared/vst'
import { queryKeys } from '@/api/client'
import { compactCurrency, compactNumber, currency, plainPercent, thousands } from '@/lib/format'

interface MetricReading {
  value: string
  period?: string
}

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function dated(observed: string | number | null | undefined) {
  if (!observed) return undefined
  const date = new Date(typeof observed === 'string' && /^\d{4}-\d{2}-\d{2}/.test(observed) ? observed.slice(0, 10) : observed)
  return Number.isFinite(date.getTime()) ? shortDate.format(date) : undefined
}

function reading(
  value: number | null | undefined,
  format: (value: number) => string,
  period?: string,
): MetricReading | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? { value: format(value), period } : undefined
}

function CachedMetric<T>({ page, queryKey, label, select, obscured }: {
  page: string
  queryKey: QueryKey
  label: string
  select: (data: T) => MetricReading | undefined
  obscured: boolean
}) {
  const client = useQueryClient()
  const queryHash = hashKey(queryKey)
  // Listen to the existing startup cache without a query observer that could fetch or pin a payload.
  const subscribe = useCallback((onChange: () => void) => {
    if (obscured) return () => {}
    return client.getQueryCache().subscribe(event => {
      if (event.query.queryHash === queryHash) onChange()
    })
  }, [client, obscured, queryHash])
  const getSnapshot = useCallback(
    () => obscured ? undefined : client.getQueryData<Envelope<T>>(queryKey),
    [client, obscured, queryKey],
  )
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const metric = snapshot && snapshot.meta.freshness !== 'failed' ? select(snapshot.data) : undefined
  const unavailable = obscured ? 'Hidden by Obscure mode' : 'No figure available'
  return (
    <span id={`focus-metric-${page}`} className="focus-dashboard__metric" data-focus-metric
      title={metric ? [label, metric.value, metric.period].filter(Boolean).join(' · ') : `${label} · ${unavailable}`}>
      <span className="focus-dashboard__metric-label">{label}</span>
      <b className="focus-dashboard__metric-value" aria-label={metric ? undefined : unavailable}>{metric?.value ?? '—'}</b>
      <span className="focus-dashboard__metric-period">{metric?.period}</span>
    </span>
  )
}

function metric<T>(queryKey: QueryKey, label: string, select: (data: T) => MetricReading | undefined) {
  return (page: string, obscured: boolean) => <CachedMetric page={page} queryKey={queryKey} label={label} select={select} obscured={obscured} />
}

const metrics: Record<string, ReturnType<typeof metric> | undefined> = {
  amzn: metric<AmznPayload>(queryKeys.amzn, 'AWS revenue', data => {
    const report = data.earnings?.reports[0]
    return reading(report?.segments.find(segment => segment.name === 'AWS')?.revenue, compactCurrency, report?.period)
  }),
  anthropic: metric<AnthropicPayload>(queryKeys.anthropic, 'Quarterly revenue', data => {
    const quarter = data.quarters.at(-1)
    return quarter && reading(quarter.revenue * 1e9, compactCurrency, quarter.period)
  }),
  avgo: metric<AvgoPayload>(queryKeys.avgo, 'AI chip revenue', ({ earnings }) => {
    const ai = earnings?.metrics.find(item => item.id === 'aiRevenue')
    const qualifier = ai?.text === 'over' ? '> ' : ai?.text ? '≈ ' : ''
    return reading(ai?.value, value => qualifier + compactCurrency(value), earnings?.period)
  }),
  bitcoin: metric<BitcoinPayload>(queryKeys.bitcoin, 'BTC spot reference', ({ stats }) =>
    reading(stats?.market_price_usd, price => currency(price, 0), dated(stats?.timestamp))),
  bmnr: metric<BmnrPayload>(queryKeys.bmnr, 'ETH held', ({ live }) =>
    reading(live?.ethHeld.value, compactNumber, dated(live?.ethHeld.asOf))),
  eth: metric<EthPayload>(queryKeys.eth, 'Mainnet throughput', ({ mainnet }) =>
    reading(mainnet?.tps, value => `${value.toFixed(1)} TPS`, dated(mainnet?.asOf))),
  gold: metric<GoldPayload>(queryKeys.gold, 'Gold futures / oz', ({ market }) =>
    reading(market.futuresPrice.value, price => currency(price, 0), dated(market.futuresPrice.asOf))),
  googl: metric<GooglPayload>(queryKeys.googl, 'Cloud revenue', data => {
    const report = data.earnings?.reports[0]
    return reading(report?.businesses.find(business => business.name === 'Google Cloud')?.revenue, compactCurrency, report?.period)
  }),
  hims: metric<HimsPayload>(queryKeys.hims, 'Subscribers', data => {
    const report = data.earnings?.reports[0]
    return reading(report?.metrics.subscribers?.value, compactNumber, report?.period)
  }),
  homebuilders: metric<HomebuildersPayload>(queryKeys.homebuilders, 'ITB ETF price', ({ rows }) => {
    const market = rows.find(row => row.company.symbol === 'ITB')?.market
    return market?.changeBasis !== '24h' ? reading(market?.price, currency, dated(market?.quoteTime)) : undefined
  }),
  hood: metric<HoodPayload>(queryKeys.hood, 'Monthly net deposits', ({ monthly }) =>
    reading(monthly?.metrics.find(item => item.id === 'deposits')?.value, compactCurrency, monthly?.period)),
  macro: metric<EconomicPayload>(queryKeys.economic, 'U.S. CPI YoY', ({ rows }) => {
    const cpi = rows.find(row => row.seriesId === 'CPIAUCSL' && row.available)
    return reading(cpi?.latest, value => plainPercent(value, 2), dated(cpi?.latestDate))
  }),
  mu: metric<MuPayload>(queryKeys.mu, 'Quarterly revenue', ({ earnings }) =>
    reading(earnings?.metrics.find(item => item.id === 'revenue')?.value, compactCurrency, earnings?.period)),
  nvda: metric<NvdaPayload>(queryKeys.nvda, 'Data center revenue', ({ earnings }) => {
    const quarter = earnings?.quarters[0]
    return reading(quarter?.dataCenter, compactCurrency, quarter?.period)
  }),
  oil: metric<OilPayload>(queryKeys.oil, 'WTI futures / bbl', ({ market }) =>
    reading(market.wtiPrice.value, currency, dated(market.wtiPrice.asOf))),
  pltr: metric<FundamentalsPagePayload>(queryKeys.fundamentalsPage('PLTR'), 'Quarterly revenue', data => {
    if (data.displayCurrency !== 'USD' || data.currencyVersion !== 2) return undefined
    const latest = pltrHistory(data).at(-1)
    return reading(latest?.revenue, compactCurrency, dated(latest?.endDate))
  }),
  semiconductors: metric<SemiconductorsPayload>(queryKeys.semiconductors, 'Stock session breadth', ({ rows }) => {
    const breadth = semiconductorOverview(rows.filter(row => row.market?.changeBasis !== '24h'))
    return breadth.quoteCount ? {
      value: `${breadth.advancing} up / ${breadth.declining} down`,
      period: `${breadth.quoteCount} of ${rows.length} quoted`,
    } : undefined
  }),
  sofi: metric<SofiPayload>(queryKeys.sofi, 'Members', ({ reports }) => {
    const quarter = reports?.quarters.at(-1)
    return reading(quarter?.values.members, compactNumber, dated(quarter?.endDate))
  }),
  vst: metric<VstPayload>(queryKeys.vst, 'Power generation', ({ operations }) =>
    reading(operations?.totalGenerationGwh, value => `${thousands(value / 1_000, 1)} TWh`, operations?.period)),
}

export function FocusCardMetric({ page, obscured }: { page: string; obscured: boolean }) {
  return metrics[page]?.(page, obscured) ?? null
}
