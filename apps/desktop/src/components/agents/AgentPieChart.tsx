import { useId } from 'react'
import type { AgentPie } from '@shared/agentCharts'
import { colorForIndex } from '@/components/charts/Donut'

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 })
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })

function point(angle: number) {
  return [100 + 92 * Math.sin(angle), 100 - 92 * Math.cos(angle)]
}

export function AgentPieChart({ chart }: { chart: AgentPie }) {
  const titleId = useId()
  const total = chart.slices.reduce((sum, slice) => sum + slice.value, 0)
  let cursor = 0
  const positive = chart.slices.filter(slice => slice.value > 0)
  const valueText = (value: number) => `${number.format(value)}${chart.unit ? ` ${chart.unit}` : ''}`

  return <figure className="agents-pie" aria-labelledby={titleId}>
    <figcaption id={titleId}>{chart.title}</figcaption>
    <div className="agents-pie-layout">
      <svg viewBox="0 0 200 200" role="img" aria-label={`${chart.title}: pie chart. Values and percentages in the table below.`}>
        {chart.slices.map((slice, index) => {
          if (slice.value === 0) return null
          const start = cursor
          cursor += slice.value / total * Math.PI * 2
          const [x1, y1] = point(start)
          const [x2, y2] = point(cursor)
          const label = `${slice.label}: ${valueText(slice.value)} (${percent.format(slice.value / total)})`
          return positive.length === 1
            ? <circle key={index} cx="100" cy="100" r="92" fill={colorForIndex(index)}><title>{label}</title></circle>
            : <path key={index} d={`M 100 100 L ${x1} ${y1} A 92 92 0 ${cursor - start > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`} fill={colorForIndex(index)}><title>{label}</title></path>
        })}
      </svg>
      <div className="agents-pie-values" tabIndex={0} role="region" aria-label={`${chart.title} values`}>
        <table>
          <thead><tr><th scope="col">Category</th><th scope="col">Value{chart.unit ? ` (${chart.unit})` : ''}</th><th scope="col">Share</th></tr></thead>
          <tbody>{chart.slices.map((slice, index) => <tr key={index}>
            <th scope="row"><span className="agents-pie-swatch" style={{ backgroundColor: colorForIndex(index) }} aria-hidden="true" />{slice.label}</th>
            <td>{number.format(slice.value)}</td><td>{percent.format(slice.value / total)}</td>
          </tr>)}</tbody>
          <tfoot><tr><th scope="row">Total</th><td>{number.format(total)}</td><td>100%</td></tr></tfoot>
        </table>
      </div>
    </div>
    {chart.caption && <p className="agents-pie-caption">{chart.caption}</p>}
  </figure>
}
