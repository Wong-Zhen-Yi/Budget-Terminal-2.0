import { useEffect, useState } from 'react'
import type { StocksRangePreset } from '@shared/contract'
import type { GooglReport } from '@shared/googl'
import { useGoogl } from '@/api/googlQueries'
import { api } from '@/api/client'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { StocksChart } from '@/components/stocks/StocksChart'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import './GooglPage.css'

const money = (value: number | null | undefined) => value == null ? '—' : `${value < 0 ? '−' : ''}$${(Math.abs(value) / 1e9).toFixed(2)}B`
const pct = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)}%`
const signed = (value: number | null | undefined) => value == null ? '—' : `${value > 0 ? '+' : ''}${pct(value)}`
const tone = (value: number | null | undefined) => value == null ? '' : value < 0 ? 'text-down' : value > 0 ? 'text-up' : 'text-text-muted'
const ratio = (numerator: number | null | undefined, denominator: number | null | undefined) => numerator == null || denominator == null || denominator <= 0 ? null : numerator / denominator * 100

function RevenueTrend({ reports, business }: { reports: GooglReport[]; business: string }) {
  const points = [...reports].reverse().map(report => ({ period: report.period, value: report.businesses.find(row => row.name === business)?.revenue ?? null }))
  const max = Math.max(1, ...points.map(point => point.value ?? 0))
  return <div className="googl-trend">
    <div className="googl-caption">{business} · quarterly revenue</div>
    <svg viewBox="0 0 440 215" role="img" aria-label={`${business} quarterly revenue in billions of US dollars`}>
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1="44" x2="432" y1={166 - fraction * 142} y2={166 - fraction * 142} stroke="var(--color-border)" /><text x="37" y={170 - fraction * 142} textAnchor="end">{(max * fraction / 1e9).toFixed(0)}B</text></g>)}
      {points.map((point, index) => {
        const width = 380 / Math.max(1, points.length)
        const height = point.value === null ? 0 : point.value / max * 142
        return <g key={point.period}><title>{point.period}: {money(point.value)}</title>
          <rect x={48 + index * width} y={166 - height} width={Math.max(2, width - 10)} height={height} fill="var(--color-accent)" />
          <text x={48 + index * width + (width - 10) / 2} y="185" textAnchor="middle">{point.period.slice(5)}</text>
          <text x={48 + index * width + (width - 10) / 2} y="201" textAnchor="middle">{point.period.slice(2, 4)}</text>
          {point.value === null && <text x={48 + index * width} y="155">—</text>}
        </g>
      })}
    </svg>
    <span className="googl-note">Select a business to inspect its reported revenue history.</span>
  </div>
}

export function GooglPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate?: (tab: string, symbol?: string) => void
}) {
  const query = useGoogl()
  const [period, setPeriod] = useState('')
  const [business, setBusiness] = useState('Search & other')
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const reports = query.data?.data.earnings?.reports ?? []
  const report = reports.find(row => row.period === period) ?? reports[0]
  const market = query.data?.data.market
  const quote = market?.currentQuote
  const cloud = report?.businesses.find(row => row.name === 'Google Cloud')
  const warning = query.data?.errors.find(error => error.symbol === 'earnings')?.reason
  useEffect(() => {
    onStatusChange([{ label: 'GOOGL', envelope: query.data, error: query.error, loading: query.isFetching, enabled: query.isEnabled }], '')
  }, [onStatusChange, query.data, query.error, query.isFetching, query.isEnabled])
  const empty = query.isFetching ? 'Loading Alphabet disclosures…' : 'Alphabet disclosures unavailable. See Settings for source diagnostics.'
  return <div className="googl-page" data-googl-page>
    <header className="googl-heading">
      <div><h1>GOOGL <span>Alphabet</span></h1><p>Search economics · Cloud expansion · Infrastructure investment</p></div>
      <div className="googl-actions">
        <label>Reported quarter <select aria-label="Reported quarter" value={report?.period ?? ''} onChange={event => setPeriod(event.target.value)} disabled={!reports.length}>
          {!reports.length && <option value="">—</option>}{reports.map(row => <option key={row.period}>{row.period}</option>)}
        </select></label>
        <Button onClick={() => void api.openExternal('https://abc.xyz/investor/')}>Investor relations ↗</Button>
        <Button disabled={!report} onClick={() => report && void api.openExternal(report.sourceUrl)}>Earnings release ↗</Button>
      </div>
    </header>
    <div className="googl-summary">
      <div><span>Alphabet revenue</span><strong>{money(report?.revenue)}</strong><small className={tone(report?.revenueGrowth)}>{signed(report?.revenueGrowth)} YoY</small></div>
      <div><span>Operating margin</span><strong>{pct(report?.operatingMargin)}</strong><small>{money(report?.operatingIncome)} operating income</small></div>
      <div><span>Cloud revenue growth</span><strong className={tone(cloud?.growth)}>{signed(cloud?.growth)}</strong><small>{pct(ratio(report?.cloudOperatingIncome, cloud?.revenue))} Cloud margin</small></div>
      <div><span>Capex / operating cash flow</span><strong>{pct(ratio(report?.capex, report?.operatingCashFlow))}</strong><small>{money(report?.freeCashFlow)} free cash flow</small></div>
    </div>
    <div className="googl-upper">
      <Panel title="Where revenue comes from" warning={warning} actions={<span className="googl-note">{report?.period} · USD</span>}>
        {report ? <div className="googl-revenue">
          <div className="googl-businesses" role="group" aria-label="Revenue businesses">
            <div className="googl-business-labels"><span>Business</span><span>Revenue / YoY</span></div>
            {report.businesses.map(row => <button key={row.name} className="googl-business" aria-pressed={business === row.name} onClick={() => setBusiness(row.name)}>
              <span>{row.name}<i style={{ width: `${Math.max(0, (row.revenue ?? 0) / report.revenue * 100)}%` }} /></span>
              <span><b>{money(row.revenue)}</b><small className={tone(row.growth)}>{signed(row.growth)}</small></span>
            </button>)}
            <div className="googl-note">Bars show share of total revenue. Total includes hedging gains / losses.</div>
          </div>
          <RevenueTrend reports={reports.filter(row => row.period <= report.period)} business={business} />
        </div> : <PanelMessage>{empty}</PanelMessage>}
      </Panel>
      <Panel title="GOOGL · Class A shares" actions={<div className="googl-ranges">{(['1M', '3M', '1Y', '3Y'] as const).map(value => <button key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}</div>}>
        <div className="googl-quote"><strong>{quote ? `$${quote.price.toFixed(2)}` : '—'}</strong><span className={tone(quote?.change)}>{signed(quote?.change)}</span><small>{quote?.source ?? 'Market quote'} · {quote?.changeBasis === '24h' ? '24h change' : 'previous close'}{quote?.priceBasis === 'equity-perp-mark' ? ' · perpetual mark' : ''}{quote?.asOf ? ` · ${new Date(quote.asOf).toLocaleString()}` : ''}</small></div>
        <div className="googl-price">{market?.chart.candles.length ? <StocksChart payload={market.chart} mfiEnabled={false} autoFollow rangePreset={range} logicalRange={null} onLogicalRangeChange={() => {}} onManualRange={() => setRange('')} onHoverCandle={() => {}} /> : <PanelMessage>{query.isFetching ? 'Loading GOOGL price history…' : 'Price history unavailable'}</PanelMessage>}</div>
        <div className="googl-history-source">Daily history · {market?.chart.stats.source ?? 'Yahoo Finance'} · {market?.chart.candles.length ? new Date(market.chart.candles[market.chart.candles.length - 1].time * 1000).toLocaleDateString() : '—'}</div>
        <div className="googl-market-metrics"><span>Market cap <b>{market?.metrics.marketCap ?? '—'}</b></span><span>Forward P/E <b>{market?.metrics.forwardPe ?? '—'}</b></span><span>Next earnings <b>{market?.metrics.earningsDate ?? '—'}</b></span></div>
        <div className="googl-links">{['charts', 'fundamentals', 'valuation', 'options'].map(tab => <button key={tab} onClick={() => onNavigate?.(tab, 'GOOGL')}>{tab[0].toUpperCase() + tab.slice(1)} ↗</button>)}</div>
      </Panel>
    </div>
    <div className="googl-lower">
      <Panel title="Profit engines & distribution costs" warning={warning}>
        {report ? <div className="googl-profit">
          <div className="googl-profit-rows">{[
            ['Google Services', report.servicesOperatingIncome], ['Google Cloud', report.cloudOperatingIncome],
            ['Other Bets', report.otherBetsOperatingIncome], ['Alphabet-level activities', report.alphabetLevelIncome],
          ].map(([name, value]) => <div key={String(name)}><span>{name}</span><b className={tone(value as number | null)}>{money(value as number | null)}</b></div>)}
            <div className="googl-total"><span>Consolidated operating income</span><b>{money(report.operatingIncome)}</b></div>
          </div>
          <div className="googl-tac"><span>Traffic acquisition costs</span><strong>{money(report.tac)}</strong><b>{pct(report.tacRate)} of advertising revenue</b><p>Payments to distribution partners and network members. Alphabet-level activities include shared AI research expenses.</p><small>Diluted EPS <b>{report.dilutedEps == null ? '—' : `$${report.dilutedEps.toFixed(2)}`}</b></small></div>
        </div> : <PanelMessage>{empty}</PanelMessage>}
      </Panel>
      <Panel title="Cash generation & capital allocation" warning={warning} actions={<span className="googl-note">Quarterly · USD</span>}>
        {report ? <div className="googl-cash">
          <div className="googl-cash-flow">{[
            ['Operating cash flow', report.operatingCashFlow, 'var(--color-accent)'],
            ['Capital expenditure', report.capex, 'var(--color-warn)'],
            ['Free cash flow', report.freeCashFlow, (report.freeCashFlow ?? 0) < 0 ? 'var(--color-down)' : 'var(--color-up)'],
          ].map(([name, value, color]) => <div key={String(name)}><span>{name}</span><div className="googl-cash-track"><i style={{ width: `${Math.abs(Number(value ?? 0)) / Math.max(1, Math.abs(report.operatingCashFlow ?? 0), report.capex ?? 0, Math.abs(report.freeCashFlow ?? 0)) * 100}%`, background: String(color) }} /></div><b>{money(value as number | null)}</b></div>)}
          </div>
          <div className="googl-capital"><span>Buybacks <b>{money(report.buybacks)}</b></span><span>Dividends paid <b>{money(report.dividends)}</b></span><span>FCF margin <b className={tone(report.freeCashFlow)}>{pct(ratio(report.freeCashFlow, report.revenue))}</b></span></div>
          <p className="googl-note">Free cash flow = operating cash flow − purchases of property and equipment. Capex is company-wide; Alphabet does not disclose an AI-only split.</p>
        </div> : <PanelMessage>{empty}</PanelMessage>}
      </Panel>
    </div>
  </div>
}
