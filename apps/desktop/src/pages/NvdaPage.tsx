import { useEffect, useState } from 'react'
import type { LogicalRange } from 'lightweight-charts'
import type { StocksRangePreset } from '@shared/contract'
import { api } from '@/api/client'
import { useNvda } from '@/api/nvdaQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { StocksChart } from '@/components/stocks/StocksChart'
import { PanelMessage } from '@/components/ui/Panel'
import './NvdaPage.css'

const billions = (value: number) => `$${(value / 1e9).toFixed(1)}B`
const dollars = (value: number) => `$${value.toFixed(2)}`
const signed = (value: number, decimals = 0) => `${value > 0 ? '+' : ''}${value.toFixed(decimals)}%`
const tone = (value: number) => value > 0 ? 'text-up' : value < 0 ? 'text-down' : ''
const marketRanges = ['1M', '3M', '1Y'] as const

export function NvdaPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate?: (tab: string, symbol?: string) => void
}) {
  const query = useNvda()
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [range, setRange] = useState<StocksRangePreset>('3M')
  const [logicalRange, setLogicalRange] = useState<LogicalRange | null>(null)
  const { earnings, market } = query.data?.data ?? {}
  const latest = earnings?.quarters[0]
  const selected = earnings?.quarters.find(quarter => quarter.period === selectedPeriod) ?? latest
  const guidance = earnings?.guidance
  const quote = market?.currentQuote
  const lastCandle = market?.chart.candles.at(-1)
  const stats = market?.chart.stats
  const price = quote?.price ?? lastCandle?.close
  const maxRevenue = Math.max(0, ...earnings?.quarters.map(quarter => Math.max(quarter.revenue, quarter.platforms.reduce((sum, value) => sum + value, 0))) ?? [])
  const tick = Math.max(1, Math.ceil(maxRevenue / 4e10)) * 1e10
  const chartMax = tick * 4
  const timestamp = quote?.asOf ?? (lastCandle && lastCandle.time * 1000)
  useEffect(() => {
    onStatusChange([{ label: 'NVDA', envelope: query.data, error: query.error, loading: query.isFetching, enabled: query.isEnabled }], '')
  }, [onStatusChange, query.data, query.error, query.isFetching, query.isEnabled])

  return <div className="nvda-page" data-nvda-page>
    <header className="nvda-heading">
      <div><p>NVDA <span>·</span> NASDAQ</p><h1>NVIDIA</h1></div>
      <div className="nvda-controls">
        {earnings && <button onClick={() => void api.openExternal(earnings.releaseUrl)}>Earnings release ↗</button>}
        <button onClick={() => onNavigate?.('fundamentals', 'NVDA')}>Fundamentals ↗</button>
        <button onClick={() => onNavigate?.('options', 'NVDA')}>Options ↗</button>
      </div>
    </header>
    <div className="nvda-workspace">
      <section className="nvda-demand" aria-labelledby="nvda-demand-title">
        <header className="nvda-section-heading">
          <div><h2 id="nvda-demand-title">Demand by market platform</h2><p>Reported revenue · USD billions</p></div>
          {latest && <div className="nvda-headline"><strong>{billions(latest.revenue)}</strong>
            <span className={tone(earnings!.revenueGrowthYoY)}>{signed(earnings!.revenueGrowthYoY)} YoY · {latest.period}</span></div>}
        </header>
        {earnings && selected ? <>
          <div className="nvda-revenue-chart" role="group" aria-label="Select a comparable fiscal quarter">
            <div className="nvda-axis" aria-hidden="true">{[4, 3, 2, 1, 0].map(step => <div key={step} style={{ top: `${(4 - step) * 25}%` }}>
              <span>{step * tick / 1e9}</span><i />
            </div>)}</div>
            {[...earnings.quarters].reverse().map(quarter => <button key={quarter.period} className="nvda-quarter"
              aria-pressed={quarter === selected} aria-label={`${quarter.period}, ${billions(quarter.revenue)} total revenue`}
              onClick={() => setSelectedPeriod(quarter.period)}>
              <span className="nvda-bar-area" aria-hidden="true">
                <span className="nvda-stack" style={{ height: `${quarter.platforms.reduce((sum, value) => sum + value, 0) / chartMax * 100}%` }}>
                  <span className="nvda-bar-total">{billions(quarter.revenue)}</span>
                  {quarter.platforms.map((value, index) => <i key={earnings.platformLabels[index]} className={`nvda-platform-${index}`}
                    style={{ flexGrow: value / 1e9 }} />)}
                </span>
              </span>
              <span className="nvda-quarter-label">{quarter.period}</span>
            </button>)}
          </div>
          <div className="nvda-mix" aria-label={`${selected.period} platform revenue`}>
            {earnings.platformLabels.map((label, index) => <div key={label} className="nvda-mix-cell">
              <span><i className={`nvda-platform-${index}`} />{label}</span>
              <strong>{billions(selected.platforms[index])}</strong>
              {selected === latest
                ? <small className={tone(earnings.platformGrowthYoY[index])}>{signed(earnings.platformGrowthYoY[index])} YoY</small>
                : <small>{(selected.platforms[index] / selected.revenue * 100).toFixed(1)}% of revenue</small>}
            </div>)}
          </div>
        </> : <PanelMessage>{query.isFetching ? 'Loading NVIDIA disclosures…' : 'NVIDIA disclosures unavailable'}</PanelMessage>}
      </section>
      <section className="nvda-economics" aria-labelledby="nvda-economics-title">
        <header className="nvda-section-heading">
          <div><h2 id="nvda-economics-title">Quarter economics</h2><p>{selected ? `${selected.period} · GAAP` : 'GAAP'}</p></div>
        </header>
        {selected ? <>
          <div className="nvda-concentration">
            <span>Data Center share of revenue</span>
            <strong>{(selected.dataCenter / selected.revenue * 100).toFixed(1)}%</strong>
            <div className="nvda-concentration-track" aria-hidden="true"><i style={{ width: `${Math.min(100, selected.dataCenter / selected.revenue * 100)}%` }} /></div>
          </div>
          <dl className="nvda-operating">
            <div><dt>Gross margin</dt><dd>{selected.grossMargin.toFixed(1)}%</dd></div>
            <div><dt>Operating margin</dt><dd>{(selected.operatingIncome / selected.revenue * 100).toFixed(1)}%</dd></div>
            <div><dt>Operating income</dt><dd>{billions(selected.operatingIncome)}</dd></div>
            <div><dt>Diluted EPS</dt><dd>{dollars(selected.dilutedEps)}</dd></div>
          </dl>
          {guidance && <div className="nvda-outlook">
            <span>{guidance.period} revenue outlook</span>
            <div><strong>{billions(guidance.revenueMidpoint)}</strong> <small>± {guidance.rangePct}%</small></div>
            <span>Management guidance · midpoint</span>
          </div>}
          <button className="nvda-source" onClick={() => void api.openExternal(earnings!.sourceUrl)}>CFO commentary ↗</button>
        </> : <PanelMessage>Quarterly metrics unavailable</PanelMessage>}
      </section>
    </div>
    <section className="nvda-market" aria-labelledby="nvda-market-title">
      <div className="nvda-market-detail">
        <h2 id="nvda-market-title">NVDA market price</h2>
        <div className="nvda-mark"><strong>{price == null ? '—' : dollars(price)}</strong>
          {quote && <span className={tone(quote.change)}>{signed(quote.change, 2)}</span>}</div>
        <p>{quote?.source ?? (lastCandle ? 'Yahoo Finance · last close' : 'Market quote')}{quote?.priceBasis === 'equity-perp-mark' ? ' · perpetual mark' : ''}</p>
        <p>{quote && (quote.changeBasis === '24h' ? '24h change · ' : 'vs previous close · ')}{timestamp ? new Date(timestamp).toLocaleDateString() : ''}</p>
        <div className="nvda-controls"><button onClick={() => onNavigate?.('charts', 'NVDA')}>Open charts ↗</button></div>
      </div>
      <div className="nvda-market-chart">
        <header><span>{stats?.source ?? 'Daily stock history'}</span>
          <div className="nvda-controls" role="group" aria-label="NVDA chart range">
            {marketRanges.map(value => <button key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}
          </div>
        </header>
        {market?.chart.candles.length ? <StocksChart payload={market.chart} rangePreset={range} autoFollow={false} latestCandleAnchor={0.98} mfiEnabled={false}
          logicalRange={logicalRange} onLogicalRangeChange={setLogicalRange} onManualRange={() => setRange('')} onHoverCandle={() => {}} />
          : <PanelMessage>{query.isFetching ? 'Loading NVDA price history…' : 'NVDA price history unavailable'}</PanelMessage>}
      </div>
    </section>
  </div>
}
