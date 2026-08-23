import type { GlobalMarketsPayload } from '@shared/contract'
import { GLOBAL_INTERVALS } from '@shared/contract'
import { performancePercent, thousands } from '@/lib/format'
import type { MappedRow } from './WorldMap'

/** `_p26_export_cell`: pipes and newlines would break the table. */
function cell(value: unknown): string {
  const text = String(value ?? '--').replace(/\|/g, '/').replace(/\n/g, ' ').trim()
  return text || '--'
}

function row(values: unknown[]): string {
  return `| ${values.map(cell).join(' | ')} |`
}

/**
 * The whole page as markdown, from `_p26_build_llm_export`: one summary table across
 * every interval, then a section per interval with the closes each return was measured
 * between.
 */
export function buildGlobalLlmExport(payload: GlobalMarketsPayload, rows: MappedRow[]): string {
  const lines = [
    '# Global Market Index Export',
    `Generated: ${payload.generatedAt || new Date().toISOString()}`,
    `Source: ${payload.source || 'yahoo chart'}`,
    'Coverage: major global market indexes mapped by country/region.',
    `Intervals: ${GLOBAL_INTERVALS.join(', ')}. Performance is percent change from start close to latest close.`,
    'Market status is inferred from Yahoo chart timing metadata and displayed in the Settings clock timezone.',
    '',
    `| Region | Country | Index | Symbol | Market | Session (Clock TZ) | Last Date | Last Close | ${GLOBAL_INTERVALS.join(' | ')} |`,
    `|---|---|---|---:|---:|---|---:|---:|${GLOBAL_INTERVALS.map(() => '---:').join('|')}|`,
  ]

  for (const entry of rows) {
    lines.push(
      row([
        entry.region,
        entry.country,
        entry.name,
        entry.symbol,
        entry.status.market,
        entry.status.session,
        entry.lastDate || '--',
        thousands(entry.lastClose),
        ...GLOBAL_INTERVALS.map((interval) => {
          const payloadForInterval = entry.intervals?.[interval]
          return payloadForInterval?.available
            ? performancePercent(payloadForInterval.changePct)
            : '--'
        }),
      ]),
    )
  }

  lines.push('', '## Interval Details')
  for (const interval of GLOBAL_INTERVALS) {
    lines.push(
      '',
      `### ${interval}`,
      '| Country | Index | Symbol | Start Date | Start Close | End Date | End Close | Performance |',
      '|---|---|---:|---:|---:|---:|---:|---:|',
    )
    for (const entry of rows) {
      const item = entry.intervals?.[interval]
      lines.push(
        row([
          entry.country,
          entry.name,
          entry.symbol,
          item?.available ? item.startDate : '--',
          thousands(item?.startClose),
          item?.endDate || entry.lastDate || '--',
          thousands(item?.endClose),
          item?.available ? performancePercent(item.changePct) : '--',
        ]),
      )
    }
  }

  return lines.join('\n')
}
