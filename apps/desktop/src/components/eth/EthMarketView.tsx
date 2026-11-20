import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '@/api/client'
import { EthTrendChart } from '@/charts/EthTrendChart'
import type { EthChartDay, EthChartKind } from '@/charts/EthTrendChart'
import { ETH_DAY_MS, ETH_MARKET_SOURCE_URL, ETH_PROTOCOL_SOURCE_URL, ETH_SOURCE_URL } from '@shared/eth'
import type { EthActivityDay, EthBurnSnapshot, EthMarketDay, EthPayload, EthStakingSnapshot, EthTpsSample } from '@shared/eth'
import '@/styles/eth-market-view.css'

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const feeUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })
const supplyAxis = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 4 })
const signed = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero', maximumFractionDigits: 2 })
const signedWhole = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero', maximumFractionDigits: 0 })
const dayLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const timeLabel = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })

const compactEth = (value: number) => compact.format(value) + ' ETH'
const usdPerDay = (value: number) => compactUsd.format(value) + '/day'
const tps = (value: number) => number.format(value) + ' TPS'
const gas = (value: number) => number.format(value) + ' Mgas/s'
const eth = (value: number) => number.format(value) + ' ETH'
const format = (value: number | undefined, display: (value: number) => string) => value === undefined ? '—' : display(value)
const noMarket: EthMarketDay[] = []
const noActivity: EthActivityDay[] = []
const noTps: EthTpsSample[] = []

interface ChartData {
  market: Map<number, EthMarketDay>
  network: Map<number, EthActivityDay>
}

interface Metric {
  label: string
  caption: string
  labels: [string, string?]
  kind: EthChartKind
  format: (value: number) => string
  axis: (value: number) => string
  sample: (data: ChartData, day: number) => Omit<EthChartDay, 'day'>
}

const marketMetrics: Metric[] = [
  { label: 'Price', caption: 'Daily USD reference rate', labels: ['ETH/USD'], kind: 'area', format: usd.format, axis: usd.format,
    sample: ({ market }, day) => ({ primary: market.get(day)?.priceUsd }) },
  { label: 'Supply', caption: 'Daily ETH supply', labels: ['ETH supply'], kind: 'line', format: eth, axis: supplyAxis.format,
    sample: ({ market }, day) => ({ primary: market.get(day)?.supplyEth }) },
  { label: 'Market cap', caption: 'Daily market capitalization in USD', labels: ['Market cap'], kind: 'line',
    format: compactUsd.format, axis: compactUsd.format, sample: ({ market }, day) => ({ primary: market.get(day)?.marketCapUsd }) },
  { label: 'Issuance', caption: 'ETH issued per completed UTC day', labels: ['Issued'], kind: 'histogram', format: eth, axis: compact.format,
    sample: ({ market }, day) => ({ primary: market.get(day)?.issuanceEth }) },
]

const layerMetrics = [
  { label: 'TPS', caption: 'Transactions per second', format: tps, axis: number.format,
    values: (point: EthActivityDay) => ({ mainnet: point.mainnetTps, layer2: point.layer2Tps }) },
  { label: 'User fees', caption: 'User fees paid per day', format: usdPerDay, axis: compactUsd.format,
    values: (point: EthActivityDay) => point.feesPaidUsdPerDay },
  { label: 'Stablecoins', caption: 'Tracked stablecoin supply', format: compactUsd.format, axis: compactUsd.format,
    values: (point: EthActivityDay) => point.stablecoinSupplyUsd },
  { label: 'Gas used', caption: 'Gas units processed per second', format: gas, axis: number.format,
    values: (point: EthActivityDay) => point.gasThroughputMgasPerSecond },
]
const networkMetrics: Metric[] = [
  ...layerMetrics.map((metric): Metric => ({
    ...metric, caption: metric.caption + ' · 7-day average', labels: ['Mainnet', 'Tracked L2s'], kind: 'line',
    sample: ({ network }, day) => {
      const point = network.get(day)
      const pair = point && metric.values(point)
      return { primary: pair?.mainnet, secondary: pair?.layer2 }
    },
  })),
  { label: 'L2 settlement', caption: 'Fees paid to Mainnet for settlement and data · 7-day average',
    labels: ['Paid to Mainnet'], kind: 'line', format: usdPerDay, axis: compactUsd.format,
    sample: ({ network }, day) => ({ primary: network.get(day)?.layer2SettlementUsdPerDay }) },
  { label: 'Active addresses', caption: 'Active Mainnet addresses per completed UTC day', labels: ['Mainnet'],
    kind: 'histogram', format: whole.format, axis: compact.format,
    sample: ({ market }, day) => ({ primary: market.get(day)?.activeAddresses }) },
]

const sources = [
  { label: 'growthepie', url: ETH_SOURCE_URL },
  { label: 'Coin Metrics', url: ETH_MARKET_SOURCE_URL },
  { label: 'ultrasound.money', url: ETH_PROTOCOL_SOURCE_URL },
  { label: 'TradingView charts', url: 'https://www.tradingview.com/lightweight-charts/' },
]

function Observation({ stamp, daily = false, now }: { stamp: number; daily?: boolean; now: number }) {
  return <time dateTime={new Date(stamp).toISOString()} title={dayLabel.format(stamp) + ' · ' + timeLabel.format(stamp) + ' UTC'}>
    {daily || now - stamp >= ETH_DAY_MS ? dayLabel.format(stamp) : timeLabel.format(stamp)} UTC
  </time>
}

function Stat({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return <div className="eth-market-view-stat"><dt>{label}{children && <small>{children}</small>}</dt><dd className="num">{value}</dd></div>
}

function MarketHeader({ market, range, onRange, now, viewControls }: {
  market: EthMarketDay[]; range: number; onRange: (range: number) => void; now: number; viewControls: ReactNode
}) {
  const latest = market.at(-1)
  function change(days: number) {
    if (!latest) return
    const baseline = market.find(point => point.day === latest.day - days * ETH_DAY_MS)
    if (baseline) return (latest.priceUsd / baseline.priceUsd - 1) * 100
  }
  return <header className="eth-market-view-market">
    <div className="eth-market-view-market-title">
      <h1>Ethereum <span>ETH</span></h1>
      {latest && <Observation stamp={latest.day} now={now} daily />}
    </div>
    <dl className="eth-market-view-market-stats">
      <Stat label="Reference price" value={format(latest?.priceUsd, usd.format)} />
      <Stat label="Market cap" value={format(latest?.marketCapUsd, compactUsd.format)} />
      {[1, 7, 30, 90].map(days => {
        const value = change(days)
        const tone = !value ? undefined : value > 0 ? 'eth-market-view-positive' : 'eth-market-view-negative'
        return <div className="eth-market-view-stat" key={days}>
          <dt>{days}D return</dt><dd className={tone ? 'num ' + tone : 'num'}>{format(value, n => signed.format(n) + '%')}</dd>
        </div>
      })}
    </dl>
    <div className="eth-market-view-header-controls">
      {viewControls}
      <div className="eth-market-view-choice" role="group" aria-label="Range for both charts">
        {[7, 30, 90].map(days => <button key={days} type="button" aria-pressed={range === days} onClick={() => onRange(days)}>{days}D</button>)}
      </div>
    </div>
  </header>
}

function TrendPanel({ id, title, metrics, data, dates, loading }: {
  id: string; title: string; metrics: Metric[]; data: ChartData; dates: number[]; loading: boolean
}) {
  const [metric, setMetric] = useState(metrics[0])
  const [inspectedDay, setInspectedDay] = useState<number>()
  const days = useMemo(() => dates.map(day => ({ day, ...metric.sample(data, day) })), [dates, data, metric])
  const latest = days.findLastIndex(day => day.primary !== undefined || day.secondary !== undefined)
  const inspected = inspectedDay === undefined ? -1 : dates.indexOf(inspectedDay)
  const selected = inspected >= 0 ? inspected : latest
  const point = days[selected]
  const readings = metric.labels.flatMap((label, index) => label
    ? [{ label, value: format(index === 0 ? point?.primary : point?.secondary, metric.format), secondary: index === 1 }] : [])

  return <section className="eth-market-view-history" aria-labelledby={id}>
    <div className="eth-market-view-history-heading">
      <h2 id={id}>{title}</h2>
      <div className="eth-market-view-choice eth-market-view-metrics" role="group" aria-label={title + ' metric'}>
        {metrics.map(option => <button key={option.label} type="button" aria-pressed={metric === option}
          onClick={() => { setMetric(option); setInspectedDay(undefined) }}>{option.label}</button>)}
      </div>
    </div>
    <div className="eth-market-view-chart-readout">
      <span className="eth-market-view-chart-caption">{metric.caption}</span>
      {readings.map(({ label, value, secondary }) => <div key={label}>
        <i className={secondary ? 'eth-market-view-secondary' : undefined} aria-hidden="true" />
        <span>{label}</span><strong className="num">{value}</strong>
      </div>)}
      {point && <time dateTime={new Date(point.day).toISOString().slice(0, 10)}>{dayLabel.format(point.day)} UTC</time>}
    </div>
    <div className="eth-market-view-plot">
      {latest >= 0 ? <EthTrendChart title={title + ' ' + metric.label} kind={metric.kind} days={days}
        paired={Boolean(metric.labels[1])} axis={metric.axis} selected={selected}
        valueText={[dayLabel.format(point.day) + ' UTC', ...readings.map(({ label, value }) => label + ' ' + (value === '—' ? 'unavailable' : value))].join(', ')}
        onInspect={setInspectedDay} />
        : <p className="eth-market-view-empty">{loading ? 'Loading history…' : 'History unavailable'}</p>}
    </div>
  </section>
}

function SupplyLedger({ market, staking, burn, now }: {
  market: EthMarketDay[]; staking?: EthStakingSnapshot; burn?: EthBurnSnapshot; now: number
}) {
  const latest = market.at(-1)
  const baseline = latest && market.find(day => day.day === latest.day - 30 * ETH_DAY_MS)
  const net = latest && baseline ? latest.supplyEth - baseline.supplyEth : undefined
  const week = latest ? Array.from({ length: 7 }, (_, i) => market.find(day => day.day === latest.day - i * ETH_DAY_MS)?.issuanceEth) : []
  const issuance = week.length === 7 && week.every(value => value !== undefined) ? week.reduce((sum, value) => sum + value, 0) : undefined
  const share = staking ? 100 * staking.validatorBalanceEth / staking.supplyEth : undefined
  return <section className="eth-market-view-ledger" aria-labelledby="eth-market-view-supply-heading">
    <div className="eth-market-view-ledger-heading"><h2 id="eth-market-view-supply-heading">Supply &amp; staking</h2>
      {latest && <Observation stamp={latest.day} now={now} daily />}</div>
    <dl>
      <Stat label={latest || !staking ? 'ETH supply' : 'ETH supply at Beacon snapshot'} value={format(latest?.supplyEth ?? staking?.supplyEth, compactEth)} />
      <Stat label="Net supply change · 30D" value={format(net, value => signedWhole.format(value) + ' ETH')}>
        {net !== undefined && baseline && signed.format(100 * net / baseline.supplyEth) + '%'}
      </Stat>
      <Stat label="Issuance · 7 UTC days" value={format(issuance, value => whole.format(value) + ' ETH')} />
      <Stat label="Fee burn · rolling 7D" value={format(burn?.sevenDayEth, eth)}>
        {burn && <Observation stamp={burn.asOf} now={now} />}
      </Stat>
      <Stat label="Beacon validator balances" value={format(staking?.validatorBalanceEth, compactEth)}>
        {staking && <Observation stamp={staking.asOf} now={now} />}
      </Stat>
      <div className="eth-market-view-stat eth-market-view-share">
        <dt>Share of ETH in validator balances</dt><dd className="num">{format(share, value => number.format(value) + '%')}</dd>
        {share !== undefined && <dd className="eth-market-view-meter" aria-hidden="true"><span style={{ width: share + '%' }} /></dd>}
      </div>
    </dl>
  </section>
}

function LayerComparison({ daily, now }: { daily: EthActivityDay[]; now: number }) {
  const latest = daily.at(-1)
  const settlement = daily.findLast(day => day.layer2SettlementUsdPerDay !== undefined)
  const total = latest ? latest.mainnetTps + latest.layer2Tps : 0
  return <section className="eth-market-view-ledger" aria-labelledby="eth-market-view-layers-heading">
    <div className="eth-market-view-ledger-heading"><h2 id="eth-market-view-layers-heading">Mainnet vs. L2s</h2><span>7-day average</span></div>
    <table className="eth-market-view-layers">
      <thead><tr>
        <th scope="col">{latest && <Observation stamp={latest.day} now={now} daily />}</th>
        <th scope="col">Mainnet</th><th scope="col">Tracked L2s</th>
      </tr></thead>
      <tbody>
        {layerMetrics.map(metric => {
          const values = latest && metric.values(latest)
          return <tr key={metric.label}>
            <th scope="row">{metric.label}</th>
            <td className="num">{format(values?.mainnet, metric.format)}</td>
            <td className="num">{format(values?.layer2, metric.format)}</td>
          </tr>
        })}
      </tbody>
    </table>
    <dl>
      <Stat label="L2 share of tracked TPS" value={format(latest && total > 0 ? 100 * latest.layer2Tps / total : undefined, value => number.format(value) + '%')} />
      <Stat label="L2 settlement to Mainnet" value={format(settlement?.layer2SettlementUsdPerDay, usdPerDay)}>
        {settlement && settlement.day !== latest?.day && <Observation stamp={settlement.day} now={now} daily />}
      </Stat>
    </dl>
  </section>
}

function NetworkSnapshot({ payload, market, now }: { payload?: EthPayload; market: EthMarketDay[]; now: number }) {
  const mainnet = payload?.mainnet
  const ecosystem = payload?.ecosystem.at(-1)
  const active = market.findLast(day => day.activeAddresses !== undefined)
  return <section className="eth-market-view-ledger" aria-labelledby="eth-market-view-network-heading">
    <div className="eth-market-view-ledger-heading"><h2 id="eth-market-view-network-heading">Network snapshot</h2></div>
    <dl>
      <Stat label="Ecosystem TPS" value={format(ecosystem?.tps, tps)}>
        {ecosystem && <Observation stamp={ecosystem.asOf} now={now} />}
      </Stat>
      <Stat label="Mainnet TPS" value={format(mainnet?.tps, tps)}>
        {mainnet && <Observation stamp={mainnet.asOf} now={now} />}
      </Stat>
      <Stat label="Mainnet median tx fee" value={format(mainnet?.medianTransactionFeeUsd, feeUsd.format)} />
      <Stat label="Mainnet block interval" value={format(mainnet?.blockTimeSeconds, value => number.format(value) + ' s')} />
      <Stat label="Active Mainnet addresses" value={format(active?.activeAddresses, whole.format)}>
        {active && <Observation stamp={active.day} now={now} daily />}
      </Stat>
    </dl>
  </section>
}

function EcosystemPulse({ samples, now }: { samples: EthTpsSample[]; now: number }) {
  const [inspected, setInspected] = useState<number>()
  const days = useMemo(() => samples.map(({ asOf, tps }) => ({ day: asOf, primary: tps })), [samples])
  const index = days.findIndex(point => point.day === inspected)
  const selected = index >= 0 ? index : days.length - 1
  const point = days[selected]
  return <section className="eth-market-view-ledger eth-market-view-pulse" aria-labelledby="eth-market-view-pulse-heading">
    <div className="eth-market-view-ledger-heading">
      <h2 id="eth-market-view-pulse-heading">Recent ecosystem TPS</h2>
      {point && <div className="eth-market-view-pulse-readout"><strong className="num">{tps(point.primary)}</strong>
        <Observation stamp={point.day} now={now} /></div>}
    </div>
    <div className="eth-market-view-plot">
      {point ? <EthTrendChart title="Recent ecosystem TPS" kind="line" days={days} paired={false}
        axis={number.format} selected={selected} valueText={timeLabel.format(point.day) + ' UTC, ' + tps(point.primary)}
        intraday onInspect={setInspected} /> : <p className="eth-market-view-empty">Recent samples unavailable</p>}
    </div>
  </section>
}

function SourceLinks() {
  const [linkError, setLinkError] = useState('')
  return <div className="eth-market-view-sources" aria-label="Ethereum data and chart sources">
    {sources.map(({ label, url }) => <button key={url} type="button" onClick={async () => {
      setLinkError('')
      try { await api.openExternal(url) } catch { setLinkError('Could not open ' + label + '.') }
    }}>{label} ↗</button>)}
    {linkError && <span role="status">{linkError}</span>}
  </div>
}

export function EthMarketView({ payload, loading, viewControls }: {
  payload?: EthPayload; loading: boolean; viewControls: ReactNode
}) {
  const [range, setRange] = useState(90)
  const market = payload?.market ?? noMarket
  const daily = payload?.daily ?? noActivity
  const chartData = useMemo(() => ({
    market: new Map(market.map(point => [point.day, point])),
    network: new Map(daily.map(point => [point.day, point])),
  }), [market, daily])
  const latest = Math.max(market.at(-1)?.day ?? 0, daily.at(-1)?.day ?? 0)
  const dates = useMemo(() => latest ? Array.from({ length: range }, (_, i) => latest - (range - 1 - i) * ETH_DAY_MS) : [], [latest, range])
  const now = Date.now()
  return <div className="eth-market-view-page">
    <MarketHeader market={market} range={range} onRange={setRange} now={now} viewControls={viewControls} />
    <div className="eth-market-view-board">
      <div className="eth-market-view-charts">
        <TrendPanel id="eth-market-view-market-heading" title="ETH market" metrics={marketMetrics} data={chartData} dates={dates} loading={loading} />
        <TrendPanel id="eth-market-view-network-history-heading" title="Network activity" metrics={networkMetrics} data={chartData} dates={dates} loading={loading} />
      </div>
      <aside className="eth-market-view-rail" aria-label="Ethereum metrics">
        <SupplyLedger market={market} staking={payload?.staking} burn={payload?.burn} now={now} />
        <LayerComparison daily={daily} now={now} />
        <NetworkSnapshot payload={payload} market={market} now={now} />
        <EcosystemPulse samples={payload?.ecosystem ?? noTps} now={now} />
      </aside>
    </div>
    <SourceLinks />
  </div>
}
