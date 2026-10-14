import { api } from '@/api/client'
import { sensitivityReturn } from './articleVisuals'
import type { ArticleVisualData } from './articleVisuals'

const colors = ['#60a5fa', '#2dd4bf', '#e9b65c', '#b89df4', '#f49da8', '#c7d2e3']
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 })
const signed = (value: number) => `${value > 0 ? '+' : ''}${number(value)}%`

export function ArticleVisual({ visual }: { visual: ArticleVisualData }) {
  const outcomes = visual.type === 'sensitivity' ? visual.growth.flatMap(growth => visual.multipleChange.map(change => sensitivityReturn(growth, change))) : [0]
  const minimum = Math.min(...outcomes)
  const maximum = Math.max(...outcomes)
  return <figure className="article-visual" aria-label={visual.title}>
    <figcaption><span className="articles-eyebrow">{visual.type === 'flow' ? 'BUSINESS MODEL' : visual.type === 'sensitivity' ? 'ILLUSTRATIVE SCENARIO' : 'FINANCIAL COMPARISON'}</span><h4>{visual.title}</h4><p>{visual.subtitle}</p></figcaption>
    {visual.type === 'comparison' && <div className="article-chart">{visual.metrics.map(metric => {
      const maximum = Math.max(...metric.values.map(row => row.value), 1)
      const ceiling = visual.unit === '%' && maximum <= 100 ? 100 : Math.ceil(maximum / 100) * 100
      const format = (value: number) => visual.unit === '%' ? `${number(value)}%` : `$${number(value)}m`
      return <div className="article-chart-metric" key={metric.label}><h5>{metric.label}</h5>
        <div className="article-chart-axis"><span>0</span><span>{format(ceiling / 2)}</span><span>{format(ceiling)}</span></div>
        {metric.values.map((row, index) => <div className="article-chart-row" key={row.label}>
          <strong>{row.label}</strong><svg viewBox="0 0 600 34" preserveAspectRatio="none" role="img" aria-label={`${metric.label}, ${row.label}: ${format(row.value)}`}>
            <rect width="600" height="34" rx="5" fill="currentColor" opacity=".05" />
            {[0, 300, 599].map(x => <line key={x} x1={x} x2={x} y1="0" y2="34" stroke="currentColor" opacity=".12" />)}
            <rect data-value={row.value} width={row.value / ceiling * 600} y="5" height="24" rx="3" fill={colors[index]} />
          </svg><span>{format(row.value)}</span>
        </div>)}
      </div>
    })}</div>}
    {visual.type === 'flow' && <div className="article-flow">{visual.lanes.map((lane, index) => <div className="article-flow-lane" key={lane.label}>
      <h5 style={{ color: colors[index] }}>{lane.label}</h5><ol>{lane.steps.map(step => <li key={step}>{step}</li>)}</ol><p>{lane.outcome}</p>
    </div>)}</div>}
    {visual.type === 'sensitivity' && <div className="article-matrix"><p>Value change (%) · rows: profit growth · columns: multiple change</p><div className="article-matrix-scroll"><table>
      <thead><tr><th scope="col">Profit growth</th>{visual.multipleChange.map(change => <th key={change} scope="col">{signed(change)}</th>)}</tr></thead>
      <tbody>{visual.growth.map(growth => <tr key={growth}><th scope="row">{signed(growth)}</th>{visual.multipleChange.map(change => {
        const value = sensitivityReturn(growth, change)
        // Color intensity follows the numeric value; signed labels also work in grayscale.
        return <td key={change} style={{ backgroundColor: `rgba(96, 165, 250, ${.08 + (value - minimum) / Math.max(maximum - minimum, 1) * .42})` }}>{signed(value)}</td>
      })}</tr>)}</tbody>
    </table></div><div className="article-matrix-scale"><span>{signed(minimum)}</span><span aria-hidden="true" /><span>{signed(maximum)}</span></div></div>}
    <p className="article-visual-note">{visual.note}</p>
    {visual.sources.length > 0 && <div className="article-visual-sources">Sources: {visual.sources.map(source => <a href={source.url} key={source.url} onClick={event => { event.preventDefault(); void api.openExternal(source.url) }}>{source.label} ↗</a>)}</div>}
    {visual.type === 'comparison' && <details className="article-visual-data"><summary>View chart data</summary><div className="article-matrix-scroll"><table><thead><tr><th scope="col">Metric</th><th scope="col">Company</th><th scope="col">Value ({visual.unit})</th></tr></thead><tbody>{visual.metrics.flatMap(metric => metric.values.map(row => <tr key={`${metric.label}-${row.label}`}><th scope="row">{metric.label}</th><td>{row.label}</td><td>{number(row.value)}</td></tr>))}</tbody></table></div></details>}
  </figure>
}
