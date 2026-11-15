import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { AnthropicPayload } from '@shared/anthropic'
import { anthropicCommitmentBuckets, anthropicComputeSeries } from '@shared/anthropicCharts'

type Evidence = (source: string, title: string, detail: string) => void
type VisualProps = { data: AnthropicPayload; onEvidence: Evidence }
const money = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}B`
const activate = (event: KeyboardEvent<SVGCircleElement>, action: () => void) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action() }
}

function Figure({ title, note, children, action, name }: { title: string; note: string; children: ReactNode; action?: ReactNode; name: string }) {
  return <section className="ant-figure" data-ant-visual={name} aria-label={title}>
    <div className="ant-figure-heading"><h3>{title}</h3>{action}</div>{children}<p className="ant-figure-note">{note}</p>
  </section>
}

export function RevenueChart({ data, selected, onSelect, onEvidence }: VisualProps & { selected: number; onSelect: (index: number) => void }) {
  const plot = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 600, height: 100 })
  useEffect(() => {
    const element = plot.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const row = data.quarters[selected] ?? data.quarters.at(-1)
  const max = Math.max(1, ...data.quarters.flatMap(row => [row.revenue, row.compute]))
  const ceiling = Math.ceil(max / 5) * 5
  const baseline = Math.max(28, size.height - 6)
  const plotHeight = Math.max(1, baseline - 20)
  const step = Math.max(1, size.width - 46) / Math.max(1, data.quarters.length)
  const y = (value: number) => baseline - value / ceiling * plotHeight
  return <Figure title="Revenue and compute spend" name="revenue" note="USD billions · quarterly flows, rounded. Compute excludes other expenses; the gap is not gross profit."
    action={<button className="ant-chart-source" onClick={() => onEvidence('factsheet', 'Quarterly financial model', 'Revenue and compute costs are rounded quarterly flows from the November IPO fact sheet. All other operating expenses are excluded from this comparison.')}>Fact sheet ↗</button>}>
    <div className="ant-visual-legend"><span>Revenue</span><span>Compute & infrastructure</span></div>
    <div className="ant-svg-host" ref={plot}><svg viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={data.quarters.map(row => `${row.period}: revenue ${money(row.revenue)}, compute ${money(row.compute)}`).join('; ')}>
      {[0, ceiling / 2, ceiling].map(value => <g key={value}><line className="ant-grid-line" x1="34" x2={size.width - 5} y1={y(value)} y2={y(value)} /><text className="ant-axis-label" x="27" y={y(value) + 3} textAnchor="end">{value}</text></g>)}
      {data.quarters.map((row, index) => { const x = 42 + index * step; const width = Math.min(32, step / 3); return <g key={row.period}>
        {index === selected && <rect className="ant-chart-highlight" x={x - 5} y="1" width={width * 2 + 16} height={baseline} />}
        <rect className="ant-series-primary" x={x} y={y(row.revenue)} width={width} height={baseline - y(row.revenue)}><title>{row.period} revenue: {money(row.revenue)}</title></rect>
        <rect className="ant-series-secondary" x={x + width + 4} y={y(row.compute)} width={width} height={baseline - y(row.compute)}><title>{row.period} compute: {money(row.compute)}</title></rect>
        <text className="ant-value-label" x={x + width / 2} y={y(row.revenue) - 5} textAnchor="middle">{row.revenue}</text>
        <text className="ant-value-label" x={x + width * 1.5 + 4} y={y(row.compute) - 5} textAnchor="middle">{row.compute}</text>
      </g> })}
    </svg></div>
    <div className="ant-quarter-picker" aria-label="Select reported quarter">{data.quarters.map((row, index) => <button className="ant-quarter" key={row.period} aria-pressed={index === selected} onClick={() => onSelect(index)}>{row.period}</button>)}</div>
    <div className="ant-chart-readout" aria-live="polite">{row ? <><strong>{row.period}</strong><span>Revenue {money(row.revenue)}</span><span>Compute {money(row.compute)}</span></> : 'Quarterly figures unavailable'}</div>
  </Figure>
}

export function AdoptionChart({ data, onEvidence }: VisualProps) {
  const metrics = data.operatingMetrics
  const max = Math.max(1, metrics.customers100kLowerBound, metrics.customers1mLowerBound)
  return <Figure title="Enterprise customer depth" name="adoption" note={`At ${metrics.asOf} · reported lower bounds. Nested groups; do not add or infer exact customer shares.`}
    action={<button className="ant-chart-source" aria-label="Inspect source for Enterprise adoption" onClick={() => onEvidence(metrics.source, 'Enterprise adoption', `At September 30, 2026, more than ${metrics.customers100kLowerBound.toLocaleString('en-US')} customers generated at least $100K in trailing-12-month revenue; more than ${metrics.customers1mLowerBound.toLocaleString('en-US')} generated at least $1M. The latter group is included in the former.`)}>Evidence ↗</button>}>
    <div className="ant-customer-bars">{[{ label: '≥ $100K TTM revenue', value: metrics.customers100kLowerBound }, { label: '≥ $1M TTM revenue', value: metrics.customers1mLowerBound }].map(row => <div key={row.label}><div><span>{row.label}</span><strong>&gt;{row.value.toLocaleString('en-US')}</strong></div><div className="ant-horizontal-track"><span style={{ width: `${row.value / max * 100}%` }} /></div></div>)}</div>
    <div className="ant-retention"><strong>~{metrics.netRevenueRetentionApprox}%</strong><span>Net revenue retention<br />Company-defined cohort expansion</span></div>
  </Figure>
}

export function FundingCharts({ data, onEvidence }: VisualProps) {
  const [selected, setSelected] = useState(data.fundingRounds.length - 1)
  const row = data.fundingRounds[selected]
  const rounds = data.fundingRounds
  const first = Date.parse(rounds[0]?.date ?? '')
  const last = Date.parse(rounds.at(-1)?.date ?? '')
  const max = Math.max(1, ...rounds.map(row => row.valuation))
  const x = (date: string) => 62 + (Date.parse(date) - first) / Math.max(1, last - first) * 470
  const y = (value: number) => 145 - value / max * 112
  const points = rounds.map(row => `${x(row.date)},${y(row.valuation)}`).join(' ')
  const maxRaised = Math.max(1, ...rounds.map(row => row.raised))
  const choose = (index: number) => {
    setSelected(index)
    const round = rounds[index]
    onEvidence(round.source, round.round, `${round.date}: ${money(round.raised)} raised at a ${money(round.valuation)} post-money private financing valuation. This is not a traded market capitalization.`)
  }
  return <div className="ant-capital-visuals">
    <Figure title="Private valuation milestones" name="valuation" note="USD billions · post-money financing values. Dates are spaced to elapsed time; connecting lines do not imply traded prices.">
      <div className="ant-svg-host"><svg viewBox="0 0 600 182" role="group" aria-label={rounds.map(row => `${row.round}, ${row.date}: post-money valuation ${money(row.valuation)}`).join('; ')}>
        {[0, max / 2, max].map(value => <g key={value}><line className="ant-grid-line" x1="52" x2="552" y1={y(value)} y2={y(value)} /><text className="ant-axis-label" x="43" y={y(value) + 3} textAnchor="end">{Math.round(value)}</text></g>)}
        <polyline className="ant-series-line" points={points} />
        {rounds.map((round, index) => <g key={round.round}><circle className={`ant-series-point ${index === selected ? 'is-selected' : ''}`} cx={x(round.date)} cy={y(round.valuation)} r={index === selected ? 6 : 4} role="button" tabIndex={0} aria-label={`Inspect ${round.round} funding source`} onClick={() => choose(index)} onKeyDown={event => activate(event, () => choose(index))}><title>{round.date} · {money(round.valuation)}</title></circle><text className="ant-value-label" x={x(round.date)} y={y(round.valuation) - 14} textAnchor="middle">${round.valuation}B</text><text className="ant-axis-label" x={x(round.date)} y="163" textAnchor="middle">{round.date.slice(0, 7)}</text></g>)}
      </svg></div>
      <div className="ant-chart-readout" aria-live="polite"><strong>{row?.round}</strong><span>{row?.date}</span><span>{row ? `${money(row.valuation)} post-money` : 'Unavailable'}</span></div>
    </Figure>
    <Figure title="Capital raised by round" name="funding" note="USD billions · selected rounds, not cumulative capital raised. Round disclosures may include earlier strategic commitments.">
      <div className="ant-round-bars">{rounds.map((round, index) => <button key={round.round} aria-pressed={selected === index} onClick={() => choose(index)}><span>{round.round}</span><span className="ant-horizontal-track"><span style={{ width: `${round.raised / maxRaised * 100}%` }} /></span><strong>{money(round.raised)}</strong></button>)}</div>
    </Figure>
  </div>
}

export function ComputeChart({ data, selected, onSelect, onEvidence }: VisualProps & { selected: number; onSelect: (index: number) => void }) {
  const [inverted, setInverted] = useState(false)
  const rows = anthropicComputeSeries(data.quarters)
  const values = rows.map(row => inverted ? row.revenuePerSpend : row.spendPerRevenue)
  const max = Math.max(1, ...values.filter((value): value is number => value !== null)) * 1.12
  const x = (index: number) => 58 + index / Math.max(1, rows.length - 1) * 480
  const y = (value: number) => 138 - value / max * 108
  const segments: string[][] = [[]]
  values.forEach((value, index) => { if (value === null) segments.push([]); else segments.at(-1)!.push(`${x(index)},${y(value)}`) })
  return <Figure title={inverted ? 'Revenue per dollar of compute' : 'Compute spend per dollar of revenue'} name="compute" note="Derived from rounded quarterly figures. The $1 line compares these two flows only; it is not operating break-even."
    action={<div className="ant-chart-toggle" aria-label="Compute ratio basis"><button aria-pressed={!inverted} onClick={() => setInverted(false)}>Spend / revenue</button><button aria-pressed={inverted} onClick={() => setInverted(true)}>Revenue / spend</button></div>}>
    <div className="ant-svg-host"><svg viewBox="0 0 600 170" role="group" aria-label={rows.map((row, index) => `${row.period}: ${values[index]?.toFixed(2) ?? 'unavailable'} dollars ${inverted ? 'revenue per compute dollar' : 'compute per revenue dollar'}`).join('; ')}>
      {[0, 1, max].map(value => <g key={value}><line className={value === 1 ? 'ant-reference-line' : 'ant-grid-line'} x1="48" x2="552" y1={y(value)} y2={y(value)} /><text className="ant-axis-label" x="40" y={y(value) + 3} textAnchor="end">${value.toFixed(1)}</text></g>)}
      {segments.filter(segment => segment.length > 0).map((segment, index) => <polyline key={index} className="ant-series-line" points={segment.join(' ')} />)}
      {rows.map((row, index) => <g key={row.period}>{values[index] !== null && <circle className={`ant-series-point ${index === selected ? 'is-selected' : ''}`} cx={x(index)} cy={y(values[index]!)} r={index === selected ? 6 : 4} role="button" tabIndex={0} aria-label={`Inspect compute ratio for ${row.period}`} onClick={() => onSelect(index)} onKeyDown={event => activate(event, () => onSelect(index))}><title>{row.period}: ${values[index]!.toFixed(2)}</title></circle>}<text className="ant-axis-label" x={x(index)} y="159" textAnchor="middle">{row.period}</text></g>)}
    </svg></div>
    <div className="ant-chart-readout" aria-live="polite"><strong>{rows[selected]?.period}</strong><span data-ant-compute-readout>{values[selected] === null || values[selected] === undefined ? 'Unavailable' : `$${values[selected]!.toFixed(2)} ${inverted ? 'revenue / $1 compute' : 'compute / $1 revenue'}`}</span><button className="ant-chart-source" onClick={() => onEvidence('factsheet', 'Compute ratios', 'These ratios divide the rounded quarterly revenue and compute-cost figures in the fact sheet. They exclude other operating costs and are not the company-defined compute efficiency measure.')}>Method & source ↗</button></div>
  </Figure>
}

export function CapitalChart({ data, onEvidence, commitments = false }: VisualProps & { commitments?: boolean }) {
  const snapshot = data.capitalSnapshot
  const liquidity = [{ label: 'Cash & equivalents', value: snapshot.cash }, { label: 'Short-term investments', value: snapshot.shortTermInvestments }]
  const rows = commitments ? anthropicCommitmentBuckets(snapshot) : liquidity.every(row => Number.isFinite(row.value) && row.value >= 0) ? liquidity : []
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return <Figure title={commitments ? 'Compute obligation horizons' : 'Liquid resources'} name={commitments ? 'commitments' : 'liquidity'}
    note={commitments ? `As of and subsequent to ${snapshot.asOf} · approximate USD billions. Next 12 months is part of the through-2030 subtotal.` : `At ${snapshot.asOf} · approximate USD billions. Available credit of ${money(snapshot.availableCredit)} is separate, not cash.`}
    action={<button className="ant-chart-source" onClick={() => onEvidence(snapshot.source, commitments ? 'Compute commitments' : 'Liquidity', commitments ? 'Multi-year compute obligations are split into non-overlapping horizons. Later through 2030 subtracts the next-12-month amount from the disclosed through-2030 subtotal. These obligations are not current capex.' : 'Cash and short-term investments are balance-sheet resources. Undrawn available credit is shown separately and is not included in liquid resources.')}>Evidence ↗</button>}>
    <div className="ant-capital-total">{rows.length ? `~${money(total)}` : 'Unavailable'}<span>{commitments ? 'Multi-year commitments' : 'Cash + short-term investments'}</span></div>
    <div className="ant-stacked-bar" role="img" aria-label={rows.length ? rows.map(row => `${row.label}: ${money(row.value)}`).join('; ') : 'Reviewed amounts unavailable'}>{rows.map((row, index) => <span key={row.label} data-segment={index} style={{ width: `${total > 0 ? row.value / total * 100 : 0}%` }}><title>{row.label}: {money(row.value)}</title></span>)}</div>
    <div className="ant-stack-labels">{rows.map((row, index) => <div key={row.label}><i data-segment={index} /><span>{row.label}</span><strong>{money(row.value)}</strong></div>)}</div>
  </Figure>
}

export function ProductMap({ onEvidence }: { onEvidence: Evidence }) {
  return <Figure title="How Claude reaches customers" name="products" note="Qualitative distribution map · paths show access routes, not revenue mix or market shares.">
    <div className="ant-product-map"><button className="ant-model-node" onClick={() => onEvidence('models', 'Claude model family', 'The reviewed November 9 release describes Fable 5.2 and Mythos 5.2. Model availability and terms vary by product and access route.')}><span>Research & model capabilities</span><strong>Claude models</strong><small>Fable / Mythos 5.2 · reviewed release</small></button>
      <div className="ant-distribution-branches"><div><span className="ant-branch-label">↓ Direct work surfaces</span><div className="ant-product-nodes">{['Chat', 'Code', 'Cowork'].map(label => <button key={label} onClick={() => onEvidence('factsheet', label, 'Claude Chat, Claude Code and Cowork are product surfaces described in the reviewed IPO fact sheet. Their individual revenue contributions are not provided by this dossier.')}>{label}</button>)}</div></div>
        <div><span className="ant-branch-label">↓ Developer & cloud access</span><div className="ant-product-nodes">{['Direct API', 'AWS', 'Google Cloud', 'Azure'].map(label => <button key={label} onClick={() => onEvidence('funding', label, 'Claude is distributed through direct developer access and major cloud partners. The Series H announcement identifies AWS as the primary cloud and training partner. This map does not imply that every product is available through every cloud.')}>{label}</button>)}</div></div></div>
    </div>
  </Figure>
}
