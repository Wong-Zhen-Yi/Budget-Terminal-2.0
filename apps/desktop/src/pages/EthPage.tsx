import { useEffect, useRef, useState } from 'react'
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
  { id: 'tps', label: 'Transactions per second', unit: 'TPS', format: tps.format,
    values: (point: EthActivityDay) => ({ mainnet: point.mainnetTps, layer2: point.layer2Tps }), stacked: true },
  { id: 'gas', label: 'Gas throughput', unit: 'Mgas/s', format: gasRate.format,
    values: (point: EthActivityDay) => point.gasThroughputMgasPerSecond, stacked: true },
  { id: 'fees', label: 'Fees paid', unit: 'USD/day', format: compactUsd.format,
    values: (point: EthActivityDay) => point.feesPaidUsdPerDay, stacked: true },
  { id: 'stablecoins', label: 'Stablecoin supply', unit: 'USD', format: compactUsd.format,
    values: (point: EthActivityDay) => point.stablecoinSupplyUsd, stacked: false },
]
type Metric = typeof metrics[number]

function layerValues(metric: Metric, point?: EthActivityDay): EthLayerValues | undefined {
  const value = point && metric.values(point)
  return value && Number.isFinite(value.mainnet) && value.mainnet >= 0 && Number.isFinite(value.layer2) && value.layer2 >= 0 ? value : undefined
}

function layerShare(value?: EthLayerValues): number | undefined {
  return value && value.mainnet + value.layer2 > 0 ? 100 * value.layer2 / (value.mainnet + value.layer2) : undefined
}

function LayerLegend() {
  return <div className="eth-legend"><span><i className="eth-l1" />Mainnet</span><span><i className="eth-l2" />Tracked Layer 2s</span></div>
}

function ShareBar({ share }: { share: number }) {
  return <div className="eth-share" aria-hidden="true"><span className="eth-l1" style={{ width: `${100 - share}%` }} /><span className="eth-l2" style={{ width: `${share}%` }} /></div>
}

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

function ActivityPlot({ metric, dates, history, selected, onSelect }: {
  metric: Metric; dates: number[]; history: Map<number, EthActivityDay>; selected?: number; onSelect: (day: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 600, height: 180 })
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const values = dates.map(day => layerValues(metric, history.get(day)))
  const available = values.some(value => value !== undefined)
  const peak = Math.max(1, ...values.flatMap(value => value ? [metric.stacked ? value.mainnet + value.layer2 : Math.max(value.mainnet, value.layer2)] : []))
  const step = 10 ** Math.floor(Math.log10(peak)) / 2
  const top = Math.ceil(peak / (2 * step)) * 2 * step
  const pad = { left: metric.unit.startsWith('USD') ? 67 : 48, right: 12, top: 12, bottom: 25 }
  const width = Math.max(1, size.width - pad.left - pad.right)
  const height = Math.max(1, size.height - pad.top - pad.bottom)
  const x = (i: number) => pad.left + width * i / Math.max(1, dates.length - 1)
  const y = (v: number) => pad.top + height * (1 - v / top)
  const selectedIndex = selected === undefined ? -1 : dates.indexOf(selected)
  // An absent UTC observation creates a gap, never a zero or a connecting line.
  const segments: Array<Array<{ index: number; value: EthLayerValues }>> = []
  values.forEach((value, index) => {
    if (!value) return
    if (!index || !values[index - 1]) segments.push([])
    segments.at(-1)!.push({ index, value })
  })
  const ticks = [...new Set([0, Math.round((dates.length - 1) / 3), Math.round(2 * (dates.length - 1) / 3), dates.length - 1])]
  const selectedValue = values[selectedIndex]
  return <div className="eth-plot" ref={container}>
    {!available ? <p className="eth-empty">No {metric.label.toLowerCase()} observations in this range</p> : <svg viewBox={`0 0 ${size.width} ${size.height}`}
      role="group" tabIndex={0} aria-label={`${metric.label} history. ${selected === undefined ? '' : `Selected ${dayLabel.format(selected)}.`} Click a date or use Left, Right, Home and End to inspect.`}
      onPointerDown={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        const index = Math.round(Math.max(0, Math.min(1, ((event.clientX - rect.left) * size.width / rect.width - pad.left) / width)) * (dates.length - 1))
        onSelect(dates[index])
      }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? dates.length - 1
          : Math.max(0, Math.min(dates.length - 1, (selectedIndex < 0 ? dates.length - 1 : selectedIndex) + (event.key === 'ArrowLeft' ? -1 : 1)))
        onSelect(dates[index])
      }}>
      {[0, 1, 2, 3, 4].map(i => <g key={i} className="eth-grid-line"><line x1={pad.left} x2={pad.left + width} y1={y(top * i / 4)} y2={y(top * i / 4)} /><text x={pad.left - 9} y={y(top * i / 4)} dy=".35em" textAnchor="end">{metric.format(top * i / 4)}</text></g>)}
      {segments.map((segment, index) => {
        const points = (read: (value: EthLayerValues) => number, reverse = false) => (reverse ? [...segment].reverse() : segment).map(({ index, value }) => `${x(index)},${y(read(value))}`).join(' ')
        return <g key={index} className="eth-data-segment">
          {metric.stacked ? <>
            <polygon className="eth-area-l2" points={`${points(v => v.mainnet + v.layer2)} ${points(v => v.mainnet, true)}`} />
            <polygon className="eth-area-l1" points={`${points(v => v.mainnet)} ${points(() => 0, true)}`} />
            <polyline className="eth-line-total" points={points(v => v.mainnet + v.layer2)} />
          </> : <><polyline className="eth-line-l1" points={points(v => v.mainnet)} /><polyline className="eth-line-l2" points={points(v => v.layer2)} /></>}
          {segment.length === 1 && <><circle className="eth-point-l1" cx={x(segment[0].index)} cy={y(segment[0].value.mainnet)} r={3} /><circle className="eth-point-l2" cx={x(segment[0].index)} cy={y(metric.stacked ? segment[0].value.mainnet + segment[0].value.layer2 : segment[0].value.layer2)} r={3} /></>}
        </g>
      })}
      {selectedIndex >= 0 && <g className="eth-crosshair" data-day={selected}>
        <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={pad.top} y2={pad.top + height} />
        {selectedValue && <><circle className="eth-point-l1" cx={x(selectedIndex)} cy={y(selectedValue.mainnet)} r={3} /><circle className="eth-point-l2" cx={x(selectedIndex)} cy={y(metric.stacked ? selectedValue.mainnet + selectedValue.layer2 : selectedValue.layer2)} r={4} /></>}
      </g>}
      {ticks.map((index, i) => <text className="eth-tick" key={index} x={x(index)} y={size.height - 5} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{shortDay.format(dates[index])}</text>)}
    </svg>}
  </div>
}

function ActivityHistory({ history, loading }: { history: EthActivityDay[]; loading: boolean }) {
  const [range, setRange] = useState(30)
  const [chosenDay, setChosenDay] = useState<number>()
  const [metric, setMetric] = useState(metrics[0])
  const [mode, setMode] = useState<'breakdown' | 'compare'>('breakdown')
  const days = new Map(history.map(point => [point.day, point]))
  const newest = history.length ? Math.max(...days.keys()) : undefined
  const dates = newest === undefined ? [] : Array.from({ length: range }, (_, i) => newest - (range - i - 1) * ETH_DAY_MS)
  const selected = chosenDay !== undefined && dates.includes(chosenDay) ? chosenDay : newest
  const point = selected === undefined ? undefined : days.get(selected)
  const value = layerValues(metric, point)
  const share = layerShare(value)
  const baselineDay = dates.find(day => selected !== undefined && day < selected && layerValues(metric, days.get(day)))
  const baseline = baselineDay === undefined ? undefined : layerValues(metric, days.get(baselineDay))
  const change = (current: number, previous: number) => `${current > previous ? '+' : current < previous ? '−' : ''}${metric.format(Math.abs(current - previous))}`
  return <section className="eth-research" aria-label="Ethereum activity research workbench">
    <div className="eth-matrix-wrap">
      <div className="eth-history-heading">
        <div><h2>Four lenses on the network</h2><p>Linked dates · daily trailing 7-day averages</p></div>
        <LayerLegend />
        <div className="eth-ranges" role="group" aria-label="Activity history range">
          {[30, 90].map(days => <button key={days} type="button" aria-pressed={range === days} onClick={() => setRange(days)}>{days}D</button>)}
        </div>
      </div>
      <div className="eth-chart-matrix">
        {metrics.map(option => {
          const current = layerValues(option, point)
          return <section className={`eth-chart-card${metric === option ? ' eth-chart-active' : ''}`} key={option.id} aria-labelledby={`eth-${option.id}-heading`}>
            <header><h3 id={`eth-${option.id}-heading`}><button type="button" aria-pressed={metric === option} onClick={() => setMetric(option)}>{option.label}</button></h3><span>{option.unit}</span></header>
            <div className="eth-chart-total"><strong className="num">{current ? option.format(current.mainnet + current.layer2) : '—'}</strong><span>{option.stacked ? 'Combined' : 'Mainnet + tracked L2s'}</span></div>
            {dates.length ? <ActivityPlot metric={option} dates={dates} history={days} selected={selected} onSelect={day => { setChosenDay(day); setMetric(option) }} />
              : <p className="eth-empty">{loading ? 'Loading activity history…' : 'Activity history unavailable'}</p>}
            <dl className="eth-card-values"><div><dt>Mainnet</dt><dd className="num">{current ? option.format(current.mainnet) : '—'}</dd></div><div><dt>Layer 2s</dt><dd className="num">{current ? option.format(current.layer2) : '—'}</dd></div></dl>
          </section>
        })}
      </div>
    </div>
    <aside className="eth-inspector" aria-label="Date inspector">
      <div className="eth-eyebrow">Date inspector</div>
      <h2>{selected === undefined ? 'No date available' : <time dateTime={new Date(selected).toISOString().slice(0, 10)}>{dayLabel.format(selected)}</time>}</h2>
      <p>UTC · trailing 7-day average</p>
      {dates.length > 0 && <input className="eth-date-slider" type="range" aria-label="Inspect activity by date" aria-valuetext={selected === undefined ? '' : dayLabel.format(selected)}
        min={0} max={dates.length - 1} value={dates.indexOf(selected!)} onChange={event => setChosenDay(dates[Number(event.target.value)])} />}
      <div className="eth-inspector-modes eth-ranges" role="group" aria-label="Inspector view">
        {(['breakdown', 'compare'] as const).map(option => <button key={option} type="button" aria-pressed={mode === option} onClick={() => setMode(option)}>{option === 'breakdown' ? 'Breakdown' : 'Compare'}</button>)}
      </div>
      <div className="eth-inspector-reading" aria-live="polite">
        <h3>{metric.label}</h3>
        <div className="eth-inspector-total"><strong className="num">{value ? metric.format(value.mainnet + value.layer2) : '—'}</strong><span>{metric.unit}</span></div>
        {value ? <>
          {mode === 'breakdown' && <dl className="eth-layer-values">
            <div><dt><i className="eth-l1" />Mainnet</dt><dd className="num">{metric.format(value.mainnet)}</dd></div>
            <div><dt><i className="eth-l2" />Tracked Layer 2s</dt><dd className="num">{metric.format(value.layer2)}</dd></div>
          </dl>}
          {mode === 'breakdown' ? <>
            {share !== undefined && <><ShareBar share={share} /><div className="eth-inspector-share"><strong className="num">{tps.format(share)}%</strong><p>of {metric.label.toLowerCase()} on tracked L2s</p></div></>}
            {share === undefined && <p>Layer shares unavailable for a zero total.</p>}
          </> : baseline && baselineDay !== undefined ? <div className="eth-comparison">
            <p>Change since {shortDay.format(baselineDay)} · {metric.unit}</p>
            <dl className="eth-layer-values"><div><dt>Mainnet</dt><dd className="num">{change(value.mainnet, baseline.mainnet)}</dd></div><div><dt>Tracked Layer 2s</dt><dd className="num">{change(value.layer2, baseline.layer2)}</dd></div></dl>
          </div> : <p>No earlier observation in this range to compare.</p>}
        </> : <p>No {metric.label.toLowerCase()} observation for this date.</p>}
      </div>
      <section className="eth-share-metrics" aria-label="Layer 2 share by metric">
        <h3>Layer 2 share by metric</h3>
        {metrics.filter(option => option !== metric).map(option => {
          const percent = layerShare(layerValues(option, point))
          return <div className="eth-share-metric" key={option.id}><button type="button" onClick={() => setMetric(option)}><span>{option.label}</span><strong className="num">{percent === undefined ? '—' : `${tps.format(percent)}%`}</strong></button><div className="eth-share-track" aria-hidden="true">{percent !== undefined && <span style={{ width: `${percent}%` }} />}</div></div>
        })}
      </section>
      <p className="eth-inspect-hint">Click a chart date or use the slider.</p>
    </aside>
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
  const savedMainnet = mainnet && now - mainnet.asOf > ETH_LIVE_MAX_AGE_MS
  return <div className="eth-page">
    <header className="eth-header">
      <div className="eth-title"><svg viewBox="0 0 40 64" aria-hidden="true"><path className="eth-logo-muted" d="M20 1 1 32l19 11 19-11L20 1ZM1 36l19 27 19-27-19 11L1 36Z" /><path className="eth-logo-accent" d="M20 1v42l19-11L20 1Zm0 46v16l19-27-19 11Z" /></svg><div><h1>Ethereum <span>/ Research workbench</span></h1><p>Inspect throughput, fees and stablecoin supply on one shared timeline.</p></div></div>
      <div className="eth-source"><button type="button" onClick={async () => {
        setLinkError(false)
        try { await api.openExternal(ETH_SOURCE_URL) } catch { setLinkError(true) }
      }}>Data by growthepie ↗</button>{linkError && <span role="status">Could not open growthepie.</span>}</div>
    </header>
    <section className="eth-snapshot" aria-label="Recent Ethereum network samples">
      <div className="eth-snapshot-metric"><h2>Ecosystem · recent</h2><Rate sample={ecosystem.at(-1)} now={now} /></div>
      <div className="eth-snapshot-metric"><h2>Mainnet · recent</h2><Rate sample={mainnet} now={now} /></div>
      <div className="eth-snapshot-metric"><h2>Block interval</h2><div className="eth-rate"><strong className="num">{mainnet?.blockTimeSeconds == null ? '—' : tps.format(mainnet.blockTimeSeconds)}</strong><span>s</span></div><p className={savedMainnet ? 'eth-saved' : undefined}>Ethereum Mainnet{savedMainnet && ' · Last observed'}</p></div>
      <div className="eth-snapshot-metric"><h2>Median tx fee</h2><div className="eth-rate"><strong className="num">{mainnet?.medianTransactionFeeUsd == null ? '—' : feeUsd.format(mainnet.medianTransactionFeeUsd)}</strong></div><p className={savedMainnet ? 'eth-saved' : undefined}>Ethereum Mainnet{savedMainnet && ' · Last observed'}</p></div>
      <RecentSamples samples={ecosystem} />
    </section>
    <ActivityHistory history={data?.data.daily ?? []} loading={isPending && !error} />
  </div>
}
