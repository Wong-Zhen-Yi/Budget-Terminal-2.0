import type { ReactNode } from 'react'

import type { Candle, DiscoverySnapshot } from '@shared/contract'
import type { DiscoveryAnalysis } from '@shared/discovery'
import { compact, decimal, money, signedPercent } from './format'

const fractionPercent = (value: number | null | undefined) => value === null || value === undefined ? 'N/A' : `${(value * 100).toFixed(2)}%`
const ratio = (value: number | null | undefined) => value === null || value === undefined ? 'N/A' : `${value.toFixed(2)}x`
const date = (value: number | null | undefined) => value === null || value === undefined ? 'N/A' : new Date(value).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })

function tone(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : value > 0 ? 'sd-positive' : value < 0 ? 'sd-negative' : ''
}

export function TerminalPanel({ title, aside, children, className = '' }: { title: string; aside?: string; children: ReactNode; className?: string }) {
  return <section className={`sd-panel ${className}`}><header className="sd-panel-header"><span>{title}</span>{aside ? <span className="sd-muted">{aside}</span> : null}</header>{children}</section>
}

type Row = [string, string, string?]
export function MetricRows({ rows }: { rows: Row[] }) {
  return <div className="sd-rows">{rows.map(([label, value, className]) => <div className="sd-row" key={label}><span>{label}</span><strong className={className ?? (value.startsWith('-') ? 'sd-negative' : value.startsWith('+') ? 'sd-positive' : '')}>{value}</strong></div>)}</div>
}

export function PriceChart({ candles }: { candles: Candle[] }) {
  const recent = candles.slice(-126)
  const values = recent.map((row) => row.close)
  if (values.length < 2) return <div className="sd-chart-empty">PRICE HISTORY N/A</div>
  const low = Math.min(...values)
  const high = Math.max(...values)
  const spread = high - low || 1
  const points = values.map((value, index) => `${(index / (values.length - 1) * 1000).toFixed(1)},${(185 - (value - low) / spread * 160).toFixed(1)}`).join(' ')
  const up = values.at(-1)! >= values[0]
  return <div className="sd-chart-wrap">
    <svg viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label="Six month price chart">
      {[25, 65, 105, 145, 185].map((line) => <line key={line} x1="0" y1={line} x2="1000" y2={line} stroke="var(--color-border)" strokeWidth="1" />)}
      {[250, 500, 750].map((line) => <line key={line} x1={line} y1="0" x2={line} y2="200" stroke="var(--color-border)" strokeWidth="1" />)}
      <polyline points={points} fill="none" stroke={up ? 'var(--color-up)' : 'var(--color-down)'} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="sd-chart-axis"><span>{new Date(recent[0].time * 1000).toLocaleDateString()}</span><span>HIGH {money(high)} · LOW {money(low)}</span><span>{new Date(recent.at(-1)!.time * 1000).toLocaleDateString()}</span></div>
  </div>
}

export function RangeIndicator({ position }: { position: number | null }) {
  return <div className="sd-range"><span>52W LOW</span><div className="sd-range-track">{position !== null ? <i style={{ left: `${Math.max(0, Math.min(100, position))}%` }} /> : null}</div><span>52W HIGH</span></div>
}

export function DiscoveryMetrics({ snapshot, analysis }: { snapshot: DiscoverySnapshot; analysis: DiscoveryAnalysis }) {
  const market = snapshot.market
  const valuation = snapshot.valuation
  const financial = snapshot.financials
  const tech = analysis.technicals
  const analyst = snapshot.analyst
  return <>
    <div className="sd-top-grid">
      <TerminalPanel title="PRICE // 6M DAILY" aside={`${snapshot.candles.length} bars`} className="sd-price-panel">
        <PriceChart candles={snapshot.candles} />
        <div className="sd-chart-stats"><span>FROM 52W HIGH <b className={tone(tech.fromHigh)}>{signedPercent(tech.fromHigh)}</b></span><span>FROM 52W LOW <b className={tone(tech.fromLow)}>{signedPercent(tech.fromLow)}</b></span><span>VS SMA200 <b className={tone(tech.vsSma200)}>{signedPercent(tech.vsSma200)}</b></span><span>FCF YIELD <b>{fractionPercent(valuation.fcfYield)}</b></span></div>
        <RangeIndicator position={tech.rangePosition ?? null} />
      </TerminalPanel>
      <TerminalPanel title="MARKET DATA" aside="USD">
        <MetricRows rows={[
          ['OPEN', money(market.open)], ['PREV CLOSE', money(snapshot.previousClose)],
          ['DAY HIGH / LOW', `${money(market.dayHigh)} / ${money(market.dayLow)}`],
          ['52W HIGH / LOW', `${money(market.high52)} / ${money(market.low52)}`],
          ['VOLUME', compact(market.volume)], ['AVG VOLUME', compact(market.averageVolume)],
          ['MARKET CAP', money(market.marketCap)], ['BETA', decimal(market.beta)],
          ['SHARES OUT', compact(market.sharesOutstanding)],
        ]} />
      </TerminalPanel>
      <TerminalPanel title="TECHNICALS" aside="DAILY">
        <MetricRows rows={[
          ['RSI 14', decimal(tech.rsi14)], ['MACD', decimal(tech.macd)], ['MACD SIGNAL', decimal(tech.macdSignal)],
          ['SMA 20', money(tech.sma20)], ['SMA 50', money(tech.sma50)], ['SMA 200', money(tech.sma200)],
          ['VS SMA 200', signedPercent(tech.vsSma200), tone(tech.vsSma200)],
          ['AVG VOLUME 20D', compact(tech.avgVolume20)], ['REL VOLUME', ratio(tech.relativeVolume)],
          ['ATR 14', money(tech.atr14)], ['52W POSITION', tech.rangePosition === null || tech.rangePosition === undefined ? 'N/A' : `${tech.rangePosition.toFixed(1)}%`],
        ]} />
      </TerminalPanel>
    </div>
    <div className="sd-middle-grid">
      <TerminalPanel title="VALUATION" aside="LATEST AVAILABLE"><MetricRows rows={[
        ['P/E', ratio(valuation.pe)], ['FORWARD P/E', ratio(valuation.forwardPe)], ['PEG', ratio(valuation.peg)],
        ['PRICE / SALES', ratio(valuation.priceSales)], ['PRICE / BOOK', ratio(valuation.priceBook)],
        ['EV / REVENUE', ratio(valuation.evRevenue)], ['EV / EBITDA', ratio(valuation.evEbitda)],
        ['ENTERPRISE VALUE', money(valuation.enterpriseValue)], ['FCF YIELD', fractionPercent(valuation.fcfYield)],
        ['EARNINGS YIELD', fractionPercent(valuation.earningsYield)],
      ]} /></TerminalPanel>
      <TerminalPanel title="FINANCIALS" aside="TTM / LATEST REPORTED"><MetricRows rows={[
        ['REVENUE', money(financial.revenue)], ['REVENUE GROWTH', fractionPercent(financial.revenueGrowth)],
        ['GROSS PROFIT', money(financial.grossProfit)], ['GROSS MARGIN', fractionPercent(financial.grossMargin)],
        ['OPERATING INCOME', money(financial.operatingIncome)], ['OPERATING MARGIN', fractionPercent(financial.operatingMargin)],
        ['EBITDA', money(financial.ebitda)], ['EBITDA MARGIN', fractionPercent(financial.ebitdaMargin)],
        ['NET INCOME', money(financial.netIncome)], ['EPS', money(financial.eps)], ['EPS GROWTH', fractionPercent(financial.epsGrowth)],
        ['FREE CASH FLOW', money(financial.freeCashFlow)], ['CASH', money(financial.cash)], ['TOTAL DEBT', money(financial.debt)],
        ['NET CASH / DEBT', money(financial.netCash)], ['DEBT / EQUITY', ratio(financial.debtEquity === null ? null : financial.debtEquity / 100)],
        ['ROE', fractionPercent(financial.roe)], ['ROA', fractionPercent(financial.roa)], ['ROIC', fractionPercent(financial.roic)],
      ]} /></TerminalPanel>
      <div className="sd-stack">
        <TerminalPanel title="PERFORMANCE" aside="PRICE RETURN"><div className="sd-performance">{Object.entries(analysis.performance).map(([period, value]) => <div key={period}><span>{period}</span><strong className={tone(value)}>{signedPercent(value)}</strong></div>)}</div></TerminalPanel>
        <TerminalPanel title="SIGNALS" aside="OBJECTIVE CONDITIONS"><div className="sd-signals">{analysis.signals.length ? analysis.signals.map((signal) => <span key={signal}>{signal}</span>) : <span>N/A</span>}</div></TerminalPanel>
        <TerminalPanel title="ANALYST / EARNINGS" aside="WHEN AVAILABLE"><MetricRows rows={[
          ['ANALYSTS', compact(analyst.count)], ['MEAN TARGET', money(analyst.target)],
          ['TARGET UPSIDE', signedPercent(analyst.target && snapshot.price ? (analyst.target / snapshot.price - 1) * 100 : null)],
          ['RECOMMENDATION MEAN', decimal(analyst.recommendation)], ['NEXT EARNINGS', date(snapshot.nextEarnings)],
          ['LAST EARNINGS', date(snapshot.lastEarnings)], ['EPS ESTIMATE', money(analyst.epsEstimate)],
          ['REVENUE ESTIMATE', money(analyst.revenueEstimate)],
        ]} /></TerminalPanel>
      </div>
    </div>
  </>
}

export function CompanyPanel({ snapshot }: { snapshot: DiscoverySnapshot }) {
  const url = snapshot.website && /^https?:\/\//i.test(snapshot.website) ? snapshot.website : null
  return <TerminalPanel title="COMPANY INFORMATION" aside={snapshot.country ?? 'N/A'}>
    <div className="sd-company-facts"><span>CEO <b>{snapshot.ceo ?? 'N/A'}</b></span><span>EMPLOYEES <b>{compact(snapshot.employees)}</b></span><span>IPO <b>{date(snapshot.ipoDate)}</b></span><span>WEB <b>{url ? <a href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, '')}</a> : 'N/A'}</b></span></div>
    <p className="sd-description">{snapshot.description ?? 'Company description N/A.'}</p>
  </TerminalPanel>
}
