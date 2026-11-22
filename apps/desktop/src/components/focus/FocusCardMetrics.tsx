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
import { compactCurrency, compactNumber, currency, performancePercent, plainPercent, thousands } from '@/lib/format'

interface MetricReading {
  value: string
  period?: string
}

type MetricReadings = readonly [MetricReading | undefined, MetricReading | undefined]

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

function CachedMetrics<T>({ page, queryKey, labels, select, obscured }: {
  page: string
  queryKey: QueryKey
  labels: readonly [string, string]
  select: (data: T) => MetricReadings | undefined
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
  const readings = snapshot && snapshot.meta.freshness !== 'failed' ? select(snapshot.data) : undefined
  const period = readings?.[0]?.period === readings?.[1]?.period ? readings?.[0]?.period : undefined
  const unavailable = obscured ? 'Hidden by Obscure mode' : 'No figure available'
  return (
    <span id={`focus-metric-${page}`} className="focus-dashboard__metric-pair" data-shared-period={period ? '' : undefined}>
      {labels.map((label, index) => {
        const metric = readings?.[index]
        return (
          <span key={label} className="focus-dashboard__metric" data-focus-metric
            title={metric ? [label, metric.value, metric.period].filter(Boolean).join(' · ') : `${label} · ${unavailable}`}>
            <span className="focus-dashboard__metric-label">{label}</span>
            <b className="focus-dashboard__metric-value" aria-label={metric ? undefined : unavailable}>{metric?.value ?? '—'}</b>
            {!period && <span className="focus-dashboard__metric-period">{metric?.period}</span>}
          </span>
        )
      })}
      {period && <span className="focus-dashboard__metric-period focus-dashboard__shared-period">{period}</span>}
    </span>
  )
}

function metricPair<T>(queryKey: QueryKey, labels: readonly [string, string], select: (data: T) => MetricReadings | undefined) {
  return (page: string, obscured: boolean) => <CachedMetrics page={page} queryKey={queryKey} labels={labels} select={select} obscured={obscured} />
}

const metrics: Record<string, ReturnType<typeof metricPair> | undefined> = {
  amzn: metricPair<AmznPayload>(queryKeys.amzn, ['AWS revenue', 'Op. income'], data => {
    const report = data.earnings?.reports[0]
    return [
      reading(report?.segments.find(segment => segment.name === 'AWS')?.revenue, compactCurrency, report?.period),
      reading(report?.operatingIncome, compactCurrency, report?.period),
    ]
  }),
  anthropic: metricPair<AnthropicPayload>(queryKeys.anthropic, ['Qtr. revenue', 'Compute costs'], data => {
    const quarter = data.quarters.at(-1)
    return quarter && [
      reading(quarter.revenue * 1e9, compactCurrency, quarter.period),
      reading(quarter.compute * 1e9, compactCurrency, quarter.period),
    ]
  }),
  avgo: metricPair<AvgoPayload>(queryKeys.avgo, ['AI chip rev.', 'Qtr. revenue'], ({ earnings }) => {
    const ai = earnings?.metrics.find(item => item.id === 'aiRevenue')
    const qualifier = ai?.text === 'over' ? '> ' : ai?.text ? '≈ ' : ''
    return [
      reading(ai?.value, value => qualifier + compactCurrency(value), earnings?.period),
      reading(earnings?.metrics.find(item => item.id === 'revenue')?.value, compactCurrency, earnings?.period),
    ]
  }),
  bitcoin: metricPair<BitcoinPayload>(queryKeys.bitcoin, ['BTC spot price', '24h hash rate'], ({ stats }) => {
    const date = dated(stats?.timestamp)
    return [
      reading(stats?.market_price_usd, price => currency(price, 0), date),
      reading(stats?.hash_rate, value => `${(value / 1e9).toFixed(0)} EH/s`, date),
    ]
  }),
  bmnr: metricPair<BmnrPayload>(queryKeys.bmnr, ['ETH held', 'Filed cash'], ({ live, filed }) => [
    reading(live?.ethHeld.value, compactNumber, dated(live?.ethHeld.asOf)),
    reading(filed?.latest?.cash, compactCurrency, dated(filed?.latest?.endDate)),
  ]),
  eth: metricPair<EthPayload>(queryKeys.eth, ['Mainnet TPS', 'Median tx fee'], ({ mainnet }) => {
    const date = dated(mainnet?.asOf)
    return [
      reading(mainnet?.tps, value => `${value.toFixed(1)} TPS`, date),
      reading(mainnet?.medianTransactionFeeUsd, value => currency(value, value > 0 && value < 0.01 ? 4 : 2), date),
    ]
  }),
  gold: metricPair<GoldPayload>(queryKeys.gold, ['Gold fut. / oz', 'GLD ETF'], ({ market }) => [
    reading(market.futuresPrice.value, price => currency(price, 0), dated(market.futuresPrice.asOf)),
    reading(market.gldPrice?.value, currency, dated(market.gldPrice?.asOf)),
  ]),
  googl: metricPair<GooglPayload>(queryKeys.googl, ['Cloud revenue', 'Op. margin'], data => {
    const report = data.earnings?.reports[0]
    return [
      reading(report?.businesses.find(business => business.name === 'Google Cloud')?.revenue, compactCurrency, report?.period),
      reading(report?.operatingMargin, plainPercent, report?.period),
    ]
  }),
  hims: metricPair<HimsPayload>(queryKeys.hims, ['Subscribers', 'Qtr. revenue'], data => {
    const report = data.earnings?.reports[0]
    return [
      reading(report?.metrics.subscribers?.value, compactNumber, report?.period),
      reading(report?.metrics.revenue?.value, compactCurrency, report?.period),
    ]
  }),
  homebuilders: metricPair<HomebuildersPayload>(queryKeys.homebuilders, ['ITB ETF price', 'XHB ETF price'], ({ rows }) => {
    const price = (symbol: string) => {
      const market = rows.find(row => row.company.symbol === symbol)?.market
      return market?.changeBasis !== '24h' ? reading(market?.price, currency, dated(market?.quoteTime)) : undefined
    }
    return [price('ITB'), price('XHB')]
  }),
  hood: metricPair<HoodPayload>(queryKeys.hood, ['Net deposits', 'Funded cust.'], ({ monthly }) => [
    reading(monthly?.metrics.find(item => item.id === 'deposits')?.value, compactCurrency, monthly?.period),
    reading(monthly?.metrics.find(item => item.id === 'customers')?.value, compactNumber, monthly?.period),
  ]),
  macro: metricPair<EconomicPayload>(queryKeys.economic, ['U.S. CPI YoY', 'Real GDP SAAR'], ({ rows }) => {
    const rate = (seriesId: string) => {
      const row = rows.find(item => item.seriesId === seriesId && item.available)
      return reading(row?.latest, value => plainPercent(value, 2), dated(row?.latestDate))
    }
    return [rate('CPIAUCSL'), rate('GDPC1')]
  }),
  mu: metricPair<MuPayload>(queryKeys.mu, ['Qtr. revenue', 'Adj. gross mgn'], ({ earnings }) => [
    reading(earnings?.metrics.find(item => item.id === 'revenue')?.value, compactCurrency, earnings?.period),
    reading(earnings?.metrics.find(item => item.id === 'nonGaapGrossMargin')?.value, plainPercent, earnings?.period),
  ]),
  nvda: metricPair<NvdaPayload>(queryKeys.nvda, ['Data ctr. rev.', 'Total revenue'], ({ earnings }) => {
    const quarter = earnings?.quarters[0]
    return [
      reading(quarter?.dataCenter, compactCurrency, quarter?.period),
      reading(quarter?.revenue, compactCurrency, quarter?.period),
    ]
  }),
  oil: metricPair<OilPayload>(queryKeys.oil, ['WTI fut. / bbl', 'Brent fut. / bbl'], ({ market }) => [
    reading(market.wtiPrice.value, currency, dated(market.wtiPrice.asOf)),
    reading(market.brentPrice?.value, currency, dated(market.brentPrice?.asOf)),
  ]),
  pltr: metricPair<FundamentalsPagePayload>(queryKeys.fundamentalsPage('PLTR'), ['Qtr. revenue', 'GAAP net inc.'], data => {
    if (data.displayCurrency !== 'USD' || data.currencyVersion !== 2) return undefined
    const latest = pltrHistory(data).at(-1)
    const date = dated(latest?.endDate)
    return [
      reading(latest?.revenue, compactCurrency, date),
      reading(latest?.netIncome, compactCurrency, date),
    ]
  }),
  semiconductors: metricPair<SemiconductorsPayload>(queryKeys.semiconductors, ['Up / down', 'Avg. move'], ({ rows }) => {
    const breadth = semiconductorOverview(rows.filter(row => row.market?.changeBasis !== '24h'))
    if (!breadth.quoteCount) return undefined
    const coverage = `${breadth.quoteCount} of ${rows.length} quoted`
    return [
      { value: `${breadth.advancing} / ${breadth.declining}`, period: coverage },
      reading(breadth.daily, performancePercent, coverage),
    ]
  }),
  sofi: metricPair<SofiPayload>(queryKeys.sofi, ['Members', 'Deposits'], ({ reports }) => {
    const quarter = reports?.quarters.at(-1)
    const date = dated(quarter?.endDate)
    return [
      reading(quarter?.values.members, compactNumber, date),
      reading(quarter?.values.deposits, compactCurrency, date),
    ]
  }),
  vst: metricPair<VstPayload>(queryKeys.vst, ['Generation', 'Qtr. revenue'], ({ operations }) => [
    reading(operations?.totalGenerationGwh, value => `${thousands(value / 1_000, 1)} TWh`, operations?.period),
    reading(operations?.totalRevenue, compactCurrency, operations?.period),
  ]),
}

export function FocusCardMetrics({ page, obscured }: { page: string; obscured: boolean }) {
  return metrics[page]?.(page, obscured) ?? null
}
