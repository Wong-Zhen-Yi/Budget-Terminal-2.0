import { useId } from 'react'
import type { HomebuilderRow } from '@shared/homebuilders'
import { compactCurrency } from '@/lib/format'

export function BuilderCapitalMap({ rows, symbol, onSelect }: { rows: HomebuilderRow[]; symbol: string; onSelect: (symbol: string) => void }) {
  const id = useId()
  const builders = rows.filter(row => row.company.kind === 'builder')
  const points = builders.flatMap(row => {
    const book = row.profile?.priceToBook
    const roe = row.profile?.returnOnEquity
    return book !== null && book !== undefined && Number.isFinite(book) && book > 0 && roe !== null && roe !== undefined && Number.isFinite(roe)
      ? [{ row, book, roe: roe * 100 }] : []
  })
  const xMax = Math.max(3, ...points.map(point => point.book * 1.15))
  const yMin = Math.min(0, ...points.map(point => point.roe * 1.2))
  const yMax = Math.max(25, ...points.map(point => point.roe * 1.2))
  const x = (value: number) => 52 + value / xMax * 448
  const y = (value: number) => 252 - (value - yMin) / (yMax - yMin) * 215
  const maxCap = Math.max(1, ...points.map(point => point.row.market?.marketCap ?? 0))
  return <section className="hb-capital" aria-labelledby={`${id}-title`}>
    <header><span className="hb-kicker">02 / The builder</span><h2 id={`${id}-title`}>What is the market paying for the equity?</h2><p>Price / book against reported return on equity</p></header>
    <div className="hb-capital-plot" data-homebuilder-capital-map>
      {points.length ? <svg viewBox="0 0 540 300" role="group" aria-label="Builder valuation map: price to book on the horizontal axis, return on equity on the vertical axis">
        {[0, 1, 2, 3, 4].map(index => {
          const value = yMin + (yMax - yMin) * index / 4
          return <g key={index}><line x1="52" x2="500" y1={y(value)} y2={y(value)} className="hb-map-grid" /><text x="43" y={y(value) + 4} textAnchor="end">{value.toFixed(0)}%</text></g>
        })}
        {[0, 1, 2, 3, 4].map(index => <g key={index}><text x={x(xMax * index / 4)} y="272" textAnchor="middle">{(xMax * index / 4).toFixed(1)}x</text></g>)}
        <text x="52" y="18">ROE · TTM</text><text x="500" y="294" textAnchor="end">Price / book →</text>
        {points.map(({ row, book, roe }, index) => <g key={row.company.symbol} className="hb-map-point" role="button" tabIndex={0} aria-label={`Select ${row.company.symbol}: ${book.toFixed(2)} times book, ${roe.toFixed(1)} percent ROE`}
          aria-pressed={symbol === row.company.symbol} onClick={() => onSelect(row.company.symbol)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(row.company.symbol) } }}>
          <title>{row.company.name} · P/B {book.toFixed(2)}x · ROE {roe.toFixed(1)}% · market cap {compactCurrency(row.market?.marketCap)}</title>
          <circle cx={x(book)} cy={y(roe)} r={6 + Math.sqrt(Math.max(0, row.market?.marketCap ?? 0) / maxCap) * 9} />
          <text x={x(book)} y={y(roe) + (index % 2 ? 28 : -21)} textAnchor="middle">{row.company.symbol}</text>
        </g>)}
      </svg> : <div className="hb-empty">Comparable book values and ROE are unavailable.</div>}
    </div>
    <div className="hb-map-caption">{points.length}/{builders.length} builders with comparable data · circle size reflects market cap · select a builder</div>
    <div className="hb-capital-context"><strong>Read the land behind the multiple</strong><p>Book value reflects each company's assets and liabilities. Lot ownership, purchase options, impairments and buybacks affect comparability. ROE and book value alone do not establish fair value.</p></div>
    <div className="hb-report-questions"><span>Follow through in the next report</span><div><b>Demand</b><small>Net orders · cancellations · incentives</small></div><div><b>Delivery</b><small>Closings · backlog · selling prices</small></div><div><b>Land</b><small>Lot control · land spend · cash flow</small></div></div>
  </section>
}
