import { useId, useState } from 'react'
import { useNewsThumbnail } from '@/api/newsQueries'
import type { Json } from '@shared/polymarket'
import { marketImageUrl, object, rows } from '@/api/polymarketQueries'

type Market = Record<string, Json>
const numeric = (value: Json | undefined) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
export const formatNumber = (value: Json | undefined) => numeric(value) == null ? '—' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))
export const formatMoney = (value: Json | undefined) => numeric(value) == null ? '—' : `$${formatNumber(value)}`
export const probability = (value: Json | undefined) => numeric(value) == null ? '—' : `${(Number(value) * 100).toFixed(Number(value) > .01 && Number(value) < .99 ? 1 : 0)}%`
const shortAddress = (value: Json | undefined) => typeof value === 'string' && value.length > 18 ? `${value.slice(0, 6)}…${value.slice(-4)}` : String(value ?? 'Anonymous')

export function MarketImage({ market }: { market: Market }) {
  const [failed, setFailed] = useState('')
  const url = marketImageUrl(market)
  const image = useNewsThumbnail(url, Boolean(url))
  const initials = String(market.question ?? '?').replace(/^(will|is|does|what|who)\s+/i, '').slice(0, 2).toUpperCase()
  return <span className="poly-market-image"><span aria-hidden="true">{initials}</span>{image.data?.data.dataUri && failed !== url && <img src={image.data.data.dataUri} alt="" onError={() => setFailed(url)}/>}</span>
}

export function MarketChart({ value }: { value: Json | undefined }) {
  const gradient = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const points = rows(value).map(row => ({ t: numeric(row.timestamp ?? row.t), p: numeric(row.price ?? row.p) }))
    .filter((point): point is { t: number; p: number } => point.t != null && point.p != null && point.p >= 0 && point.p <= 1).sort((a, b) => a.t - b.t)
  if (!points.length) return <div className="poly-empty">No price history available for this outcome and range.</div>
  const min = Math.min(...points.map(point => point.p))
  const max = Math.max(...points.map(point => point.p))
  const padding = Math.max(.03, (max - min) * .2)
  const low = Math.max(0, Math.floor((min - padding) * 20) / 20)
  const high = Math.min(1, Math.ceil((max + padding) * 20) / 20)
  const first = points[0].t
  const last = points[points.length - 1].t
  const x = (t: number) => 18 + (t - first) / Math.max(1, last - first) * 820
  const y = (p: number) => 232 - (p - low) / Math.max(.01, high - low) * 208
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${x(point.t)},${y(point.p)}`).join(' ')
  const focus = hover == null ? null : points[Math.min(hover, points.length - 1)]
  const stamp = (t: number) => new Date(t * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric', ...(last - first < 172800 ? { hour: 'numeric', minute: '2-digit' } : {}) })
  return <div className="poly-chart"><svg viewBox="0 0 900 278" role="img" aria-label="Outcome probability over time" onPointerLeave={() => setHover(null)} onPointerMove={event => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const target = first + Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 900 - 18) / 820)) * (last - first)
    let index = 0
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - target) < Math.abs(points[index].t - target)) index = i
    setHover(index)
  }}>
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4c8dff" stopOpacity=".22"/><stop offset="100%" stopColor="#4c8dff" stopOpacity="0"/></linearGradient></defs>
    {[0, 1, 2, 3, 4].map(i => { const price = low + (high - low) * i / 4; return <g key={i}><line x1="18" x2="838" y1={y(price)} y2={y(price)} stroke="currentColor" opacity=".09" strokeDasharray="3 5"/><text x="856" y={y(price) + 4} fill="currentColor" fontSize="12">{(price * 100).toFixed(0)}%</text></g> })}
    <path d={`${path} L${x(last)},240 L18,240 Z`} fill={`url(#${gradient})`}/><path d={path} fill="none" stroke="#5b97ff" strokeWidth="2.5" strokeLinejoin="round"/>
    <circle cx={x(last)} cy={y(points[points.length - 1].p)} r="4" fill="#79aaff"/>
    {[0, .33, .66, 1].map(fraction => <text key={fraction} x={18 + fraction * 820} y="267" textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'} fill="currentColor" fontSize="11">{stamp(first + (last - first) * fraction)}</text>)}
    {focus && <g><line x1={x(focus.t)} x2={x(focus.t)} y1="15" y2="240" stroke="#6c7b91" strokeDasharray="4 4"/><circle cx={x(focus.t)} cy={y(focus.p)} r="5" fill="#91b9ff" stroke="#121b28" strokeWidth="2"/></g>}
  </svg>{focus && <div className="poly-chart-tooltip"><strong>{probability(focus.p)}</strong><span>{new Date(focus.t * 1000).toLocaleString()}</span></div>}</div>
}

export function MarketBook({ value }: { value: Json | undefined }) {
  const book = object(value)
  const levels = (side: 'asks' | 'bids') => (Array.isArray(book[side]) ? book[side].map(item => object(item)) : []).filter(row => numeric(row.price) != null && numeric(row.size) != null).sort((a, b) => Number(b.price) - Number(a.price))
  const asks = levels('asks').slice(-3)
  const bids = levels('bids').slice(0, 3)
  const maximum = Math.max(1, ...[...asks, ...bids].map(row => Number(row.size)))
  const bestAsk = asks.length ? Number(asks[asks.length - 1].price) : null
  const bestBid = bids.length ? Number(bids[0].price) : null
  const side = (values: Market[], name: 'asks' | 'bids') => values.length ? values.map((row, i) => <div key={i} className={`poly-book-row ${name}`}><i style={{ width: `${Number(row.size) / maximum * 100}%` }}/><span>{name === 'asks' ? 'Ask' : 'Bid'}</span><strong>{(Number(row.price) * 100).toFixed(1)}¢</strong><span>{formatNumber(row.size)}</span><span>{formatMoney(Number(row.price) * Number(row.size))}</span></div>) : <p className="poly-empty">No {name} available.</p>
  return <><div className="poly-book-columns"><span>Side</span><span>Price</span><span>Shares</span><span>Total</span></div>{side(asks, 'asks')}<div className="poly-spread"><span>Spread</span><strong>{bestAsk == null || bestBid == null ? '—' : `${((bestAsk - bestBid) * 100).toFixed(2)}¢`}</strong></div>{side(bids, 'bids')}<div className="poly-book-depth"><span><i/>Bids · buyers</span><span><i/>Asks · sellers</span></div></>
}

export function MarketActivity({ value, kind, token, outcome }: { value: Json | undefined; kind: string; token?: string; outcome?: string }) {
  let data = rows(value)
  if (kind === 'Top holders') {
    data = data.filter(row => !token || String(row.token_id) === token).flatMap(row => Array.isArray(row.holders) ? row.holders.map(holder => object(holder)) : [])
  }
  if (!data.length) return <div className="poly-empty">{kind === 'Top holders' ? `No public holder records for ${outcome ?? 'this outcome'}.` : kind === 'Activity' ? 'No recent trades for this market.' : 'No leaderboard entries available.'}</div>
  const headers = kind === 'Activity' ? ['Trader', 'Action', 'Outcome', 'Price', 'Shares', 'Time'] : kind === 'Top holders' ? ['Holder', 'Outcome', 'Shares', 'Position'] : ['Rank', 'Trader', 'Profit / loss', 'Volume (shares)']
  return <div className="poly-activity-scroll"><table className="poly-activity-table"><thead><tr>{headers.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.slice(0, 25).map((row, i) => <tr key={i}>
    {kind === 'Activity' ? <><td><span className="poly-avatar">{String(row.name ?? row.pseudonym ?? row.proxy_wallet ?? '?').slice(0, 2).toUpperCase()}</span>{shortAddress(row.name || row.pseudonym || row.proxy_wallet || row.wallet)}</td><td><span className={row.side === 'BUY' ? 'poly-trade-buy' : 'poly-trade-sell'}>{row.side === 'BUY' ? 'Bought' : row.side === 'SELL' ? 'Sold' : String(row.side ?? '—')}</span></td><td>{String(row.outcome ?? '—')}</td><td>{numeric(row.price) == null ? '—' : `${(Number(row.price) * 100).toFixed(1)}¢`}</td><td>{formatNumber(row.size)}</td><td>{numeric(row.timestamp) == null ? '—' : new Date(Number(row.timestamp) * (Number(row.timestamp) > 1e12 ? 1 : 1000)).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</td></> : kind === 'Top holders' ? <><td><span className="poly-avatar">{i + 1}</span>{shortAddress(row.name || row.pseudonym || row.proxy_wallet || row.wallet)}</td><td>{outcome ?? '—'}</td><td>{formatNumber(row.amount ?? row.size ?? row.balance)}</td><td>{formatMoney(row.value ?? row.current_value)}</td></> : <><td className="poly-rank">{String(row.rank ?? i + 1)}</td><td>{shortAddress(row.user_name || row.userName || row.user_id || row.wallet)}</td><td className={Number(row.pnl) >= 0 ? 'poly-positive' : 'poly-negative'}>{formatMoney(row.pnl)}</td><td>{formatNumber(row.volume)}</td></>}
  </tr>)}</tbody></table></div>
}
