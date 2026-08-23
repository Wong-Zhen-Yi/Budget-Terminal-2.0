import type { TradingVolumesPayload } from '@shared/contract'
import { TRADING_VOLUME_INTERVALS } from '@shared/contract'
import { TRADING_VOLUME_METRICS, metricValue, rankRows } from '@shared/tradingVolumes'

/**
 * The whole page as markdown, from `_p20_build_trading_volume_llm_export`.
 *
 * Six sections, each re-ranked by its own interval, so the export answers "what trades
 * most over a year" as well as "what traded most today". The page's filters are
 * deliberately ignored — the reference says so on the face of the document.
 */

/** `_p20_export_escape`: pipes and newlines would break the table. */
function cell(value: unknown): string {
  const text = String(value ?? 'N/A')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  return text || 'N/A'
}

function row(values: unknown[]): string {
  return `| ${values.map(cell).join(' | ')} |`
}

/** `_p20_format_export_currency`: full dollars, not the table's compact form. */
function exportCurrency(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'N/A'
  return `$${Math.round(value).toLocaleString('en-US')}`
}

function timestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  )
}

export function buildTradingVolumesLlmExport(
  payload: TradingVolumesPayload,
  now = new Date(),
): string {
  const intervalLabels = TRADING_VOLUME_INTERVALS.map((key) => TRADING_VOLUME_METRICS[key].label)

  const lines = [
    '# Trading Volumes Export',
    '',
    '- Page: Trading Volumes',
    '- Panel: Trading Volumes',
    `- Exported at: ${timestamp(now)}`,
    `- Data source: ${payload.source || 'Yahoo Finance'}`,
    `- Data as of: ${payload.asOf || 'N/A'}`,
    `- Intervals exported: ${intervalLabels.join(', ')}`,
    `- Stocks exported per interval: ${payload.rows.length}`,
    '- Page modifiers: Ignored',
  ]

  for (const key of TRADING_VOLUME_INTERVALS) {
    const metric = TRADING_VOLUME_METRICS[key]
    lines.push(
      '',
      `## ${metric.label} Trading Volumes`,
      '',
      `| Rank | Ticker | Name | Sector | Market Cap ($) | ${metric.label} ADV ($) |`,
      '| ---: | --- | --- | --- | ---: | ---: |',
    )
    for (const entry of rankRows(payload.rows, key)) {
      lines.push(
        row([
          entry.rank,
          entry.ticker,
          entry.name,
          entry.sector,
          exportCurrency(entry.marketCap),
          exportCurrency(metricValue(entry, metric.volumeField)),
        ]),
      )
    }
  }

  return `${lines.join('\n')}\n`
}
