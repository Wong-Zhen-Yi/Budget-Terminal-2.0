import { useEffect, useState } from 'react'
import { api, queryKeys } from '@/api/client'
import { useQuery } from '@/api/progressiveQuery'
import { forcing } from '@/api/queries'
import { queryFreshness } from '@/api/queryPersistence'
import { useSnapshotClock } from '@/api/snapshotHealth'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { ETH_DAY_MS, ETH_LIVE_MAX_AGE_MS, ETH_SOURCE_URL, type EthActivityDay, type EthLayerValues, type EthTpsSample } from '@shared/eth'
import '@/styles/eth.css'

const tps = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const gasRate = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })
const feeUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
const dayLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const timeLabel = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })

const metrics = [
  { label: 'TPS', unit: 'TPS', heading: 'Transactions per second', format: tps.format,
    values: (point: EthActivityDay) => ({ mainnet: point.mainnetTps, layer2: point.layer2Tps }), stacked: true },
  { label: 'Gas throughput', unit: 'Mgas/s', heading: 'Millions of gas units processed per second', format: gasRate.format,
    values: (point: EthActivityDay) => point.gasThroughputMgasPerSecond, stacked: true },
  { label: 'Fees paid', unit: 'USD/day', heading: 'Network fees paid by users per day', format: compactUsd.format,
    values: (point: EthActivityDay) => point.feesPaidUsdPerDay, stacked: true },
  { label: 'Stablecoin supply', unit: 'USD', heading: 'Value of tracked stablecoins by layer', format: compactUsd.format,
    values: (point: EthActivityDay) => point.stablecoinSupplyUsd, stacked: false },
]

function Rate({ sample, now }: { sample?: EthTpsSample | null; now: number }) {
  const saved = sample && now - sample.asOf > ETH_LIVE_MAX_AGE_MS
  return <>
    <div className="eth-rate"><strong className="num">{sample ? tps.format(sample.tps) : '—'}</strong><span>TPS</span></div>
    <p className={saved ? 'eth-saved' : undefined}>
      {sample ? <><time dateTime={new Date(sample.asOf).toISOString()} title={dayLabel.format(sample.asOf)}>{timeLabel.format(sample.asOf)} UTC</time>{saved && ' · Last observed'}</> : 'No recent reading'}
    </p>
  </>
}

function RecentSamples({ samples }: { samples: EthTpsSample[] }) {
  const top = Math.max(1, ...samples.map(sample => sample.tps))
  return <figure className="eth-pulse" aria-label="Recent Ethereum ecosystem TPS samples">
    <figcaption>Recent ecosystem samples</figcaption>
    {samples.length ? <>
      <div className="eth-pulse-bars" aria-hidden="true">
        {samples.map(sample => <span key={sample.asOf} style={{ height: `${100 * sample.tps / top}%` }}
          title={`${timeLabel.format(sample.asOf)} UTC · ${tps.format(sample.tps)} TPS`} />)}
      </div>
      <div className="eth-axis"><span>{timeLabel.format(samples[0].asOf)}</span><span>{timeLabel.format(samples.at(-1)!.asOf)} UTC</span></div>
    </> : <p className="eth-empty">Recent samples unavailable</p>}
  </figure>
}

function ActivityHistory({ history, loading }: { history: EthActivityDay[]; loading: boolean }) {
  const [range, setRange] = useState(30)
  const [chosenDay, setChosenDay] = useState<number>()
  const [metric, setMetric] = useState(metrics[0])
  const days = new Map<number, EthLayerValues>()
  for (const point of history) {
    const values = metric.values(point)
    if (values) days.set(point.day, values)
  }
  const newest = [...days.keys()].at(-1)
  const dates = newest === undefined ? [] : Array.from({ length: range }, (_, i) => newest - (range - i - 1) * ETH_DAY_MS)
  const selected = chosenDay !== undefined && dates.includes(chosenDay) ? chosenDay : newest
  const point = selected === undefined ? undefined : days.get(selected)
  const peak = Math.max(1, ...dates.map(day => {
    const value = days.get(day)
    return value ? metric.stacked ? value.mainnet + value.layer2 : Math.max(value.mainnet, value.layer2) : 0
  }))
  const step = 10 ** Math.floor(Math.log10(peak)) / 2
  const top = Math.ceil(peak / (2 * step)) * 2 * step
  const total = point ? point.mainnet + point.layer2 : 0
  const share = point && total > 0 && metric.stacked ? 100 * point.layer2 / total : null

  return <section className="eth-history" aria-labelledby="eth-history-heading">
    <div className="eth-history-heading">
      <div><h2 id="eth-history-heading">Mainnet vs. Layer 2</h2><p>{metric.heading} · trailing 7-day average</p></div>
      <div className="eth-ranges eth-metrics" role="group" aria-label="Historical metric">
        {metrics.map(option => <button key={option.label} type="button" aria-pressed={metric === option} onClick={() => setMetric(option)}>{option.label}</button>)}
      </div>
      <div className="eth-ranges" role="group" aria-label="Activity history range">
        {[30, 90].map(days => <button key={days} type="button" aria-pressed={range === days} onClick={() => setRange(days)}>{days}D</button>)}
      </div>
    </div>
    {selected === undefined ? <p className="eth-empty">{loading ? 'Loading activity history…' : 'Activity history unavailable'}</p> : <div className="eth-history-body">
      <div className="eth-trend">
        <div className="eth-plot">
          <div className="eth-y-axis num" aria-hidden="true"><span>{metric.format(top)}</span><span>{metric.format(top / 2)}</span><span>0</span></div>
          <div className="eth-columns">
            {dates.map(day => {
              const value = days.get(day)
              const title = value ? `${shortDay.format(day)} · Mainnet ${metric.format(value.mainnet)} · L2s ${metric.format(value.layer2)} ${metric.unit}` : `${shortDay.format(day)} · No data`
              return <button key={day} type="button" tabIndex={-1} aria-hidden="true" title={title}
                className={`eth-column${day === selected ? ' eth-selected' : ''}${metric.stacked ? '' : ' eth-grouped'}`} onClick={() => setChosenDay(day)}>
                {value && <><span className="eth-l1" style={{ height: `${100 * value.mainnet / top}%` }} /><span className="eth-l2" style={{ height: `${100 * value.layer2 / top}%` }} /></>}
              </button>
            })}
          </div>
        </div>
        <div className="eth-axis eth-history-axis"><span>{shortDay.format(dates[0])}</span><span>{shortDay.format(newest!)}</span></div>
        <input className="eth-date-slider" type="range" aria-label="Inspect activity by date" aria-valuetext={dayLabel.format(selected)}
          min={0} max={dates.length - 1} value={dates.indexOf(selected)} onChange={event => setChosenDay(dates[Number(event.target.value)])} />
      </div>
      <aside className="eth-breakdown" aria-label="Selected day activity" aria-live="polite">
        <time dateTime={new Date(selected).toISOString().slice(0, 10)}>{dayLabel.format(selected)} UTC</time>
        {point ? <>
          {metric.stacked && <div className="eth-rate"><strong className="num">{metric.format(total)}</strong><span>{metric.unit} combined</span></div>}
          {share !== null && <div className="eth-share" aria-hidden="true">
            <span className="eth-l1" style={{ width: `${100 - share}%` }} /><span className="eth-l2" style={{ width: `${share}%` }} />
          </div>}
          <dl>
            <div><dt><i className="eth-l1" />Mainnet</dt><dd className="num">{metric.format(point.mainnet)} {metric.unit}</dd></div>
            <div><dt><i className="eth-l2" />Tracked L2s</dt><dd className="num">{metric.format(point.layer2)} {metric.unit}</dd></div>
          </dl>
          {share !== null && <p>{tps.format(share)}% of the total on tracked L2s</p>}
        </> : <p>No activity data for this date</p>}
      </aside>
    </div>}
  </section>
}

export function EthPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const { data, error, isFetching, isPending } = useQuery({
    queryKey: queryKeys.eth,
    queryFn: () => api.eth({ force: forcing() }),
    staleTime: queryFreshness(queryKeys.eth),
    refetchOnMount: false,
  })
  const now = useSnapshotClock()
  const [linkError, setLinkError] = useState(false)
  useEffect(() => onStatusChange([{ label: 'Ethereum', envelope: data, error, loading: isFetching }], ''),
    [data, error, isFetching, onStatusChange])
  const ecosystem = data?.data.ecosystem ?? []
  const mainnet = data?.data.mainnet
  const loading = isPending && !error
  return <div className="eth-page">
    <header className="eth-header">
      <h1>Ethereum network activity</h1>
      <button type="button" onClick={async () => {
        setLinkError(false)
        try { await api.openExternal(ETH_SOURCE_URL) } catch { setLinkError(true) }
      }}>Data by growthepie ↗</button>
      {linkError && <span role="status">Could not open growthepie.</span>}
    </header>
    <section className="eth-live" aria-label="Latest transactions per second">
      <div className="eth-live-primary">
        <h2>Ecosystem TPS</h2>
        <p>Mainnet + tracked Layer 2s</p>
        <Rate sample={ecosystem.at(-1)} now={now} />
      </div>
      <RecentSamples samples={ecosystem} />
      <div className="eth-live-mainnet">
        <h2>Mainnet TPS</h2>
        <p>Ethereum Layer 1</p>
        <Rate sample={mainnet} now={now} />
        <dl className="eth-mainnet-metrics">
          <div><dt>Block interval</dt><dd className="num">{mainnet?.blockTimeSeconds == null ? '—' : `${tps.format(mainnet.blockTimeSeconds)} s`}</dd></div>
          <div><dt>Median tx fee</dt><dd className="num">{mainnet?.medianTransactionFeeUsd == null ? '—' : feeUsd.format(mainnet.medianTransactionFeeUsd)}</dd></div>
        </dl>
      </div>
    </section>
    <ActivityHistory history={data?.data.daily ?? []} loading={loading} />
  </div>
}
